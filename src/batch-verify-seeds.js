/**
 * Batch-verify unverified discovery configs.
 * Loads all configs with verified=false from discovery_configs,
 * runs verifyExtraction on each, and updates verified+approved status.
 *
 * Kör: node --env-file=.env src/batch-verify-seeds.js
 *
 * Flags:
 *   --dry-run   Print what would happen without updating DB
 *   --limit=N   Only process first N configs
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { writeFile, mkdir } from "fs/promises";
import { verifyExtraction } from "./utils/discovery.js";

const VERTICAL = process.env.VERTICAL || "byggsignal";
const verticalConfig = JSON.parse(
  readFileSync(new URL(`./config/verticals/${VERTICAL}.json`, import.meta.url), "utf-8")
);
const discoveryConfig = verticalConfig.discovery || {};
const searchTerms = discoveryConfig.search_terms || [];

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limitArg = args.find(a => a.startsWith("--limit="));
const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : null;

const CONCURRENCY = 5;
const DELAY_MS = 500;

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

  // Load all unverified configs
  const { data: rows, error } = await supabase
    .from("discovery_configs")
    .select("municipality, config, needs_browser, approved, verified")
    .eq("verified", false)
    .order("municipality");

  if (error) {
    console.error(`Failed to load configs: ${error.message}`);
    process.exit(1);
  }

  let configs = rows || [];
  if (limit) configs = configs.slice(0, limit);

  console.log(`=== Batch-verify: ${configs.length} unverified configs (${dryRun ? "DRY RUN" : "LIVE"}) ===\n`);

  const results = [];
  let totalCost = 0;
  let verified = 0;
  let needsBrowser = 0;
  let failed = 0;
  let httpError = 0;

  for (let i = 0; i < configs.length; i++) {
    const row = configs[i];
    const name = row.municipality;
    const listingUrl = row.config?.listing_url;

    if (!listingUrl) {
      console.log(`  [${i + 1}/${configs.length}] ${name}: SKIP — no listing_url`);
      results.push({ municipality: name, status: "skip", reason: "no listing_url" });
      failed++;
      continue;
    }

    console.log(`  [${i + 1}/${configs.length}] ${name}: ${listingUrl}`);

    const result = await verifyExtraction(listingUrl, verticalConfig, searchTerms);
    totalCost += result.cost_usd || 0;

    if (result.error && result.result_count === 0 && !result.needs_browser) {
      // HTTP error or extraction failure without keywords
      console.log(`    -> FAIL: ${result.error}`);
      results.push({ municipality: name, status: "failed", error: result.error, url: listingUrl, cost_usd: result.cost_usd });
      if (result.error?.startsWith("HTTP ")) httpError++;
      else failed++;
    } else if (result.verified && result.result_count > 0) {
      // Success — extracted data
      console.log(`    -> VERIFIED: ${result.result_count} items`);
      results.push({
        municipality: name,
        status: "verified",
        result_count: result.result_count,
        sample: result.sample,
        url: listingUrl,
        cost_usd: result.cost_usd,
      });
      verified++;

      if (!dryRun) {
        const { error: updateErr } = await supabase
          .from("discovery_configs")
          .update({
            verified: true,
            verified_at: new Date().toISOString(),
            verify_result_count: result.result_count,
            approved: true,
            updated_at: new Date().toISOString(),
          })
          .eq("municipality", name);
        if (updateErr) console.log(`    -> DB update failed: ${updateErr.message}`);
      }
    } else if (result.needs_browser) {
      // Keywords found but 0 items — likely needs JS rendering
      console.log(`    -> NEEDS_BROWSER (keywords found, 0 items via HTTP)`);
      results.push({
        municipality: name,
        status: "needs_browser",
        url: listingUrl,
        cost_usd: result.cost_usd,
      });
      needsBrowser++;

      if (!dryRun) {
        const { error: updateErr } = await supabase
          .from("discovery_configs")
          .update({
            needs_browser: true,
            approved: true,
            updated_at: new Date().toISOString(),
          })
          .eq("municipality", name);
        if (updateErr) console.log(`    -> DB update failed: ${updateErr.message}`);
      }
    } else {
      // 0 items, no keywords, no HTTP error
      console.log(`    -> FAIL: 0 items, no keywords`);
      results.push({ municipality: name, status: "failed", reason: "0 items, no keywords", url: listingUrl, cost_usd: result.cost_usd });
      failed++;
    }

    // Rate limit
    if (i < configs.length - 1) {
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  console.log(`\n=== RESULTS ===`);
  console.log(`Total: ${configs.length}`);
  console.log(`Verified (approved): ${verified}`);
  console.log(`Needs browser (approved): ${needsBrowser}`);
  console.log(`Failed (HTTP error): ${httpError}`);
  console.log(`Failed (other): ${failed}`);
  console.log(`Total cost: $${totalCost.toFixed(4)}`);

  // Save report
  await mkdir("data", { recursive: true });
  const report = {
    timestamp: new Date().toISOString(),
    vertical: VERTICAL,
    dry_run: dryRun,
    summary: { total: configs.length, verified, needs_browser: needsBrowser, http_error: httpError, failed, cost_usd: totalCost },
    results,
  };
  await writeFile("data/batch-verify-report.json", JSON.stringify(report, null, 2), "utf-8");
  console.log(`\nReport saved: data/batch-verify-report.json`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
