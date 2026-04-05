/**
 * validate-villaagarna-urls.js
 *
 * HTTP health check against all 290 municipality URLs from Villaägarna.
 * No AI, no Playwright, no database writes. Pure HTTP GET + keyword check.
 *
 * Output: data/villaagarna-validation.json
 *
 * Usage: node src/validate-villaagarna-urls.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INPUT = path.join(__dirname, '..', 'data', 'villaagarna-kommuner.json');
const OUTPUT = path.join(__dirname, '..', 'data', 'villaagarna-validation.json');
const TIMEOUT_MS = 10000;
const CONCURRENCY = 10;
const KEYWORDS = ['bygglov', 'ansökan', 'beviljat', 'fastighetsbeteckning', 'diarienummer', 'byggnadsnämnden', 'startbesked', 'marklov', 'rivningslov'];

function classifyResponse(status) {
  if (status >= 200 && status < 300) return 'live';
  if (status >= 300 && status < 400) return 'redirect';
  if (status === 404) return 'not_found';
  if (status >= 400 && status < 500) return 'client_error';
  if (status >= 500) return 'server_error';
  return 'error';
}

async function checkUrl(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const start = Date.now();

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Floede-HealthCheck/1.0' },
      redirect: 'follow',
    });

    const body = await res.text();
    const truncated = body.slice(0, 200000);
    const elapsed = Date.now() - start;
    const lower = truncated.toLowerCase();
    const keywordHits = KEYWORDS.filter(kw => lower.includes(kw));

    return {
      status: res.status,
      redirect_url: res.redirected ? res.url : null,
      content_type: (res.headers.get('content-type') || '').split(';')[0].trim(),
      size_bytes: Buffer.byteLength(truncated, 'utf8'),
      response_ms: elapsed,
      keyword_hits: keywordHits,
      classification: classifyResponse(res.status)
    };
  } catch (err) {
    return {
      status: 0,
      redirect_url: null,
      content_type: null,
      size_bytes: 0,
      response_ms: Date.now() - start,
      keyword_hits: [],
      classification: err.name === 'AbortError' ? 'timeout' : 'error',
      error: err.name === 'AbortError' ? 'timeout' : err.message
    };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  if (!fs.existsSync(INPUT)) {
    console.error('Missing input file: ' + INPUT);
    process.exit(1);
  }

  const kommuner = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
  console.log('Validating ' + kommuner.length + ' URLs (concurrency: ' + CONCURRENCY + ')...');
  console.log('');

  const results = [];

  for (let i = 0; i < kommuner.length; i += CONCURRENCY) {
    const batch = kommuner.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(async (k) => {
      const result = await checkUrl(k.anslagstavla);
      return {
        kommun: k.kommun,
        lan: k.lan,
        anslagstavla_url: k.anslagstavla,
        hemsida: k.hemsida,
        ...result
      };
    }));
    results.push(...batchResults);

    const done = Math.min(i + CONCURRENCY, kommuner.length);
    // Log non-live results from this batch
    for (const r of batchResults) {
      if (r.classification !== 'live') {
        console.log('  ' + r.kommun + ': ' + r.classification.toUpperCase() + (r.error ? ' (' + r.error + ')' : ''));
      }
    }
    process.stdout.write('[' + done + '/' + kommuner.length + ']\n');
  }

  // Write results
  fs.writeFileSync(OUTPUT, JSON.stringify(results, null, 2));

  // Summary
  const live = results.filter(r => r.classification === 'live').length;
  const redirect = results.filter(r => r.classification === 'redirect').length;
  const timeout = results.filter(r => r.classification === 'timeout').length;
  const errorCount = results.filter(r => !['live', 'redirect', 'timeout'].includes(r.classification)).length;

  console.log('');
  console.log('=== RESULTAT ===');
  console.log('Live:     ' + live);
  console.log('Redirect: ' + redirect);
  console.log('Timeout:  ' + timeout);
  console.log('Error:    ' + errorCount);
  console.log('');

  const withKeywords = results.filter(r => r.keyword_hits.length > 0);
  const withoutKeywords = results.filter(r => r.classification === 'live' && r.keyword_hits.length === 0);
  console.log('Med bygglovs-nyckelord: ' + withKeywords.length);
  console.log('Live men UTAN nyckelord: ' + withoutKeywords.length + ' (kan vara protokoll-anslagstavlor)');
  console.log('');
  console.log('Sparat till: ' + OUTPUT);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
