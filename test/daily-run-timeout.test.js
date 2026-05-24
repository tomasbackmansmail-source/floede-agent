// Regression tests for the per-source timeout / abort mechanism in daily-run.js.
//
// The bug being guarded against: the old `Promise.race([innerWork, timeout])` let
// innerWork keep running in the background after the timeout branch won, which
// produced inserts AFTER a source was already marked failed (false positives) and
// silent, unaccounted data loss. The fix replaces the race with runWithTimeout +
// AbortController so the work actually terminates on timeout, and gates the insert
// (the only DB-mutating step) behind an abort check.
//
// Core assertion: a fetch that hangs past the timeout must NEVER reach the insert.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { processHttpSource, processBrowserSource, runWithTimeout } =
  await import("../src/daily-run.js");

const tmp = await mkdtemp(join(tmpdir(), "floede-timeout-"));
const baseConfig = { municipality: "TestMuni", listing_url: "http://example.test/listing" };
const baseDeps = { runId: "test-run", supabase: {}, client: {}, log: () => {}, htmlDir: tmp, extractedDir: tmp, updateHashFn: async () => {} };

// A fetch that never resolves on its own — it only settles when the abort signal
// fires, exactly like a real fetch given an AbortSignal. Models a hung source.
function hangingFetch() {
  return (config, signal) => new Promise((_, reject) => {
    if (signal) {
      signal.addEventListener("abort", () => reject(signal.reason ?? new Error("aborted")), { once: true });
    }
  });
}

function fastFetch(subpages) {
  return async () => ({ subpages });
}

function permitsExtract(permits) {
  return async () => ({
    permits,
    cost: { cost_usd: 0.01, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    contentHash: "hash-1",
    skipped: false,
  });
}

describe("runWithTimeout + abort (HTTP source)", () => {
  it("CORE: a fetch that hangs past the timeout aborts and NEVER inserts", async () => {
    let insertCalls = 0;
    const insertFn = async () => {
      insertCalls++;
      return { inserted: 1, skipped: 0, errors: 0, insertedIds: ["x"], aborted: false };
    };

    await assert.rejects(
      () => runWithTimeout(40, (signal) =>
        processHttpSource(baseConfig, { ...baseDeps, signal, fetchPage: hangingFetch(), insertFn })
      ),
      /timeout/i,
      "a hung source must reject with the timeout error"
    );

    assert.equal(insertCalls, 0, "insert must never run after the timeout aborts the source");
  });

  it("aborts before insert even when fetch succeeds but extract hangs", async () => {
    let insertCalls = 0;
    const extractFn = (config_, html, muni, url, cfg, { signal }) =>
      new Promise((_, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason ?? new Error("aborted")), { once: true });
      });
    const insertFn = async () => { insertCalls++; return { inserted: 1, skipped: 0, errors: 0, insertedIds: ["x"], aborted: false }; };

    await assert.rejects(
      () => runWithTimeout(40, (signal) =>
        processHttpSource(baseConfig, {
          ...baseDeps, signal,
          fetchPage: fastFetch([{ url: "http://example.test/1", content: "x".repeat(1000), isPdf: false }]),
          extractFn, insertFn,
        })
      ),
      /timeout/i
    );

    assert.equal(insertCalls, 0, "insert must never run when extract is aborted");
  });

  it("happy path under the timeout: inserts exactly once, status ok", async () => {
    let insertCalls = 0;
    const insertFn = async () => { insertCalls++; return { inserted: 2, skipped: 0, errors: 0, insertedIds: ["a", "b"], aborted: false }; };

    const res = await runWithTimeout(5000, (signal) =>
      processHttpSource(baseConfig, {
        ...baseDeps, signal,
        fetchPage: fastFetch([{ url: "http://example.test/1", content: "x".repeat(1000), isPdf: false }]),
        extractFn: permitsExtract([{ case_number: "A1" }, { case_number: "A2" }]),
        insertFn,
      })
    );

    assert.equal(insertCalls, 1);
    assert.equal(res.result.status, "ok");
    assert.equal(res.inserted, 2);
    assert.deepEqual(res.insertedIds, ["a", "b"]);
    assert.equal(res.bump, "http");
  });

  it("abort mid-insert -> source marked partial (not rolled back), keeps committed rows", async () => {
    // insertFn reports it broke out of its record loop on abort (aborted:true) after
    // committing one row. The source must be recorded as partial, the inserted row
    // kept — idempotent upsert/dedup completes the rest on the next run.
    const insertFn = async () => ({ inserted: 1, skipped: 0, errors: 0, insertedIds: ["a"], aborted: true });

    const res = await runWithTimeout(5000, (signal) =>
      processHttpSource(baseConfig, {
        ...baseDeps, signal,
        fetchPage: fastFetch([{ url: "http://example.test/1", content: "x".repeat(1000), isPdf: false }]),
        extractFn: permitsExtract([{ case_number: "A1" }, { case_number: "A2" }]),
        insertFn,
      })
    );

    assert.equal(res.result.status, "partial");
    assert.equal(res.result.aborted, true);
    assert.equal(res.inserted, 1, "the row that did commit is kept, not rolled back");
    assert.deepEqual(res.insertedIds, ["a"]);
  });
});

describe("runWithTimeout + abort (browser source)", () => {
  it("CORE: a hung browser fetch aborts and NEVER inserts", async () => {
    let insertCalls = 0;
    const insertFn = async () => { insertCalls++; return { inserted: 1, skipped: 0, errors: 0, insertedIds: ["x"], aborted: false }; };
    // browser fetchPage signature is (page, config, signal, log)
    const hangingBrowserFetch = (page, config, signal) => new Promise((_, reject) => {
      signal?.addEventListener("abort", () => reject(signal.reason ?? new Error("aborted")), { once: true });
    });

    await assert.rejects(
      () => runWithTimeout(40, (signal) =>
        processBrowserSource(baseConfig, /* page */ {}, { ...baseDeps, signal, fetchPage: hangingBrowserFetch, insertFn })
      ),
      /timeout/i
    );

    assert.equal(insertCalls, 0, "insert must never run after the browser source times out");
  });
});
