import { chromium } from "playwright";
import { municipalities } from "./config/municipalities.js";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { createHash } from "crypto";

const HTML_DIR = join(process.cwd(), "data", "html");
const META_DIR = join(process.cwd(), "data", "meta");

// CLI: --only nacka,malmo to fetch specific municipalities
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const onlyIds = onlyArg ? onlyArg.split("=")[1].split(",") : null;

async function ensureDirs() {
  await mkdir(HTML_DIR, { recursive: true });
  await mkdir(META_DIR, { recursive: true });
}

function saveMeta(municipality, url, extra) {
  const meta = {
    municipality: municipality.name,
    municipality_id: municipality.id,
    platform: municipality.platform,
    url,
    fetched_at: new Date().toISOString(),
    ...extra
  };
  return meta;
}

// --- Malmö: click page-size selector to 100/sida before grabbing HTML ---
async function fetchMalmo(page, municipality) {
  const url = municipality.urls[0];
  console.log(`[${municipality.name}] Fetching with 100/sida: ${url}`);
  const startTime = Date.now();

  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(1000);

  // Open the page-size dropdown and select 100/sida
  const pageSizeBtn = page.locator('button:has-text("/ sida")');
  if (await pageSizeBtn.count() > 0) {
    await pageSizeBtn.click();
    await page.waitForTimeout(500);
    const opt100 = page.locator('a:has-text("100 / sida")');
    if (await opt100.count() > 0) {
      await opt100.click();
      console.log(`[${municipality.name}] Switched to 100/sida, waiting for reload...`);
      await page.waitForTimeout(3000);
      await page.waitForLoadState("networkidle");
    } else {
      console.log(`[${municipality.name}] 100/sida option not found, using default`);
    }
  }

  const html = await page.content();
  const elapsed = Date.now() - startTime;
  const hash = createHash("sha256").update(html).digest("hex").slice(0, 16);

  const filename = `${municipality.id}_${Date.now()}.html`;
  await writeFile(join(HTML_DIR, filename), html, "utf-8");

  const meta = saveMeta(municipality, url, {
    html_file: filename,
    html_bytes: Buffer.byteLength(html, "utf-8"),
    html_hash: hash,
    fetch_time_ms: elapsed,
    status: "ok",
    note: "page_size=100"
  });
  await writeFile(join(META_DIR, `${municipality.id}_${Date.now()}.json`), JSON.stringify(meta, null, 2), "utf-8");

  console.log(`[${municipality.name}] OK - ${html.length} chars, ${elapsed}ms, hash=${hash}`);
  return [meta];
}

// --- Nacka: list page is link index only, must follow detail links ---
async function fetchNacka(page, municipality) {
  const url = municipality.urls[0];
  console.log(`[${municipality.name}] Fetching listing + detail pages: ${url}`);
  const startTime = Date.now();

  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(1000);

  // Click "Fler Nyheter" to load all items if present
  for (let i = 0; i < 10; i++) {
    const moreBtn = page.locator('a.c-get-more__button, a:has-text("Fler Nyheter")');
    if (await moreBtn.count() > 0 && await moreBtn.first().isVisible()) {
      console.log(`[${municipality.name}] Clicking 'Fler Nyheter' (round ${i + 1})...`);
      await moreBtn.first().click();
      await page.waitForTimeout(2000);
    } else {
      break;
    }
  }

  // Collect all detail links that look like bygglov kungörelser
  const detailLinks = await page.locator('a[href*="kungorelse-bygglov"]').evaluateAll(
    (els) => els.map((el) => el.href)
  );
  const uniqueLinks = [...new Set(detailLinks)];
  console.log(`[${municipality.name}] Found ${uniqueLinks.length} bygglov detail links`);

  // Start with the listing page HTML
  let combinedHtml = `<!-- LISTING PAGE: ${url} -->\n` + await page.content();

  // Fetch each detail page
  for (let i = 0; i < uniqueLinks.length; i++) {
    const link = uniqueLinks[i];
    console.log(`[${municipality.name}]   Detail ${i + 1}/${uniqueLinks.length}: ${link}`);
    try {
      await page.goto(link, { waitUntil: "networkidle", timeout: 30000 });
      await page.waitForTimeout(500);
      const detailHtml = await page.content();
      combinedHtml += `\n\n<!-- DETAIL PAGE: ${link} -->\n` + detailHtml;
    } catch (err) {
      console.error(`[${municipality.name}]   FAILED: ${err.message}`);
      combinedHtml += `\n\n<!-- DETAIL PAGE FAILED: ${link} - ${err.message} -->`;
    }
    // Rate limiting
    await new Promise((r) => setTimeout(r, 1000));
  }

  const elapsed = Date.now() - startTime;
  const hash = createHash("sha256").update(combinedHtml).digest("hex").slice(0, 16);

  const filename = `${municipality.id}_${Date.now()}.html`;
  await writeFile(join(HTML_DIR, filename), combinedHtml, "utf-8");

  const meta = saveMeta(municipality, url, {
    html_file: filename,
    html_bytes: Buffer.byteLength(combinedHtml, "utf-8"),
    html_hash: hash,
    fetch_time_ms: elapsed,
    status: "ok",
    detail_pages_fetched: uniqueLinks.length,
    note: "listing + detail pages combined"
  });
  await writeFile(join(META_DIR, `${municipality.id}_${Date.now()}.json`), JSON.stringify(meta, null, 2), "utf-8");

  console.log(`[${municipality.name}] OK - ${combinedHtml.length} chars (${uniqueLinks.length} detail pages), ${elapsed}ms, hash=${hash}`);
  return [meta];
}

// --- Default fetcher for other municipalities ---
async function fetchDefault(page, municipality) {
  const results = [];

  for (const url of municipality.urls) {
    console.log(`[${municipality.name}] Fetching: ${url}`);
    const startTime = Date.now();

    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
      await page.waitForTimeout(1000);

      const html = await page.content();
      const elapsed = Date.now() - startTime;
      const hash = createHash("sha256").update(html).digest("hex").slice(0, 16);

      const filename = `${municipality.id}_${Date.now()}.html`;
      await writeFile(join(HTML_DIR, filename), html, "utf-8");

      const meta = saveMeta(municipality, url, {
        html_file: filename,
        html_bytes: Buffer.byteLength(html, "utf-8"),
        html_hash: hash,
        fetch_time_ms: elapsed,
        status: "ok"
      });
      await writeFile(join(META_DIR, `${municipality.id}_${Date.now()}.json`), JSON.stringify(meta, null, 2), "utf-8");

      console.log(`[${municipality.name}] OK - ${html.length} chars, ${elapsed}ms, hash=${hash}`);
      results.push(meta);
    } catch (err) {
      console.error(`[${municipality.name}] FAILED: ${err.message}`);

      const meta = saveMeta(municipality, url, {
        html_file: null,
        html_bytes: 0,
        html_hash: null,
        fetch_time_ms: Date.now() - startTime,
        status: "error",
        error: err.message
      });
      await writeFile(join(META_DIR, `${municipality.id}_error_${Date.now()}.json`), JSON.stringify(meta, null, 2), "utf-8");
      results.push(meta);
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  return results;
}

async function fetchMunicipality(page, municipality) {
  if (municipality.id === "malmo") return fetchMalmo(page, municipality);
  if (municipality.id === "nacka") return fetchNacka(page, municipality);
  return fetchDefault(page, municipality);
}

async function main() {
  await ensureDirs();

  let munis = municipalities;
  if (onlyIds) {
    munis = municipalities.filter((m) => onlyIds.includes(m.id));
    console.log(`=== Floede Agent - HTML Fetcher (only: ${onlyIds.join(", ")}) ===`);
  } else {
    console.log("=== Floede Agent - HTML Fetcher ===");
  }
  console.log(`Fetching ${munis.length} municipalities\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "FloedAgent/0.1 (byggsignal.se; datainsamling fran offentliga anslagstavlor)"
  });
  const page = await context.newPage();

  const allResults = [];

  for (const muni of munis) {
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
