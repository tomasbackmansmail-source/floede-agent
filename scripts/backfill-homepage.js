import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

// Load .env manually
const env = readFileSync(new URL('../.env', import.meta.url), 'utf-8');
const vars = {};
for (const line of env.split('\n')) {
  const [k, ...v] = line.split('=');
  if (k && v.length) vars[k.trim()] = v.join('=').trim();
}

const supabase = createClient(vars.SUPABASE_URL, vars.SUPABASE_SERVICE_KEY);
const data = JSON.parse(readFileSync('/tmp/homepage-backfill.json', 'utf-8'));

let updated = 0, notFound = 0, errors = 0;
const notFoundNames = [];

for (const [name, homepage] of Object.entries(data)) {
  const { data: rows, error } = await supabase
    .from('municipalities')
    .update({ homepage })
    .eq('name', name)
    .select('name');

  if (error) {
    console.error(`Error updating ${name}: ${error.message}`);
    errors++;
  } else if (!rows || rows.length === 0) {
    notFoundNames.push(name);
    notFound++;
  } else {
    updated++;
  }
}

console.log('\n=== BACKFILL SUMMARY ===');
console.log(`Updated: ${updated}`);
console.log(`Not found in DB: ${notFound}`);
console.log(`Errors: ${errors}`);
if (notFoundNames.length > 0) {
  console.log(`\nNot found names (${notFoundNames.length}):`);
  notFoundNames.forEach(n => console.log(`  - ${n}`));
}
