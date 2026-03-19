// Daily runner: fetch HTML → extract with Haiku → insert to permits_v2 → QC
// This is what Railway cron runs daily at 14:00 CET.

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { createHash } from "crypto";
import { EXTRACTION_PROMPT_V2 } from "./config/extraction-prompt-v2.js";
import { withRetry } from "./utils/retry.js";

function sanitizeFilename(name) {
  return name
    .toLowerCase()
    .replace(/å/g, "a")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

const HTML_DIR = join(process.cwd(), "data", "html");
const EXTRACTED_DIR = join(process.cwd(), "data", "extracted");
const COST_DIR = join(process.cwd(), "data", "costs");
const RUN_LOG_DIR = join(process.cwd(), "data", "runs");

const HAIKU_INPUT_COST = 0.0000008;
const HAIKU_OUTPUT_COST = 0.000004;

async function ensureDirs() {
  for (const dir of [HTML_DIR, EXTRACTED_DIR, COST_DIR, RUN_LOG_DIR]) {
    await mkdir(dir, { recursive: true });
  }
}

async function loadApprovedConfigs(supabase) {
  const { data, error } = await supabase
    .from("discovery_configs")
    .select("*")
    .eq("approved", true);

  if (error) {
    console.error(`Failed to load configs from Supabase: ${error.message}`);
    return [];
  }

  return data.map((row) => ({
    ...row.config,
    approved: row.approved,
    _file: `${row.municipality}_config.json`,
  }));
}

function stripNonContent(html) {
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

async function fetchPage(page, config) {
  const url = config.listing_url;
  console.log(`  [Fetch] ${url}`);

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);

  // Handle pagination if configured
  if (config.pagination && config.pagination.has_pagination) {
    if (config.pagination.type === "load_more_button" && config.pagination.mechanism) {
      // Click "load more" button multiple times
      for (let i = 0; i < 10; i++) {
        try {
          const btn = await page.$(config.pagination.mechanism);
          if (!btn) break;
          await btn.click();
          await page.waitForTimeout(1500);
        } catch {
          break;
        }
      }
    } else if (config.pagination.type === "page_size_selector") {
      // Try to set page size to maximum
      try {
        const selectors = ["select[name*='size']", "select[name*='antal']", ".page-size select"];
        for (const sel of selectors) {
          const select = await page.$(sel);
          if (select) {
            const options = await select.$$("option");
            if (options.length > 0) {
              const lastOption = options[options.length - 1];
              const value = await lastOption.getAttribute("value");
              await select.selectOption(value);
              await page.waitForTimeout(2000);
            }
            break;
          }
        }
      } catch (err) {
        console.log(`  [Fetch] Could not set page size: ${err.message}`);
      }
    }
  }

  // Handle subpages if required
  let html;

  if (config.requires_subpages && config.requires_subpages.required) {
    const linkSelector = config.requires_subpages.link_selector_hint || "a[href*='bygglov'], a[href*='kungorelse']";
    const links = await page.$$eval(linkSelector, (els) =>
      els.map((el) => el.href).filter((href) => href && href.startsWith("http"))
    );

    // Filter out binary files and external domains
    const configDomain = new URL(config.listing_url).hostname.replace(/^www\./, "");
    const filteredLinks = [...new Set(links)].filter((url) => {
      if (/\.(pdf|doc|docx|xlsx|xls|zip|png|jpg|jpeg|gif)$/i.test(url)) return false;
      try {
        const host = new URL(url).hostname.replace(/^www\./, "");
        return host === configDomain || host.endsWith(`.${configDomain}`);
      } catch { return false; }
    });
    const maxSubpages = config.requires_subpages.max_subpages || 200;
    console.log(`  [Fetch] Found ${links.length} links, ${filteredLinks.length} after filtering (fetching up to ${maxSubpages})`);

    const subpageTexts = [];
    for (const link of filteredLinks.slice(0, maxSubpages)) {
      try {
        await page.goto(link, { waitUntil: "domcontentloaded", timeout: 15000 });
        await page.waitForTimeout(500);

        // Extract only the meaningful text content to avoid bloat from
        // navigation, headers, footers, and scripts. This lets us fit
        // hundreds of subpages within the extraction token limit.
        const text = await page.evaluate(() => {
          const main = document.querySelector("main, article, .pagecontent, [role='main']");
          return (main || document.body).innerText;
        });
        subpageTexts.push(`<!-- SUBPAGE: ${link} -->\n${text}`);
      } catch (err) {
        console.log(`  [Fetch] Subpage failed: ${link} — ${err.message}`);
      }
      await new Promise((r) => setTimeout(r, 1000)); // Rate limit
    }

    console.log(`  [Fetch] Fetched ${subpageTexts.length} subpages`);
    html = subpageTexts.join("\n\n");
  } else {
    // Expand accordion/details sections before extracting text
    await page.evaluate(() => {
      document.querySelectorAll("details").forEach(d => d.open = true);
      document.querySelectorAll("[aria-expanded='false']").forEach(el => el.click());
    });
    await page.waitForTimeout(500);
    // For inline pages: extract text content only (avoids navigation/header/footer noise)
    html = await page.evaluate(() => {
      const main = document.querySelector("main, article, .pagecontent, [role='main'], #pageContent");
      return (main || document.body).innerText;
    });
  }

  return html;
}

async function extractPermits(client, html, municipalityName, sourceUrl) {
  const cleaned = stripNonContent(html);
  const truncated = cleaned.length > 100000 ? cleaned.slice(0, 100000) : cleaned;

  const response = await withRetry(
    () => client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 16384,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: EXTRACTION_PROMPT_V2,
              cache_control: { type: "ephemeral" }
            },
            {
              type: "text",
              text: `Kommun: ${municipalityName}\n\nHTML:\n${truncated}`
            }
          ]
        }
      ]
    }),
    { maxRetries: 3, baseDelay: 30000, label: municipalityName }
  );

  const rawText = response.content[0].text.trim()
    .replace(/```json\s*/g, "").replace(/```\s*/g, "");

  let permits = [];
  try {
    permits = JSON.parse(rawText);
  } catch {
    console.log(`  [Extract] JSON parse error for ${municipalityName}`);
    permits = [];
  }

  // Cache stats
  const cacheCreated = response.usage.cache_creation_input_tokens || 0;
  const cacheRead = response.usage.cache_read_input_tokens || 0;

  const cost = {
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    cache_creation_input_tokens: cacheCreated,
    cache_read_input_tokens: cacheRead,
    cost_usd: (response.usage.input_tokens * HAIKU_INPUT_COST) +
              (response.usage.output_tokens * HAIKU_OUTPUT_COST)
  };

  return { permits, cost };
}

async function insertToSupabase(supabase, permits, extractionRun) {
  if (permits.length === 0) return { inserted: 0, skipped: 0, errors: 0 };

  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  for (const p of permits) {
    const row = {
      municipality: p.municipality,
      case_number: p.case_number || null,
      address: p.address || null,
      permit_type: p.permit_type || null,
      status: p.status || null,
      date: p.date || null,
      description: p.description || null,
      source_url: p.source_url || null,
      extraction_model: "claude-haiku-4-5-20251001",
      extraction_cost_usd: null,
      raw_html_hash: null
    };

    if (row.case_number) {
      // Standard upsert on municipality + case_number
      const { error } = await withRetry(
        () => supabase
          .from("permits_v2")
          .upsert(row, {
            onConflict: "municipality,case_number",
            ignoreDuplicates: true
          }),
        { maxRetries: 3, baseDelay: 5000, label: `DB ${row.case_number}` }
      );

      if (error) {
        if (error.code === "23505") { skipped++; }
        else { errors++; console.log(`  [DB] Error inserting ${row.case_number}: ${error.message}`); }
      } else {
        inserted++;
      }
    } else {
      // For null case_number: check if duplicate exists by municipality + address + date
      const query = supabase
        .from("permits_v2")
        .select("id", { count: "exact", head: true })
        .is("case_number", null)
        .eq("municipality", row.municipality);
      if (row.address) query.eq("address", row.address);
      else query.is("address", null);
      if (row.date) query.eq("date", row.date);
      else query.is("date", null);

      const { count } = await withRetry(() => query, { maxRetries: 3, baseDelay: 5000, label: `DB check ${row.address}` });

      if (count > 0) {
        skipped++;
      } else {
        const { error } = await withRetry(
          () => supabase.from("permits_v2").insert(row),
          { maxRetries: 3, baseDelay: 5000, label: `DB insert ${row.address}` }
        );
        if (error) { errors++; console.log(`  [DB] Error inserting null/${row.address}: ${error.message}`); }
        else { inserted++; }
      }
    }
  }

  return { inserted, skipped, errors };
}

async function main() {
  await ensureDirs();

  const startTime = Date.now();
  const runId = new Date().toISOString().slice(0, 19).replace(/[:.]/g, "-");

  // CLI: --municipality norrkoping,malmo to run specific municipalities
  const muniArg = process.argv.find((a) => a.startsWith("--municipality="));
  const onlyMunis = muniArg
    ? muniArg.split("=")[1].split(",").map((s) => s.trim().toLowerCase())
    : null;

  console.log(`=== Floede Agent - Daily Run ${runId} ===\n`);

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  let configs = await loadApprovedConfigs(supabase);
  if (onlyMunis) {
    configs = configs.filter((c) =>
      onlyMunis.some((m) => c.municipality.toLowerCase().includes(m) ||
        c._file.toLowerCase().includes(m))
    );
    console.log(`Filtered to ${configs.length} configs: ${configs.map((c) => c.municipality).join(", ")}\n`);
  }

  if (configs.length === 0) {
    console.error("No approved configs found in Supabase. Run Discovery first and approve configs.");
    process.exit(1);
  }

  console.log(`Found ${configs.length} approved configs\n`);

  const client = new Anthropic();
  let browser = await chromium.launch({ headless: true });
  let context = await browser.newContext({
    userAgent: "FloedAgent/0.1 (byggsignal.se; datainsamling fran offentliga anslagstavlor)"
  });
  let page = await context.newPage();

  const results = [];
  let totalCost = 0;
  let totalPermits = 0;
  let totalInserted = 0;
  let totalCacheCreated = 0;
  let totalCacheRead = 0;
  let processedCount = 0;

  for (const config of configs) {
    // Restart browser every 80 municipalities to prevent resource exhaustion
    if (processedCount > 0 && processedCount % 80 === 0) {
      console.log(`\n[Browser] Restarting browser after ${processedCount} municipalities...`);
      await browser.close();
      browser = await chromium.launch({ headless: true });
      context = await browser.newContext({
        userAgent: "FloedAgent/0.1 (byggsignal.se; datainsamling fran offentliga anslagstavlor)"
      });
      page = await context.newPage();
      console.log(`[Browser] Restarted successfully`);
    }

    const muniName = config.municipality;
    const hasSubpages = config.requires_subpages && config.requires_subpages.required;
    const timeout = hasSubpages ? 300000 : 60000; // 5 min for subpages, 60s otherwise
    console.log(`\n--- ${muniName} ---`);

    try {
      await Promise.race([
        (async () => {
          // 1. Fetch HTML
          const html = await fetchPage(page, config);
          const hash = createHash("sha256").update(html).digest("hex").slice(0, 16);

          // Save HTML
          const htmlFile = `${sanitizeFilename(muniName)}_${runId}.html`;
          await writeFile(join(HTML_DIR, htmlFile), html, "utf-8");

          // 2. Extract permits
          const { permits, cost } = await extractPermits(client, html, muniName, config.listing_url);
          totalCost += cost.cost_usd;
          totalPermits += permits.length;
          totalCacheCreated += cost.cache_creation_input_tokens || 0;
          totalCacheRead += cost.cache_read_input_tokens || 0;

          console.log(`  Permits: ${permits.length}, Cost: $${cost.cost_usd.toFixed(4)}${cost.cache_read_input_tokens ? ` (cache hit: ${cost.cache_read_input_tokens} tokens)` : ""}`);

          // Save extracted data
          await writeFile(
            join(EXTRACTED_DIR, `${sanitizeFilename(muniName)}_extracted.json`),
            JSON.stringify(permits, null, 2),
            "utf-8"
          );

          // 3. Insert to Supabase
          const db = await insertToSupabase(supabase, permits, runId);
          totalInserted += db.inserted;
          console.log(`  DB: ${db.inserted} inserted, ${db.skipped} skipped, ${db.errors} errors`);

          results.push({
            municipality: muniName,
            status: "ok",
            permits: permits.length,
            inserted: db.inserted,
            skipped: db.skipped,
            errors: db.errors,
            cost_usd: cost.cost_usd,
            html_hash: hash
          });
        })(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Municipality timeout: ${timeout / 1000}s exceeded`)), timeout)
        )
      ]);

    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
      results.push({
        municipality: muniName,
        status: "error",
        error: err.message,
        permits: 0,
        cost_usd: 0
      });
    }

    processedCount++;
    // Rate limit between municipalities
    await new Promise((r) => setTimeout(r, 1000));
  }

  await browser.close();

  const elapsed = Date.now() - startTime;

  // Save run log
  const runLog = {
    run_id: runId,
    run_at: new Date().toISOString(),
    elapsed_ms: elapsed,
    configs_count: configs.length,
    total_permits: totalPermits,
    total_inserted: totalInserted,
    total_cost_usd: totalCost,
    cost_per_permit_usd: totalPermits > 0 ? totalCost / totalPermits : 0,
    results
  };

  await writeFile(join(RUN_LOG_DIR, `run_${runId}.json`), JSON.stringify(runLog, null, 2), "utf-8");

  // Save cost log (for QC to read)
  await writeFile(
    join(COST_DIR, `extraction_cost_${Date.now()}.json`),
    JSON.stringify({
      run_at: new Date().toISOString(),
      agent: "extraction",
      model: "claude-haiku-4-5-20251001",
      total_cost_usd: totalCost,
      total_permits: totalPermits,
      cost_per_permit_usd: totalPermits > 0 ? totalCost / totalPermits : 0,
      details: results.map((r) => ({
        municipality: r.municipality,
        permits: r.permits,
        cost_usd: r.cost_usd
      }))
    }, null, 2),
    "utf-8"
  );

  // Summary
  console.log(`\n=== RUN COMPLETE ===`);
  console.log(`Time: ${Math.round(elapsed / 1000)}s`);
  console.log(`Municipalities: ${configs.length}`);
  console.log(`Permits extracted: ${totalPermits}`);
  console.log(`Permits inserted: ${totalInserted}`);
  console.log(`Cost: $${totalCost.toFixed(4)}`);
  console.log(`Cost/permit: $${(totalPermits > 0 ? totalCost / totalPermits : 0).toFixed(6)}`);
  console.log(`Cache: ${totalCacheCreated} tokens created, ${totalCacheRead} tokens read (${totalCacheRead > 0 ? "caching active" : "no cache hits"})`);

  const ok = results.filter((r) => r.status === "ok").length;
  const failed = results.filter((r) => r.status === "error").length;
  console.log(`OK: ${ok}, Failed: ${failed}`);

  if (failed > 0) {
    console.log("Failed municipalities:");
    results.filter((r) => r.status === "error").forEach((r) => {
      console.log(`  - ${r.municipality}: ${r.error}`);
    });
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
