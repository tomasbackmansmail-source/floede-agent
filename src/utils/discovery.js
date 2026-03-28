// Discovery utility functions — pure motor, no vertical-specific logic.
// These are the "cheap steps" that run before any LLM calls.

const DEFAULT_TIMEOUT = 10000;
const USER_AGENT_FALLBACK = "FloedAgent/0.1 (floede.se; autonomous data discovery)";

// Detect CMS platform from HTML signatures
export function detectPlatform(html) {
  const lower = html.toLowerCase();
  const signatures = [
    { platform: "sitevision", patterns: ["sitevision", "sv-portlet", "sv-layout", "sv-template", "/sitevision/"] },
    { platform: "episerver", patterns: ["episerver", "epi-", "optimizely", "EPiServer"] },
    { platform: "wordpress", patterns: ["wp-content", "wp-includes", "wordpress"] },
    { platform: "municipio", patterns: ["municipio", "developer.flavor"] },
    { platform: "netpublicator", patterns: ["netpublicator", "digicomm"] },
    { platform: "meetingsplus", patterns: ["meetingsplus", "meetings plus"] },
  ];

  for (const sig of signatures) {
    if (sig.patterns.some(p => lower.includes(p.toLowerCase()))) {
      return sig.platform;
    }
  }
  return "unknown";
}

// Build candidate URLs from base domain + url_patterns + platform_templates
export function buildCandidateUrls(homepageUrl, urlPatterns, platformTemplates, detectedPlatform) {
  let baseUrl;
  try {
    const parsed = new URL(homepageUrl);
    baseUrl = `${parsed.protocol}//${parsed.host}`;
  } catch {
    return [];
  }

  const candidates = new Set();

  // Platform-specific templates first (higher confidence)
  if (detectedPlatform && detectedPlatform !== "unknown" && platformTemplates && platformTemplates[detectedPlatform]) {
    for (const pattern of platformTemplates[detectedPlatform]) {
      candidates.add(`${baseUrl}${pattern}`);
    }
  }

  // Then general url_patterns
  if (urlPatterns) {
    for (const pattern of urlPatterns) {
      candidates.add(`${baseUrl}${pattern}`);
    }
  }

  return [...candidates];
}

// Test a single URL — does it return 200 and contain relevant content?
export async function testUrl(url, searchTerms, userAgent, timeout) {
  const ua = userAgent || USER_AGENT_FALLBACK;
  const to = timeout || DEFAULT_TIMEOUT;

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": ua },
      signal: AbortSignal.timeout(to),
      redirect: "follow",
    });

    if (!response.ok) {
      return { url, status: response.status, found: false, reason: `HTTP ${response.status}` };
    }

    const html = await response.text();

    // Check if page contains any of the search terms
    const lower = html.toLowerCase();
    const matchedTerms = (searchTerms || []).filter(term => lower.includes(term.toLowerCase()));

    if (matchedTerms.length === 0) {
      return { url, status: 200, found: false, reason: "no matching content", html };
    }

    return {
      url,
      status: 200,
      found: true,
      matchedTerms,
      matchCount: matchedTerms.length,
      contentLength: html.length,
      html,
    };
  } catch (err) {
    return { url, status: 0, found: false, reason: err.message };
  }
}

// Try all candidate URLs, return the best match (most search term hits)
export async function tryUrlVariants(homepageUrl, verticalDiscoveryConfig, userAgent) {
  const config = verticalDiscoveryConfig;

  // Step 1: Fetch homepage to detect platform
  let detectedPlatform = "unknown";
  try {
    const homepageResp = await fetch(homepageUrl, {
      headers: { "User-Agent": userAgent || USER_AGENT_FALLBACK },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
      redirect: "follow",
    });
    if (homepageResp.ok) {
      const homepageHtml = await homepageResp.text();
      detectedPlatform = detectPlatform(homepageHtml);
    }
  } catch {
    // Homepage unreachable — continue with unknown platform
  }

  // Step 2: Build candidate URLs
  const candidates = buildCandidateUrls(
    homepageUrl,
    config.url_patterns,
    config.platform_templates,
    detectedPlatform
  );

  if (candidates.length === 0) {
    return { found: false, platform: detectedPlatform, candidates: [], reason: "no candidates generated" };
  }

  // Step 3: Test each candidate
  const results = [];
  for (const url of candidates) {
    const result = await testUrl(url, config.search_terms, userAgent);
    results.push(result);

    // Early exit: if we find a strong match (2+ search terms), use it
    if (result.found && result.matchCount >= 2) {
      return {
        found: true,
        url: result.url,
        platform: detectedPlatform,
        matchedTerms: result.matchedTerms,
        matchCount: result.matchCount,
        candidates: results,
      };
    }

    // Rate limit between requests
    await new Promise(r => setTimeout(r, 300));
  }

  // Return best partial match if any
  const matches = results.filter(r => r.found);
  if (matches.length > 0) {
    const best = matches.sort((a, b) => b.matchCount - a.matchCount)[0];
    return {
      found: true,
      url: best.url,
      platform: detectedPlatform,
      matchedTerms: best.matchedTerms,
      matchCount: best.matchCount,
      candidates: results,
    };
  }

  return {
    found: false,
    platform: detectedPlatform,
    candidates: results,
    reason: "no candidates matched search terms",
  };
}


// Extract links from HTML (simplified, no dependency on engine.js)
export function extractLinksSimple(html, baseUrl) {
  const links = [];
  const regex = /<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const href = match[1];
    const text = match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) continue;
    try {
      const absolute = new URL(href, baseUrl).href;
      links.push({ href: absolute, text });
    } catch { /* skip invalid URLs */ }
  }
  return links;
}

// Score links against search terms — pure function, no I/O
export function scoreLinks(links, searchTerms) {
  if (!links || !searchTerms || searchTerms.length === 0) return [];

  return links
    .map(link => {
      const textLower = link.text.toLowerCase();
      const hrefLower = link.href.toLowerCase();
      const matchedTerms = searchTerms.filter(term => {
        const t = term.toLowerCase();
        return textLower.includes(t) || hrefLower.includes(t);
      });
      return { ...link, matchedTerms, matchCount: matchedTerms.length };
    })
    .filter(l => l.matchCount > 0)
    .sort((a, b) => b.matchCount - a.matchCount);
}

// Step 3: Crawl homepage — fetch page, extract links, score against search terms
export async function crawlHomepage(homepageUrl, searchTerms, userAgent) {
  const ua = userAgent || USER_AGENT_FALLBACK;

  let html;
  try {
    const response = await fetch(homepageUrl, {
      headers: { 'User-Agent': ua },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
      redirect: 'follow',
    });
    if (!response.ok) return { found: false, reason: 'HTTP ' + response.status };
    html = await response.text();
  } catch (err) {
    return { found: false, reason: err.message };
  }

  const allLinks = extractLinksSimple(html, homepageUrl);
  if (allLinks.length === 0) return { found: false, reason: 'no links found on page' };

  const hits = scoreLinks(allLinks, searchTerms);
  if (hits.length === 0) return { found: false, reason: 'no links matched search terms', linksScanned: allLinks.length };

  return {
    found: true,
    url: hits[0].href,
    linkText: hits[0].text,
    matchedTerms: hits[0].matchedTerms,
    matchCount: hits[0].matchCount,
    alternativeUrls: hits.slice(1, 4).map(h => ({ url: h.href, text: h.text, matchCount: h.matchCount })),
    linksScanned: allLinks.length,
  };
}

// Parse sitemap XML — extract URLs (pure function, testable)
export function parseSitemapUrls(xml) {
  const urls = [];
  const regex = /<loc>\s*(https?:\/\/[^<]+?)\s*<\/loc>/gi;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    urls.push(match[1].trim());
  }
  return urls;
}

// Score sitemap URLs against search terms (pure function)
export function scoreSitemapUrls(urls, searchTerms) {
  if (!urls || !searchTerms || searchTerms.length === 0) return [];

  return urls
    .map(url => {
      const lower = url.toLowerCase();
      const matchedTerms = searchTerms.filter(t => lower.includes(t.toLowerCase()));
      return { url, matchedTerms, matchCount: matchedTerms.length };
    })
    .filter(u => u.matchCount > 0)
    .sort((a, b) => b.matchCount - a.matchCount);
}

// Step 4: Check sitemap.xml for relevant URLs
export async function checkSitemap(homepageUrl, searchTerms, userAgent) {
  const ua = userAgent || USER_AGENT_FALLBACK;
  let baseUrl;
  try {
    const parsed = new URL(homepageUrl);
    baseUrl = parsed.protocol + '//' + parsed.host;
  } catch {
    return { found: false, reason: 'invalid URL' };
  }

  const sitemapUrl = baseUrl + '/sitemap.xml';

  let xml;
  try {
    const response = await fetch(sitemapUrl, {
      headers: { 'User-Agent': ua },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
      redirect: 'follow',
    });
    if (!response.ok) return { found: false, reason: 'HTTP ' + response.status };
    xml = await response.text();
  } catch (err) {
    return { found: false, reason: err.message };
  }

  const urls = parseSitemapUrls(xml);
  if (urls.length === 0) return { found: false, reason: 'no URLs in sitemap', sitemapUrl };

  const hits = scoreSitemapUrls(urls, searchTerms);
  if (hits.length === 0) return { found: false, reason: 'no URLs matched search terms', sitemapUrl, urlsScanned: urls.length };

  return {
    found: true,
    url: hits[0].url,
    matchedTerms: hits[0].matchedTerms,
    matchCount: hits[0].matchCount,
    alternativeUrls: hits.slice(1, 4).map(h => ({ url: h.url, matchCount: h.matchCount })),
    sitemapUrl,
    urlsScanned: urls.length,
  };
}

// ═══════════════════════════════════════════════
// Orchestrator: try cheap steps in order, stop at first hit
// ═══════════════════════════════════════════════
// Contract: discoverSource(sourceName, sourceUrl, discoveryConfig)
//   → { found, url, method, confidence, details }
// No vertical-specific logic. Everything comes from config.

export async function discoverSource(sourceName, sourceUrl, discoveryConfig) {
  const config = discoveryConfig;
  const userAgent = config.user_agent || USER_AGENT_FALLBACK;
  const searchTerms = config.search_terms || [];

  // Step 1: URL variants (platform detection + known patterns)
  const urlResult = await tryUrlVariants(sourceUrl, config, userAgent);
  if (urlResult.found) {
    return {
      found: true,
      url: urlResult.url,
      method: 'url_variants',
      platform: urlResult.platform,
      confidence: urlResult.matchCount >= 2 ? 'high' : 'medium',
      cost_usd: 0,
      details: urlResult,
    };
  }

  // Step 2: Crawl homepage for relevant links
  const crawlResult = await crawlHomepage(sourceUrl, searchTerms, userAgent);
  if (crawlResult.found) {
    return {
      found: true,
      url: crawlResult.url,
      method: 'crawl_homepage',
      platform: urlResult.platform || 'unknown',
      confidence: crawlResult.matchCount >= 2 ? 'high' : 'medium',
      cost_usd: 0,
      details: crawlResult,
    };
  }

  // Step 3: Check sitemap.xml
  const sitemapResult = await checkSitemap(sourceUrl, searchTerms, userAgent);
  if (sitemapResult.found) {
    return {
      found: true,
      url: sitemapResult.url,
      method: 'sitemap',
      platform: urlResult.platform || 'unknown',
      confidence: sitemapResult.matchCount >= 2 ? 'high' : 'medium',
      cost_usd: 0,
      details: sitemapResult,
    };
  }

  // Step 4: All cheap steps failed — return null
  // Sonnet Discovery (step 5) is not called here.
  // It will be added later, either as a direct call or via Agent SDK.
  return {
    found: false,
    url: null,
    method: null,
    platform: urlResult.platform || 'unknown',
    confidence: null,
    cost_usd: 0,
    steps_tried: ['url_variants', 'crawl_homepage', 'sitemap'],
    details: {
      url_variants: urlResult,
      crawl: crawlResult,
      sitemap: sitemapResult,
    },
  };
}