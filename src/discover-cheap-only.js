// Floede Engine — Cheap-steps-only discovery analysis
// Runs url_variants, crawl, sitemap against all municipalities.
// No LLM calls, no writes to discovery_configs. Read-only analysis.

import { createClient } from "@supabase/supabase-js";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { readFileSync } from "fs";
import { discoverSource } from "./utils/discovery.js";

const VERTICAL = process.env.VERTICAL || "byggsignal";
const verticalConfig = JSON.parse(
  readFileSync(new URL(`./config/verticals/${VERTICAL}.json`, import.meta.url), "utf-8")
);
const discoveryConfig = verticalConfig.discovery;

const onlyArg = process.argv.find(a => a.startsWith("--only="));
const onlyNames = onlyArg
  ? onlyArg.replace("--only=", "").split(",").map(s => s.trim().toLowerCase())
  : null;

async function loadTargets(supabase) {
  const table = discoveryConfig.source_table;
  const idField = discoveryConfig.source_id_field;
  const urlField = discoveryConfig.source_url_field;

  const { data, error } = await supabase
    .from(table)
    .select(`${idField}, ${urlField}`)
    .not(urlField, "is", null);

  if (error) {
    console.error(`Failed to load targets from ${table}: ${error.message}`);
    return [];
  }

  let targets = data.map(row => ({
    name: row[idField],
    url: row[urlField],
  }));

  if (onlyNames) {
    targets = targets.filter(t =>
      onlyNames.some(n => t.name.toLowerCase().includes(n))
    );
  }

  return targets;
}

async function main() {
  const analysisDir = join(process.cwd(), "data", "analysis");
  await mkdir(analysisDir, { recursive: true });

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_KEY required.");
    process.exit(1);
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const targets = await loadTargets(supabase);

  if (targets.length === 0) {
    console.error("No targets found.");
    process.exit(1);
  }

  console.log(`=== Cheap-Steps-Only Discovery Analysis ===`);
  console.log(`Vertical: ${verticalConfig.name}`);
  console.log(`Targets: ${targets.length}\n`);

  const results = {
    found_url_variants: [],
    found_crawl: [],
    found_sitemap: [],
    not_found: [],
  };

  const platforms = {};

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    const label = `[${i + 1}/${targets.length}] ${target.name}`;

    try {
      const result = await Promise.race([
        discoverSource(target.name, target.url, discoveryConfig),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 30000)),
      ]);

      const platform = result.platform || "unknown";
      platforms[platform] = (platforms[platform] || 0) + 1;

      if (result.found) {
        const entry = {
          name: target.name,
          url: result.url,
          method: result.method,
          platform,
          confidence: result.confidence,
          matchCount: result.details?.matchCount || 0,
        };

        if (result.method === "url_variants") {
          results.found_url_variants.push(entry);
        } else if (result.method === "crawl_homepage") {
          results.found_crawl.push(entry);
        } else if (result.method === "sitemap") {
          results.found_sitemap.push(entry);
        }

        console.log(`${label} — ${result.method} — ${result.url}`);
      } else {
        results.not_found.push({
          name: target.name,
          url: target.url,
          platform,
          reason: result.details?.url_variants?.reason || "all steps failed",
        });
        console.log(`${label} — NOT FOUND`);
      }
    } catch (err) {
      results.not_found.push({
        name: target.name,
        url: target.url,
        platform: "unknown",
        reason: err.message,
      });
      console.log(`${label} — ERROR: ${err.message}`);
      platforms["unknown"] = (platforms["unknown"] || 0) + 1;
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 500));
  }

  // Summary
  const total = targets.length;
  const foundTotal = results.found_url_variants.length + results.found_crawl.length + results.found_sitemap.length;
  const pct = (n) => `${n} (${(n / total * 100).toFixed(1)}%)`;

  console.log(`\n${"=".repeat(50)}`);
  console.log(`CHEAP-STEPS DISCOVERY SUMMARY`);
  console.log(`${"=".repeat(50)}`);
  console.log(`Total targets:        ${total}`);
  console.log(`Found (total):        ${pct(foundTotal)}`);
  console.log(`  url_variants:       ${pct(results.found_url_variants.length)}`);
  console.log(`  crawl_homepage:     ${pct(results.found_crawl.length)}`);
  console.log(`  sitemap:            ${pct(results.found_sitemap.length)}`);
  console.log(`Not found:            ${pct(results.not_found.length)}`);

  console.log(`\nPlatform distribution:`);
  for (const [platform, count] of Object.entries(platforms).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${platform}: ${count}`);
  }

  if (results.not_found.length > 0) {
    console.log(`\nNot found municipalities (${results.not_found.length}):`);
    for (const nf of results.not_found) {
      console.log(`  - ${nf.name} (${nf.reason})`);
    }
  }

  // Save report
  const report = {
    run_at: new Date().toISOString(),
    vertical: verticalConfig.name,
    total_targets: total,
    found_total: foundTotal,
    found_url_variants: results.found_url_variants.length,
    found_crawl: results.found_crawl.length,
    found_sitemap: results.found_sitemap.length,
    not_found_count: results.not_found.length,
    platforms,
    details: results,
  };

  const reportPath = join(analysisDir, "cheap-steps-report.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf-8");
  console.log(`\nReport saved to ${reportPath}`);
}

main().catch(console.error);
