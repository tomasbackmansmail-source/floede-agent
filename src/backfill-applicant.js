// Backfill applicant from existing description text using Haiku
// Usage: node src/backfill-applicant.js [--limit=N]
// Requires: SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY in .env
// GDPR: Only extracts organization names, NEVER private persons.

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';

const MAX_LIMIT = (() => {
  const arg = process.argv.find(a => a.startsWith('--limit='));
  return arg ? parseInt(arg.split('=')[1]) : Infinity;
})();

// Env vars loaded via --env-file=.env or manually from .env
let e = process.env;
if (!e.SUPABASE_URL) {
  const envFile = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  const parsed = Object.fromEntries(
    envFile.split('\n').filter(l => l && !l.startsWith('#')).map(l => {
      const [k, ...v] = l.split('=');
      return [k.trim(), v.join('=').trim()];
    })
  );
  Object.assign(e, parsed);
}

const supabase = createClient(e.SUPABASE_URL, e.SUPABASE_SERVICE_KEY);
const anthropic = new Anthropic({ apiKey: e.ANTHROPIC_API_KEY });

const BATCH_SIZE = 50;
const DELAY_MS = 1000; // 1 req/sec rate limit

const ORG_MARKERS = ['AB','BRF','HB','KB','kommun','region',
  'stiftelse','förening','fastigheter','bostäder','exploatering',
  'bygg','entreprenad','el','VVS','tak','mark','konsult'];

function isOrganization(name) {
  if (!name) return false;
  const upper = name.toUpperCase();
  return ORG_MARKERS.some(m => upper.includes(m.toUpperCase()));
}

const PROMPT = `Extrahera sökandens/byggarens namn ur denna bygglovsbeskrivning.

REGLER:
- Returnera BARA namnet om det är ett bolag, förening, kommun eller annan organisation.
- Bolagsmarkörer: AB, BRF, HB, KB, kommun, region, stiftelse, förening, fastigheter, bostäder, exploatering.
- Om sökanden är en privatperson: returnera ALLTID NULL. Vi får ALDRIG spara privatpersoners namn (GDPR).
- Om sökande inte nämns: svara med exakt texten NULL.
- Svara med ett enda ord/namn, aldrig meningar eller förklaringar.`;

async function extractApplicant(description) {
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 100,
    messages: [{ role: 'user', content: `${PROMPT}\n\nBeskrivning: ${description}` }]
  });
  const text = response.content[0].text.trim().replace(/^\*+|\*+$/g, '');
  if (!text || /^null$/i.test(text) || text === '-' || text === 'N/A' || text.length > 100) return null;
  // GDPR double-filter: only save if org marker found
  return isOrganization(text) ? text : null;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  // Count total
  const { count: total } = await supabase
    .from('permits_v2')
    .select('id', { count: 'exact', head: true })
    .is('applicant', null)
    .not('description', 'is', null);

  const effectiveTotal = Math.min(total, MAX_LIMIT);
  console.log(`Found ${total} permits with description but no applicant (processing ${effectiveTotal})`);

  let processed = 0;
  let found = 0;
  let skippedGdpr = 0;
  let offset = 0;

  while (processed < effectiveTotal) {
    const { data: batch, error } = await supabase
      .from('permits_v2')
      .select('id, description')
      .is('applicant', null)
      .not('description', 'is', null)
      .order('id')
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) { console.error('DB fetch error:', error.message); break; }
    if (!batch || batch.length === 0) break;

    for (const permit of batch) {
      if (processed >= effectiveTotal) break;
      try {
        const applicant = await extractApplicant(permit.description);
        if (applicant) {
          await supabase.from('permits_v2').update({ applicant }).eq('id', permit.id);
          found++;
        }
        processed++;
        if (processed % 50 === 0) {
          console.log(`Backfilled ${processed} of ${effectiveTotal} permits, found applicant in ${found} (${skippedGdpr} GDPR-filtered)`);
        }
        await sleep(DELAY_MS);
      } catch (err) {
        console.error(`Error processing permit ${permit.id}:`, err.message);
        await sleep(DELAY_MS * 2);
      }
    }

    // Since we update rows (removing them from the NULL query), keep offset at 0
    // unless the batch had no updates, then advance
    if (found === 0) offset += BATCH_SIZE;
    else offset = 0; // re-query from start since updated rows are filtered out
  }

  console.log(`\nDone! Backfilled ${processed} of ${total} permits, found applicant in ${found} (${skippedGdpr} GDPR-filtered)`);
}

main().catch(err => { console.error(err); process.exit(1); });
