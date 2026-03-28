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
