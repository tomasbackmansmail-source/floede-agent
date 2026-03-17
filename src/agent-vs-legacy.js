// Compare agent system (permits_v2) vs legacy system (permits)
// for the same municipalities. Answers: which system finds more data?

import { createClient } from "@supabase/supabase-js";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

const COMPARE_DIR = join(process.cwd(), "data", "comparison");

const AGENT_MUNICIPALITIES = [
  "Nacka", "Helsingborg", "Malmö", "Mölndal", "Lund",
  "Uppsala", "Linköping", "Norrköping", "Umeå", "Örebro",
  "Jönköping", "Karlstad", "Västerås", "Sundsvall", "Halmstad",
  "Trosa", "Höör", "Tibro", "Kiruna", "Gotland"
];

async function main() {
  await mkdir(COMPARE_DIR, { recursive: true });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  console.log("=== Agent vs Legacy Comparison ===\n");

  const results = [];
  let agentTotal = 0;
  let legacyTotal = 0;
  let agentWins = 0;
  let legacyWins = 0;
  let ties = 0;

  for (const muni of AGENT_MUNICIPALITIES) {
    // Count agent permits
    const { count: agentCount, error: agentErr } = await supabase
      .from("permits_v2")
      .select("id", { count: "exact", head: true })
      .ilike("municipality", `%${muni}%`);

    // Count legacy permits
    const { count: legacyCount, error: legacyErr } = await supabase
      .from("permits")
      .select("id", { count: "exact", head: true })
      .ilike("municipality", `%${muni}%`);

    const agent = agentErr ? 0 : (agentCount || 0);
    const legacy = legacyErr ? 0 : (legacyCount || 0);

    agentTotal += agent;
    legacyTotal += legacy;

    let winner;
    if (agent > legacy) { winner = "AGENT"; agentWins++; }
    else if (legacy > agent) { winner = "LEGACY"; legacyWins++; }
    else { winner = "TIE"; ties++; }

    results.push({ municipality: muni, agent, legacy, diff: agent - legacy, winner });
  }

  // Sort by biggest agent advantage
  results.sort((a, b) => b.diff - a.diff);

  // Print table
  console.log("Municipality      | Agent | Legacy | Diff   | Winner");
  console.log("------------------|-------|--------|--------|-------");
  for (const r of results) {
    const diff = r.diff > 0 ? `+${r.diff}` : `${r.diff}`;
    console.log(
      `${r.municipality.padEnd(17)} | ${String(r.agent).padEnd(5)} | ${String(r.legacy).padEnd(6)} | ${diff.padEnd(6)} | ${r.winner}`
    );
  }

  console.log(`\n=== TOTALS ===`);
  console.log(`Agent total: ${agentTotal}`);
  console.log(`Legacy total: ${legacyTotal}`);
  console.log(`Agent wins: ${agentWins} municipalities`);
  console.log(`Legacy wins: ${legacyWins} municipalities`);
  console.log(`Ties: ${ties} municipalities`);

  if (agentTotal > legacyTotal) {
    console.log(`\nVERDICT: Agent finds ${agentTotal - legacyTotal} MORE permits across these 20 municipalities.`);
  } else if (legacyTotal > agentTotal) {
    console.log(`\nVERDICT: Legacy finds ${legacyTotal - agentTotal} MORE permits across these 20 municipalities.`);
  } else {
    console.log(`\nVERDICT: Both systems find the same number of permits.`);
  }

  // Check municipalities where agent has data but legacy doesn't
  const agentExclusive = results.filter((r) => r.agent > 0 && r.legacy === 0);
  if (agentExclusive.length > 0) {
    console.log(`\nAgent covers ${agentExclusive.length} municipalities with ZERO legacy data:`);
    agentExclusive.forEach((r) => console.log(`  - ${r.municipality}: ${r.agent} permits`));
  }

  // Save report
  await writeFile(
    join(COMPARE_DIR, `agent_vs_legacy_${Date.now()}.json`),
    JSON.stringify({
      run_at: new Date().toISOString(),
      agent_total: agentTotal,
      legacy_total: legacyTotal,
      agent_wins: agentWins,
      legacy_wins: legacyWins,
      ties,
      by_municipality: results
    }, null, 2),
    "utf-8"
  );

  console.log(`\nReport saved to data/comparison/`);
}

main().catch(console.error);
