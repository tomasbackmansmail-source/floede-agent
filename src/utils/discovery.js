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
