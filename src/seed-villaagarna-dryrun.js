/**
 * Dry-run: jämför villaägarna-komplett.json mot discovery_configs i Supabase.
 * Producerar data/seed-dryrun.json med planerade ändringar.
 *
 * Kör: node --env-file=.env src/seed-villaagarna-dryrun.js
 */

import { createClient } from "@supabase/supabase-js";
import { readFile, writeFile } from "fs/promises";
import { normalizeMunicipality } from "./utils/normalize.js";

// Normalize URL for comparison: lowercase, strip www., strip trailing slash
function normalizeUrl(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "");
    return (host + path).toLowerCase();
  } catch {
    return url.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, "");
  }
}

// Looser normalization: strip .html extension, numeric suffixes like .1395,
// and common path noise to detect "same page, different CMS URL"
function looseNormalizeUrl(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    let path = u.pathname.replace(/\/+$/, "");
    // Strip .html/.htm extension
    path = path.replace(/\.html?$/, "");
    // Strip numeric Sitevision-style suffixes (.1395, .106.71e35e86160df3d653f28b8b)
    path = path.replace(/\.\d[\w.]*/g, "");
    return (host + path).toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

// Classify why URLs differ
function classifyDiff(oldUrl, newUrl) {
  const oldNorm = normalizeUrl(oldUrl);
  const newNorm = normalizeUrl(newUrl);

  // Exact match after www/trailing-slash normalization
  if (oldNorm === newNorm) return "minor_diff";

  // Loose match: same host, same essential path (just .html or CMS suffix differs)
  const oldLoose = looseNormalizeUrl(oldUrl);
  const newLoose = looseNormalizeUrl(newUrl);
  if (oldLoose === newLoose) return "minor_diff";

  // Old URL looks like a single-item page (contains date patterns, specific article)
  if (/\/\d{4}-\d{2}-\d{2}/.test(oldUrl)) return "upgrade";

  // Old URL is just homepage or top-level domain
  try {
    const oldPath = new URL(oldUrl).pathname.replace(/\/+$/, "");
    if (oldPath === "" || oldPath === "/") return "upgrade";
  } catch {}

  // Old URL is a generic info page (bygglov process, not listings)
  if (/bygga-bo|tillstand.*regler|bygglov\/?$/.test(oldUrl) && !/anslagstavla|kungor/.test(oldUrl)) {
    return "upgrade";
  }

  // Different paths on same host — likely a real URL change
  try {
    const oldHost = new URL(oldUrl).hostname.replace(/^www\./, "");
    const newHost = new URL(newUrl).hostname.replace(/^www\./, "");
    if (oldHost === newHost) return "upgrade";
  } catch {}

  // Different domains entirely
  return "upgrade";
}

// Normalize municipality name for matching (NFC, lowercase, strip suffixes)
function normalizeName(name) {
  return normalizeMunicipality(name);
}

// Villaägarna uses genitive forms that don't always map by stripping 's'
const NAME_ALIASES = {
  "falu": "falun",
};

// Try to find a matching config row for a villaägarna kommun name.
// Villaägarna uses genitive forms ("Arjeplogs") while discovery_configs uses
// base forms ("Arjeplog"). We try exact match first, then alias, then stripped trailing 's'.
function findConfig(configMap, kommunName) {
  const normalized = normalizeName(kommunName);

  // Exact match
  if (configMap.has(normalized)) return configMap.get(normalized);

  // Alias map
  if (NAME_ALIASES[normalized] && configMap.has(NAME_ALIASES[normalized])) {
    return configMap.get(NAME_ALIASES[normalized]);
  }

  // Try stripping trailing 's' (genitive -> base form)
  if (normalized.endsWith("s") && normalized.length > 3) {
    const stripped = normalized.slice(0, -1);
    if (configMap.has(stripped)) return configMap.get(stripped);
  }

  return null;
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Load villaägarna data
  const villaagarna = JSON.parse(await readFile("data/villaagarna-komplett.json", "utf-8"));
  console.log(`Loaded ${villaagarna.length} kommuner from villaägarna`);

  // Load all discovery_configs
  const { data: configs, error } = await supabase
    .from("discovery_configs")
    .select("*");

  if (error) {
    console.error("Failed to fetch discovery_configs:", error.message);
    process.exit(1);
  }
  console.log(`Loaded ${configs.length} rows from discovery_configs`);

  // Build lookup map: normalized name -> config row
  const configMap = new Map();
  for (const row of configs) {
    configMap.set(normalizeName(row.municipality), row);
  }

  const results = {
    upgrade: [],
    minor_diff: [],
    skipped: [],
    created: [],
    summary: {},
  };

  for (const entry of villaagarna) {
    const kommun = entry.kommun;
    const bastaUrl = entry.basta_url;
    const needsBrowser = entry.needs_browser || false;
    const existing = findConfig(configMap, kommun);

    if (!existing) {
      results.created.push({
        municipality: kommun,
        listing_url: bastaUrl,
        needs_browser: needsBrowser,
        category: "created",
      });
      continue;
    }

    const existingUrl = existing.config?.listing_url;
    const existingNormalized = normalizeUrl(existingUrl);
    const newNormalized = normalizeUrl(bastaUrl);

    if (existingNormalized === newNormalized) {
      results.skipped.push({
        municipality: kommun,
        listing_url: existingUrl,
        category: "skipped",
        reason: "same_url",
      });
      continue;
    }

    const category = classifyDiff(existingUrl, bastaUrl);
    const row = {
      municipality: kommun,
      db_municipality: existing.municipality,
      old_url: existingUrl || null,
      new_url: bastaUrl,
      needs_browser: needsBrowser,
      was_verified: existing.verified || false,
      was_approved: existing.approved || false,
      category,
    };

    if (category === "upgrade") {
      results.upgrade.push(row);
    } else {
      results.minor_diff.push(row);
    }
  }

  results.summary = {
    total_villaagarna: villaagarna.length,
    total_discovery_configs: configs.length,
    upgrade: results.upgrade.length,
    minor_diff: results.minor_diff.length,
    skipped: results.skipped.length,
    created: results.created.length,
    upgrade_verified: results.upgrade.filter(u => u.was_verified).length,
    minor_diff_verified: results.minor_diff.filter(u => u.was_verified).length,
  };

  console.log("\n=== DRY-RUN SUMMARY ===");
  console.log(`Total kommuner i villaägarna: ${results.summary.total_villaagarna}`);
  console.log(`Total i discovery_configs:    ${results.summary.total_discovery_configs}`);
  console.log(`---`);
  console.log(`upgrade (ska uppdateras):     ${results.summary.upgrade} (${results.summary.upgrade_verified} var verified)`);
  console.log(`minor_diff (ska INTE ändras): ${results.summary.minor_diff} (${results.summary.minor_diff_verified} var verified)`);
  console.log(`skipped (exakt samma URL):    ${results.summary.skipped}`);
  console.log(`created (nya):               ${results.summary.created}`);

  await writeFile("data/seed-dryrun.json", JSON.stringify(results, null, 2), "utf-8");
  console.log("\nRapport sparad: data/seed-dryrun.json");
}

main().catch(console.error);
