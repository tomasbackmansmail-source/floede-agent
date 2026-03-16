import { createClient } from "@supabase/supabase-js";
import { readFile, readdir, writeFile, mkdir } from "fs/promises";
import { join } from "path";

const EXTRACTED_DIR = join(process.cwd(), "data", "extracted");
const COMPARE_DIR = join(process.cwd(), "data", "comparison");

const MUNICIPALITY_NAME_MAP = {
  nacka: "Nacka",
  helsingborg: "Helsingborg",
  malmo: "Malmö",
  molndal: "Mölndal",
  lund: "Lund"
};

// Normalize case numbers for comparison: strip whitespace, dashes,
// convert to uppercase. "BN 2026-001234" and "BN2026001234" should match.
function normalizeCaseNumber(cn) {
  if (!cn) return null;
  return cn
    .toUpperCase()
    .replace(/[\s\-\.\/]/g, "")
    .trim();
}

async function main() {
  await mkdir(COMPARE_DIR, { recursive: true });

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env");
    process.exit(1);
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  console.log("=== Gap Analysis: Normalized Overlap + Nacka Direction ===\n");

  const extractedFiles = (await readdir(EXTRACTED_DIR)).filter((f) => f.endsWith("_extracted.json"));
  const results = [];

  for (const file of extractedFiles) {
    const municipalityId = file.replace("_extracted.json", "");
    const municipalityName = MUNICIPALITY_NAME_MAP[municipalityId] || municipalityId;

    console.log(`\n=== ${municipalityName} ===`);

    const extracted = JSON.parse(await readFile(join(EXTRACTED_DIR, file), "utf-8"));

    // Fetch legacy data — legacy table uses "kommun" and "scraped_at"
    const { data: legacy, error } = await supabase
      .from("permits")
      .select("*")
      .ilike("kommun", `%${municipalityName}%`)
      .order("scraped_at", { ascending: false })
      .limit(500);

    if (error) {
      console.error(`  Supabase error: ${error.message}`);
      results.push({ municipality: municipalityName, status: "error", error: error.message });
      continue;
    }

    // Build normalized lookup maps
    const extractedMap = new Map();
    for (const p of extracted) {
      const norm = normalizeCaseNumber(p.case_number);
      if (norm) extractedMap.set(norm, p);
    }

    const legacyMap = new Map();
    for (const p of (legacy || [])) {
      const raw = p.diarienummer;
      const norm = normalizeCaseNumber(raw);
      if (norm) legacyMap.set(norm, { ...p, _raw_case_number: raw });
    }

    // Extracted permits without case number
    const extractedNoCaseNumber = extracted.filter((p) => !p.case_number);

    // Overlap analysis
    const matched = [];
    const agentOnly = [];
    const legacyOnly = [];

    for (const [norm, ext] of extractedMap) {
      if (legacyMap.has(norm)) {
        matched.push({ normalized: norm, agent: ext, legacy: legacyMap.get(norm) });
      } else {
        agentOnly.push({ normalized: norm, agent: ext });
      }
    }

    for (const [norm, leg] of legacyMap) {
      if (!extractedMap.has(norm)) {
        legacyOnly.push({ normalized: norm, legacy: leg });
      }
    }

    const overlapPct = extractedMap.size > 0
      ? ((matched.length / extractedMap.size) * 100).toFixed(1)
      : "0.0";

    console.log(`  Extracted total: ${extracted.length} (${extractedNoCaseNumber.length} without case_number)`);
    console.log(`  Extracted with case_number: ${extractedMap.size}`);
    console.log(`  Legacy with case_number: ${legacyMap.size}`);
    console.log(`  Matched (normalized): ${matched.length}`);
    console.log(`  Agent-only (not in legacy): ${agentOnly.length}`);
    console.log(`  Legacy-only (not in agent): ${legacyOnly.length}`);
    console.log(`  Overlap: ${overlapPct}%`);

    // Direction analysis
    console.log(`\n  DIRECTION:`);
    if (agentOnly.length > 0) {
      console.log(`  Agent finds MORE than legacy: ${agentOnly.length} extra permits`);
      console.log(`  Sample agent-only permits:`);
      agentOnly.slice(0, 5).forEach((a) => {
        console.log(`    - ${a.agent.case_number}: ${a.agent.address || "no address"} (${a.agent.permit_type}, ${a.agent.status})`);
      });
    }
    if (legacyOnly.length > 0) {
      console.log(`  Legacy finds MORE than agent: ${legacyOnly.length} extra permits`);
      console.log(`  Sample legacy-only permits:`);
      legacyOnly.slice(0, 5).forEach((l) => {
        console.log(`    - ${l.legacy._raw_case_number}: ${l.legacy.adress || "no address"}`);
      });
    }

    // Field accuracy on matched permits
    let fieldMatches = { permit_type: 0, status: 0, address: 0 };
    for (const m of matched) {
      if (m.agent.permit_type && m.legacy.permit_type) {
        const agentType = m.agent.permit_type.toLowerCase();
        const legacyType = (m.legacy.permit_type || "").toLowerCase();
        if (agentType === legacyType) fieldMatches.permit_type++;
      }
      if (m.agent.status && m.legacy.status) {
        const agentStatus = m.agent.status.toLowerCase();
        const legacyStatus = (m.legacy.status || "").toLowerCase();
        if (agentStatus === legacyStatus) fieldMatches.status++;
      }
      if (m.agent.address && m.legacy.adress) {
        const agentAddr = m.agent.address.toLowerCase().slice(0, 15);
        const legacyAddr = (m.legacy.adress || "").toLowerCase().slice(0, 15);
        if (agentAddr.includes(legacyAddr) || legacyAddr.includes(agentAddr)) fieldMatches.address++;
      }
    }

    if (matched.length > 0) {
      console.log(`\n  FIELD ACCURACY (on ${matched.length} matched permits):`);
      console.log(`    permit_type: ${fieldMatches.permit_type}/${matched.length} (${(fieldMatches.permit_type / matched.length * 100).toFixed(0)}%)`);
      console.log(`    status: ${fieldMatches.status}/${matched.length} (${(fieldMatches.status / matched.length * 100).toFixed(0)}%)`);
      console.log(`    address: ${fieldMatches.address}/${matched.length} (${(fieldMatches.address / matched.length * 100).toFixed(0)}%)`);
    }

    results.push({
      municipality: municipalityName,
      status: "ok",
      extracted_total: extracted.length,
      extracted_with_case: extractedMap.size,
      extracted_no_case: extractedNoCaseNumber.length,
      legacy_with_case: legacyMap.size,
      matched: matched.length,
      agent_only: agentOnly.length,
      legacy_only: legacyOnly.length,
      overlap_pct: parseFloat(overlapPct),
      field_accuracy: matched.length > 0 ? fieldMatches : null,
      agent_only_samples: agentOnly.slice(0, 5).map((a) => a.agent),
      legacy_only_samples: legacyOnly.slice(0, 5).map((l) => l.legacy)
    });
  }

  // Save full report
  await writeFile(
    join(COMPARE_DIR, `gap_analysis_${Date.now()}.json`),
    JSON.stringify({ run_at: new Date().toISOString(), results }, null, 2),
    "utf-8"
  );

  console.log("\n\n=== SUMMARY ===");
  console.log("Municipality       | Extracted | Legacy | Matched | Agent+ | Legacy+ | Overlap");
  console.log("-------------------|-----------|--------|---------|--------|---------|--------");
  results.filter((r) => r.status === "ok").forEach((r) => {
    console.log(
      `${r.municipality.padEnd(18)} | ${String(r.extracted_total).padEnd(9)} | ${String(r.legacy_with_case).padEnd(6)} | ${String(r.matched).padEnd(7)} | ${String(r.agent_only).padEnd(6)} | ${String(r.legacy_only).padEnd(7)} | ${r.overlap_pct}%`
    );
  });
}

main().catch(console.error);
