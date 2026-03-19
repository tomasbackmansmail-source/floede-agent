// Diagnose municipalities with 0 permits in latest extraction run.
// Categorizes each as: url_broken, wrong_page, needs_browser, extraction_fail, genuinely_empty
// Auto-fixes categories A (url_broken) and B (wrong_page) by crawling homepages.
// Flags category C as needs_browser.
// Run: node src/diagnose-zero-permits.js

import { createClient } from "@supabase/supabase-js";

const USER_AGENT = "FloedAgent/0.1 (byggsignal.se; URL-verifiering)";

const BYGGLOV_KEYWORDS = [
  "bygglov", "rivningslov", "marklov", "förhandsbesked",
  "kungörelse", "plan- och bygglagen", "ansökan", "beviljat",
  "startbesked", "strandskyddsdispens",
];

const LINK_KEYWORDS = ["anslagstavla", "kungörelse", "kungorelse", "bulletin", "anslagstavlan", "bygglov", "anslag"];

const JS_SPA_INDICATORS = [
  "#!/billboard", "data-reactroot", "Lex2PinBoardWasm",
  "digital-bulletin-board", "/kungorelse", "ciceron",
  "netpublicator", "meetingsplus", "meetingspublic",
];

async function httpGet(url, timeout = 15000) {
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(timeout),
      redirect: "follow",
    });
    const text = resp.ok ? await resp.text() : null;
    return { status: resp.status, finalUrl: resp.url, text, ok: resp.ok };
  } catch (err) {
    return { status: 0, finalUrl: url, text: null, ok: false, error: err.message };
  }
}

function extractDomain(url) {
  try { return new URL(url).hostname; } catch { return null; }
}

function extractAnchors(html, baseUrl) {
  const anchors = [];
  const regex = /<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const href = m[1];
    const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) continue;
    try {
      const absolute = new URL(href, baseUrl).href;
      anchors.push({ href: absolute, text });
    } catch { /* skip */ }
  }
  return anchors;
}

function hasBygglovContent(html) {
  if (!html) return false;
  const lower = html.toLowerCase();
  let matchCount = 0;
  for (const kw of BYGGLOV_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) matchCount++;
  }
  return matchCount >= 2; // At least 2 different keywords
}

function isJsSpa(url, html) {
  const urlLower = (url || "").toLowerCase();
  const htmlLower = (html || "").toLowerCase();
  for (const indicator of JS_SPA_INDICATORS) {
    if (urlLower.includes(indicator.toLowerCase())) return true;
    if (htmlLower.includes(indicator.toLowerCase()) && htmlLower.length < 5000) return true;
  }
  // Check if page body is mostly empty (JS-rendered)
  if (html) {
    const textContent = html.replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (textContent.length < 200 && html.length > 1000) return true;
  }
  return false;
}

async function findAnslagstavlaUrl(domain) {
  const baseDomain = domain.replace(/^www\./, "");
  for (const prefix of [`https://www.${baseDomain}`, `https://${baseDomain}`]) {
    const home = await httpGet(prefix, 10000);
    if (!home.ok || !home.text) continue;

    const anchors = extractAnchors(home.text, prefix);
    for (const a of anchors) {
      const hrefLower = a.href.toLowerCase();
      const textLower = a.text.toLowerCase();
      if (LINK_KEYWORDS.some(kw => hrefLower.includes(kw) || textLower.includes(kw))) {
        const linkDomain = extractDomain(a.href);
        if (!linkDomain) continue;
        const linkBase = linkDomain.replace(/^www\./, "");
        if (linkBase === baseDomain || linkBase.endsWith(`.${baseDomain}`)) {
          // Verify it works
          const test = await httpGet(a.href, 10000);
          if (test.ok) return test.finalUrl;
        }
      }
    }
    await new Promise(r => setTimeout(r, 200));
  }
  return null;
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.");
    process.exit(1);
  }

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // Load approved configs
  const { data: configs } = await sb.from("discovery_configs").select("municipality, config").eq("approved", true);

  // Load municipalities that have permits (from latest runs)
  const { data: permitRows } = await sb.from("permits_v2").select("municipality");
  const withPermits = new Set();
  for (const p of permitRows) {
    withPermits.add(p.municipality.toLowerCase());
  }

  // Filter to zero-permit municipalities (excluding needs_browser already flagged)
  const zeroPermit = configs.filter(c => !withPermits.has(c.municipality.toLowerCase()));

  console.log(`Total approved configs: ${configs.length}`);
  console.log(`With permits: ${configs.length - zeroPermit.length}`);
  console.log(`Zero permits: ${zeroPermit.length}\n`);

  const categories = {
    A_url_broken: [],
    B_wrong_page: [],
    C_needs_browser: [],
    D_extraction_fail: [],
    E_genuinely_empty: [],
  };

  let tested = 0;
  const autoFixed = [];

  for (const row of zeroPermit) {
    const url = row.config.listing_url;
    const municipality = row.municipality;
    const alreadyBrowser = row.config.needs_browser || false;
    tested++;

    if (!url) {
      categories.A_url_broken.push({ municipality, reason: "no URL" });
      continue;
    }

    // Test URL
    const result = await httpGet(url);

    if (!result.ok) {
      // Category A: URL broken
      console.log(`  [A] ${municipality}: HTTP ${result.status} — ${url}`);

      // Try to find working URL
      const domain = extractDomain(url);
      if (domain) {
        const newUrl = await findAnslagstavlaUrl(domain);
        if (newUrl) {
          console.log(`      → FOUND: ${newUrl}`);
          autoFixed.push({ municipality, oldUrl: url, newUrl, category: "A" });
        }
      }
      categories.A_url_broken.push({ municipality, url, status: result.status });
      await new Promise(r => setTimeout(r, 200));
      continue;
    }

    // URL works — check if it's a JS SPA
    if (alreadyBrowser || isJsSpa(url, result.text)) {
      console.log(`  [C] ${municipality}: JS SPA — ${url}`);
      categories.C_needs_browser.push({ municipality, url });
      await new Promise(r => setTimeout(r, 150));
      continue;
    }

    // Check for bygglov content
    const hasContent = hasBygglovContent(result.text);

    if (!hasContent) {
      // Category B: Wrong page — no bygglov keywords
      console.log(`  [B] ${municipality}: no bygglov keywords — ${url}`);

      // Try to find better URL
      const domain = extractDomain(url);
      if (domain) {
        const newUrl = await findAnslagstavlaUrl(domain);
        if (newUrl && newUrl !== url) {
          // Verify the new URL has content
          const newResult = await httpGet(newUrl);
          if (newResult.ok && hasBygglovContent(newResult.text)) {
            console.log(`      → FOUND with content: ${newUrl}`);
            autoFixed.push({ municipality, oldUrl: url, newUrl, category: "B" });
          } else if (newResult.ok) {
            console.log(`      → Found ${newUrl} but no bygglov keywords either`);
          }
        }
      }
      categories.B_wrong_page.push({ municipality, url });
      await new Promise(r => setTimeout(r, 200));
      continue;
    }

    // Has bygglov content — check if page has enough substance for extraction
    const textContent = result.text
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // Count bygglov-specific matches
    let kwMatches = 0;
    for (const kw of BYGGLOV_KEYWORDS) {
      const regex = new RegExp(kw, "gi");
      const matches = textContent.match(regex);
      if (matches) kwMatches += matches.length;
    }

    if (kwMatches >= 5) {
      // Has plenty of content — extraction failure
      console.log(`  [D] ${municipality}: ${kwMatches} keyword matches but 0 permits — ${url}`);
      categories.D_extraction_fail.push({ municipality, url, kwMatches });
    } else {
      // Has some keywords but few — probably genuinely empty or sparse
      console.log(`  [E] ${municipality}: ${kwMatches} keyword matches (sparse) — ${url}`);
      categories.E_genuinely_empty.push({ municipality, url, kwMatches });
    }

    await new Promise(r => setTimeout(r, 150));

    if (tested % 50 === 0) {
      console.log(`\n--- Progress: ${tested}/${zeroPermit.length} ---\n`);
    }
  }

  // Apply auto-fixes
  console.log(`\n=== AUTO-FIXING ${autoFixed.length} municipalities ===\n`);
  for (const fix of autoFixed) {
    const { data } = await sb.from("discovery_configs").select("municipality, config").eq("municipality", fix.municipality);
    if (data.length === 0) continue;
    const cfg = { ...data[0].config, listing_url: fix.newUrl };
    const { error } = await sb.from("discovery_configs")
      .update({ config: cfg, updated_at: new Date().toISOString() })
      .eq("municipality", fix.municipality);
    if (error) console.log(`  ERROR ${fix.municipality}: ${error.message}`);
    else console.log(`  FIXED ${fix.municipality}: ${fix.oldUrl} → ${fix.newUrl}`);
  }

  // Flag needs_browser
  const toFlagBrowser = categories.C_needs_browser.filter(c => {
    const row = zeroPermit.find(r => r.municipality === c.municipality);
    return row && !row.config.needs_browser;
  });

  if (toFlagBrowser.length > 0) {
    console.log(`\n=== FLAGGING ${toFlagBrowser.length} as needs_browser ===\n`);
    for (const item of toFlagBrowser) {
      const { data } = await sb.from("discovery_configs").select("municipality, config").eq("municipality", item.municipality);
      if (data.length === 0) continue;
      const cfg = { ...data[0].config, needs_browser: true };
      const { error } = await sb.from("discovery_configs")
        .update({ config: cfg, updated_at: new Date().toISOString() })
        .eq("municipality", item.municipality);
      if (error) console.log(`  ERROR ${item.municipality}: ${error.message}`);
      else console.log(`  FLAGGED ${item.municipality}: needs_browser`);
    }
  }

  // Report
  console.log(`\n${"=".repeat(60)}`);
  console.log(`DIAGNOSIS REPORT`);
  console.log(`${"=".repeat(60)}`);
  console.log(`\nA) URL broken (${categories.A_url_broken.length}):`);
  categories.A_url_broken.forEach(c => console.log(`   ${c.municipality} — ${c.url || "NO URL"}`));
  console.log(`\nB) Wrong page (${categories.B_wrong_page.length}):`);
  categories.B_wrong_page.forEach(c => console.log(`   ${c.municipality} — ${c.url}`));
  console.log(`\nC) Needs browser (${categories.C_needs_browser.length}):`);
  categories.C_needs_browser.forEach(c => console.log(`   ${c.municipality} — ${c.url}`));
  console.log(`\nD) Extraction fail (${categories.D_extraction_fail.length}):`);
  categories.D_extraction_fail.forEach(c => console.log(`   ${c.municipality} — ${c.url} (${c.kwMatches} matches)`));
  console.log(`\nE) Genuinely empty (${categories.E_genuinely_empty.length}):`);
  categories.E_genuinely_empty.forEach(c => console.log(`   ${c.municipality} — ${c.url} (${c.kwMatches} matches)`));

  console.log(`\n=== SUMMARY ===`);
  console.log(`Total zero-permit: ${zeroPermit.length}`);
  console.log(`A) URL broken:      ${categories.A_url_broken.length}`);
  console.log(`B) Wrong page:      ${categories.B_wrong_page.length}`);
  console.log(`C) Needs browser:   ${categories.C_needs_browser.length}`);
  console.log(`D) Extraction fail: ${categories.D_extraction_fail.length}`);
  console.log(`E) Genuinely empty: ${categories.E_genuinely_empty.length}`);
  console.log(`\nAuto-fixed: ${autoFixed.length}`);
  console.log(`Newly flagged browser: ${toFlagBrowser.length}`);
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1); });
