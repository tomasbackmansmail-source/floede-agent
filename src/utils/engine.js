// Pure utility functions extracted from daily-run.js for testability.
// No side effects, no I/O, no API calls.

export const BYGGLOV_KEYWORDS = [
  'bygglov', 'rivningslov', 'marklov', 'förhandsbesked',
  'plan- och bygglagen', 'pbl', 'kungörelse om beslut i lov',
  'strandskyddsdispens', 'bygganmälan',
];

export function sanitizeFilename(name) {
  return name.normalize('NFC').toLowerCase()
    .replace(/[åä]/g, "a").replace(/ö/g, "o")
    .replace(/é/g, "e").replace(/ü/g, "u")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// Strip HTML to plain text (equivalent to innerText)
export function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|h[1-6]|li|tr|dt|dd|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#\d+;/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Extract links from raw HTML, resolve to absolute URLs
export function extractLinks(html, baseUrl, selectorHint) {
  const links = [];
  const anchorRegex = /<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorRegex.exec(html)) !== null) {
    const href = match[1];
    const innerHtml = match[2];
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) continue;
    const text = innerHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    try {
      const absolute = new URL(href, baseUrl).href;
      links.push({ href: absolute, text });
    } catch { /* skip invalid URLs */ }
  }

  if (selectorHint) {
    const hrefPatterns = [...selectorHint.matchAll(/href\*='([^']+)'/g)].map(m => m[1]);
    if (hrefPatterns.length > 0) {
      return links.filter(l => hrefPatterns.some(p => l.href.toLowerCase().includes(p)));
    }
  }

  return links;
}

// Filter links by keyword list (generic — works for any vertical)
export function filterByKeywords(links, keywords) {
  return links.filter(l => {
    const text = l.text.toLowerCase();
    return keywords.some(kw => text.includes(kw));
  });
}

// Legacy wrapper for backward compatibility (tests + existing code)
export function filterByBygglovKeywords(links) {
  return filterByKeywords(links, BYGGLOV_KEYWORDS);
}

// Filter links: remove binaries and external domains
export function filterLinks(links, configUrl) {
  const configDomain = new URL(configUrl).hostname.replace(/^www\./, "");
  return [...new Set(links)].filter((url) => {
    if (/\.(pdf|doc|docx|xlsx|xls|zip|png|jpg|jpeg|gif)$/i.test(url)) return false;
    try {
      const host = new URL(url).hostname.replace(/^www\./, "");
      return host === configDomain || host.endsWith(`.${configDomain}`);
    } catch { return false; }
  });
}

// Strip non-content HTML elements for LLM input
export function stripNonContent(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<link[^>]*>/gi, "")
    .replace(/<meta[^>]*>/gi, "")
    .replace(/<img[^>]*>/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Validate permit enums — returns cleaned object
// Takes enum lists as parameters for vertical independence.
// Defaults to ByggSignal enums for backward compatibility (tests).
const DEFAULT_PERMIT_TYPES = ["bygglov", "marklov", "rivningslov", "förhandsbesked", "strandskyddsdispens", "anmälan"];
const DEFAULT_STATUSES = ["ansökt", "beviljat", "avslag", "överklagat", "startbesked", "slutbesked"];

export function validatePermitEnums(permit, validPermitTypes = DEFAULT_PERMIT_TYPES, validStatuses = DEFAULT_STATUSES) {
  return {
    permit_type: validPermitTypes.includes(permit.permit_type) ? permit.permit_type : null,
    status: validStatuses.includes(permit.status) ? permit.status : null,
  };
}

// Parse config rows from Supabase into the format daily-run expects
export function parseConfigRows(rows) {
  return rows.map((row) => ({
    ...row.config,
    approved: row.approved,
    needs_browser: row.config.needs_browser || row.needs_browser || false,
    _file: `${row.municipality}_config.json`,
  }));
}
