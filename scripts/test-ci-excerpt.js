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

  const html = await fetchPagePlaywright(page, testConfig);
  console.log(`Hamtat innehall: ${html.length} tecken`);

  const client = new Anthropic();
  const { permits, cost } = await extractPermits(
    client,
    html,
    testConfig.municipality,
    testConfig.listing_url,
    testConfig,
    { forceExtract: true }
  );

  await writeFile(OUTPUT_FILE, JSON.stringify(permits, null, 2), "utf-8");

  const excerptLengths = permits
    .map((p) => (p.source_excerpt ? p.source_excerpt.length : 0))
    .filter((n) => n > 0);
  const longest = excerptLengths.length ? Math.max(...excerptLengths) : 0;
  const shortest = excerptLengths.length ? Math.min(...excerptLengths) : 0;
  const withSummary = permits.filter(
    (p) => p.ai_summary != null && p.ai_summary !== ""
  ).length;
  const withoutSummary = permits.length - withSummary;

  console.log("");
  console.log(`Signaler: ${permits.length}`);
  console.log(`Langsta source_excerpt: ${longest} tecken`);
  console.log(`Kortaste source_excerpt (bland satta): ${shortest} tecken`);
  console.log(`Med ai_summary: ${withSummary}`);
  console.log(`Utan ai_summary: ${withoutSummary}`);
  console.log(`Total cost_usd: $${cost.cost_usd.toFixed(6)}`);
  console.log(`Output: ${OUTPUT_FILE}`);

  await browser.close();
  process.exit(0);
} catch (err) {
  console.error(`ERROR: ${err.message}`);
  console.error(err.stack);
  try { if (browser) await browser.close(); } catch {}
  process.exit(1);
}
