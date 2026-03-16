import { chromium } from "playwright";
import { municipalities } from "./config/municipalities.js";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { createHash } from "crypto";

const HTML_DIR = join(process.cwd(), "data", "html");
const META_DIR = join(process.cwd(), "data", "meta");

async function ensureDirs() {
  await mkdir(HTML_DIR, { recursive: true });
  await mkdir(META_DIR, { recursive: true });
}

async function fetchMunicipality(page, municipality) {
  const results = [];

  for (const url of municipality.urls) {
    console.log(`[${municipality.name}] Fetching: ${url}`);
    const startTime = Date.now();

    try {
      // Navigate with generous timeout - some municipality sites are slow
      await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });

      // Wait an extra second for any late JS rendering
      await page.waitForTimeout(1000);

      const html = await page.content();
      const elapsed = Date.now() - startTime;
      const hash = createHash("sha256").update(html).digest("hex").slice(0, 16);

      // Save HTML
      const filename = `${municipality.id}_${Date.now()}.html`;
      await writeFile(join(HTML_DIR, filename), html, "utf-8");

      // Save metadata
      const meta = {
        municipality: municipality.name,
        municipality_id: municipality.id,
        platform: municipality.platform,
        url,
        fetched_at: new Date().toISOString(),
        html_file: filename,
        html_bytes: Buffer.byteLength(html, "utf-8"),
        html_hash: hash,
        fetch_time_ms: elapsed,
        status: "ok"
      };

      await writeFile(
        join(META_DIR, `${municipality.id}_${Date.now()}.json`),
        JSON.stringify(meta, null, 2),
        "utf-8"
      );

      console.log(`[${municipality.name}] OK - ${html.length} chars, ${elapsed}ms, hash=${hash}`);
      results.push(meta);
    } catch (err) {
      console.error(`[${municipality.name}] FAILED: ${err.message}`);

      const meta = {
        municipality: municipality.name,
        municipality_id: municipality.id,
        platform: municipality.platform,
        url,
        fetched_at: new Date().toISOString(),
        html_file: null,
        html_bytes: 0,
        html_hash: null,
        fetch_time_ms: Date.now() - startTime,
        status: "error",
        error: err.message
      };

      await writeFile(
        join(META_DIR, `${municipality.id}_error_${Date.now()}.json`),
        JSON.stringify(meta, null, 2),
        "utf-8"
      );

      results.push(meta);
    }

    // Rate limiting: 1 request/second per domain
    await new Promise((r) => setTimeout(r, 1000));
  }

  return results;
}

async function main() {
  await ensureDirs();

  console.log("=== Floede Agent - HTML Fetcher ===");
  console.log(`Fetching ${municipalities.length} municipalities\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "FloedAgent/0.1 (byggsignal.se; datainsamling fran offentliga anslagstavlor)"
  });
  const page = await context.newPage();

  const allResults = [];

  for (const muni of municipalities) {
    const results = await fetchMunicipality(page, muni);
    allResults.push(...results);
  }

  await browser.close();

  // Summary
  console.log("\n=== SUMMARY ===");
  const ok = allResults.filter((r) => r.status === "ok");
  const failed = allResults.filter((r) => r.status === "error");
  console.log(`OK: ${ok.length}/${allResults.length}`);
  console.log(`Failed: ${failed.length}/${allResults.length}`);
  if (failed.length > 0) {
    console.log("Failed municipalities:");
    failed.forEach((f) => console.log(`  - ${f.municipality}: ${f.error}`));
  }

  // Save summary
  await writeFile(
    join(META_DIR, `fetch_summary_${Date.now()}.json`),
    JSON.stringify({
      run_at: new Date().toISOString(),
      total: allResults.length,
      ok: ok.length,
      failed: failed.length,
      results: allResults
    }, null, 2),
    "utf-8"
  );
}

main().catch(console.error);
