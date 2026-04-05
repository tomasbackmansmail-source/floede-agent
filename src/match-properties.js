// src/match-properties.js — Match CI properties against ByggSignal permits
// Creates ci_signals for new building permit matches.
// Run: node src/match-properties.js

import { readFileSync } from 'node:fs';
import { normalizeMunicipality } from './utils/normalize.js';

const ciConfig = JSON.parse(readFileSync(new URL('./config/verticals/ci-pressroom.json', import.meta.url), 'utf8'));

const CI_SUPABASE_URL = ciConfig.supabase_url;
const CI_SUPABASE_KEY = process.env.CI_SUPABASE_SERVICE_KEY;
const BS_SUPABASE_URL = process.env.SUPABASE_URL;
const BS_SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!CI_SUPABASE_KEY || !BS_SUPABASE_URL || !BS_SUPABASE_KEY) {
  console.error('[match-properties] Missing required env variables');
  process.exit(1);
}

const log = (...args) => console.log('[match-properties]', ...args);
const warn = (...args) => console.warn('[match-properties]', ...args);

const ciHeaders = {
  apikey: CI_SUPABASE_KEY,
  Authorization: `Bearer ${CI_SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

const bsHeaders = {
  apikey: BS_SUPABASE_KEY,
  Authorization: `Bearer ${BS_SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

// ── Maturity mapping ────────────────────────────────────────────────────

const STATUS_TO_MATURITY = {
  'ansökt': 'rumor',
  'beviljat': 'planned',
  'startbesked': 'planned',
  'slutbesked': 'awarded',
  'överklagat': 'rumor',
};
// 'avslag' → null → skip

function mapMaturity(status) {
  if (!status) return null;
  const lower = status.toLowerCase().trim();
  if (lower === 'avslag') return null;
  return STATUS_TO_MATURITY[lower] || null;
}

// ── Supabase helpers ────────────────────────────────────────────────────

async function fetchAll(baseUrl, headers, table, select, filters = '') {
  const rows = [];
  const pageSize = 1000;
  let offset = 0;
  while (true) {
    const url = `${baseUrl}/rest/v1/${table}?select=${encodeURIComponent(select)}${filters}&limit=${pageSize}&offset=${offset}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`GET ${table} failed: ${res.status} ${await res.text()}`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return rows;
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  // 1. Read ci_properties
  const properties = await fetchAll(CI_SUPABASE_URL, ciHeaders, 'ci_properties', '*');
  log(`Loaded ${properties.length} properties from ci_properties`);

  if (properties.length === 0) {
    log('No properties found, exiting');
    process.exit(0);
  }

  // 2. Read ci_organizations for name lookup
  const organizations = await fetchAll(CI_SUPABASE_URL, ciHeaders, 'ci_organizations', 'id,name');
  const orgNameById = new Map(organizations.map((o) => [o.id, o.name]));

  // 3. Read permits_v2
  let permits;
  try {
    permits = await fetchAll(BS_SUPABASE_URL, bsHeaders, 'permits_v2', '*');
  } catch (err) {
    warn(`Failed to fetch permits_v2: ${err.message}`);
    process.exit(1);
  }
  log(`Loaded ${permits.length} permits from permits_v2`);

  // 4. Match properties against permits
  let matchCount = 0;
  let createdCount = 0;
  let skippedCount = 0;

  for (const prop of properties) {
    if (!prop.property_designation || !prop.municipality) continue;

    const designation = prop.property_designation.toLowerCase();
    const municipalityNorm = normalizeMunicipality(prop.municipality);

    const matched = permits.filter((p) => {
      if (!p.address || !p.municipality) return false;
      return p.address.toLowerCase().includes(designation) &&
             normalizeMunicipality(p.municipality) === municipalityNorm;
    });

    for (const permit of matched) {
      matchCount++;

      const maturity = mapMaturity(permit.status);
      if (maturity === null && permit.status && permit.status.toLowerCase().trim() === 'avslag') {
        skippedCount++;
        continue;
      }

      const orgName = orgNameById.get(prop.organization_id) || null;
      const description = permit.description
        ? permit.description.slice(0, 200)
        : null;

      const signal = {
        organization_id: prop.organization_id,
        organization_name: orgName,
        title: `${(permit.permit_type || 'okänt').charAt(0).toUpperCase() + (permit.permit_type || 'okänt').slice(1)} — ${prop.property_designation}`,
        maturity: maturity,
        amount_sek: null,
        timeline: null,
        description: description,
        source_url: permit.source_url,
        source_date: permit.date || null,
        region: permit.lan || permit.municipality || null,
      };

      // Upsert with conflict on (organization_id, source_url, title)
      try {
        const url = `${CI_SUPABASE_URL}/rest/v1/ci_signals`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            ...ciHeaders,
            Prefer: 'resolution=merge-duplicates,return=minimal',
          },
          body: JSON.stringify(signal),
        });

        if (!res.ok) {
          const body = await res.text();
          warn(`Insert failed for permit ${permit.case_number}: ${res.status} ${body}`);
          continue;
        }
        createdCount++;
      } catch (err) {
        warn(`Insert error for permit ${permit.case_number}: ${err.message}`);
      }
    }
  }

  log(`Matched ${matchCount} permits`);
  log(`Created/upserted ${createdCount} signals`);
  log(`Skipped ${skippedCount} (avslag or unmapped status)`);
}

main().catch((err) => {
  warn(`Fatal: ${err.message}`);
  process.exit(1);
});
