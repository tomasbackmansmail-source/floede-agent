// Generate template configs for Sitevision municipalities.
// Tests anslagstavla URLs with Playwright, saves to discovery_configs as approved=false.
// No LLM calls — zero API cost.
// Run: node src/generate-sitevision-configs.js

import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const ANSLAGSTAVLA_PATHS = [
  "/kommun-och-politik/anslagstavla",
  "/kommun--politik/anslagstavla",
  "/kommunochpolitik/anslagstavla",
  "/kommun-och-politik/kommunens-anslagstavla",
  "/anslagstavla",
  "/kommunens-anslagstavla",
];

function capitalize(id) {
  // Convert municipality ID to display name
  return id
    .replace(/-/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace(/å/g, "å").replace(/ä/g, "ä").replace(/ö/g, "ö")
    .replace(/Å/g, "Å").replace(/Ä/g, "Ä").replace(/Ö/g, "Ö");
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.");
    process.exit(1);
  }

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // Get Sitevision municipalities
  const { data: platforms } = await sb.from("municipality_platforms")
    .select("municipality, domain")
    .eq("platform", "sitevision");

  // Get existing configs (match by lowercased municipality name or ID)
  const { data: existing } = await sb.from("discovery_configs").select("municipality");
  const existingSet = new Set(existing.map(c => c.municipality.toLowerCase()));

  // Also create a normalized set (strip diacritics for matching)
  const normalize = s => s.toLowerCase()
    .replace(/å/g, "a").replace(/ä/g, "a").replace(/ö/g, "o")
    .replace(/é/g, "e").replace(/ü/g, "u")
    .replace(/[^a-z0-9]/g, "");

  const existingNorm = new Set(existing.map(c => normalize(c.municipality)));

  const missing = platforms.filter(p =>
    !existingSet.has(p.municipality.toLowerCase()) &&
    !existingNorm.has(normalize(p.municipality))
  );

  console.log(`Sitevision municipalities without config: ${missing.length}`);
  if (missing.length === 0) {
    console.log("Nothing to do.");
    process.exit(0);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "FloedAgent/0.1 (byggsignal.se; URL-verifiering)"
  });

  let created = 0;
  let failed = 0;
  const results = [];

  for (const { municipality: id, domain } of missing) {
    const displayName = capitalize(id);
    let foundUrl = null;

    // Try each anslagstavla path
    for (const path of ANSLAGSTAVLA_PATHS) {
      const url = `https://www.${domain}${path}`;
      try {
        const page = await context.newPage();
        const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 10000 });
        const status = resp ? resp.status() : 0;
        const finalUrl = page.url();
        await page.close();

        // Accept 200 responses that didn't redirect to a 404/error page
        if (status === 200 && !finalUrl.includes("404") && !finalUrl.includes("/fel/") && !finalUrl.includes("/error")) {
          foundUrl = url;
          break;
        }
      } catch {
        // timeout or network error — try next path
        try { await context.pages().then(pages => pages.length > 1 && pages[pages.length - 1].close()); } catch {}
      }
    }

    const config = {
      municipality: displayName,
      platform_guess: "sitevision",
      listing_url: foundUrl || `https://www.${domain}/kommun-och-politik/anslagstavla`,
      listing_type: "inline_list",
      pagination: { has_pagination: false, type: "none", mechanism: null, estimated_total_pages: null },
      requires_subpages: { required: false, reason: "Sitevision anslagstavla typically lists permits inline" },
      selectors_hint: {
        container: "main, .sv-portlet-anslagstavla, [role=main]",
        item: ".sv-portlet-anslagstavla li, table tr, .anslagstavla-item",
      },
      text_only: true,
      notes: `Auto-generated Sitevision template. URL ${foundUrl ? "verified" : "NOT verified"}.`,
      confidence: foundUrl ? "medium" : "low",
      approved: false,
    };

    const { error } = await sb.from("discovery_configs").upsert({
      municipality: displayName,
      config,
      approved: false,
      confidence: config.confidence,
      updated_at: new Date().toISOString(),
    }, { onConflict: "municipality" });

    if (error) {
      console.log(`  ERROR ${displayName}: ${error.message}`);
      failed++;
    } else {
      const tag = foundUrl ? "OK" : "NO-URL";
      console.log(`  [${tag}] ${displayName} → ${foundUrl || "fallback URL"}`);
      created++;
    }

    results.push({ id, displayName, url: foundUrl, verified: !!foundUrl });

    // Rate limit
    await new Promise(r => setTimeout(r, 300));
  }

  await browser.close();

  const verified = results.filter(r => r.verified).length;
  console.log(`\n=== DONE ===`);
  console.log(`Created: ${created}, Failed: ${failed}`);
  console.log(`URL verified: ${verified}/${results.length}`);

  // Verify total
  const { data: all } = await sb.from("discovery_configs").select("municipality, approved");
  console.log(`Total configs in DB: ${all.length}, Approved: ${all.filter(r => r.approved).length}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
