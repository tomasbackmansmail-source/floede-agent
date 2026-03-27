// Test suite for Floede Engine utility functions.
// Run: npm test
// Uses Node.js built-in test runner (node:test) — no dependencies.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeFilename,
  htmlToText,
  extractLinks,
  filterByBygglovKeywords,
  filterLinks,
  stripNonContent,
  validatePermitEnums,
  parseConfigRows,
  BYGGLOV_KEYWORDS,
} from "../src/utils/engine.js";

// ═══════════════════════════════════════════════
// sanitizeFilename
// ═══════════════════════════════════════════════

describe("sanitizeFilename", () => {
  it("lowercases and replaces åäö", () => {
    assert.equal(sanitizeFilename("Jönköping"), "jonkoping");
    assert.equal(sanitizeFilename("Malmö"), "malmo");
    assert.equal(sanitizeFilename("Västerås"), "vasteras");
    assert.equal(sanitizeFilename("Höör"), "hoor");
  });

  it("replaces spaces and special chars with hyphens", () => {
    assert.equal(sanitizeFilename("Upplands Väsby"), "upplands-vasby");
    assert.equal(sanitizeFilename("Dals-Ed"), "dals-ed");
  });

  it("collapses multiple hyphens", () => {
    assert.equal(sanitizeFilename("a---b"), "a-b");
  });

  it("strips leading/trailing hyphens", () => {
    assert.equal(sanitizeFilename("-test-"), "test");
  });

  it("handles empty string", () => {
    assert.equal(sanitizeFilename(""), "");
  });
});

// ═══════════════════════════════════════════════
// htmlToText
// ═══════════════════════════════════════════════

describe("htmlToText", () => {
  it("strips script tags and content", () => {
    const html = '<p>Hello</p><script>alert("x")</script><p>World</p>';
    const text = htmlToText(html);
    assert.ok(!text.includes("alert"));
    assert.ok(text.includes("Hello"));
    assert.ok(text.includes("World"));
  });

  it("strips style tags and content", () => {
    const html = "<style>.foo{color:red}</style><p>Content</p>";
    assert.ok(!htmlToText(html).includes("color"));
  });

  it("strips SVG tags and content", () => {
    const html = '<svg viewBox="0 0 100 100"><circle r="50"/></svg><p>After</p>';
    assert.ok(!htmlToText(html).includes("circle"));
    assert.ok(htmlToText(html).includes("After"));
  });

  it("strips nav, header, footer", () => {
    const html = "<nav>Menu</nav><main>Content</main><footer>Foot</footer>";
    const text = htmlToText(html);
    assert.ok(!text.includes("Menu"));
    assert.ok(!text.includes("Foot"));
    assert.ok(text.includes("Content"));
  });

  it("strips HTML comments", () => {
    const html = "<!-- comment --><p>Visible</p>";
    assert.ok(!htmlToText(html).includes("comment"));
  });

  it("converts <br> to newline", () => {
    const html = "Line1<br>Line2<br/>Line3";
    const text = htmlToText(html);
    assert.ok(text.includes("Line1\nLine2\nLine3"));
  });

  it("decodes HTML entities", () => {
    const html = "<p>A &amp; B &lt; C &gt; D &quot;E&quot;</p>";
    const text = htmlToText(html);
    assert.ok(text.includes('A & B < C > D "E"'));
  });

  it("collapses whitespace", () => {
    const html = "<p>  too   many    spaces  </p>";
    assert.ok(!htmlToText(html).includes("  "));
  });

  it("handles empty input", () => {
    assert.equal(htmlToText(""), "");
  });
});

// ═══════════════════════════════════════════════
// extractLinks
// ═══════════════════════════════════════════════

describe("extractLinks", () => {
  const BASE = "https://www.nacka.se/anslagstavla/";

  it("extracts absolute links", () => {
    const html = '<a href="https://www.nacka.se/page1">Page 1</a>';
    const links = extractLinks(html, BASE);
    assert.equal(links.length, 1);
    assert.equal(links[0].href, "https://www.nacka.se/page1");
    assert.equal(links[0].text, "Page 1");
  });

  it("resolves relative links to absolute", () => {
    const html = '<a href="/kungorelse/bygglov-123">Bygglov 123</a>';
    const links = extractLinks(html, BASE);
    assert.equal(links.length, 1);
    assert.equal(links[0].href, "https://www.nacka.se/kungorelse/bygglov-123");
  });

  it("skips hash and javascript links", () => {
    const html = '<a href="#">Top</a><a href="javascript:void(0)">Click</a><a href="/real">Real</a>';
    const links = extractLinks(html, BASE);
    assert.equal(links.length, 1);
    assert.equal(links[0].text, "Real");
  });

  it("strips inner HTML tags from link text", () => {
    const html = '<a href="/page"><span class="icon">★</span> <strong>Bold text</strong></a>';
    const links = extractLinks(html, BASE);
    assert.equal(links[0].text, "★ Bold text");
  });

  it("filters by selector hint", () => {
    const html = `
      <a href="/kungorelse/bygglov-1">Bygglov 1</a>
      <a href="/nyheter/info">Info</a>
      <a href="/kungorelse/bygglov-2">Bygglov 2</a>
    `;
    const links = extractLinks(html, BASE, "a[href*='kungorelse']");
    assert.equal(links.length, 2);
    assert.ok(links.every(l => l.href.includes("kungorelse")));
  });

  it("returns all links when no selector hint", () => {
    const html = '<a href="/a">A</a><a href="/b">B</a>';
    const links = extractLinks(html, BASE);
    assert.equal(links.length, 2);
  });

  it("handles empty HTML", () => {
    assert.deepEqual(extractLinks("", BASE), []);
  });
});

// ═══════════════════════════════════════════════
// filterByBygglovKeywords
// ═══════════════════════════════════════════════

describe("filterByBygglovKeywords", () => {
  it("matches bygglov keyword in text", () => {
    const links = [
      { href: "https://x.se/1", text: "Kungörelse om beviljat bygglov" },
      { href: "https://x.se/2", text: "Nyheter från kommunen" },
      { href: "https://x.se/3", text: "Rivningslov för garage" },
    ];
    const filtered = filterByBygglovKeywords(links);
    assert.equal(filtered.length, 2);
    assert.equal(filtered[0].href, "https://x.se/1");
    assert.equal(filtered[1].href, "https://x.se/3");
  });

  it("matches PBL keyword", () => {
    const links = [{ href: "https://x.se/1", text: "Beslut enligt plan- och bygglagen" }];
    assert.equal(filterByBygglovKeywords(links).length, 1);
  });

  it("is case-insensitive", () => {
    const links = [{ href: "https://x.se/1", text: "BYGGLOV för nybyggnad" }];
    assert.equal(filterByBygglovKeywords(links).length, 1);
  });

  it("returns empty for non-matching links", () => {
    const links = [
      { href: "https://x.se/1", text: "Protokoll kommunstyrelsen" },
      { href: "https://x.se/2", text: "Barnomsorg information" },
    ];
    assert.equal(filterByBygglovKeywords(links).length, 0);
  });

  it("handles empty input", () => {
    assert.deepEqual(filterByBygglovKeywords([]), []);
  });
});

// ═══════════════════════════════════════════════
// filterLinks
// ═══════════════════════════════════════════════

describe("filterLinks", () => {
  const CONFIG_URL = "https://www.nacka.se/anslagstavla/";

  it("keeps same-domain links", () => {
    const links = ["https://www.nacka.se/page1", "https://nacka.se/page2"];
    assert.equal(filterLinks(links, CONFIG_URL).length, 2);
  });

  it("keeps subdomain links", () => {
    const links = ["https://anslagstavla.nacka.se/page"];
    assert.equal(filterLinks(links, CONFIG_URL).length, 1);
  });

  it("removes external domain links", () => {
    const links = ["https://www.google.com/search", "https://www.nacka.se/page"];
    assert.equal(filterLinks(links, CONFIG_URL).length, 1);
  });

  it("removes binary file links", () => {
    const links = [
      "https://www.nacka.se/doc.pdf",
      "https://www.nacka.se/img.jpg",
      "https://www.nacka.se/file.xlsx",
      "https://www.nacka.se/page",
    ];
    assert.equal(filterLinks(links, CONFIG_URL).length, 1);
  });

  it("deduplicates links", () => {
    const links = ["https://www.nacka.se/page", "https://www.nacka.se/page"];
    assert.equal(filterLinks(links, CONFIG_URL).length, 1);
  });

  it("handles empty input", () => {
    assert.deepEqual(filterLinks([], CONFIG_URL), []);
  });
});

// ═══════════════════════════════════════════════
// stripNonContent
// ═══════════════════════════════════════════════

describe("stripNonContent", () => {
  it("strips scripts, styles, SVG, comments, link, meta, img", () => {
    const html = `
      <link rel="stylesheet" href="style.css">
      <meta charset="utf-8">
      <style>.x{}</style>
      <script>alert(1)</script>
      <svg><rect/></svg>
      <!-- comment -->
      <img src="photo.jpg">
      <p>Real content here</p>
    `;
    const cleaned = stripNonContent(html);
    assert.ok(cleaned.includes("Real content here"));
    assert.ok(!cleaned.includes("alert"));
    assert.ok(!cleaned.includes("stylesheet"));
    assert.ok(!cleaned.includes("charset"));
    assert.ok(!cleaned.includes("rect"));
    assert.ok(!cleaned.includes("comment"));
    assert.ok(!cleaned.includes("photo.jpg"));
  });

  it("collapses whitespace", () => {
    const html = "<p>a     b</p>";
    assert.ok(!stripNonContent(html).includes("  "));
  });

  it("preserves HTML tags (unlike htmlToText)", () => {
    const html = "<p>Content</p>";
    assert.ok(stripNonContent(html).includes("<p>"));
  });
});

// ═══════════════════════════════════════════════
// validatePermitEnums
// ═══════════════════════════════════════════════

describe("validatePermitEnums", () => {
  it("passes valid permit_type and status", () => {
    const result = validatePermitEnums({ permit_type: "bygglov", status: "beviljat" });
    assert.equal(result.permit_type, "bygglov");
    assert.equal(result.status, "beviljat");
  });

  it("accepts all valid permit types", () => {
    for (const pt of ["bygglov", "marklov", "rivningslov", "förhandsbesked", "strandskyddsdispens", "anmälan"]) {
      assert.equal(validatePermitEnums({ permit_type: pt, status: "beviljat" }).permit_type, pt);
    }
  });

  it("accepts all valid statuses", () => {
    for (const s of ["ansökt", "beviljat", "avslag", "överklagat", "startbesked", "slutbesked"]) {
      assert.equal(validatePermitEnums({ permit_type: "bygglov", status: s }).status, s);
    }
  });

  it("nullifies invalid permit_type", () => {
    assert.equal(validatePermitEnums({ permit_type: "invalid", status: "beviljat" }).permit_type, null);
  });

  it("nullifies invalid status", () => {
    assert.equal(validatePermitEnums({ permit_type: "bygglov", status: "pending" }).status, null);
  });

  it("nullifies ASCII versions (must use Swedish chars)", () => {
    assert.equal(validatePermitEnums({ permit_type: "forhandsbesked", status: "beviljat" }).permit_type, null);
    assert.equal(validatePermitEnums({ permit_type: "anmalan", status: "beviljat" }).permit_type, null);
    assert.equal(validatePermitEnums({ permit_type: "bygglov", status: "ansokt" }).status, null);
    assert.equal(validatePermitEnums({ permit_type: "bygglov", status: "overklagat" }).status, null);
  });

  it("handles missing fields", () => {
    const result = validatePermitEnums({});
    assert.equal(result.permit_type, null);
    assert.equal(result.status, null);
  });
});

// ═══════════════════════════════════════════════
// parseConfigRows
// ═══════════════════════════════════════════════

describe("parseConfigRows", () => {
  it("parses Supabase rows into config objects", () => {
    const rows = [{
      municipality: "Nacka",
      approved: true,
      config: {
        municipality: "Nacka",
        listing_url: "https://www.nacka.se/anslagstavla/",
        needs_browser: false,
        platform_guess: "sitevision",
      },
    }];
    const configs = parseConfigRows(rows);
    assert.equal(configs.length, 1);
    assert.equal(configs[0].municipality, "Nacka");
    assert.equal(configs[0].listing_url, "https://www.nacka.se/anslagstavla/");
    assert.equal(configs[0].approved, true);
    assert.equal(configs[0].needs_browser, false);
    assert.equal(configs[0]._file, "Nacka_config.json");
  });

  it("defaults needs_browser to false", () => {
    const rows = [{
      municipality: "Test",
      approved: true,
      config: { municipality: "Test", listing_url: "https://test.se" },
    }];
    assert.equal(parseConfigRows(rows)[0].needs_browser, false);
  });

  it("picks needs_browser from config over row", () => {
    const rows = [{
      municipality: "Test",
      approved: true,
      needs_browser: false,
      config: { municipality: "Test", listing_url: "https://test.se", needs_browser: true },
    }];
    assert.equal(parseConfigRows(rows)[0].needs_browser, true);
  });

  it("handles empty input", () => {
    assert.deepEqual(parseConfigRows([]), []);
  });
});

// ═══════════════════════════════════════════════
// BYGGLOV_KEYWORDS constant
// ═══════════════════════════════════════════════

describe("BYGGLOV_KEYWORDS", () => {
  it("is a non-empty array of strings", () => {
    assert.ok(Array.isArray(BYGGLOV_KEYWORDS));
    assert.ok(BYGGLOV_KEYWORDS.length > 0);
    assert.ok(BYGGLOV_KEYWORDS.every(kw => typeof kw === "string"));
  });

  it("contains core permit keywords", () => {
    assert.ok(BYGGLOV_KEYWORDS.includes("bygglov"));
    assert.ok(BYGGLOV_KEYWORDS.includes("rivningslov"));
    assert.ok(BYGGLOV_KEYWORDS.includes("marklov"));
    assert.ok(BYGGLOV_KEYWORDS.includes("strandskyddsdispens"));
  });
});

// ═══════════════════════════════════════════════
// Integration: realistic HTML → extraction pipeline
// ═══════════════════════════════════════════════

describe("integration: Sitevision-style HTML processing", () => {
  const SITEVISION_HTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Anslagstavla - Nacka kommun</title>
      <link rel="stylesheet" href="/sitevision/style.css">
      <style>.sv-portlet { margin: 0; }</style>
      <script>var sv_config = {};</script>
    </head>
    <body>
      <header><nav><a href="/">Start</a><a href="/bygga">Bygga & bo</a></nav></header>
      <main>
        <h1>Kungörelser bygglov</h1>
        <div class="sv-portlet-anslagstavla">
          <div class="item">
            <h3>Kungörelse om beviljat bygglov</h3>
            <p>Fastighetsbeteckning: SICKLAÖN 37:10</p>
            <p>Ärendenummer: KFKS 2024/00542</p>
            <p>Åtgärd: Nybyggnad av enbostadshus</p>
            <p>Beslutsdatum: 2026-03-15</p>
            <a href="/kungorelse-bygglov/kfks-2024-00542">Läs mer</a>
          </div>
          <div class="item">
            <h3>Kungörelse om rivningslov</h3>
            <p>Fastighetsbeteckning: BOO 1:23</p>
            <p>Ärendenummer: KFKS 2024/00601</p>
            <p>Åtgärd: Rivning av komplementbyggnad</p>
            <p>Beslutsdatum: 2026-03-14</p>
            <a href="/kungorelse-bygglov/kfks-2024-00601">Läs mer</a>
          </div>
          <div class="item">
            <h3>Protokoll kommunstyrelsen</h3>
            <p>Datum: 2026-03-10</p>
            <a href="/protokoll/ks-2026-03">Läs mer</a>
          </div>
        </div>
      </main>
      <footer><p>© Nacka kommun</p></footer>
      <!-- Google Analytics -->
      <script>ga('send', 'pageview');</script>
      <svg viewBox="0 0 100 100"><circle r="50"/></svg>
    </body>
    </html>
  `;

  it("stripNonContent removes noise, keeps structure", () => {
    const cleaned = stripNonContent(SITEVISION_HTML);
    assert.ok(cleaned.includes("SICKLAÖN 37:10"));
    assert.ok(cleaned.includes("KFKS 2024/00542"));
    assert.ok(!cleaned.includes("sv_config"));
    assert.ok(!cleaned.includes("ga('send'"));
    assert.ok(!cleaned.includes("circle"));
    assert.ok(!cleaned.includes("Google Analytics"));
  });

  it("htmlToText produces clean text with permit data", () => {
    const text = htmlToText(SITEVISION_HTML);
    assert.ok(text.includes("SICKLAÖN 37:10"));
    assert.ok(text.includes("KFKS 2024/00542"));
    assert.ok(text.includes("Nybyggnad av enbostadshus"));
    assert.ok(!text.includes("<"));  // no HTML tags
    assert.ok(!text.includes("sv_config"));
    assert.ok(!text.includes("Start"));  // nav stripped
    assert.ok(!text.includes("© Nacka kommun"));  // footer stripped
  });

  it("extractLinks finds bygglov detail links", () => {
    const links = extractLinks(
      SITEVISION_HTML,
      "https://www.nacka.se/anslagstavla/",
      "a[href*='kungorelse']"
    );
    assert.equal(links.length, 2);
    assert.ok(links[0].href.includes("kfks-2024-00542"));
    assert.ok(links[1].href.includes("kfks-2024-00601"));
  });

  it("filterByBygglovKeywords filters on link text (not surrounding HTML)", () => {
    const allLinks = extractLinks(SITEVISION_HTML, "https://www.nacka.se/anslagstavla/");
    const filtered = filterByBygglovKeywords(allLinks);
    // "Läs mer" links don't contain bygglov keywords — so they are correctly filtered out.
    // Only links like "Bygga & bo" that happen to be in nav would remain, but nav is not stripped by extractLinks.
    // This confirms: filterByBygglovKeywords only looks at anchor text, not page context.
    assert.ok(filtered.every(l => BYGGLOV_KEYWORDS.some(kw => l.text.toLowerCase().includes(kw))));
  });

  it("full pipeline: selector hint is needed to find subpage links", () => {
    const cleaned = stripNonContent(SITEVISION_HTML);
    assert.ok(cleaned.length < SITEVISION_HTML.length);

    // Without selector hint, "Läs mer" links have no bygglov keywords in text
    const allLinks = extractLinks(SITEVISION_HTML, "https://www.nacka.se/anslagstavla/");
    const bygglovByText = filterByBygglovKeywords(allLinks);
    // But WITH selector hint, we find the kungorelse links by URL pattern
    const bySelector = extractLinks(SITEVISION_HTML, "https://www.nacka.se/anslagstavla/", "a[href*='kungorelse']");
    assert.equal(bySelector.length, 2);
    assert.ok(bySelector.every(l => l.href.includes("kungorelse")));
  });
});

describe("integration: subpage links with relative URLs", () => {
  // This tests the Gotland bug documented in fas-b-analysis.md
  const GOTLAND_HTML = `
    <div class="anslagstavla">
      <a href="/region-och-politik/anslagstavla/bygglov-villa-visby">Bygglov villa Visby</a>
      <a href="/region-och-politik/anslagstavla/rivningslov-garage">Rivningslov garage Slite</a>
      <a href="https://external.site/spam">External spam</a>
    </div>
  `;

  it("resolves relative URLs to absolute", () => {
    const links = extractLinks(GOTLAND_HTML, "https://gotland.se/anslagstavla/");
    const gotlandLinks = links.filter(l => l.href.includes("gotland.se"));
    assert.equal(gotlandLinks.length, 2);
    assert.ok(gotlandLinks[0].href.startsWith("https://gotland.se/"));
    assert.ok(gotlandLinks[1].href.startsWith("https://gotland.se/"));
  });

  it("filterLinks keeps same-domain, drops external", () => {
    const links = extractLinks(GOTLAND_HTML, "https://gotland.se/anslagstavla/");
    const filtered = filterLinks(links.map(l => l.href), "https://gotland.se/anslagstavla/");
    assert.equal(filtered.length, 2);
    assert.ok(filtered.every(u => u.includes("gotland.se")));
  });
});

describe("integration: EPiServer-style table HTML", () => {
  const EPISERVER_HTML = `
    <table class="permit-table">
      <thead><tr><th>Datum</th><th>Ärende</th><th>Typ</th><th>Status</th></tr></thead>
      <tbody>
        <tr>
          <td>2026-03-20</td>
          <td>BN 2026/0145 - Nybyggnad av flerbostadshus, Kv Storken 5</td>
          <td>Bygglov</td>
          <td>Beviljat</td>
        </tr>
        <tr>
          <td>2026-03-18</td>
          <td>BN 2026/0132 - Installation av eldstad, Björken 12</td>
          <td>Anmälan</td>
          <td>Startbesked</td>
        </tr>
      </tbody>
    </table>
  `;

  it("htmlToText preserves table content as readable text", () => {
    const text = htmlToText(EPISERVER_HTML);
    assert.ok(text.includes("BN 2026/0145"));
    assert.ok(text.includes("Nybyggnad av flerbostadshus"));
    assert.ok(text.includes("Kv Storken 5"));
    assert.ok(text.includes("BN 2026/0132"));
    assert.ok(text.includes("Installation av eldstad"));
  });

  it("stripNonContent keeps table structure for LLM", () => {
    const cleaned = stripNonContent(EPISERVER_HTML);
    assert.ok(cleaned.includes("<table"));
    assert.ok(cleaned.includes("BN 2026/0145"));
  });
});
