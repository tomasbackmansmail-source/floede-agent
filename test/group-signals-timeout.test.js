// Regression tests for the per-call Haiku timeout in group-signals.js Step 2.
//
// The bug being guarded against: askHaikuForMatch did a raw fetch to the Anthropic
// API with NO timeout and NO try/catch around the per-signal loop body. A single
// hung Haiku request blocked the loop until execSync's 300s wall-clock killed the
// whole grouping run (observed: ETIMEDOUT). The fix adds AbortSignal.timeout on the
// fetch (so the call throws on timeout) and a narrow try/catch around the call so
// the offending signal is left UNGROUPED (project_id untouched) and the loop
// continues to the next signal.
//
// Core assertion: a Haiku call that fails (timeout) must NEVER write a project_id
// for that signal, and must not stop the loop — the next signal still gets matched.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

// Module reads CI_SUPABASE_SERVICE_KEY at import (process.exit(1) if missing) and
// captures ANTHROPIC_API_KEY into a const — both must be set BEFORE the import.
process.env.CI_SUPABASE_SERVICE_KEY = "test-key";
process.env.ANTHROPIC_API_KEY = "test-anthropic-key";

const { main } = await import("../src/group-signals.js");

// Two ungrouped TED signals for the same org, plus one existing project for that
// org. Signal A's Haiku call times out (throws); Signal B's resolves to project P.
const SIGNALS = [
  { id: "sig-a", title: "Signal A om upphandling", description: "x", source_type: "ted", organization_id: "org-x", organization_name: "OrgX" },
  { id: "sig-b", title: "Signal B om upphandling", description: "y", source_type: "ted", organization_id: "org-x", organization_name: "OrgX" },
];
const PROJECTS = [
  { id: "proj-p", title: "Projekt P", property_designation: null, organization_id: "org-x" },
];

function jsonResponse(data) {
  return new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
}

// Routes group-signals' fetches by URL. Records the Anthropic calls (with their
// options.signal) and the ci_signals PATCH calls (updateSignalProject).
function makeScenario() {
  const anthropicCalls = [];
  const patchCalls = [];
  const postProjectCalls = [];

  const fetchMock = async (url, options = {}) => {
    const u = String(url);

    if (u.includes("api.anthropic.com")) {
      anthropicCalls.push({ signal: options.signal, body: options.body });
      const content = JSON.parse(options.body).messages[0].content;
      if (content.includes("Signal A")) {
        // Simulate AbortSignal.timeout having fired — fetch rejects with a
        // TimeoutError, exactly as the native timeout would. No 30s wait needed.
        return Promise.reject(Object.assign(new Error("The operation timed out"), { name: "TimeoutError" }));
      }
      // Signal B → return project P's id so it gets grouped.
      return jsonResponse({ content: [{ text: "proj-p" }], usage: { input_tokens: 10, output_tokens: 1 } });
    }

    if (u.includes("/rest/v1/ci_signals") && options.method === "PATCH") {
      const m = u.match(/id=eq\.([^&]+)/);
      patchCalls.push({ id: m && m[1], body: options.body });
      return new Response(null, { status: 204 });
    }
    if (u.includes("/rest/v1/ci_signals")) return jsonResponse(SIGNALS); // GET ungrouped

    if (u.includes("/rest/v1/ci_projects") && options.method === "POST") {
      postProjectCalls.push(options.body);
      return jsonResponse([{ id: "created-1", ...JSON.parse(options.body) }]);
    }
    if (u.includes("/rest/v1/ci_projects")) return jsonResponse(PROJECTS); // GET existing

    throw new Error("unexpected fetch in test: " + u);
  };

  return { anthropicCalls, patchCalls, postProjectCalls, fetchMock };
}

describe("group-signals per-call Haiku timeout (Step 2)", () => {
  let scenario;

  before(async () => {
    scenario = makeScenario();
    const origFetch = global.fetch;
    const origLog = console.log;
    const origWarn = console.warn;
    global.fetch = scenario.fetchMock;
    console.log = () => {};
    console.warn = () => {};
    try {
      await main();
    } finally {
      global.fetch = origFetch;
      console.log = origLog;
      console.warn = origWarn;
    }
  });

  it("CORE: a timed-out Haiku signal is skipped — no project_id is written for it", () => {
    const patchedIds = scenario.patchCalls.map((c) => c.id);
    assert.ok(!patchedIds.includes("sig-a"), "the timed-out signal must NOT get a project_id PATCH");
    assert.equal(scenario.postProjectCalls.length, 0, "the timed-out signal must NOT spawn a new project either");
  });

  it("the loop continues: the next signal is still matched after the timeout", () => {
    assert.equal(scenario.anthropicCalls.length, 2, "both signals must reach Haiku — the loop did not stop on the timeout");
    const patchedIds = scenario.patchCalls.map((c) => c.id);
    assert.ok(patchedIds.includes("sig-b"), "the signal after the timed-out one must still be grouped");
  });

  it("the Haiku fetch carries an AbortSignal (per-call timeout wiring)", () => {
    for (const call of scenario.anthropicCalls) {
      assert.ok(call.signal instanceof AbortSignal, "every Haiku fetch must pass an AbortSignal (AbortSignal.timeout)");
    }
  });
});
