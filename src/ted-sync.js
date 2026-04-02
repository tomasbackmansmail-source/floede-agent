// src/ted-sync.js — Sync TED (Tenders Electronic Daily) notices to ci_signals
// Fetches EU public procurement notices for CI organizations.
// Run: node src/ted-sync.js            (last 30 days)
//      node src/ted-sync.js --backfill (last 12 months)

import { readFileSync } from 'node:fs';

const ciConfig = JSON.parse(readFileSync(new URL('./config/verticals/ci-pressroom.json', import.meta.url), 'utf8'));

const CI_SUPABASE_URL = ciConfig.supabase_url;
const CI_SUPABASE_KEY = process.env.CI_SUPABASE_SERVICE_KEY;

if (!CI_SUPABASE_KEY) {
  console.error('[ted-sync] Missing CI_SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const log = (...args) => console.log('[ted-sync]', ...args);
const warn = (...args) => console.warn('[ted-sync]', ...args);

const TED_API = 'https://api.ted.europa.eu/v3/notices/search';
const TED_FIELDS = [
  'title-proc',
  'publication-date',
  'description-proc',
  'estimated-value-proc',
  'estimated-value-cur-proc',
  'deadline-receipt-tender-date-lot',
  'classification-cpv',
];
const EUR_TO_SEK = 11.5;

// CPV prefixes relevant for construction/architecture
const RELEVANT_CPV_PREFIXES = ['45', '71', '44'];

const isBackfill = process.argv.includes('--backfill');

const ciHeaders = {
  apikey: CI_SUPABASE_KEY,
  Authorization: `Bearer ${CI_SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

// ── Helpers ──────────────────────────────────────────────────────────

function formatDate(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

function parsePublicationDate(dateStr) {
  if (!dateStr) return null;
  // Format: "2026-03-05+01:00" or "2026-03-05Z"
  return dateStr.slice(0, 10);
}

function hasRelevantCpv(cpvCodes) {
  if (!cpvCodes || !Array.isArray(cpvCodes)) return true; // no CPV = include
  return cpvCodes.some(code => {
    const str = String(code);
    return RELEVANT_CPV_PREFIXES.some(prefix => str.startsWith(prefix));
  });
}

function parseAmount(value, currency) {
  if (!value) return null;
  const num = parseFloat(value);
  if (isNaN(num)) return null;
  if (currency && currency !== 'SEK') {
    return Math.round(num * EUR_TO_SEK);
  }
  return Math.round(num);
}

function mapCategory(cpvCodes, description) {
  if (!cpvCodes || cpvCodes.length === 0) return 'commercial';
  const first = String(cpvCodes[0]);

  // 71xxx = architecture/engineering services
  if (first.startsWith('71')) return 'commercial';
  // 44xxx = construction structures
  if (first.startsWith('44')) return 'commercial';

  // 45xxx = construction work — try to infer from description
  if (first.startsWith('45')) {
    const desc = (description || '').toLowerCase();
    if (/bost[aä]d|l[aä]genhet|student/.test(desc)) return 'residential';
    if (/skol|sjukhus|kultur|idrot|universite|campus/.test(desc)) return 'public';
    if (/v[aä]g|bro|tunnel|va-|vatten|avlopp/.test(desc)) return 'infrastructure';
    if (/kontor|handel|hotell|butik/.test(desc)) return 'commercial';
    return 'commercial';
  }

  return 'commercial';
}

// ── TED API ──────────────────────────────────────────────────────────

async function searchTed(orgName, startDate) {
  const query = `organisation-name-buyer = "*${orgName}*" AND organisation-country-buyer = "SWE" AND publication-date > ${startDate}`;

  const allNotices = [];
  let page = 1;
  const limit = 100;

  while (true) {
    const body = { query, fields: TED_FIELDS, limit };
    if (page > 1) {
      // TED API uses iterationNextToken for pagination — not supported in simple mode
      // We fetch up to 100 which covers most cases
      break;
    }

    const res = await fetch(TED_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      warn(`TED API error for ${orgName}: ${res.status} ${text.slice(0, 200)}`);
      return [];
    }

    const data = await res.json();
    if (data.message) {
      warn(`TED API message for ${orgName}: ${data.message}`);
      return [];
    }

    allNotices.push(...(data.notices || []));
    log(`  ${orgName}: ${data.totalNoticeCount} total notices, fetched ${allNotices.length}`);
    break;
  }

  return allNotices;
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  const lookbackDays = isBackfill ? 365 : 30;
  const startDate = formatDate(lookbackDays);
  log(`Mode: ${isBackfill ? 'backfill (12 months)' : 'daily (30 days)'}, start date: ${startDate}`);

  // 1. Load organizations
  const orgRes = await fetch(`${CI_SUPABASE_URL}/rest/v1/ci_organizations?select=id,name`, {
    headers: ciHeaders,
  });
  if (!orgRes.ok) throw new Error(`Failed to load organizations: ${orgRes.status}`);
  const organizations = await orgRes.json();
  log(`Loaded ${organizations.length} organizations`);

  let totalFetched = 0;
  let totalFiltered = 0;
  let totalInserted = 0;

  // 2. Search TED per organization
  for (const org of organizations) {
    const notices = await searchTed(org.name, startDate);
    if (notices.length === 0) continue;

    totalFetched += notices.length;

    // 3. Filter by relevant CPV
    const relevant = notices.filter(n => hasRelevantCpv(n['classification-cpv']));
    totalFiltered += relevant.length;

    if (relevant.length === 0) {
      log(`  ${org.name}: ${notices.length} notices, 0 with relevant CPV — skipped`);
      continue;
    }

    log(`  ${org.name}: ${notices.length} notices, ${relevant.length} with relevant CPV`);

    // 4. Map and upsert
    let orgInserted = 0;
    for (const notice of relevant) {
      const titleObj = notice['title-proc'] || {};
      const title = (titleObj.swe || titleObj.eng || '(okänd titel)').slice(0, 80);

      const descObj = notice['description-proc'] || {};
      const description = (descObj.swe || descObj.eng || '').slice(0, 200);

      const pubDate = parsePublicationDate(notice['publication-date']);
      const noticeId = notice['publication-number'];
      const sourceUrl = `https://ted.europa.eu/sv/notice/-/detail/${noticeId}`;

      const deadlines = notice['deadline-receipt-tender-date-lot'];
      const timeline = deadlines && deadlines.length > 0
        ? `Anbudsfrist: ${parsePublicationDate(deadlines[0])}`
        : null;

      const amount = parseAmount(
        notice['estimated-value-proc'],
        notice['estimated-value-cur-proc']
      );

      const cpvCodes = notice['classification-cpv'];
      const category = mapCategory(cpvCodes, description);

      const signal = {
        organization_id: org.id,
        organization_name: org.name,
        title,
        maturity: 'tender',
        amount_sek: amount,
        timeline,
        description: description || null,
        source_url: sourceUrl,
        source_date: pubDate,
        region: null,
        category,
        source_type: 'ted',
      };

      try {
        const res = await fetch(`${CI_SUPABASE_URL}/rest/v1/ci_signals`, {
          method: 'POST',
          headers: {
            ...ciHeaders,
            Prefer: 'resolution=merge-duplicates,return=minimal',
          },
          body: JSON.stringify(signal),
        });

        if (!res.ok) {
          const body = await res.text();
          warn(`Insert failed for ${noticeId}: ${res.status} ${body.slice(0, 200)}`);
          continue;
        }
        orgInserted++;
      } catch (err) {
        warn(`Insert error for ${noticeId}: ${err.message}`);
      }
    }

    totalInserted += orgInserted;
    log(`  ${org.name}: ${orgInserted} signals upserted`);
  }

  log(`\n=== TED SYNC COMPLETE ===`);
  log(`Fetched: ${totalFetched}, Relevant CPV: ${totalFiltered}, Inserted: ${totalInserted}`);
}

main().catch((err) => {
  warn(`Fatal: ${err.message}`);
  process.exit(1);
});
