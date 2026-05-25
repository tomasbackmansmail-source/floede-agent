// Tests for honest permits_inserted sourcing: qc.js reads daily-run's run log to map
// source -> inserted count. Core distinctions guarded here:
//   - "ran, inserted 0" (known 0) vs "did not run / unknown" (absent from map -> caller
//     writes NULL). These must never be merged.
//   - escalated(http)->ok(browser) and --source re-runs resolve to the real count (last-wins).
//   - stale run logs (run_at != today) never contribute.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { loadInsertedBySlug } = await import("../src/qc.js");

const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

function writeRunLog(dir, filename, runAtDate, results) {
  return writeFile(
    join(dir, filename),
    JSON.stringify({ run_id: filename, run_at: `${runAtDate}T04:00:00.000Z`, results })
  );
}

async function tmp() {
  return mkdtemp(join(tmpdir(), "qc-runlog-"));
}

describe("loadInsertedBySlug", () => {
  it("maps slug -> inserted for ok/partial/adapter results; ran-0 is a known 0", async () => {
    const dir = await tmp();
    await writeRunLog(dir, "run_2026-05-25T04-00-00.json", today, [
      { municipality: "Statens fastighetsverk", status: "ok", inserted: 5 },
      { municipality: "Alingsås", status: "partial", inserted: 2 },
      { municipality: "Aneby", status: "ok", fetch_mode: "ciceron", inserted: 0 }, // ran, inserted nothing
      { municipality: "Borås", status: "error" },                  // no inserted -> unknown
      { municipality: "Gävle", status: "unchanged", permits: 0 },  // no inserted -> unknown
    ]);

    const map = await loadInsertedBySlug(dir);

    assert.equal(map["statens-fastighetsverk"], 5);
    assert.equal(map["alingsas"], 2);
    assert.equal(map["aneby"], 0, "ran-but-inserted-0 must be recorded as a known 0");
    assert.ok(!("boras" in map), "errored source must stay unknown (-> NULL), never 0");
    assert.ok(!("gavle" in map), "unchanged source must stay unknown (-> NULL), never 0");

    await rm(dir, { recursive: true, force: true });
  });

  it("last-wins: browser ok overrides earlier http-escalated (no inserted) for same source", async () => {
    const dir = await tmp();
    await writeRunLog(dir, "run_2026-05-25T04-00-00.json", today, [
      { municipality: "Nacka", status: "escalated", fetch_mode: "http" }, // no inserted
      { municipality: "Nacka", status: "ok", fetch_mode: "browser", inserted: 7 },
    ]);

    const map = await loadInsertedBySlug(dir);
    assert.equal(map["nacka"], 7);
    await rm(dir, { recursive: true, force: true });
  });

  it("later run log overrides earlier for same source (--source re-run same day)", async () => {
    const dir = await tmp();
    await writeRunLog(dir, "run_2026-05-25T04-00-00.json", today, [
      { municipality: "Lund", status: "ok", inserted: 3 },
    ]);
    await writeRunLog(dir, "run_2026-05-25T09-00-00.json", today, [
      { municipality: "Lund", status: "ok", inserted: 9 },
    ]);

    const map = await loadInsertedBySlug(dir);
    assert.equal(map["lund"], 9);
    await rm(dir, { recursive: true, force: true });
  });

  it("ignores stale run logs (run_at not today) so they never write old counts", async () => {
    const dir = await tmp();
    await writeRunLog(dir, "run_old.json", yesterday, [
      { municipality: "Umeå", status: "ok", inserted: 4 },
    ]);

    const map = await loadInsertedBySlug(dir);
    assert.ok(!("umea" in map), "stale run log must not contribute");
    await rm(dir, { recursive: true, force: true });
  });

  it("returns {} when the run-log dir is missing", async () => {
    const map = await loadInsertedBySlug(join(tmpdir(), "qc-runlog-missing-" + Date.now()));
    assert.deepEqual(map, {});
  });
});
