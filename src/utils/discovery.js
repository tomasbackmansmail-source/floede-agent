// Discovery utility functions — pure motor, no vertical-specific logic.
// These are the "cheap steps" that run before any LLM calls.

import { kommunToDomain, normalizeToAscii } from './normalize.js';

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
    { platform: "meetingsplus", patterns: ["meetingsplus", "meetings plus", "digital-bulletin-board", "/api/dbb/"] },
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

// Re-export from normalize.js for backwards compatibility
export { normalizeToAscii as normalizeToHostname } from './normalize.js';

// Resolve homepage URL from municipality name.
// IMPORTANT: This function normalizes the name for DNS lookup only.
// The caller must always use the ORIGINAL sourceName for DB writes —
// never the normalized hostname. See CLAUDE.md "KÄNDA PROBLEM" for context.
export async function resolveHomepage(sourceName, userAgent) {
  const ua = userAgent || USER_AGENT_FALLBACK;

  // Use kommunToDomain for the primary guess (handles exceptions)
  const domain = kommunToDomain(sourceName);
  const normalized = normalizeToAscii(sourceName);

  // Build candidate hostnames — domain-based first, then ASCII fallbacks
  const candidates = [
    `https://www.${domain.replace(/\.se$/, '')}.se`,
    `https://${domain}`,
    `https://www.${normalized}.se`,
    `https://${normalized}.se`,
    `https://www.${normalized}.kommun.se`,
  ];

  // If name contains hyphen, also try without it
  if (sourceName.includes('-')) {
    const withoutHyphen = normalizeToAscii(sourceName.replace(/-/g, ''));
    candidates.push(`https://www.${withoutHyphen}.se`);
    candidates.push(`https://${withoutHyphen}.se`);
  }
  // If normalized has no hyphen but original had space+word, also try with hyphen
  if (sourceName.includes(' ')) {
    const hyphenated = sourceName.normalize('NFC').toLowerCase().replace(/\s+/g, '-')
      .replace(/[åä]/g, 'a').replace(/ö/g, 'o').replace(/é/g, 'e').replace(/ü/g, 'u');
    candidates.push(`https://www.${hyphenated}.se`);
    candidates.push(`https://${hyphenated}.se`);
  }

  // Deduplicate
  const uniqueCandidates = [...new Set(candidates)];

  for (const url of uniqueCandidates) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': ua },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
        redirect: 'follow',
      });
      if (!response.ok) continue;

      const html = await response.text();
      // Verify page mentions the municipality name (avoid parked domains)
      const nameParts = sourceName.toLowerCase().split(/[\s-]+/);
      const lower = html.toLowerCase();
      const nameFound = nameParts.some(part => part.length >= 3 && lower.includes(part));

      if (nameFound) {
        return { found: true, url: response.url, method: 'resolve_homepage' };
      }
    } catch {
      // Timeout or network error — try next candidate
    }
  }

  return { found: false, url: null, method: 'resolve_homepage' };
}

// Step 4: Haiku LLM — read homepage links, ask Haiku to pick the best one
export async function haikuDiscovery(homepageUrl, discoveryConfig) {
  const config = discoveryConfig;
  const userAgent = config.user_agent || USER_AGENT_FALLBACK;
  const searchTerms = config.search_terms || [];
  const model = config.haiku_model;
  const prompt = config.haiku_prompt;

  if (!model || !prompt) {
    return { found: false, reason: "haiku_model or haiku_prompt not configured" };
  }

  // Fetch homepage and extract links
  let html;
  try {
    const response = await fetch(homepageUrl, {
      headers: { "User-Agent": userAgent },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
      redirect: "follow",
    });
    if (!response.ok) return { found: false, reason: `HTTP ${response.status}` };
    html = await response.text();
  } catch (err) {
    return { found: false, reason: err.message };
  }

  const allLinks = extractLinksSimple(html, homepageUrl);
  if (allLinks.length === 0) return { found: false, reason: "no links found on page" };

  // Format links for Haiku
  const linkList = allLinks
    .map((l, i) => `${i + 1}. ${l.text} → ${l.href}`)
    .join("\n");

  const HAIKU_INPUT_COST = 0.0000008;
  const HAIKU_OUTPUT_COST = 0.000004;

  let candidates = [];
  let costUsd = 0;

  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic();

    const response = await client.messages.create({
      model,
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: `${prompt}\n\nLänkar:\n${linkList}`,
        },
      ],
    });

    costUsd =
      (response.usage.input_tokens * HAIKU_INPUT_COST) +
      (response.usage.output_tokens * HAIKU_OUTPUT_COST);

    const reply = response.content[0].text.trim()
      .replace(/```json\s*/g, "").replace(/```\s*/g, "");

    const parsed = JSON.parse(reply);
    candidates = Array.isArray(parsed.candidates) ? parsed.candidates.slice(0, 3) : [];
  } catch (err) {
    return { found: false, reason: `Haiku API/parse error: ${err.message}`, cost_usd: costUsd };
  }

  if (candidates.length === 0) {
    return { found: false, reason: "Haiku returned no candidates", cost_usd: costUsd };
  }

  // Test each candidate, pick the first with search term matches
  const testResults = [];
  let bestCandidate = null;

  for (const candidate of candidates) {
    const testResult = await testUrl(candidate.url, searchTerms, userAgent);
    testResults.push({ ...candidate, testResult });

    if (testResult.found && !bestCandidate) {
      bestCandidate = {
        url: testResult.url,
        matchedTerms: testResult.matchedTerms,
        matchCount: testResult.matchCount,
        confidence: candidate.confidence,
        reason: candidate.reason,
        verified_by_test: true,
      };
      break;
    }
  }

  // Fallback: use first candidate that returned 200, with low confidence
  if (!bestCandidate) {
    const firstOk = testResults.find(t => t.testResult.status === 200);
    if (firstOk) {
      bestCandidate = {
        url: firstOk.url,
        matchedTerms: [],
        matchCount: 0,
        confidence: "low",
        reason: firstOk.reason,
        verified_by_test: false,
      };
    }
  }

  if (!bestCandidate) {
    return { found: false, reason: "All Haiku candidates failed HTTP check", cost_usd: costUsd, details: { candidates, testResults } };
  }

  return {
    found: true,
    url: bestCandidate.url,
    matchedTerms: bestCandidate.matchedTerms,
    matchCount: bestCandidate.matchCount,
    cost_usd: costUsd,
    verified_by_test: bestCandidate.verified_by_test,
    details: { candidates, best_candidate: bestCandidate, test_results: testResults },
  };
}

// ═══════════════════════════════════════════════
// Step 5: Interactive page exploration (Playwright + Haiku)
// ═══════════════════════════════════════════════

// Extract interactive elements from a Playwright page (pure browser JS).
export async function extractInteractiveElements(page) {
  return await page.evaluate(() => {
    const elements = { selects: [], inputs: [], buttons: [], forms: [] };

    // Native <select> elements
    document.querySelectorAll('select').forEach(sel => {
      const options = [...sel.options].map(o => ({
        value: o.value,
        text: o.textContent.trim(),
        selected: o.selected,
      }));
      if (options.length > 0) {
        const labelEl = sel.id ? document.querySelector(`label[for="${sel.id}"]`) : null;
        elements.selects.push({
          id: sel.id || null, name: sel.name || null,
          label: labelEl?.textContent?.trim() || sel.getAttribute('aria-label') || null,
          selector: sel.id ? `#${sel.id}` : sel.name ? `select[name="${sel.name}"]` : null,
          options,
        });
      }
    });

    // React Select / custom dropdown patterns
    document.querySelectorAll('[class*="react-select"], [class*="rs-picker"], [role="listbox"], [role="combobox"]').forEach(el => {
      const text = el.textContent.trim().slice(0, 200);
      const label = el.getAttribute('aria-label') || el.closest('[class*="form-group"]')?.querySelector('label')?.textContent?.trim() || null;
      elements.selects.push({
        id: el.id || null, name: null,
        label,
        selector: el.id ? `#${el.id}` : null,
        options: [{ value: '__react_select__', text, selected: false }],
        isCustom: true,
      });
    });

    // Search/text inputs
    document.querySelectorAll('input[type="text"], input[type="search"], input[name*="search"], input[name*="sok"], input[name*="sök"], input[placeholder]').forEach(inp => {
      if (inp.type === 'hidden') return;
      const labelEl = inp.id ? document.querySelector(`label[for="${inp.id}"]`) : null;
      elements.inputs.push({
        id: inp.id || null, name: inp.name || null, type: inp.type,
        placeholder: inp.placeholder || null,
        label: labelEl?.textContent?.trim() || inp.getAttribute('aria-label') || null,
        selector: inp.id ? `#${inp.id}` : inp.name ? `input[name="${inp.name}"]` : null,
      });
    });

    // Buttons and filter tabs
    document.querySelectorAll('button, [role="tab"], a[class*="filter"], [class*="tab-item"]').forEach(btn => {
      const text = btn.textContent.trim().slice(0, 100);
      if (!text || text.length < 2) return;
      elements.buttons.push({
        tag: btn.tagName.toLowerCase(),
        text,
        id: btn.id || null,
        selector: btn.id ? `#${btn.id}` : null,
      });
    });

    // Forms
    document.querySelectorAll('form').forEach(form => {
      elements.forms.push({
        action: form.action, method: form.method,
        id: form.id || null,
      });
    });

    return elements;
  });
}

// Ask Haiku which interactive element to use.
export async function askHaikuForInteraction(elements, searchTerms, config) {
  const model = config.haiku_model || config.interact_page?.haiku_model || "claude-haiku-4-5-20251001";
  const HAIKU_INPUT_COST = 0.0000008;
  const HAIKU_OUTPUT_COST = 0.000004;

  // Skip if no interactive elements found
  const totalElements = elements.selects.length + elements.inputs.length + elements.buttons.length;
  if (totalElements === 0) {
    return { action: "NONE", reason: "no interactive elements found", cost_usd: 0 };
  }

  const prompt = `Du får en lista över interaktiva element (dropdowns, sökfält, knappar) från en svensk kommuns webbsida. Vi söker efter bygglovsdata.

Söktermer: ${searchTerms.join(", ")}

Interaktiva element:
${JSON.stringify(elements, null, 2)}

Finns det någon dropdown, sökfält eller filter som kan visa bygglovsärenden när man väljer rätt alternativ?

Om en dropdown har alternativ som matchar söktermer (t.ex. "bygglov", "kungörelse", "plan- och bygglagen"), välj det alternativet.
Om ett sökfält finns, skriv den mest relevanta söktermen.
Om en knapp/tab matchar, klicka på den.

Svara ENBART med JSON (ingen markdown, inga backticks):
{"action": "SELECT", "selector": "CSS-selektor", "value": "option value att välja", "reason": "kort motivering"}
eller
{"action": "SEARCH", "selector": "CSS-selektor", "value": "sökterm att skriva", "reason": "kort motivering"}
eller
{"action": "CLICK", "selector": "CSS-selektor", "value": null, "reason": "kort motivering"}
eller
{"action": "NONE", "selector": null, "value": null, "reason": "varför inget element matchar"}`;

  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic();

    const response = await client.messages.create({
      model,
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    });

    const costUsd = (response.usage.input_tokens * HAIKU_INPUT_COST) + (response.usage.output_tokens * HAIKU_OUTPUT_COST);
    const reply = response.content[0].text.trim().replace(/```json\s*/g, "").replace(/```\s*/g, "");

    try {
      const parsed = JSON.parse(reply);
      return { ...parsed, cost_usd: costUsd };
    } catch {
      return { action: "NONE", reason: `Haiku parse error: ${reply.slice(0, 100)}`, cost_usd: costUsd };
    }
  } catch (err) {
    return { action: "NONE", reason: `Haiku API error: ${err.message}`, cost_usd: 0 };
  }
}

// Orchestrate: load page in Playwright, extract elements, ask Haiku, interact, check result.
export async function interactWithPage(pageUrl, searchTerms, discoveryConfig, browser) {
  const config = discoveryConfig.interact_page || {};
  const maxInteractions = config.max_interactions || 3;
  const waitMs = config.wait_after_interaction_ms || 3000;
  let totalCost = 0;

  if (!browser) {
    return { found: false, url: null, interaction_recipe: null, method: "interact_page", cost_usd: 0, reason: "no browser provided" };
  }

  const context = await browser.newContext({
    userAgent: discoveryConfig.user_agent || USER_AGENT_FALLBACK,
  });
  const page = await context.newPage();

  try {
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);

    const urlBefore = page.url();
    const steps = [];

    for (let i = 0; i < maxInteractions; i++) {
      // Extract interactive elements
      const elements = await extractInteractiveElements(page);
      console.log(`  [interact] Found ${elements.selects.length} selects, ${elements.inputs.length} inputs, ${elements.buttons.length} buttons`);

      // Ask Haiku what to do
      const decision = await askHaikuForInteraction(elements, searchTerms, discoveryConfig);
      totalCost += decision.cost_usd || 0;
      console.log(`  [interact] Haiku: ${decision.action} — ${decision.reason || ""}`);

      if (decision.action === "NONE") break;

      // Validate selector exists
      const selector = decision.selector;
      if (!selector) {
        console.log(`  [interact] No selector provided, skipping`);
        break;
      }

      const el = await page.$(selector);
      if (!el) {
        console.log(`  [interact] Selector "${selector}" not found on page`);
        break;
      }

      // Perform the interaction
      try {
        if (decision.action === "SELECT") {
          await page.selectOption(selector, decision.value);
          steps.push({ action: "select", selector, value: decision.value });
        } else if (decision.action === "SEARCH") {
          await page.fill(selector, decision.value);
          await page.press(selector, "Enter");
          steps.push({ action: "type", selector, value: decision.value });
        } else if (decision.action === "CLICK") {
          await el.click();
          steps.push({ action: "click", selector, value: null });
        }
      } catch (err) {
        console.log(`  [interact] Action failed: ${err.message}`);
        break;
      }

      await page.waitForTimeout(waitMs);

      // Check if URL changed (query parameters added)
      const urlAfter = page.url();
      if (urlAfter !== urlBefore && urlAfter !== pageUrl) {
        console.log(`  [interact] URL changed: ${urlAfter}`);
        await context.close();
        return {
          found: true,
          url: urlAfter,
          interaction_recipe: null, // URL is enough
          method: "interact_page",
          cost_usd: totalCost,
          details: { steps, url_before: urlBefore, url_after: urlAfter },
        };
      }
    }

    // URL didn't change — check if DOM changed and we have steps
    if (steps.length > 0) {
      // Verify the page now has relevant content
      const pageText = await page.evaluate(() => document.body.innerText.slice(0, 5000));
      const hasContent = searchTerms.some(t => pageText.toLowerCase().includes(t.toLowerCase()));

      if (hasContent) {
        console.log(`  [interact] DOM changed with relevant content — saving recipe`);
        await context.close();
        return {
          found: true,
          url: pageUrl,
          interaction_recipe: { steps, wait_ms: waitMs },
          method: "interact_page",
          cost_usd: totalCost,
          details: { steps, url_unchanged: true },
        };
      }
    }

    await context.close();
    return {
      found: false,
      url: null,
      interaction_recipe: null,
      method: "interact_page",
      cost_usd: totalCost,
      reason: "no relevant interaction found",
    };
  } catch (err) {
    try { await context.close(); } catch {}
    return {
      found: false,
      url: null,
      interaction_recipe: null,
      method: "interact_page",
      cost_usd: totalCost,
      reason: `Page load error: ${err.message}`,
    };
  }
}

// ═══════════════════════════════════════════════
// Orchestrator: try cheap steps in order, stop at first hit
// ═══════════════════════════════════════════════
// Contract: discoverSource(sourceName, sourceUrl, discoveryConfig, browser?)
//   → { found, url, method, confidence, details }
// No vertical-specific logic. Everything comes from config.
// browser is optional — only needed for step 5 (interactWithPage).

export async function discoverSource(sourceName, sourceUrl, discoveryConfig, browser) {
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

  // Step 4: Haiku LLM — ask Haiku to pick the best link from homepage
  const haikuResult = await haikuDiscovery(sourceUrl, discoveryConfig);
  if (haikuResult.found) {
    return {
      found: true,
      url: haikuResult.url,
      method: 'haiku',
      platform: urlResult.platform || 'unknown',
      confidence: haikuResult.matchCount >= 2 ? 'high' : haikuResult.matchCount >= 1 ? 'medium' : 'low',
      cost_usd: haikuResult.cost_usd || 0,
      details: haikuResult,
    };
  }

  // Step 5: Interactive page exploration (Playwright + Haiku)
  // Requires a browser instance — skipped if not provided.
  let interactResult = { found: false, cost_usd: 0 };
  if (browser && discoveryConfig.interact_page?.enabled !== false) {
    // Try the homepage and any candidate URLs found in earlier steps
    const pagesToTry = [sourceUrl];
    // Add best candidates from crawl/haiku if they returned a URL but it didn't match search terms
    if (crawlResult.url) pagesToTry.push(crawlResult.url);
    if (haikuResult.url) pagesToTry.push(haikuResult.url);

    for (const pageUrl of [...new Set(pagesToTry)]) {
      console.log(`  [interact] Trying ${pageUrl}...`);
      interactResult = await interactWithPage(pageUrl, searchTerms, discoveryConfig, browser);
      if (interactResult.found) {
        return {
          found: true,
          url: interactResult.url,
          method: 'interact_page',
          platform: urlResult.platform || 'unknown',
          confidence: 'medium',
          cost_usd: (haikuResult.cost_usd || 0) + interactResult.cost_usd,
          interaction_recipe: interactResult.interaction_recipe,
          details: interactResult,
        };
      }
    }
  }

  // Step 6: All steps failed — return null
  // Sonnet Discovery is not called here — it runs from discover.js main().
  return {
    found: false,
    url: null,
    method: null,
    platform: urlResult.platform || 'unknown',
    confidence: null,
    cost_usd: (haikuResult.cost_usd || 0) + (interactResult.cost_usd || 0),
    steps_tried: ['url_variants', 'crawl_homepage', 'sitemap', 'haiku', 'interact_page'],
    details: {
      url_variants: urlResult,
      crawl: crawlResult,
      sitemap: sitemapResult,
      haiku: haikuResult,
      interact: interactResult,
    },
  };
}

// Verify that a discovered config actually produces extraction results.
// Fetches the listing_url, runs the extraction prompt with the configured model, counts results.
export async function verifyExtraction(listingUrl, verticalConfig, keywords) {
  const userAgent = verticalConfig.user_agent || "FloedAgent/0.1";
  const model = verticalConfig.model;
  const extractionPrompt = verticalConfig.extraction_prompt;

  if (!listingUrl || !model || !extractionPrompt) {
    return { verified: false, result_count: 0, sample: [], cost_usd: 0, error: "Missing listingUrl, model, or extraction_prompt", needs_browser: false };
  }

  // Step 1: Fetch the page
  let html;
  try {
    const response = await fetch(listingUrl, {
      headers: { "User-Agent": userAgent },
      signal: AbortSignal.timeout(30000),
      redirect: "follow",
    });
    if (!response.ok) {
      return { verified: false, result_count: 0, sample: [], cost_usd: 0, error: `HTTP ${response.status}`, needs_browser: false };
    }
    html = await response.text();
  } catch (err) {
    return { verified: false, result_count: 0, sample: [], cost_usd: 0, error: err.message, needs_browser: false };
  }

  // Step 2: Basic text extraction (strip scripts/styles, truncate)
  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  if (cleaned.length > 100000) {
    cleaned = cleaned.slice(0, 100000);
  }

  // Pre-compute keyword match before LLM call so all return paths can use it
  const hasKeywordMatch = (keywords || []).some(k => html.toLowerCase().includes(k.toLowerCase()));

  // Step 3: Run extraction with configured model
  const HAIKU_INPUT_COST = 0.0000008;
  const HAIKU_OUTPUT_COST = 0.000004;

  let resultCount = 0;
  let sample = [];
  let costUsd = 0;

  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic();

    const response = await client.messages.create({
      model,
      max_tokens: 16384,
      messages: [
        {
          role: "user",
          content: `${extractionPrompt}\n\nHTML:\n${cleaned}`,
        },
      ],
    });

    costUsd =
      (response.usage.input_tokens * HAIKU_INPUT_COST) +
      (response.usage.output_tokens * HAIKU_OUTPUT_COST);

    const rawText = response.content[0].text.trim()
      .replace(/```json\s*/g, "").replace(/```\s*/g, "");

    const parsed = JSON.parse(rawText);
    if (Array.isArray(parsed)) {
      resultCount = parsed.length;
      sample = parsed.slice(0, 3);
    }
  } catch (err) {
    return { verified: false, result_count: 0, sample: [], cost_usd: costUsd, error: `Extraction failed: ${err.message}`, needs_browser: hasKeywordMatch };
  }

  // 0 extracted items: check if page has relevant keywords (likely needs JS rendering)
  if (resultCount === 0) {
    if (hasKeywordMatch) {
      console.log(`  [Verify] 0 items but keywords found — flagging needs_browser`);
      return {
        verified: false,
        result_count: 0,
        sample: [],
        cost_usd: costUsd,
        error: null,
        needs_browser: true,
      };
    }
    console.log(`  [Verify] 0 items extracted, no keywords — not auto-approving`);
    return {
      verified: false,
      result_count: 0,
      sample: [],
      cost_usd: costUsd,
      error: null,
      needs_browser: false,
    };
  }

  return {
    verified: true,
    result_count: resultCount,
    sample,
    cost_usd: costUsd,
    error: null,
    needs_browser: false,
  };
}