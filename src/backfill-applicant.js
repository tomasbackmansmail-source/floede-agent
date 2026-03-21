// Backfill applicant from existing description text using Haiku
// Usage: node src/backfill-applicant.js
// Requires: SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY in .env

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';

// Load .env manually (no dotenv dependency)
const envFile = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const env = Object.fromEntries(
  envFile.split('\n').filter(l => l && !l.startsWith('#')).map(l => {
    const [k, ...v] = l.split('=');
    return [k.trim(), v.join('=').trim()];
  })
);

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

const BATCH_SIZE = 50;
const DELAY_MS = 1000; // 1 req/sec rate limit

const PROMPT = `Ur följande bygglovsbeskrivning, extrahera sökandens namn om det framgår.
Returnera BARA namnet, inget annat. Om sökande inte framgår, returnera NULL.`;

async function extractApplicant(description) {
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 100,
    messages: [{ role: 'user', content: `${PROMPT}\n\nBeskrivning: ${description}` }]
  });
  const text = response.content[0].text.trim();
  if (!text || text.toUpperCase() === 'NULL' || text === '-' || text === 'null') return null;
  return text;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  // Count total
  const { count: total } = await supabase
    .from('permits_v2')
    .select('id', { count: 'exact', head: true })
    .is('applicant', null)
    .not('description', 'is', null);

  console.log(`Found ${total} permits with description but no applicant`);

  let processed = 0;
  let found = 0;
  let offset = 0;

  while (true) {
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
      try {
        const applicant = await extractApplicant(permit.description);
        if (applicant) {
          await supabase.from('permits_v2').update({ applicant }).eq('id', permit.id);
          found++;
        }
        processed++;
        if (processed % 10 === 0) {
          console.log(`Backfilled ${processed} of ${total} permits, found applicant in ${found}`);
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

  console.log(`\nDone! Backfilled ${processed} of ${total} permits, found applicant in ${found}`);
}

main().catch(err => { console.error(err); process.exit(1); });
