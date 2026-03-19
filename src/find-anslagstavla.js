// Find anslagstavla URLs for municipalities with broken/404 configs.
// Crawls homepage and sitemap.xml to discover non-standard URL patterns.
// Zero API cost — only HTTP requests.
// Run: node src/find-anslagstavla.js

import { createClient } from "@supabase/supabase-js";

const USER_AGENT = "FloedAgent/0.1 (byggsignal.se; URL-verifiering)";

const LINK_KEYWORDS = ["anslagstavla", "kungörelse", "kungorelse", "bulletin", "anslagstavlan"];

const CONTENT_KEYWORDS = [
  "bygglov", "kungörelse", "plan- och bygglagen",
  "ansökan", "beviljat", "startbesked",
  "rivningslov", "marklov", "förhandsbesked",
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

function hasRelevantContent(html) {
  const lower = html.toLowerCase();
  return CONTENT_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()));
}

// Extract <a> tags with href and text from HTML
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

// Find anslagstavla links from a list of anchors
function findAnslagstavlaLinks(anchors, domain) {
  const matches = [];
  for (const a of anchors) {
    const hrefLower = a.href.toLowerCase();
    const textLower = a.text.toLowerCase();
    // Must be same domain
    const linkDomain = extractDomain(a.href);
    if (!linkDomain) continue;
    const baseDomain = domain.replace(/^www\./, "");
    const linkBase = linkDomain.replace(/^www\./, "");
    if (linkBase !== baseDomain && !linkBase.endsWith(`.${baseDomain}`)) continue;

    if (LINK_KEYWORDS.some(kw => hrefLower.includes(kw) || textLower.includes(kw))) {
      matches.push(a);
    }
  }
  // Deduplicate by href
  const seen = new Set();
  return matches.filter(a => {
    if (seen.has(a.href)) return false;
    seen.add(a.href);
    return true;
  });
}

// Extract URLs from sitemap XML matching keywords
function extractSitemapUrls(xml, domain) {
  const urls = [];
  const regex = /<loc>\s*(.*?)\s*<\/loc>/gi;
  let m;
  while ((m = regex.exec(xml)) !== null) {
    const url = m[1];
    if (LINK_KEYWORDS.some(kw => url.toLowerCase().includes(kw))) {
      // Same-domain check
      const d = extractDomain(url);
      if (d) {
        const baseDomain = domain.replace(/^www\./, "");
        const linkBase = d.replace(/^www\./, "");
        if (linkBase === baseDomain || linkBase.endsWith(`.${baseDomain}`)) {
          urls.push(url);
        }
      }
    }
  }
  return [...new Set(urls)];
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.");
    process.exit(1);
  }

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // Load all approved configs
  const { data: rows, error } = await sb
    .from("discovery_configs")
    .select("municipality, config")
    .eq("approved", true);

  if (error) { console.error(`Failed: ${error.message}`); process.exit(1); }

  // Step 1: find broken configs (HTTP test)
  console.log(`Testing ${rows.length} configs for broken URLs...\n`);
  const broken = [];

  for (const row of rows) {
    const url = row.config.listing_url;
    if (!url) { broken.push(row); continue; }
    const result = await httpGet(url);
    if (!result.ok) {
      broken.push(row);
    }
    await new Promise(r => setTimeout(r, 150));
  }

  console.log(`Found ${broken.length} broken configs.\n`);
  if (broken.length === 0) { console.log("Nothing to fix."); process.exit(0); }

  const fixedViaHomepage = [];
  const fixedViaSitemap = [];
  const needsDiscovery = [];

  for (const row of broken) {
    const domain = extractDomain(row.config.listing_url || "https://example.com");
    if (!domain || domain === "example.com") {
      console.log(`  SKIP ${row.municipality}: no valid domain`);
      needsDiscovery.push(row);
      continue;
    }

    const baseDomain = domain.replace(/^www\./, "");
    console.log(`\n--- ${row.municipality} (${baseDomain}) ---`);

    let found = null;

    // Strategy 1: Crawl homepage
    for (const prefix of [`https://www.${baseDomain}`, `https://${baseDomain}`]) {
      const home = await httpGet(prefix, 10000);
      if (!home.ok || !home.text) continue;

      const anchors = extractAnchors(home.text, prefix);
      const candidates = findAnslagstavlaLinks(anchors, baseDomain);

      if (candidates.length > 0) {
        console.log(`  Homepage: found ${candidates.length} candidate(s): ${candidates.map(c => c.href).join(", ")}`);
      }

      for (const c of candidates) {
        const test = await httpGet(c.href);
        if (test.ok && test.text && hasRelevantContent(test.text)) {
          found = test.finalUrl;
          console.log(`  FOUND (homepage): ${found}`);
          break;
        }
        // Even without bygglov keywords, accept if it's clearly an anslagstavla page
        if (test.ok && test.text && test.text.toLowerCase().includes("anslagstavla")) {
          found = test.finalUrl;
          console.log(`  FOUND (homepage, anslagstavla match): ${found}`);
          break;
        }
        await new Promise(r => setTimeout(r, 200));
      }

      if (found) break;
      await new Promise(r => setTimeout(r, 200));
    }

    if (found) {
      fixedViaHomepage.push({ ...row, newUrl: found });
      await updateConfig(sb, row, found);
      continue;
    }

    // Strategy 2: Sitemap
    for (const prefix of [`https://www.${baseDomain}`, `https://${baseDomain}`]) {
      const sitemapUrl = `${prefix}/sitemap.xml`;
      const sm = await httpGet(sitemapUrl, 10000);
      if (!sm.ok || !sm.text) continue;

      // Also check for sitemap index (nested sitemaps)
      let allUrls = extractSitemapUrls(sm.text, baseDomain);

      // If sitemap index, try to fetch child sitemaps
      if (allUrls.length === 0) {
        const childSitemaps = [];
        const sitemapRegex = /<loc>\s*(.*?sitemap.*?\.xml.*?)\s*<\/loc>/gi;
        let cm;
        while ((cm = sitemapRegex.exec(sm.text)) !== null) {
          childSitemaps.push(cm[1]);
        }
        for (const childUrl of childSitemaps.slice(0, 5)) {
          const child = await httpGet(childUrl, 10000);
          if (child.ok && child.text) {
            allUrls.push(...extractSitemapUrls(child.text, baseDomain));
          }
          await new Promise(r => setTimeout(r, 200));
        }
      }

      if (allUrls.length > 0) {
        console.log(`  Sitemap: found ${allUrls.length} candidate(s): ${allUrls.join(", ")}`);
      }

      for (const candidateUrl of allUrls) {
        const test = await httpGet(candidateUrl);
        if (test.ok && test.text && (hasRelevantContent(test.text) || test.text.toLowerCase().includes("anslagstavla"))) {
          found = test.finalUrl;
          console.log(`  FOUND (sitemap): ${found}`);
          break;
        }
        await new Promise(r => setTimeout(r, 200));
      }

      if (found) break;
      await new Promise(r => setTimeout(r, 200));
    }

    if (found) {
      fixedViaSitemap.push({ ...row, newUrl: found });
      await updateConfig(sb, row, found);
    } else {
      console.log(`  NEEDS DISCOVERY: ${row.municipality}`);
      needsDiscovery.push(row);
    }
  }

  // Report
  console.log(`\n=== REPORT ===`);
  console.log(`Total broken: ${broken.length}`);
  console.log(`Fixed via homepage: ${fixedViaHomepage.length}`);
  console.log(`Fixed via sitemap: ${fixedViaSitemap.length}`);
  console.log(`Needs Discovery (Sonnet): ${needsDiscovery.length}`);

  if (fixedViaHomepage.length > 0) {
    console.log(`\nFixed via homepage:`);
    fixedViaHomepage.forEach(r => console.log(`  ${r.municipality}: ${r.newUrl}`));
  }
  if (fixedViaSitemap.length > 0) {
    console.log(`\nFixed via sitemap:`);
    fixedViaSitemap.forEach(r => console.log(`  ${r.municipality}: ${r.newUrl}`));
  }
  if (needsDiscovery.length > 0) {
    console.log(`\nNeeds Discovery:`);
    needsDiscovery.forEach(r => console.log(`  ${r.municipality} (${r.config.listing_url})`));
  }
}

async function updateConfig(sb, row, newUrl) {
  const updatedConfig = { ...row.config, listing_url: newUrl };
  const { error } = await sb
    .from("discovery_configs")
    .update({ config: updatedConfig, updated_at: new Date().toISOString() })
    .eq("municipality", row.municipality);
  if (error) {
    console.log(`    DB UPDATE ERROR: ${error.message}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1); });
