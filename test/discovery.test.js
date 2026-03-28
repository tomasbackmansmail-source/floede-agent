// Tests for Discovery utility functions.
// Only pure functions — no network calls.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectPlatform, buildCandidateUrls } from "../src/utils/discovery.js";

// ═══════════════════════════════════════════════
// detectPlatform
// ═══════════════════════════════════════════════

describe("detectPlatform", () => {
  it("detects Sitevision from sv-portlet class", () => {
    const html = '<div class="sv-portlet"><p>Content</p></div>';
    assert.equal(detectPlatform(html), "sitevision");
  });

  it("detects Sitevision from /sitevision/ path", () => {
    const html = '<link rel="stylesheet" href="/sitevision/style.css">';
    assert.equal(detectPlatform(html), "sitevision");
  });

  it("detects EPiServer", () => {
    const html = '<meta name="generator" content="EPiServer">';
    assert.equal(detectPlatform(html), "episerver");
  });

  it("detects WordPress from wp-content", () => {
    const html = '<link rel="stylesheet" href="/wp-content/themes/flavor/style.css">';
    assert.equal(detectPlatform(html), "wordpress");
  });

  it("detects Municipio", () => {
    const html = '<meta name="generator" content="municipio">';
    assert.equal(detectPlatform(html), "municipio");
  });

  it("detects Netpublicator", () => {
    const html = '<div class="netpublicator-content">Data</div>';
    assert.equal(detectPlatform(html), "netpublicator");
  });

  it("returns unknown for unrecognized HTML", () => {
    const html = '<html><body><p>Hello world</p></body></html>';
    assert.equal(detectPlatform(html), "unknown");
  });

  it("is case-insensitive", () => {
    const html = '<div class="SV-PORTLET">Content</div>';
    assert.equal(detectPlatform(html), "sitevision");
  });

  it("handles empty input", () => {
    assert.equal(detectPlatform(""), "unknown");
  });

  it("detects first matching platform when multiple present", () => {
    const html = '<div class="sv-portlet"><link href="/wp-content/style.css"></div>';
    assert.equal(detectPlatform(html), "sitevision");
  });
});

// ═══════════════════════════════════════════════
// buildCandidateUrls
// ═══════════════════════════════════════════════

describe("buildCandidateUrls", () => {
  const urlPatterns = ["/anslagstavla", "/kungorelser"];
  const platformTemplates = {
    sitevision: ["/nyheter-och-press/anslagstavla", "/politik/anslagstavla"],
    episerver: ["/bygga-bo/anslagstavla"],
  };

  it("builds URLs from general patterns", () => {
    const urls = buildCandidateUrls("https://www.nacka.se", urlPatterns, platformTemplates, "unknown");
    assert.ok(urls.includes("https://www.nacka.se/anslagstavla"));
    assert.ok(urls.includes("https://www.nacka.se/kungorelser"));
  });

  it("puts platform-specific templates first for detected platform", () => {
    const urls = buildCandidateUrls("https://www.nacka.se", urlPatterns, platformTemplates, "sitevision");
    // Platform templates should come before general patterns
    const svIndex = urls.indexOf("https://www.nacka.se/nyheter-och-press/anslagstavla");
    const genIndex = urls.indexOf("https://www.nacka.se/anslagstavla");
    assert.ok(svIndex < genIndex, "platform template should come before general pattern");
  });

  it("includes both platform and general patterns", () => {
    const urls = buildCandidateUrls("https://www.nacka.se", urlPatterns, platformTemplates, "sitevision");
    assert.ok(urls.length >= 4); // 2 sitevision + 2 general
    assert.ok(urls.includes("https://www.nacka.se/nyheter-och-press/anslagstavla"));
    assert.ok(urls.includes("https://www.nacka.se/anslagstavla"));
  });

  it("deduplicates URLs", () => {
    const patterns = ["/anslagstavla"];
    const templates = { sitevision: ["/anslagstavla"] };
    const urls = buildCandidateUrls("https://www.test.se", patterns, templates, "sitevision");
    const count = urls.filter(u => u === "https://www.test.se/anslagstavla").length;
    assert.equal(count, 1);
  });

  it("handles unknown platform gracefully", () => {
    const urls = buildCandidateUrls("https://www.test.se", urlPatterns, platformTemplates, "unknown");
    assert.equal(urls.length, 2); // only general patterns
  });

  it("handles null platform templates", () => {
    const urls = buildCandidateUrls("https://www.test.se", urlPatterns, null, "sitevision");
    assert.equal(urls.length, 2);
  });

  it("handles null url patterns", () => {
    const urls = buildCandidateUrls("https://www.test.se", null, platformTemplates, "sitevision");
    assert.equal(urls.length, 2); // only sitevision templates
  });

  it("strips trailing paths from homepage URL", () => {
    const urls = buildCandidateUrls("https://www.nacka.se/startsida/", urlPatterns, null, "unknown");
    assert.ok(urls.includes("https://www.nacka.se/anslagstavla"));
    assert.ok(!urls.some(u => u.includes("/startsida/")));
  });

  it("returns empty array for invalid URL", () => {
    const urls = buildCandidateUrls("not-a-url", urlPatterns, null, "unknown");
    assert.deepEqual(urls, []);
  });

  it("handles empty inputs", () => {
    const urls = buildCandidateUrls("https://www.test.se", [], {}, "unknown");
    assert.deepEqual(urls, []);
  });
});

// ═══════════════════════════════════════════════
// extractLinksSimple
// ═══════════════════════════════════════════════

import { extractLinksSimple, scoreLinks } from "../src/utils/discovery.js";

describe("extractLinksSimple", () => {
  const BASE = "https://www.nacka.se";

  it("extracts absolute links", () => {
    const html = '<a href="https://www.nacka.se/anslagstavla">Anslagstavla</a>';
    const links = extractLinksSimple(html, BASE);
    assert.equal(links.length, 1);
    assert.equal(links[0].href, "https://www.nacka.se/anslagstavla");
    assert.equal(links[0].text, "Anslagstavla");
  });

  it("resolves relative links", () => {
    const html = '<a href="/bygga-bo/anslagstavla">Bygglov</a>';
    const links = extractLinksSimple(html, BASE);
    assert.equal(links[0].href, "https://www.nacka.se/bygga-bo/anslagstavla");
  });

  it("strips inner HTML from link text", () => {
    const html = '<a href="/page"><span>Ikon</span> <strong>Text</strong></a>';
    const links = extractLinksSimple(html, BASE);
    assert.equal(links[0].text, "Ikon Text");
  });

  it("skips hash and javascript links", () => {
    const html = '<a href="#">Top</a><a href="javascript:void(0)">Klick</a><a href="/real">Real</a>';
    const links = extractLinksSimple(html, BASE);
    assert.equal(links.length, 1);
    assert.equal(links[0].text, "Real");
  });

  it("handles empty HTML", () => {
    assert.deepEqual(extractLinksSimple("", BASE), []);
  });

  it("handles HTML with no links", () => {
    assert.deepEqual(extractLinksSimple("<p>Ingen länk här</p>", BASE), []);
  });
});

// ═══════════════════════════════════════════════
// scoreLinks
// ═══════════════════════════════════════════════

describe("scoreLinks", () => {
  const links = [
    { href: "https://x.se/anslagstavla", text: "Anslagstavla bygglov" },
    { href: "https://x.se/nyheter", text: "Nyheter från kommunen" },
    { href: "https://x.se/bygglov/kungorelser", text: "Kungörelser" },
    { href: "https://x.se/kontakt", text: "Kontakta oss" },
  ];

  const searchTerms = ["anslagstavla", "bygglov", "kungörelse"];

  it("scores links by number of matching search terms", () => {
    const scored = scoreLinks(links, searchTerms);
    assert.ok(scored.length >= 2);
    assert.equal(scored[0].href, "https://x.se/anslagstavla");
    assert.equal(scored[0].matchCount, 2); // anslagstavla + bygglov
  });

  it("matches in both text and URL", () => {
    const scored = scoreLinks(links, searchTerms);
    const kungLink = scored.find(s => s.href.includes("kungorelser"));
    assert.ok(kungLink);
    assert.ok(kungLink.matchCount >= 1);
  });

  it("filters out non-matching links", () => {
    const scored = scoreLinks(links, searchTerms);
    assert.ok(!scored.some(s => s.href.includes("kontakt")));
    assert.ok(!scored.some(s => s.href.includes("nyheter")));
  });

  it("is case-insensitive", () => {
    const links = [{ href: "https://x.se/page", text: "ANSLAGSTAVLA BYGGLOV" }];
    const scored = scoreLinks(links, ["anslagstavla"]);
    assert.equal(scored.length, 1);
    assert.equal(scored[0].matchCount, 1);
  });

  it("returns empty for no matches", () => {
    const scored = scoreLinks(links, ["detaljplan"]);
    assert.deepEqual(scored, []);
  });

  it("handles empty inputs", () => {
    assert.deepEqual(scoreLinks([], searchTerms), []);
    assert.deepEqual(scoreLinks(links, []), []);
    assert.deepEqual(scoreLinks(null, null), []);
  });

  it("sorts by matchCount descending", () => {
    const scored = scoreLinks(links, searchTerms);
    for (let i = 1; i < scored.length; i++) {
      assert.ok(scored[i - 1].matchCount >= scored[i].matchCount);
    }
  });
});

// ═══════════════════════════════════════════════
// parseSitemapUrls
// ═══════════════════════════════════════════════

import { parseSitemapUrls, scoreSitemapUrls } from "../src/utils/discovery.js";

describe("parseSitemapUrls", () => {
  it("extracts URLs from sitemap XML", () => {
    const xml = '<?xml version="1.0"?><urlset><url><loc>https://www.nacka.se/anslagstavla</loc></url><url><loc>https://www.nacka.se/kontakt</loc></url></urlset>';
    const urls = parseSitemapUrls(xml);
    assert.equal(urls.length, 2);
    assert.equal(urls[0], "https://www.nacka.se/anslagstavla");
    assert.equal(urls[1], "https://www.nacka.se/kontakt");
  });

  it("handles whitespace in loc tags", () => {
    const xml = '<urlset><url><loc>  https://www.test.se/page  </loc></url></urlset>';
    const urls = parseSitemapUrls(xml);
    assert.equal(urls[0], "https://www.test.se/page");
  });

  it("returns empty for no loc tags", () => {
    const xml = '<urlset></urlset>';
    assert.deepEqual(parseSitemapUrls(xml), []);
  });

  it("returns empty for empty input", () => {
    assert.deepEqual(parseSitemapUrls(""), []);
  });

  it("handles large sitemaps", () => {
    let xml = '<urlset>';
    for (let i = 0; i < 100; i++) {
      xml += '<url><loc>https://www.test.se/page-' + i + '</loc></url>';
    }
    xml += '</urlset>';
    assert.equal(parseSitemapUrls(xml).length, 100);
  });
});

// ═══════════════════════════════════════════════
// scoreSitemapUrls
// ═══════════════════════════════════════════════

describe("scoreSitemapUrls", () => {
  const urls = [
    "https://www.nacka.se/anslagstavla/bygglov",
    "https://www.nacka.se/kontakt",
    "https://www.nacka.se/kungorelser/anslagstavla",
    "https://www.nacka.se/om-kommunen",
  ];
  const searchTerms = ["anslagstavla", "bygglov", "kungörelse"];

  it("scores URLs by search term matches", () => {
    const scored = scoreSitemapUrls(urls, searchTerms);
    assert.equal(scored[0].url, "https://www.nacka.se/anslagstavla/bygglov");
    assert.equal(scored[0].matchCount, 2);
  });

  it("filters out non-matching URLs", () => {
    const scored = scoreSitemapUrls(urls, searchTerms);
    assert.ok(!scored.some(s => s.url.includes("kontakt")));
    assert.ok(!scored.some(s => s.url.includes("om-kommunen")));
  });

  it("is case-insensitive", () => {
    const scored = scoreSitemapUrls(["https://x.se/ANSLAGSTAVLA"], ["anslagstavla"]);
    assert.equal(scored.length, 1);
  });

  it("handles empty inputs", () => {
    assert.deepEqual(scoreSitemapUrls([], searchTerms), []);
    assert.deepEqual(scoreSitemapUrls(urls, []), []);
    assert.deepEqual(scoreSitemapUrls(null, null), []);
  });

  it("sorts by matchCount descending", () => {
    const scored = scoreSitemapUrls(urls, searchTerms);
    for (let i = 1; i < scored.length; i++) {
      assert.ok(scored[i - 1].matchCount >= scored[i].matchCount);
    }
  });
});
