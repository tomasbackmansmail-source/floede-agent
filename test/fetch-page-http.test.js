// Tests for fetchPageHttp subpage-return format.
// Uses Node.js built-in test runner. Mocks globalThis.fetch.

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";

const { fetchPageHttp } = await import("../src/daily-run.js");

const originalFetch = globalThis.fetch;

function mockFetch(responses) {
  globalThis.fetch = async (url) => {
    const u = typeof url === "string" ? url : url.toString();
    const r = responses.get(u);
    if (!r) throw new Error(`Mock fetch: no response configured for ${u}`);
    return {
      ok: r.status >= 200 && r.status < 400,
      status: r.status,
      statusText: "OK",
      headers: {
        get: (name) =>
          name.toLowerCase() === "content-type"
            ? r.contentType || "text/html; charset=utf-8"
            : null,
      },
      text: async () =>
        Buffer.isBuffer(r.body) ? r.body.toString("utf-8") : r.body,
      arrayBuffer: async () => {
        if (Buffer.isBuffer(r.body)) {
          return r.body.buffer.slice(
            r.body.byteOffset,
            r.body.byteOffset + r.body.byteLength
          );
        }
        return new TextEncoder().encode(r.body).buffer;
      },
    };
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("fetchPageHttp subpage-format", () => {
  it("utan requires_subpages returnerar exakt 1 element med listing_url", async () => {
    const listing = "https://example.test/nyheter";
    mockFetch(
      new Map([
        [
          listing,
          {
            status: 200,
            body: "<html><body><h1>Nyheter</h1><p>Innehall</p></body></html>",
          },
        ],
      ])
    );

    const result = await fetchPageHttp({ listing_url: listing });

    assert.ok(Array.isArray(result.subpages));
    assert.equal(result.subpages.length, 1);
    assert.equal(result.subpages[0].url, listing);
    assert.equal(result.subpages[0].isPdf, false);
    assert.equal(typeof result.subpages[0].content, "string");
  });

  it("med requires_subpages och 3 framgangsrika subpages returnerar 3 element med korrekt url", async () => {
    const listing = "https://example.test/bygglov";
    const sub1 = "https://example.test/bygglov/a";
    const sub2 = "https://example.test/bygglov/b";
    const sub3 = "https://example.test/bygglov/c";

    const listingHtml = `<html><body>
      <a href="${sub1}">Bygglov A</a>
      <a href="${sub2}">Bygglov B</a>
      <a href="${sub3}">Bygglov C</a>
    </body></html>`;

    mockFetch(
      new Map([
        [listing, { status: 200, body: listingHtml }],
        [sub1, { status: 200, body: "<html><body>Bygglov innehall A</body></html>" }],
        [sub2, { status: 200, body: "<html><body>Bygglov innehall B</body></html>" }],
        [sub3, { status: 200, body: "<html><body>Bygglov innehall C</body></html>" }],
      ])
    );

    const result = await fetchPageHttp({
      listing_url: listing,
      requires_subpages: {
        required: true,
        max_subpages: 10,
        link_selector_hint: "a[href*='bygglov']",
      },
    });

    assert.equal(result.subpages.length, 3);
    const urls = result.subpages.map((s) => s.url).sort();
    assert.deepEqual(urls, [sub1, sub2, sub3].sort());
    for (const s of result.subpages) {
      assert.equal(s.isPdf, false);
      assert.equal(typeof s.content, "string");
      assert.ok(s.content.length > 0);
    }
  });

  it("med requires_subpages men 0 matchande keyword-lankar faller tillbaka till listing_url", async () => {
    const listing = "https://example.test/startsida";
    const listingHtml = `<html><body>
      <a href="https://example.test/om-oss">Om oss</a>
      <a href="https://example.test/kontakt">Kontakt</a>
    </body></html>`;

    mockFetch(new Map([[listing, { status: 200, body: listingHtml }]]));

    const result = await fetchPageHttp({
      listing_url: listing,
      requires_subpages: { required: true, max_subpages: 10 },
    });

    assert.equal(result.subpages.length, 1);
    assert.equal(result.subpages[0].url, listing);
    assert.equal(result.subpages[0].isPdf, false);
  });

  it("PDF-fallet returnerar 1 element med isPdf:true och Buffer-content", async () => {
    const listing = "https://example.test/rapport.pdf";
    const pdfBytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

    mockFetch(
      new Map([
        [
          listing,
          { status: 200, body: pdfBytes, contentType: "application/pdf" },
        ],
      ])
    );

    const result = await fetchPageHttp({ listing_url: listing });

    assert.equal(result.subpages.length, 1);
    assert.equal(result.subpages[0].url, listing);
    assert.equal(result.subpages[0].isPdf, true);
    assert.ok(Buffer.isBuffer(result.subpages[0].content));
    assert.equal(result.subpages[0].content.length, pdfBytes.length);
  });
});
