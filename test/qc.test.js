// Tests for QC feedback loop functions.
// Only unit tests — no network calls.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";

import { triggerRediscovery, checkZeroStreak } from "../src/qc.js";
import { normalizeToAscii } from "../src/utils/normalize.js";

// ═══════════════════════════════════════════════
// triggerRediscovery — parameter validation
// ═══════════════════════════════════════════════

describe("triggerRediscovery", () => {
  it("returns success: false with missing municipalityName", async () => {
    const result = await triggerRediscovery(null, "https://x.se", "https://x.se", {});
    assert.strictEqual(result.success, false);
    assert.ok(result.error);
  });

  it("returns success: false with missing supabase", async () => {
    const result = await triggerRediscovery("TestKommun", "https://x.se", "https://x.se", null);
    assert.strictEqual(result.success, false);
    assert.ok(result.error);
  });

  it("returns cost_usd 0 on parameter error", async () => {
    const result = await triggerRediscovery(null, null, null, null);
    assert.strictEqual(result.cost_usd, 0);
  });
});

// ═══════════════════════════════════════════════
// shouldApprove logic — needs_browser alone is NOT enough
// ═══════════════════════════════════════════════

describe("shouldApprove logic", () => {
  // This mirrors the logic in triggerRediscovery (qc.js)
  function shouldApprove(verifyResult) {
    return verifyResult.verified && verifyResult.result_count > 0;
  }

  it("approves when verified=true and result_count > 0", () => {
    assert.strictEqual(shouldApprove({ verified: true, result_count: 5, needs_browser: false }), true);
  });

  it("rejects when needs_browser=true but result_count=0", () => {
    assert.strictEqual(shouldApprove({ verified: false, result_count: 0, needs_browser: true }), false);
  });

  it("rejects when verified=false even with result_count > 0", () => {
    assert.strictEqual(shouldApprove({ verified: false, result_count: 3, needs_browser: false }), false);
  });

  it("rejects when verified=true but result_count=0", () => {
    assert.strictEqual(shouldApprove({ verified: true, result_count: 0, needs_browser: false }), false);
  });
});

// ═══════════════════════════════════════════════
// checkZeroStreak — counts days-without-data, not just zero-rows
// ═══════════════════════════════════════════════

describe("checkZeroStreak", () => {
  it("returns empty array on DB error", async () => {
    const fakeSupabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            gte: () => ({
              order: () => ({
                order: () => ({ data: null, error: { message: "test" } })
              })
            })
          })
        })
      })
    };
    const result = await checkZeroStreak(fakeSupabase);
    assert.deepStrictEqual(result, []);
  });
});

// ═══════════════════════════════════════════════
// homepageMap ÅÄÖ lookup — matches normalized municipality names
// ═══════════════════════════════════════════════

describe("homepageMap ÅÄÖ lookup", () => {
  // Simulates the homepageMap construction from qc.js
  function buildHomepageMap(muniRows, sourceIdField, sourceUrlField) {
    return Object.fromEntries(
      muniRows.flatMap(r => {
        const name = r[sourceIdField];
        const url = r[sourceUrlField];
        const ascii = normalizeToAscii(name)
          .replace(/\s*kommun$/i, '').replace(/\s*stad$/i, '');
        return [[name, url], [ascii, url], [name.normalize('NFC').toLowerCase(), url]];
      })
    );
  }

  // Simulates the lookup logic from qc.js re-discovery section
  function lookupHomepage(homepageMap, municipality) {
    return homepageMap[municipality]
      || homepageMap[normalizeToAscii(municipality)]
      || homepageMap[municipality.normalize('NFC').toLowerCase()]
      || null;
  }

  const muniRows = [
    { name: "Ängelholm", homepage: "https://www.engelholm.se" },
    { name: "Österåker", homepage: "https://www.osteraker.se" },
    { name: "Västerås", homepage: "https://www.vasteras.se" },
  ];
  const homepageMap = buildHomepageMap(muniRows, "name", "homepage");

  it("finds Ängelholm by exact name", () => {
    assert.strictEqual(lookupHomepage(homepageMap, "Ängelholm"), "https://www.engelholm.se");
  });

  it("finds Ängelholm by ascii-normalized name", () => {
    assert.strictEqual(lookupHomepage(homepageMap, "Angelholm"), "https://www.engelholm.se");
  });

  it("finds Österåker by lowercase NFC", () => {
    assert.strictEqual(lookupHomepage(homepageMap, "österåker"), "https://www.osteraker.se");
  });

  it("finds Västerås by ascii fallback", () => {
    assert.strictEqual(lookupHomepage(homepageMap, "Vasteras"), "https://www.vasteras.se");
  });

  it("returns null for unknown municipality", () => {
    assert.strictEqual(lookupHomepage(homepageMap, "Narnia"), null);
  });
});

// ═══════════════════════════════════════════════
// feedback config — reads correctly from vertical config
// ═══════════════════════════════════════════════

describe("feedback config", () => {
  const verticalConfig = JSON.parse(readFileSync(new URL("../src/config/verticals/byggsignal.json", import.meta.url), "utf-8"));

  it("zero_streak_threshold is defined and is a number", () => {
    assert.ok(verticalConfig.feedback);
    assert.strictEqual(typeof verticalConfig.feedback.zero_streak_threshold, "number");
    assert.strictEqual(verticalConfig.feedback.zero_streak_threshold, 3);
  });

  it("max_rediscoveries_per_run is defined", () => {
    assert.strictEqual(verticalConfig.feedback.max_rediscoveries_per_run, 50);
  });

  it("max_cost_per_run_usd is defined", () => {
    assert.strictEqual(verticalConfig.feedback.max_cost_per_run_usd, 2.0);
  });
});
