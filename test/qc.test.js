// Tests for QC feedback loop functions.
// Only unit tests — no network calls.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";

import { triggerRediscovery } from "../src/qc.js";

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
