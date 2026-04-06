/**
 * Playwright batch-verify for needs_browser configs.
 * Loads configs with needs_browser=true and verified=false,
 * renders each page in Chromium, runs LLM extraction, and
 * updates verified+approved status on success.
 *
 * Kör: VERTICAL=byggsignal node --env-file=.env src/batch-verify-browser.js
 *
 * Flags:
 *   --dry-run   Print what would happen without updating DB
 *   --limit=N   Only process first N configs
 *   --batch=N   Batch size for browser restarts (default 30)
 */

import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { writeFile, mkdir } from "fs/promises";
import { stripNonContent } from "./utils/engine.js";

const VERTICAL = process.env.VERTICAL || "byggsignal";
const verticalConfig = JSON.parse(
  readFileSync(new URL(`./config/verticals/${VERTICAL}.json`, import.meta.url), "utf-8")
);

const MODEL = verticalConfig.model;
const EXTRACTION_PROMPT = verticalConfig.extraction_prompt;
const USER_AGENT = verticalConfig.user_agent || "FloedAgent/0.1 (floede.se)";
const MODEL_COSTS = {
  "claude-haiku-4-5-20251001": { input: 0.0000008, output: 0.000004 },
  "claude-sonnet-4-6": { input: 0.000003, output: 0.000015 },
};
const modelCost = MODEL_COSTS[MODEL] || MODEL_COSTS["claude-haiku-4-5-20251001"];

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limitArg = args.find(a => a.startsWith("--limit="));
const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : null;
const batchArg = args.find(a => a.startsWith("--batch="));
const BATCH_SIZE = batchArg ? parseInt(batchArg.split("=")[1], 10) : 30;

async function fetchRenderedText(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);

  // Expand collapsed content
  await page.evaluate(() => {
    document.querySelectorAll("details").forEach(d => d.open = true);
    document.querySelectorAll("[aria-expanded='false']").forEach(el => {
      try { el.click(); } catch {}
    });
  });
  await page.waitForTimeout(500);

  const text = await page.evaluate(() => {
    const main = document.querySelector("main, article, .pagecontent, [role='main'], #pageContent");
    return (main || document.body).innerText;
  });
  return text;
}

async function extractFromText(client, text, municipality) {
  const cleaned = stripNonContent(text);
  const truncated = cleaned.length > 100000 ? cleaned.slice(0, 100000) : cleaned;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16384,
    messages: [
      {
        role: "user",
        content: `${EXTRACTION_PROMPT}\n\nKommun: ${municipality}\n\nHTML:\n${truncated}`,
      },
    ],
  });

  const costUsd =
    (response.usage.input_tokens * modelCost.input) +
    (response.usage.output_tokens * modelCost.output);

  const rawText = response.content[0].text.trim()
    .replace(/```json\s*/g, "").replace(/```\s*/g, "");

  let items = [];
  try {
    items = JSON.parse(rawText);
    if (!Array.isArray(items)) items = [];
  } catch {
    items = [];
  }

  return { items, cost_usd: costUsd };
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Missing ANTHROPIC_API_KEY");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const client = new Anthropic();

  // Load needs_browser configs that are not yet verified
  const { data: rows, error } = await supabase
    .from("discovery_configs")
    .select("municipality, config, needs_browser, approved, verified")
    .eq("needs_browser", true)
    .eq("verified", false)
    .order("municipality");

  if (error) {
    console.error(`Failed to load configs: ${error.message}`);
    process.exit(1);
  }

  let configs = (rows || []).filter(r => r.config?.listing_url);
  if (limit) configs = configs.slice(0, limit);

  console.log(`=== Playwright batch-verify: ${configs.length} needs_browser configs (${dryRun ? "DRY RUN" : "LIVE"}) ===`);
  console.log(`Model: ${MODEL}, Batch size: ${BATCH_SIZE}\n`);

  const results = [];
  let totalCost = 0;
  let verified = 0;
  let failed = 0;
  let fetchError = 0;

  let browser = await chromium.launch({ headless: true });
  let context = await browser.newContext({ userAgent: USER_AGENT });
  let page = await context.newPage();
  let processed = 0;

  for (let i = 0; i < configs.length; i++) {
    // Restart browser every BATCH_SIZE
    if (processed > 0 && processed % BATCH_SIZE === 0) {
      const batchNum = Math.floor(processed / BATCH_SIZE);
      const batchVerified = results.filter(r => r.status === "verified" && results.indexOf(r) >= (batchNum - 1) * BATCH_SIZE && results.indexOf(r) < batchNum * BATCH_SIZE).length;
      console.log(`\n--- Batch ${batchNum} complete: ${batchVerified} verified in this batch ---`);
      console.log(`[Browser] Restarting after ${processed} municipalities...`);
      await browser.close();
      browser = await chromium.launch({ headless: true });
      context = await browser.newContext({ userAgent: USER_AGENT });
      page = await context.newPage();
    }

    const row = configs[i];
    const name = row.municipality;
    const listingUrl = row.config.listing_url;

    console.log(`  [${i + 1}/${configs.length}] ${name}: ${listingUrl}`);

    let text;
    try {
      text = await fetchRenderedText(page, listingUrl);
    } catch (err) {
      console.log(`    -> FETCH ERROR: ${err.message}`);
      results.push({ municipality: name, status: "fetch_error", error: err.message, url: listingUrl });
      fetchError++;
      processed++;
      continue;
    }

    if (!text || text.trim().length < 50) {
      console.log(`    -> FAIL: page too short (${(text || "").length} chars)`);
      results.push({ municipality: name, status: "failed", reason: "page too short", url: listingUrl });
      failed++;
      processed++;
      continue;
    }

    try {
      const { items, cost_usd } = await extractFromText(client, text, name);
      totalCost += cost_usd;

      if (items.length > 0) {
        console.log(`    -> VERIFIED: ${items.length} items ($${cost_usd.toFixed(4)})`);
        results.push({
          municipality: name,
          status: "verified",
          result_count: items.length,
          sample: items.slice(0, 2),
          url: listingUrl,
          cost_usd,
        });
        verified++;

        if (!dryRun) {
          const { error: updateErr } = await supabase
            .from("discovery_configs")
            .update({
              verified: true,
              verified_at: new Date().toISOString(),
              verify_result_count: items.length,
              approved: true,
              updated_at: new Date().toISOString(),
            })
            .eq("municipality", name);
          if (updateErr) console.log(`    -> DB update failed: ${updateErr.message}`);
        }
      } else {
        console.log(`    -> FAIL: 0 items extracted ($${cost_usd.toFixed(4)})`);
        results.push({ municipality: name, status: "failed", reason: "0 items", url: listingUrl, cost_usd });
        failed++;
      }
    } catch (err) {
      console.log(`    -> EXTRACTION ERROR: ${err.message}`);
      results.push({ municipality: name, status: "extraction_error", error: err.message, url: listingUrl });
      failed++;
    }

    processed++;

    // Rate limit between LLM calls
    if (i < configs.length - 1) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  await browser.close();

  // Final batch summary
  const lastBatchStart = Math.floor((processed - 1) / BATCH_SIZE) * BATCH_SIZE;
  const lastBatchVerified = results.filter((r, idx) => r.status === "verified" && idx >= lastBatchStart).length;
  console.log(`\n--- Final batch: ${lastBatchVerified} verified ---`);

  console.log(`\n=== RESULTS ===`);
  console.log(`Total: ${configs.length}`);
  console.log(`Verified (approved): ${verified}`);
  console.log(`Failed (0 items): ${failed}`);
  console.log(`Fetch errors: ${fetchError}`);
  console.log(`Total cost: $${totalCost.toFixed(4)}`);

  // Save report
  await mkdir("data", { recursive: true });
  const report = {
    timestamp: new Date().toISOString(),
    vertical: VERTICAL,
    dry_run: dryRun,
    summary: { total: configs.length, verified, failed, fetch_error: fetchError, cost_usd: totalCost },
    results,
  };
  await writeFile("data/batch-verify-browser-report.json", JSON.stringify(report, null, 2), "utf-8");
  console.log(`\nReport saved: data/batch-verify-browser-report.json`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
