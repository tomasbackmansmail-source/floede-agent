// Compare permits_v2 data by source (floede vs kommunkartan)
// Run: node --env-file=.env src/compare-sources.js

import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Count by source
const { count: kkCount } = await sb.from("permits_v2").select("*", { count: "exact", head: true }).eq("source", "kommunkartan");
const { count: floCount } = await sb.from("permits_v2").select("*", { count: "exact", head: true }).eq("source", "floede");
const { count: nullCount } = await sb.from("permits_v2").select("*", { count: "exact", head: true }).is("source", null);
const { count: totalCount } = await sb.from("permits_v2").select("*", { count: "exact", head: true });

console.log("=== OVERVIEW BY SOURCE ===");
console.log("kommunkartan:", kkCount);
console.log("floede:", floCount);
console.log("null/unset:", nullCount);
console.log("total:", totalCount);

// Get all permits for comparison (paginate to get all rows)
let allPermits = [];
let offset = 0;
const pageSize = 1000;
while (true) {
  const { data } = await sb.from("permits_v2").select("municipality, source").range(offset, offset + pageSize - 1);
  if (!data || data.length === 0) break;
  allPermits.push(...data);
  if (data.length < pageSize) break;
  offset += pageSize;
}
console.log(`\nTotal rows fetched: ${allPermits.length}`);
const muniStats = {};
for (const p of allPermits || []) {
  const m = p.municipality;
  if (!muniStats[m]) muniStats[m] = { floede: 0, kommunkartan: 0 };
  if (p.source === "kommunkartan") muniStats[m].kommunkartan++;
  else muniStats[m].floede++;
}

// Distinct municipalities per source
const kkMunis = Object.entries(muniStats).filter(([, s]) => s.kommunkartan > 0);
const floMunis = Object.entries(muniStats).filter(([, s]) => s.floede > 0);
console.log();
console.log("kommunkartan municipalities:", kkMunis.length);
console.log("floede municipalities:", floMunis.length);

// Top 50 by KK count
console.log();
console.log("=== TOP 50 BY KOMMUNKARTAN COUNT ===");
const sorted = Object.entries(muniStats).sort((a, b) => b[1].kommunkartan - a[1].kommunkartan).slice(0, 50);
console.log("Municipality".padEnd(30) + "Flöde".padStart(8) + "KK".padStart(8));
console.log("-".repeat(46));
for (const [m, s] of sorted) {
  console.log(m.padEnd(30) + String(s.floede).padStart(8) + String(s.kommunkartan).padStart(8));
}

// KK has data, Floede has 0
const kkOnly = Object.entries(muniStats).filter(([, s]) => s.kommunkartan > 0 && s.floede === 0).sort((a, b) => b[1].kommunkartan - a[1].kommunkartan);
console.log();
console.log(`=== KK HAS DATA, FLÖDE HAS 0 (${kkOnly.length}) ===`);
for (const [m, s] of kkOnly) console.log(`  ${m}: ${s.kommunkartan} permits`);

// Floede has data, KK has 0
const floOnly = Object.entries(muniStats).filter(([, s]) => s.floede > 0 && s.kommunkartan === 0).sort((a, b) => b[1].floede - a[1].floede);
console.log();
console.log(`=== FLÖDE HAS DATA, KK HAS 0 (${floOnly.length}) ===`);
for (const [m, s] of floOnly.slice(0, 30)) console.log(`  ${m}: ${s.floede} permits`);
if (floOnly.length > 30) console.log(`  ...and ${floOnly.length - 30} more`);
