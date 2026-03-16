// Nacka gap analysis: are the 14 legacy-only permits old or fresh?
// If old (>30 days): correct behavior, they've fallen off the anslagstavla
// If fresh (<30 days): bug, agent is missing current permits

import { createClient } from "@supabase/supabase-js";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";

const EXTRACTED_DIR = join(process.cwd(), "data", "extracted");
const COMPARE_DIR = join(process.cwd(), "data", "comparison");

function normalizeCaseNumber(cn) {
  if (!cn) return null;
  return cn.toUpperCase().replace(/[\s\-\.\/]/g, "").trim();
}

async function main() {
  await mkdir(COMPARE_DIR, { recursive: true });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  console.log("=== Nacka Gap Deep-Dive ===\n");

  // Load extracted Nacka data
  const extracted = JSON.parse(await readFile(join(EXTRACTED_DIR, "nacka_extracted.json"), "utf-8"));
  const extractedNorm = new Set(
    extracted.map((p) => normalizeCaseNumber(p.case_number)).filter(Boolean)
  );

  // Load ALL legacy Nacka data (not just 200)
  const { data: legacy, error } = await supabase
    .from("permits")
    .select("*")
    .ilike("kommun", "%Nacka%")
    .order("scraped_at", { ascending: false })
    .limit(500);

  if (error) {
    console.error(`Supabase error: ${error.message}`);
    process.exit(1);
  }

  console.log(`Extracted permits: ${extracted.length}`);
  console.log(`Legacy permits: ${legacy.length}`);

  // Find legacy-only permits
  const legacyOnly = [];
  for (const leg of legacy) {
    const raw = leg.diarienummer;
    const norm = normalizeCaseNumber(raw);
    if (norm && !extractedNorm.has(norm)) {
      legacyOnly.push({
        case_number_raw: raw,
        case_number_normalized: norm,
        address: leg.adress,
        permit_type: leg.permit_type,
        status: leg.status,
        date: leg.beslutsdatum,
        scraped_at: leg.scraped_at
      });
    }
  }

  console.log(`\nLegacy-only permits (not in agent extraction): ${legacyOnly.length}`);

  if (legacyOnly.length === 0) {
    console.log("No gap! Agent finds all legacy permits.");
    return;
  }

  // Analyze dates
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

  let fresh = 0;  // < 30 days
  let medium = 0; // 30-60 days
  let old = 0;    // > 60 days
  let noDate = 0;

  console.log("\nLegacy-only permits detail:");
  console.log("Case Number          | Date       | Scraped    | Age    | Address");
  console.log("---------------------|------------|------------|--------|--------");

  for (const p of legacyOnly) {
    const dateStr = p.date || p.scraped_at;
    const date = dateStr ? new Date(dateStr) : null;

    let ageLabel = "no date";
    if (date) {
      if (date > thirtyDaysAgo) { fresh++; ageLabel = "FRESH"; }
      else if (date > sixtyDaysAgo) { medium++; ageLabel = "30-60d"; }
      else { old++; ageLabel = ">60d"; }
    } else {
      noDate++;
    }

    const scrapedStr = p.scraped_at ? new Date(p.scraped_at).toISOString().slice(0, 10) : "N/A";
    const dateDisplay = date ? date.toISOString().slice(0, 10) : "N/A";

    console.log(
      `${(p.case_number_raw || "null").padEnd(20)} | ${dateDisplay.padEnd(10)} | ${scrapedStr.padEnd(10)} | ${ageLabel.padEnd(6)} | ${(p.address || "N/A").slice(0, 30)}`
    );
  }

  console.log(`\n=== AGE SUMMARY ===`);
  console.log(`Fresh (<30 days): ${fresh}`);
  console.log(`Medium (30-60 days): ${medium}`);
  console.log(`Old (>60 days): ${old}`);
  console.log(`No date: ${noDate}`);

  console.log(`\n=== VERDICT ===`);
  if (fresh === 0) {
    console.log("ALL legacy-only permits are old or undated.");
    console.log("The agent is NOT missing current permits. The gap is expected behavior.");
    console.log("These permits have fallen off the anslagstavla.");
  } else {
    console.log(`WARNING: ${fresh} legacy-only permits are FRESH (<30 days).`);
    console.log("The agent may be missing current permits. Investigate pagination/subpage fetching.");
  }

  // Save report
  await writeFile(
    join(COMPARE_DIR, `nacka_gap_deep_dive_${Date.now()}.json`),
    JSON.stringify({
      run_at: new Date().toISOString(),
      extracted_count: extracted.length,
      legacy_count: legacy.length,
      legacy_only_count: legacyOnly.length,
      age_breakdown: { fresh, medium, old, no_date: noDate },
      verdict: fresh === 0 ? "gap_is_expected" : "agent_may_miss_permits",
      legacy_only_permits: legacyOnly
    }, null, 2),
    "utf-8"
  );
}

main().catch(console.error);
