import Anthropic from "@anthropic-ai/sdk";
import { readFile, readdir, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { EXTRACTION_PROMPT_V2 } from "./config/extraction-prompt-v2.js";

const HTML_DIR = join(process.cwd(), "data", "html");
const OUTPUT_DIR = join(process.cwd(), "data", "extracted");
const COST_DIR = join(process.cwd(), "data", "costs");

// CLI: --only nacka,malmo to extract specific municipalities
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const onlyIds = onlyArg ? onlyArg.split("=")[1].split(",") : null;

// Haiku pricing (per token, as of 2025)
// Input: $0.80 per 1M tokens = $0.0000008/token
// Output: $4.00 per 1M tokens = $0.000004/token
const HAIKU_INPUT_COST_PER_TOKEN = 0.0000008;
const HAIKU_OUTPUT_COST_PER_TOKEN = 0.000004;

const EXTRACTION_PROMPT = EXTRACTION_PROMPT_V2;

async function ensureDirs() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  await mkdir(COST_DIR, { recursive: true });
}

function truncateHtml(html, maxChars = 100000) {
  // Haiku context window is 200k tokens. Typical HTML char:token ratio ~1:0.3
  // 100k chars ~ 30k tokens, leaving plenty of room for prompt + output
  if (html.length <= maxChars) return html;

  console.log(`  HTML truncated from ${html.length} to ${maxChars} chars`);
  return html.slice(0, maxChars);
}

function stripNonContent(html) {
  // Remove scripts, styles, SVGs, and comments to reduce token usage
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<link[^>]*>/gi, "")
    .replace(/<meta[^>]*>/gi, "")
    .replace(/<img[^>]*>/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function prepareHtml(html) {
  // For multi-page HTML (listing + detail pages), skip the listing and
  // only keep the detail pages to avoid truncation losing actual content.
  if (html.includes("<!-- DETAIL PAGE:")) {
    const parts = html.split(/<!-- DETAIL PAGE:/);
    // parts[0] is the listing page — skip it
    const detailParts = parts.slice(1).map((p) => "<!-- DETAIL PAGE:" + p);
    console.log(`  Multi-page HTML: skipping listing, using ${detailParts.length} detail pages`);
    const combined = detailParts.map((p) => stripNonContent(p)).join("\n\n");
    return truncateHtml(combined, 200000);
  }
  return truncateHtml(stripNonContent(html));
}

async function extractFromHtml(client, html, municipalityName, sourceUrl) {
  const prepared = prepareHtml(html);

  const startTime = Date.now();

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 8192,
    messages: [
      {
        role: "user",
        content: `${EXTRACTION_PROMPT}\n\nKommun: ${municipalityName}\n\nHTML:\n${prepared}`
      }
    ]
  });

  const elapsed = Date.now() - startTime;
  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const cost = (inputTokens * HAIKU_INPUT_COST_PER_TOKEN) + (outputTokens * HAIKU_OUTPUT_COST_PER_TOKEN);

  // Parse response — strip markdown fences if present
  let rawText = response.content[0].text.trim();
  if (rawText.startsWith("```")) {
    rawText = rawText.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }
  let permits = [];

  try {
    permits = JSON.parse(rawText);
  } catch (err) {
    console.error(`  JSON parse error: ${err.message}`);
    console.error(`  Raw response (first 500 chars): ${rawText.slice(0, 500)}`);
    permits = [];
  }

  // Post-process: fill in source_url, validate enums
  const validPermitTypes = ["bygglov", "marklov", "rivningslov", "förhandsbesked", "strandskyddsdispens", "anmälan"];
  const validStatuses = ["ansökt", "beviljat", "avslag", "överklagat", "startbesked", "slutbesked"];

  const validated = permits.map((p) => ({
    municipality: p.municipality || municipalityName,
    case_number: p.case_number || null,
    address: p.address || null,
    permit_type: validPermitTypes.includes(p.permit_type) ? p.permit_type : null,
    status: validStatuses.includes(p.status) ? p.status : null,
    date: p.date || null,
    description: p.description || null,
    applicant: p.applicant || null,
    source_url: sourceUrl,
    _extraction_meta: {
      raw_permit_type: p.permit_type,
      raw_status: p.status,
      permit_type_valid: validPermitTypes.includes(p.permit_type),
      status_valid: validStatuses.includes(p.status)
    }
  }));

  return {
    permits: validated,
    cost: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: cost,
      elapsed_ms: elapsed
    }
  };
}

async function main() {
  await ensureDirs();

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY not set. Copy .env.example to .env and fill in your key.");
    process.exit(1);
  }

  const client = new Anthropic();

  console.log("=== Floede Agent - Extraction ===\n");

  // Find all HTML files (filtered by --only if provided)
  let htmlFiles = (await readdir(HTML_DIR)).filter((f) => f.endsWith(".html"));
  if (onlyIds) {
    htmlFiles = htmlFiles.filter((f) => onlyIds.some((id) => f.startsWith(id)));
    console.log(`Filtering to: ${onlyIds.join(", ")}\n`);
  }
  // Use the newest file per municipality
  const byMuni = new Map();
  for (const f of htmlFiles) {
    const id = f.split("_")[0];
    if (!byMuni.has(id) || f > byMuni.get(id)) byMuni.set(id, f);
  }
  htmlFiles = [...byMuni.values()];

  if (htmlFiles.length === 0) {
    console.error("No HTML files found. Run fetch-html.js first.");
    process.exit(1);
  }

  console.log(`Found ${htmlFiles.length} HTML files\n`);

  const allResults = [];
  let totalCost = 0;

  for (const file of htmlFiles) {
    const municipalityId = file.split("_")[0];
    const html = await readFile(join(HTML_DIR, file), "utf-8");

    console.log(`[${municipalityId}] Processing ${file} (${html.length} chars)`);

    // Read corresponding meta for URL
    const metaFiles = (await readdir(join(process.cwd(), "data", "meta")))
      .filter((f) => f.startsWith(municipalityId) && !f.includes("error") && !f.includes("summary"));
    let sourceUrl = null;
    if (metaFiles.length > 0) {
      const meta = JSON.parse(await readFile(join(process.cwd(), "data", "meta", metaFiles[0]), "utf-8"));
      sourceUrl = meta.url;
    }

    const result = await extractFromHtml(client, html, municipalityId, sourceUrl);

    console.log(`  Permits found: ${result.permits.length}`);
    console.log(`  Tokens: ${result.cost.input_tokens} in / ${result.cost.output_tokens} out`);
    console.log(`  Cost: $${result.cost.cost_usd.toFixed(6)}`);
    console.log(`  Time: ${result.cost.elapsed_ms}ms`);

    // Flag issues
    const nullPermitTypes = result.permits.filter((p) => p.permit_type === null).length;
    const nullStatuses = result.permits.filter((p) => p.status === null).length;
    if (nullPermitTypes > 0) console.log(`  WARNING: ${nullPermitTypes} permits with null permit_type`);
    if (nullStatuses > 0) console.log(`  WARNING: ${nullStatuses} permits with null status`);

    totalCost += result.cost.cost_usd;

    allResults.push({
      file,
      municipality_id: municipalityId,
      source_url: sourceUrl,
      permits_count: result.permits.length,
      permits: result.permits,
      cost: result.cost,
      null_permit_types: nullPermitTypes,
      null_statuses: nullStatuses
    });

    // Save per-municipality extraction
    await writeFile(
      join(OUTPUT_DIR, `${municipalityId}_extracted.json`),
      JSON.stringify(result.permits, null, 2),
      "utf-8"
    );
  }

  // Save cost log
  const costLog = {
    run_at: new Date().toISOString(),
    agent: "extraction",
    model: "claude-haiku-4-5-20251001",
    total_cost_usd: totalCost,
    total_permits: allResults.reduce((sum, r) => sum + r.permits_count, 0),
    cost_per_permit_usd: totalCost / Math.max(1, allResults.reduce((sum, r) => sum + r.permits_count, 0)),
    details: allResults.map((r) => ({
      municipality: r.municipality_id,
      permits: r.permits_count,
      cost_usd: r.cost.cost_usd,
      input_tokens: r.cost.input_tokens,
      output_tokens: r.cost.output_tokens,
      elapsed_ms: r.cost.elapsed_ms
    }))
  };

  await writeFile(
    join(COST_DIR, `extraction_cost_${Date.now()}.json`),
    JSON.stringify(costLog, null, 2),
    "utf-8"
  );

  // Summary
  console.log("\n=== EXTRACTION SUMMARY ===");
  console.log(`Total permits extracted: ${costLog.total_permits}`);
  console.log(`Total cost: $${totalCost.toFixed(6)}`);
  console.log(`Cost per permit: $${costLog.cost_per_permit_usd.toFixed(6)}`);
  console.log(`\nPer municipality:`);
  allResults.forEach((r) => {
    console.log(`  ${r.municipality_id}: ${r.permits_count} permits, $${r.cost.cost_usd.toFixed(6)}, ${r.null_permit_types} null types, ${r.null_statuses} null statuses`);
  });
}

main().catch(console.error);
