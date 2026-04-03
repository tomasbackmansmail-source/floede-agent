// scripts/fix-aao-duplicates.js — Find and fix ÅÄÖ-mangled names in discovery_configs
// Run: node --env-file=.env scripts/fix-aao-duplicates.js
// Dry-run (default): shows what would change. Pass --apply to execute.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const apply = process.argv.includes("--apply");

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Detect mangled ÅÄÖ names: uppercase letters mid-word (e.g. "åMåL", "åRe")
function isMangledName(name) {
  // Pattern: lowercase letter followed by uppercase letter mid-word
  if (/[a-zåäö][A-ZÅÄÖ]/.test(name)) return true;
  // Pattern: starts with å/ä/ö followed by uppercase (e.g. "åRe")
  if (/^[åäö][A-Z]/.test(name)) return true;
  return false;
}

async function main() {
  // 1. Load all discovery_configs
  const { data: configs, error } = await supabase
    .from("discovery_configs")
    .select("id, municipality, approved, config")
    .order("municipality");

  if (error) {
    console.error(`Failed to load configs: ${error.message}`);
    process.exit(1);
  }

  console.log(`Total discovery_configs: ${configs.length}`);
  console.log(`Approved: ${configs.filter(c => c.approved).length}\n`);

  // 2. Load municipalities reference table
  const { data: muniRows } = await supabase
    .from("municipalities")
    .select("name");
  const validNames = new Set((muniRows || []).map(r => r.name));

  // 3. Find mangled names
  const mangled = configs.filter(c => isMangledName(c.municipality));
  console.log(`=== MANGLED NAMES (${mangled.length}) ===`);
  for (const c of mangled) {
    console.log(`  id=${c.id}  municipality="${c.municipality}"  approved=${c.approved}`);
  }

  // 4. Find duplicates: normalize both names and check for collisions
  function normalize(name) {
    return name.toLowerCase()
      .replace(/å/g, 'a').replace(/ä/g, 'a').replace(/ö/g, 'o')
      .replace(/é/g, 'e').replace(/ü/g, 'u')
      .replace(/[^a-z]/g, '');
  }

  const byNormalized = new Map();
  for (const c of configs) {
    const key = normalize(c.municipality);
    if (!byNormalized.has(key)) byNormalized.set(key, []);
    byNormalized.get(key).push(c);
  }

  const duplicates = [...byNormalized.entries()].filter(([, v]) => v.length > 1);
  console.log(`\n=== DUPLICATES (${duplicates.length} groups) ===`);
  for (const [key, group] of duplicates) {
    console.log(`  "${key}":`);
    for (const c of group) {
      console.log(`    id=${c.id}  municipality="${c.municipality}"  approved=${c.approved}`);
    }
  }

  // 5. Build fix plan
  const toDelete = [];
  const toRename = [];

  // Handle duplicates: keep the one with correct name, delete the mangled one
  // But skip groups where BOTH names are valid municipalities (e.g. Habo vs Håbo)
  for (const [, group] of duplicates) {
    const allValid = group.filter(c => validNames.has(c.municipality));
    if (allValid.length > 1) {
      console.log(`  SKIP: both are valid municipalities: ${allValid.map(c => c.municipality).join(', ')}`);
      continue;
    }

    const correct = allValid[0];
    const others = group.filter(c => c !== correct);
    if (correct) {
      for (const other of others) {
        toDelete.push({ id: other.id, municipality: other.municipality, reason: `duplicate of "${correct.municipality}"` });
      }
    } else {
      // No correct name found — keep the approved one, delete the rest
      const approved = group.find(c => c.approved);
      const keep = approved || group[0];
      for (const other of group.filter(c => c !== keep)) {
        toDelete.push({ id: other.id, municipality: other.municipality, reason: `duplicate (no reference match)` });
      }
    }
  }

  // Handle mangled names without duplicates: rename to correct name
  for (const c of mangled) {
    if (toDelete.some(d => d.id === c.id)) continue; // Already marked for deletion

    // Find matching municipality
    const normalizedMangled = normalize(c.municipality);
    const correctName = [...validNames].find(name => normalize(name) === normalizedMangled);
    if (correctName && correctName !== c.municipality) {
      toRename.push({ id: c.id, from: c.municipality, to: correctName });
    }
  }

  console.log(`\n=== FIX PLAN ===`);
  console.log(`Delete: ${toDelete.length}`);
  for (const d of toDelete) {
    console.log(`  DELETE id=${d.id} "${d.municipality}" — ${d.reason}`);
  }
  console.log(`Rename: ${toRename.length}`);
  for (const r of toRename) {
    console.log(`  RENAME id=${r.id} "${r.from}" → "${r.to}"`);
  }

  if (!apply) {
    console.log(`\nDry run. Pass --apply to execute.`);
    return;
  }

  // 6. Execute fixes
  console.log(`\n=== APPLYING FIXES ===`);

  for (const d of toDelete) {
    const { error } = await supabase.from("discovery_configs").delete().eq("id", d.id);
    if (error) console.error(`  DELETE failed id=${d.id}: ${error.message}`);
    else console.log(`  DELETED id=${d.id} "${d.municipality}"`);
  }

  for (const r of toRename) {
    const { error } = await supabase.from("discovery_configs").update({ municipality: r.to }).eq("id", r.id);
    if (error) console.error(`  RENAME failed id=${r.id}: ${error.message}`);
    else console.log(`  RENAMED id=${r.id} "${r.from}" → "${r.to}"`);
  }

  // 7. Verify
  const { count } = await supabase
    .from("discovery_configs")
    .select("id", { count: "exact", head: true })
    .eq("approved", true);
  console.log(`\nApproved configs after fix: ${count}`);
}

main().catch(err => { console.error(err); process.exit(1); });
