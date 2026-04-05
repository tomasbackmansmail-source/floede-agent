/**
 * Apply villaägarna URL upgrades to discovery_configs in Supabase.
 * Only applies entries with was_verified=false (safe — these don't work today).
 * Also exports verified=true entries to data/seed-verified-review.json for manual review.
 *
 * Kör: node --env-file=.env src/seed-villaagarna-apply.js
 */

import { createClient } from "@supabase/supabase-js";
import { readFile, writeFile } from "fs/promises";

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const dryrun = JSON.parse(await readFile("data/seed-dryrun.json", "utf-8"));

  const unverified = dryrun.upgrade.filter(u => !u.was_verified);
  const verified = dryrun.upgrade.filter(u => u.was_verified);

  console.log(`=== STEG 1: Applicera ${unverified.length} unverified upgrades ===\n`);

  const log = [];
  let success = 0;
  let failed = 0;

  for (const entry of unverified) {
    const name = entry.db_municipality;

    // Fetch current row to get existing config object
    const { data: rows, error: fetchErr } = await supabase
      .from("discovery_configs")
      .select("config")
      .eq("municipality", name)
      .limit(1);

    if (fetchErr || !rows?.length) {
      console.log(`  SKIP ${name}: fetch error — ${fetchErr?.message || "not found"}`);
      log.push({ municipality: name, status: "fetch_error", error: fetchErr?.message || "not found" });
      failed++;
      continue;
    }

    const existingConfig = rows[0].config || {};
    const updatedConfig = {
      ...existingConfig,
      listing_url: entry.new_url,
      needs_browser: entry.needs_browser,
    };

    const { error: updateErr } = await supabase
      .from("discovery_configs")
      .update({
        config: updatedConfig,
        verified: false,
        needs_browser: entry.needs_browser,
        updated_at: new Date().toISOString(),
      })
      .eq("municipality", name);

    if (updateErr) {
      console.log(`  FAIL ${name}: ${updateErr.message}`);
      log.push({ municipality: name, status: "error", error: updateErr.message });
      failed++;
    } else {
      console.log(`  OK   ${name}: ${entry.old_url} -> ${entry.new_url}`);
      log.push({
        municipality: name,
        status: "updated",
        old_url: entry.old_url,
        new_url: entry.new_url,
        needs_browser: entry.needs_browser,
      });
      success++;
    }
  }

  console.log(`\n=== Resultat: ${success} OK, ${failed} failed ===`);

  // Save apply log
  await writeFile("data/seed-apply-log.json", JSON.stringify(log, null, 2), "utf-8");
  console.log("Apply-log sparad: data/seed-apply-log.json");

  // Step 2: export verified entries for review
  console.log(`\n=== STEG 2: Exporterar ${verified.length} verified upgrades for review ===`);
  await writeFile("data/seed-verified-review.json", JSON.stringify(verified, null, 2), "utf-8");
  console.log("Review-fil sparad: data/seed-verified-review.json");
}

main().catch(console.error);
