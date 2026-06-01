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
  'place-of-performance',
  'notice-type',
  'organisation-name-tenderer',
  'organisation-identifier-tenderer',
  'total-value',
  'total-value-cur',
  'contract-duration-end-date-lot',
];
const EUR_TO_SEK = 11.5;

// CPV prefixes relevant for construction/architecture
const RELEVANT_CPV_PREFIXES = ['45', '71', '44'];

const NUTS_TO_LAN = {
  'SE110': 'Stockholms län',
  'SE121': 'Uppsala län',
  'SE122': 'Södermanlands län',
  'SE123': 'Östergötlands län',
  'SE124': 'Örebro län',
  'SE125': 'Västmanlands län',
  'SE211': 'Jönköpings län',
  'SE212': 'Kronobergs län',
  'SE213': 'Kalmar län',
  'SE214': 'Gotlands län',
  'SE221': 'Blekinge län',
  'SE224': 'Skåne län',
  'SE231': 'Hallands län',
  'SE232': 'Västra Götalands län',
  'SE311': 'Värmlands län',
  'SE312': 'Dalarnas län',
  'SE313': 'Gävleborgs län',
  'SE321': 'Västernorrlands län',
  'SE322': 'Jämtlands län',
  'SE331': 'Västerbottens län',
  'SE332': 'Norrbottens län'
};

let placeOfPerformanceSampleLogged = false;

function extractSeNutsCode(placeOfPerformance) {
  if (!placeOfPerformance) return null;
  const items = Array.isArray(placeOfPerformance) ? placeOfPerformance : [placeOfPerformance];
  for (const item of items) {
    if (!item) continue;
    if (typeof item === 'string') {
      if (item.toUpperCase().startsWith('SE')) return item.toUpperCase();
      continue;
    }
    // Try common shapes: { nuts: 'SE110' }, { code: 'SE110' }, nested arrays
    const candidates = [item.nuts, item.code, item.nutsCode, item['nuts-code'], item.value];
    for (const c of candidates) {
      if (typeof c === 'string' && c.toUpperCase().startsWith('SE')) return c.toUpperCase();
    }
    // Recurse into arrays/objects
    for (const key of Object.keys(item)) {
      const v = item[key];
      if (Array.isArray(v) || (v && typeof v === 'object')) {
        const nested = extractSeNutsCode(v);
        if (nested) return nested;
      } else if (typeof v === 'string' && v.toUpperCase().startsWith('SE') && /^SE\d{3}$/i.test(v)) {
        return v.toUpperCase();
      }
    }
  }
  return null;
}

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

// notice-type can arrive as a string or a single-element array.
function firstOf(value) {
  return Array.isArray(value) ? value[0] : value;
}

// can-standard = contract award → awarded; cn-standard = tender. Anything else
// keeps the tender fallback (logged, never crashes).
function mapMaturity(noticeType) {
  const t = firstOf(noticeType);
  if (t === 'can-standard') return 'awarded';
  if (t === 'cn-standard') return 'tender';
  warn(`notice-type "${t}" not mapped, defaulting maturity=tender`);
  return 'tender';
}

// Awarded value from total-value. SEK = raw, EUR = ×11.5, anything else → null.
function totalValueToSek(value, currencyRaw) {
  if (value == null) return null;
  const num = parseFloat(value);
  if (isNaN(num)) return null;
  const cur = firstOf(currencyRaw);
  if (cur === 'SEK') return Math.round(num);
  if (cur === 'EUR') return Math.round(num * EUR_TO_SEK);
  warn(`TED currency ${cur} not handled, skipping amount_sek`);
  return null;
}

// Swedish org-nr in hyphenated form. TED often delivers 10 bare digits — insert
// the hyphen after digit 6. Already-formatted values round-trip unchanged.
// Missing identifier → null.
function formatOrgNr(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const digits = s.replace(/\D/g, '');
  if (digits.length === 10) {
    return `${digits.slice(0, 6)}-${digits.slice(6)}`;
  }
  return s;
}

// GDPR guard: a 10-digit identifier starting with "19" or "20" is personnummer
// format, not an org-nr. Defensive — TED organisation-* fields are orgs by
// definition, but this mirrors ByggSignal's applicant rule.
function looksLikePrivatePerson(raw) {
  if (raw == null) return false;
  const digits = String(raw).replace(/\D/g, '');
  return digits.length === 10 && (digits.startsWith('19') || digits.startsWith('20'));
}

// Build [{name, org_nr}] from TED's parallel arrays. names: language-keyed
// object ({swe:[...]} preferred over {eng:[...]}) or a bare array. ids: bare
// array, may be shorter/absent. Returns null when there are no tenderers.
function buildCounterparties(nameField, idField) {
  let names = null;
  if (Array.isArray(nameField)) {
    names = nameField;
  } else if (nameField && typeof nameField === 'object') {
    names = Array.isArray(nameField.swe) ? nameField.swe
      : Array.isArray(nameField.eng) ? nameField.eng
      : null;
  }
  if (!names || names.length === 0) return null;

  const ids = Array.isArray(idField) ? idField : [];
  if (ids.length > 0 && ids.length !== names.length) {
    warn(`counterparties length mismatch: ${names.length} names vs ${ids.length} ids — pairing min`);
  }
  const count = ids.length > 0 ? Math.min(names.length, ids.length) : names.length;

  const out = [];
  for (let i = 0; i < count; i++) {
    const name = names[i];
    const rawId = ids.length > 0 ? ids[i] : null;
    if (looksLikePrivatePerson(rawId) || looksLikePrivatePerson(name)) {
      warn(`counterparties: skipping suspected private-person entry (id ${rawId})`);
      continue;
    }
    out.push({ name, org_nr: formatOrgNr(rawId) });
  }
  return out.length > 0 ? out : null;
}

// contract-duration-end-date-lot is an array of e.g. "2025-09-30+02:00".
// Take the first, parse to YYYY-MM-DD. Unparseable → null (logged).
function parseContractEndDate(field) {
  const val = firstOf(field);
  if (!val) return null;
  const m = String(val).match(/^(\d{4}-\d{2}-\d{2})/);
  if (!m) {
    warn(`contract_end_date unparseable: ${JSON.stringify(val)}`);
    return null;
  }
  return m[1];
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
  // SORT BY publication-date DESC: TED default is ASC (oldest first), verified
  // empirically. Without this, limit:100 without pagination returns the oldest
  // notices in the window and the pilot never sees fresh awards.
  const query = `organisation-name-buyer = "*${orgName}*" AND organisation-country-buyer = "SWE" AND publication-date > ${startDate} SORT BY publication-date DESC`;

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
      const descFull = descObj.swe || descObj.eng || '';
      const description = descFull.slice(0, 200);

      const pubDate = parsePublicationDate(notice['publication-date']);
      const noticeId = notice['publication-number'];
      const sourceUrl = `https://ted.europa.eu/sv/notice/-/detail/${noticeId}`;

      const deadlines = notice['deadline-receipt-tender-date-lot'];
      const timeline = deadlines && deadlines.length > 0
        ? `Anbudsfrist: ${parsePublicationDate(deadlines[0])}`
        : null;

      const maturity = mapMaturity(notice['notice-type']);

      // Awarded notices carry the final contract value in total-value; tender
      // notices keep the existing estimated-value logic unchanged.
      const amount = maturity === 'awarded'
        ? totalValueToSek(notice['total-value'], notice['total-value-cur'])
        : parseAmount(notice['estimated-value-proc'], notice['estimated-value-cur-proc']);

      const counterparties = buildCounterparties(
        notice['organisation-name-tenderer'],
        notice['organisation-identifier-tenderer']
      );
      const contractEndDate = parseContractEndDate(notice['contract-duration-end-date-lot']);

      const cpvCodes = notice['classification-cpv'];
      const category = mapCategory(cpvCodes, description);

      if (notice['place-of-performance'] && !placeOfPerformanceSampleLogged) {
        log('place-of-performance sample:', JSON.stringify(notice['place-of-performance']).slice(0, 200));
        placeOfPerformanceSampleLogged = true;
      }

      const nutsCode = extractSeNutsCode(notice['place-of-performance']);
      const region = nutsCode ? (NUTS_TO_LAN[nutsCode.toUpperCase()] || null) : null;

      const excerptParts = [];
      const fullTitle = titleObj.swe || titleObj.eng;
      if (fullTitle) excerptParts.push(`Titel: ${fullTitle}`);
      if (descFull) excerptParts.push(descFull.slice(0, 9000));
      if (cpvCodes && cpvCodes.length > 0) excerptParts.push(`CPV: ${cpvCodes.join(', ')}`);
      if (amount) excerptParts.push(`Uppskattat varde: ${amount.toLocaleString('sv-SE')} SEK`);
      if (timeline) excerptParts.push(timeline);
      if (nutsCode) excerptParts.push(`NUTS: ${nutsCode}`);
      const sourceExcerpt = excerptParts.length > 0 ? excerptParts.join('\n\n') : null;

      const signal = {
        organization_id: org.id,
        organization_name: org.name,
        title,
        maturity,
        amount_sek: amount,
        timeline,
        description: description || null,
        source_url: sourceUrl,
        source_date: pubDate,
        region,
        category,
        source_type: 'ted',
        source_excerpt: sourceExcerpt,
        ted_reference: noticeId || null,
        nuts_code: nutsCode,
        counterparties,
        contract_end_date: contractEndDate,
      };

      try {
        const res = await fetch(`${CI_SUPABASE_URL}/rest/v1/ci_signals?on_conflict=organization_id,source_url,title`, {
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
