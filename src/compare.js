import { createClient } from "@supabase/supabase-js";
import { readFile, readdir, writeFile, mkdir } from "fs/promises";
import { join } from "path";

const EXTRACTED_DIR = join(process.cwd(), "data", "extracted");
const COMPARE_DIR = join(process.cwd(), "data", "comparison");

// Map municipality IDs to names as stored in legacy permits table
const MUNICIPALITY_NAME_MAP = {
  nacka: "Nacka",
  helsingborg: "Helsingborg",
  malmo: "Malmö",
  molndal: "Mölndal",
  lund: "Lund"
};

async function main() {
  await mkdir(COMPARE_DIR, { recursive: true });

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env");
    process.exit(1);
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  console.log("=== Floede Agent - Comparison vs Legacy ===\n");

  const extractedFiles = (await readdir(EXTRACTED_DIR)).filter((f) => f.endsWith("_extracted.json"));

  if (extractedFiles.length === 0) {
    console.error("No extracted files found. Run extract.js first.");
    process.exit(1);
  }

  const comparisons = [];

  for (const file of extractedFiles) {
    const municipalityId = file.replace("_extracted.json", "");
    const municipalityName = MUNICIPALITY_NAME_MAP[municipalityId] || municipalityId;

    console.log(`[${municipalityName}] Comparing...`);

    // Load extracted data
    const extracted = JSON.parse(await readFile(join(EXTRACTED_DIR, file), "utf-8"));

    // Fetch legacy data from Supabase permits table
    // NOTE: The legacy table column names may differ. Adjust query if needed.
    const { data: legacy, error } = await supabase
      .from("permits")
      .select("*")
      .ilike("municipality", `%${municipalityName}%`)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      console.error(`  Supabase error: ${error.message}`);
      comparisons.push({
        municipality: municipalityName,
        municipality_id: municipalityId,
        status: "error",
        error: error.message
      });
      continue;
    }

    console.log(`  Extracted: ${extracted.length} permits`);
    console.log(`  Legacy: ${legacy ? legacy.length : 0} permits`);

    // Compare case numbers to find overlap
    const extractedCaseNumbers = new Set(extracted.map((p) => p.case_number).filter(Boolean));
    const legacyCaseNumbers = new Set((legacy || []).map((p) => p.case_number || p.diary_number || p.dnr).filter(Boolean));

    const matchedCases = [...extractedCaseNumbers].filter((cn) => legacyCaseNumbers.has(cn));
    const extractedOnly = [...extractedCaseNumbers].filter((cn) => !legacyCaseNumbers.has(cn));
    const legacyOnly = [...legacyCaseNumbers].filter((cn) => !extractedCaseNumbers.has(cn));

    const overlapRate = extractedCaseNumbers.size > 0
      ? (matchedCases.length / extractedCaseNumbers.size * 100).toFixed(1)
      : "0.0";

    console.log(`  Matched case numbers: ${matchedCases.length}`);
    console.log(`  Only in extracted: ${extractedOnly.length}`);
    console.log(`  Only in legacy: ${legacyOnly.length}`);
    console.log(`  Overlap rate: ${overlapRate}%`);

    // For matched cases, compare field accuracy
    let fieldMatches = { permit_type: 0, status: 0, address: 0, date: 0 };
    let fieldTotal = 0;

    for (const caseNum of matchedCases) {
      const ext = extracted.find((p) => p.case_number === caseNum);
      const leg = (legacy || []).find((p) => (p.case_number || p.diary_number || p.dnr) === caseNum);

      if (!ext || !leg) continue;
      fieldTotal++;

      // Compare fields (normalize for comparison)
      if (ext.permit_type && leg.permit_type && ext.permit_type === leg.permit_type) fieldMatches.permit_type++;
      if (ext.status && leg.status && ext.status === leg.status) fieldMatches.status++;
      if (ext.address && leg.address && ext.address.toLowerCase().includes(leg.address.toLowerCase().slice(0, 10))) fieldMatches.address++;
      if (ext.date && leg.date && ext.date.slice(0, 10) === (leg.date || "").slice(0, 10)) fieldMatches.date++;
    }

    const comparison = {
      municipality: municipalityName,
      municipality_id: municipalityId,
      status: "ok",
      extracted_count: extracted.length,
      legacy_count: legacy ? legacy.length : 0,
      matched_cases: matchedCases.length,
      extracted_only: extractedOnly.length,
      legacy_only: legacyOnly.length,
      overlap_rate_pct: parseFloat(overlapRate),
      field_accuracy: fieldTotal > 0 ? {
        permit_type: (fieldMatches.permit_type / fieldTotal * 100).toFixed(1) + "%",
        status: (fieldMatches.status / fieldTotal * 100).toFixed(1) + "%",
        address: (fieldMatches.address / fieldTotal * 100).toFixed(1) + "%",
        date: (fieldMatches.date / fieldTotal * 100).toFixed(1) + "%",
        sample_size: fieldTotal
      } : null,
      extracted_only_cases: extractedOnly.slice(0, 10),
      legacy_only_cases: legacyOnly.slice(0, 10)
    };

    comparisons.push(comparison);
  }

  // Save comparison report
  const report = {
    run_at: new Date().toISOString(),
    municipalities: comparisons,
    summary: {
      total_extracted: comparisons.reduce((s, c) => s + (c.extracted_count || 0), 0),
      total_legacy: comparisons.reduce((s, c) => s + (c.legacy_count || 0), 0),
      total_matched: comparisons.reduce((s, c) => s + (c.matched_cases || 0), 0),
      avg_overlap_pct: (comparisons.filter((c) => c.status === "ok").reduce((s, c) => s + c.overlap_rate_pct, 0) /
        Math.max(1, comparisons.filter((c) => c.status === "ok").length)).toFixed(1)
    }
  };

  await writeFile(
    join(COMPARE_DIR, `comparison_${Date.now()}.json`),
    JSON.stringify(report, null, 2),
    "utf-8"
  );

  console.log("\n=== COMPARISON SUMMARY ===");
  console.log(`Total extracted: ${report.summary.total_extracted}`);
  console.log(`Total legacy: ${report.summary.total_legacy}`);
  console.log(`Total matched: ${report.summary.total_matched}`);
  console.log(`Average overlap: ${report.summary.avg_overlap_pct}%`);
}

main().catch(console.error);
