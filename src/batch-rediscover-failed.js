/**
 * Rediscovery for approved municipalities that have never produced data.
 * Finds new URLs via discoverSource(), verifies with extraction,
 * and updates discovery_configs on success.
 *
 * Targets: approved configs with 0 rows in permits_v2.
 *
 * Kör: VERTICAL=byggsignal node --env-file=.env src/batch-rediscover-failed.js
 *
 * Flags:
 *   --dry-run   Print what would happen without updating DB
 *   --limit=N   Only process first N municipalities
 */

import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { writeFile, mkdir } from "fs/promises";
import { discoverSource, verifyExtraction, resolveHomepage } from "./utils/discovery.js";
import { stripNonContent } from "./utils/engine.js";

const VERTICAL = process.env.VERTICAL || "byggsignal";
const verticalConfig = JSON.parse(
  readFileSync(new URL(`./config/verticals/${VERTICAL}.json`, import.meta.url), "utf-8")
);
const discoveryConfig = verticalConfig.discovery || {};
const searchTerms = discoveryConfig.search_terms || [];

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

async function playwrightVerify(browser, url, municipality) {
  const context = await browser.newContext({ userAgent: USER_AGENT });
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);
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

    if (!text || text.trim().length < 50) {
      return { verified: false, result_count: 0, cost_usd: 0, needs_browser: true };
    }

    const cleaned = stripNonContent(text);
    const truncated = cleaned.length > 100000 ? cleaned.slice(0, 100000) : cleaned;

    const client = new Anthropic();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16384,
      messages: [{ role: "user", content: `${EXTRACTION_PROMPT}\n\nKommun: ${municipality}\n\nHTML:\n${truncated}` }],
    });

    const costUsd = (response.usage.input_tokens * modelCost.input) + (response.usage.output_tokens * modelCost.output);
    const rawText = response.content[0].text.trim().replace(/```json\s*/g, "").replace(/```\s*/g, "");
    let items = [];
    try { items = JSON.parse(rawText); if (!Array.isArray(items)) items = []; } catch { items = []; }

    return { verified: items.length > 0, result_count: items.length, cost_usd: costUsd, needs_browser: true };
  } catch (err) {
    return { verified: false, result_count: 0, cost_usd: 0, error: err.message, needs_browser: true };
  } finally {
    await context.close();
  }
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

  // Step 1: Find approved configs with no data in permits_v2
  const { data: approvedConfigs } = await supabase
    .from("discovery_configs")
    .select("municipality, config, needs_browser, verified")
    .eq("approved", true)
    .order("municipality");

  const { data: permitsData } = await supabase
    .from(verticalConfig.db?.table || "permits_v2")
    .select("municipality")
    .limit(10000);

  const munisWithData = new Set((permitsData || []).map(r => r.municipality));
  let noDataConfigs = (approvedConfigs || []).filter(r => !munisWithData.has(r.municipality));

  if (limit) noDataConfigs = noDataConfigs.slice(0, limit);

  console.log(`=== Rediscovery: ${noDataConfigs.length} approved municipalities with 0 data (${dryRun ? "DRY RUN" : "LIVE"}) ===\n`);

  // Step 2: Load homepages from municipalities table
  const { data: muniRows } = await supabase
    .from(discoveryConfig.source_table)
    .select(`${discoveryConfig.source_id_field}, ${discoveryConfig.source_url_field}`);
  const homepageMap = Object.fromEntries(
    (muniRows || []).map(r => [r[discoveryConfig.source_id_field], r[discoveryConfig.source_url_field]])
  );

  const results = [];
  let totalCost = 0;
  let newUrlFound = 0;
  let verified = 0;
  let failed = 0;
  let sameUrl = 0;

  // Launch Playwright for browser verification fallback
  let browser = null;

  for (let i = 0; i < noDataConfigs.length; i++) {
    const row = noDataConfigs[i];
    const name = row.municipality;
    const currentUrl = row.config?.listing_url || null;
    const homepage = homepageMap[name] || null;

    console.log(`  [${i + 1}/${noDataConfigs.length}] ${name}`);
    console.log(`    Current: ${currentUrl || "(none)"}`);
    console.log(`    Homepage: ${homepage || "(none)"}`);

    // Resolve homepage if not in DB
    let sourceUrl = homepage;
    if (!sourceUrl && !currentUrl) {
      console.log(`    Resolving homepage...`);
      const resolved = await resolveHomepage(name, USER_AGENT);
      if (resolved.found) {
        sourceUrl = resolved.url;
        console.log(`    Resolved: ${sourceUrl}`);
      } else {
        console.log(`    -> FAIL: no homepage found`);
        results.push({ municipality: name, status: "no_homepage", url: null });
        failed++;
        continue;
      }
    }
    if (!sourceUrl) sourceUrl = currentUrl;

    // Run discovery
    const discovery = await discoverSource(name, sourceUrl, discoveryConfig);
    totalCost += discovery.cost_usd || 0;

    if (!discovery.found) {
      console.log(`    -> DISCOVERY FAILED (tried: ${discovery.steps_tried?.join(", ")})`);
      results.push({ municipality: name, status: "discovery_failed", cost_usd: discovery.cost_usd || 0, url: currentUrl });
      failed++;
      continue;
    }

    const newUrl = discovery.url;
    const isSameUrl = newUrl === currentUrl;
    console.log(`    Found: ${newUrl} (method: ${discovery.method}${isSameUrl ? ", SAME as current" : ""})`);

    if (isSameUrl) {
      // Same URL — try Playwright verify since HTTP already failed
      console.log(`    Same URL — trying Playwright verify...`);
      if (!browser) browser = await chromium.launch({ headless: true });
      const pwResult = await playwrightVerify(browser, newUrl, name);
      totalCost += pwResult.cost_usd || 0;

      if (pwResult.verified && pwResult.result_count > 0) {
        console.log(`    -> VERIFIED via Playwright: ${pwResult.result_count} items`);
        newUrlFound++;
        verified++;
        results.push({
          municipality: name, status: "verified_playwright", url: newUrl,
          result_count: pwResult.result_count, method: discovery.method,
          cost_usd: (discovery.cost_usd || 0) + (pwResult.cost_usd || 0),
        });
        if (!dryRun) {
          await supabase.from("discovery_configs").update({
            verified: true, verified_at: new Date().toISOString(),
            verify_result_count: pwResult.result_count,
            needs_browser: true, approved: true,
            updated_at: new Date().toISOString(),
          }).eq("municipality", name);
        }
      } else {
        console.log(`    -> FAIL: same URL, Playwright also gave 0 items`);
        results.push({ municipality: name, status: "same_url_zero", url: newUrl, cost_usd: (discovery.cost_usd || 0) + (pwResult.cost_usd || 0) });
        sameUrl++;
      }
      continue;
    }

    // New URL found — verify via HTTP first
    newUrlFound++;
    const httpVerify = await verifyExtraction(newUrl, verticalConfig, searchTerms);
    totalCost += httpVerify.cost_usd || 0;

    if (httpVerify.verified && httpVerify.result_count > 0) {
      console.log(`    -> VERIFIED (HTTP): ${httpVerify.result_count} items`);
      verified++;
      results.push({
        municipality: name, status: "verified_http", url: newUrl,
        result_count: httpVerify.result_count, method: discovery.method,
        cost_usd: (discovery.cost_usd || 0) + (httpVerify.cost_usd || 0),
      });
      if (!dryRun) {
        await supabase.from("discovery_configs").update({
          config: { ...row.config, listing_url: newUrl, discovery_method: discovery.method },
          verified: true, verified_at: new Date().toISOString(),
          verify_result_count: httpVerify.result_count,
          needs_browser: false, approved: true,
          stale_rediscovery_count: 0,
          updated_at: new Date().toISOString(),
        }).eq("municipality", name);
      }
    } else if (httpVerify.needs_browser) {
      // Try Playwright
      console.log(`    HTTP gave 0 items (keywords found) — trying Playwright...`);
      if (!browser) browser = await chromium.launch({ headless: true });
      const pwResult = await playwrightVerify(browser, newUrl, name);
      totalCost += pwResult.cost_usd || 0;

      if (pwResult.verified && pwResult.result_count > 0) {
        console.log(`    -> VERIFIED (Playwright): ${pwResult.result_count} items`);
        verified++;
        results.push({
          municipality: name, status: "verified_playwright", url: newUrl,
          result_count: pwResult.result_count, method: discovery.method,
          cost_usd: (discovery.cost_usd || 0) + (httpVerify.cost_usd || 0) + (pwResult.cost_usd || 0),
        });
        if (!dryRun) {
          await supabase.from("discovery_configs").update({
            config: { ...row.config, listing_url: newUrl, discovery_method: discovery.method },
            verified: true, verified_at: new Date().toISOString(),
            verify_result_count: pwResult.result_count,
            needs_browser: true, approved: true,
            stale_rediscovery_count: 0,
            updated_at: new Date().toISOString(),
          }).eq("municipality", name);
        }
      } else {
        console.log(`    -> FAIL: new URL, but 0 items from both HTTP and Playwright`);
        results.push({
          municipality: name, status: "new_url_zero", url: newUrl, method: discovery.method,
          cost_usd: (discovery.cost_usd || 0) + (httpVerify.cost_usd || 0) + (pwResult.cost_usd || 0),
        });
        failed++;
      }
    } else {
      console.log(`    -> FAIL: new URL but 0 items, no keywords`);
      results.push({
        municipality: name, status: "new_url_zero", url: newUrl, method: discovery.method,
        cost_usd: (discovery.cost_usd || 0) + (httpVerify.cost_usd || 0),
      });
      failed++;
    }
  }

  if (browser) await browser.close();

  console.log(`\n=== RESULTS ===`);
  console.log(`Total: ${noDataConfigs.length}`);
  console.log(`New URL found: ${newUrlFound}`);
  console.log(`Verified (updated): ${verified}`);
  console.log(`Same URL, still 0: ${sameUrl}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total cost: $${totalCost.toFixed(4)}`);

  await mkdir("data", { recursive: true });
  const report = {
    timestamp: new Date().toISOString(),
    vertical: VERTICAL,
    dry_run: dryRun,
    summary: { total: noDataConfigs.length, new_url_found: newUrlFound, verified, same_url: sameUrl, failed, cost_usd: totalCost },
    results,
  };
  await writeFile("data/batch-rediscover-report.json", JSON.stringify(report, null, 2), "utf-8");
  console.log(`\nReport saved: data/batch-rediscover-report.json`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
