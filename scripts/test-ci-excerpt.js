// Test: ci-pressroom extraction mot Vasakronan Cision utan DB-write.
// Testar exakt produktionsvagen: fetchPagePlaywright + extractPermits
// fran src/daily-run.js. Skriver resultatet till data/extracted/test-ci-excerpt.json.

process.env.VERTICAL = "ci-pressroom";

import { chromium } from "playwright";
import Anthropic from "@anthropic-ai/sdk";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

const { fetchPagePlaywright, extractPermits } = await import("../src/daily-run.js");

const USER_AGENT = "FloedAgent/0.1 (clientintelligence; datainsamling fran offentliga kallor)";

const testConfig = {
  municipality: "Vasakronan",
  listing_url: "https://news.cision.com/se/vasakronan",
  needs_browser: true,
  requires_subpages: {
    required: true,
    max_subpages: 10,
    link_selector_hint: "a[href*='cision.com/se/vasakronan/r/']",
  },
};

const OUTPUT_DIR = join(process.cwd(), "data", "extracted");
const OUTPUT_FILE = join(OUTPUT_DIR, "test-ci-excerpt.json");

let browser;
try {
  await mkdir(OUTPUT_DIR, { recursive: true });

  console.log("=== Test: ci-pressroom extraction mot Vasakronan Cision ===");
  console.log(`Listing URL: ${testConfig.listing_url}`);

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: USER_AGENT });
  const page = await context.newPage();

  const result = await fetchPagePlaywright(page, testConfig);
  const subpages = result.subpages;
  console.log(`Hamtat ${subpages.length} subpages`);

  const client = new Anthropic();
  let allPermits = [];
  let totalCostUsd = 0;

  for (const subpage of subpages) {
    console.log(`  Extraherar fran: ${subpage.url}`);
    const { permits, cost } = await extractPermits(
      client,
      subpage.content,
      testConfig.municipality,
      subpage.url,
      testConfig,
      { forceExtract: true, isPdf: subpage.isPdf }
    );

    // Tagg varje permit med subpage-URL for verifiering
    for (const p of permits) {
      p._from_subpage_url = subpage.url;
    }

    allPermits.push(...permits);
    totalCostUsd += cost.cost_usd;
  }

  await writeFile(OUTPUT_FILE, JSON.stringify(allPermits, null, 2), "utf-8");

  const excerptLengths = allPermits
    .map((p) => (p.source_excerpt ? p.source_excerpt.length : 0))
    .filter((n) => n > 0);
  const longest = excerptLengths.length ? Math.max(...excerptLengths) : 0;
  const shortest = excerptLengths.length ? Math.min(...excerptLengths) : 0;
  const withSummary = allPermits.filter(
    (p) => p.ai_summary != null && p.ai_summary !== ""
  ).length;
  const withoutSummary = allPermits.length - withSummary;

  // Ny: verifiera att source_url ar unikt per signal, inte bas-URL
  const uniqueSourceUrls = new Set(allPermits.map((p) => p.source_url));
  const sourceUrlDiversity = `${uniqueSourceUrls.size}/${allPermits.length} unika source_url`;
  const hasBaseUrlLeakage = allPermits.filter(
    (p) => p.source_url === testConfig.listing_url
  ).length;

  console.log("");
  console.log(`Signaler: ${allPermits.length}`);
  console.log(`Subpages processade: ${subpages.length}`);
  console.log(`Langsta source_excerpt: ${longest} tecken`);
  console.log(`Kortaste source_excerpt (bland satta): ${shortest} tecken`);
  console.log(`Med ai_summary: ${withSummary}`);
  console.log(`Utan ai_summary: ${withoutSummary}`);
  console.log(`Source_url diversity: ${sourceUrlDiversity}`);
  console.log(`Signaler med bas-URL som source_url: ${hasBaseUrlLeakage}`);
  console.log(`Total cost_usd: $${totalCostUsd.toFixed(6)}`);
  console.log(`Output: ${OUTPUT_FILE}`);

  await browser.close();
  process.exit(0);
} catch (err) {
  console.error(`ERROR: ${err.message}`);
  console.error(err.stack);
  try { if (browser) await browser.close(); } catch {}
  process.exit(1);
}
