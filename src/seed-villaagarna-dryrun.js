/**
 * Dry-run: jämför villaägarna-komplett.json mot discovery_configs i Supabase.
 * Producerar data/seed-dryrun.json med planerade ändringar.
 *
 * Kör: node --env-file=.env src/seed-villaagarna-dryrun.js
 */

import { createClient } from "@supabase/supabase-js";
import { readFile, writeFile } from "fs/promises";

// Normalize URL for comparison: lowercase, strip trailing slash, strip protocol
function normalizeUrl(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, "");
    return (u.hostname + path).toLowerCase();
  } catch {
    return url.toLowerCase().replace(/\/+$/, "");
  }
}

// Normalize municipality name for matching (NFC, lowercase)
function normalizeName(name) {
  return name.normalize("NFC").toLowerCase().trim();
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
    created: [],
    updated: [],
    skipped: [],
    summary: {},
  };

  for (const entry of villaagarna) {
    const kommun = entry.kommun;
    const bastaUrl = entry.basta_url;
    const needsBrowser = entry.needs_browser || false;
    const existing = findConfig(configMap, kommun);

    if (!existing) {
      // New — create
      results.created.push({
        municipality: kommun,
        listing_url: bastaUrl,
        needs_browser: needsBrowser,
        action: "created",
      });
      continue;
    }

    const existingUrl = existing.config?.listing_url;
    const existingNormalized = normalizeUrl(existingUrl);
    const newNormalized = normalizeUrl(bastaUrl);

    if (existingNormalized === newNormalized) {
      // Same URL — skip (also skip if verified=true)
      results.skipped.push({
        municipality: kommun,
        listing_url: existingUrl,
        reason: "same_url",
      });
      continue;
    }

    // URL differs — but don't overwrite verified=true with same URL (already handled above)
    // If verified=true and URL is different, we still update since villaägarna has a better URL
    results.updated.push({
      municipality: kommun,
      old_url: existingUrl || null,
      new_url: bastaUrl,
      needs_browser: needsBrowser,
      was_verified: existing.verified || false,
      was_approved: existing.approved || false,
      action: "updated",
    });
  }

  results.summary = {
    total_villaagarna: villaagarna.length,
    total_discovery_configs: configs.length,
    created: results.created.length,
    updated: results.updated.length,
    skipped: results.skipped.length,
  };

  console.log("\n=== DRY-RUN SUMMARY ===");
  console.log(`Total kommuner i villaägarna: ${results.summary.total_villaagarna}`);
  console.log(`Total i discovery_configs:    ${results.summary.total_discovery_configs}`);
  console.log(`Skapas (nya):                 ${results.summary.created}`);
  console.log(`Uppdateras (ny URL):          ${results.summary.updated}`);
  console.log(`Skippas (samma URL):          ${results.summary.skipped}`);

  await writeFile("data/seed-dryrun.json", JSON.stringify(results, null, 2), "utf-8");
  console.log("\nRapport sparad: data/seed-dryrun.json");
}

main().catch(console.error);
