import { test } from "node:test";
import assert from "node:assert/strict";
import { findParentSignalId, findOrphanChildIds, isParentLinkConfig } from "../src/utils/parent-link.js";

const CONFIG = {
  child_source_type: "annual_report",
  parent_source_type: "financial_report",
  match_field: "organization_id",
  date_field: "source_date",
  window_days: 7,
};

// Minimal mock of the Supabase query builder. Records all filter calls
// and returns a fixed result set.
function mockSupabase(rows, capturedFilters = []) {
  const builder = {
    from(table) { capturedFilters.push(["from", table]); return this; },
    select(cols) { capturedFilters.push(["select", cols]); return this; },
    eq(col, val) { capturedFilters.push(["eq", col, val]); return this; },
    gte(col, val) { capturedFilters.push(["gte", col, val]); return this; },
    lte(col, val) { capturedFilters.push(["lte", col, val]); return this; },
    is(col, val) { capturedFilters.push(["is", col, val]); return this; },
    then(onResolve) { onResolve({ data: rows, error: null }); return Promise.resolve({ data: rows, error: null }); },
  };
  return builder;
}

test("isParentLinkConfig validates required fields", () => {
  assert.equal(isParentLinkConfig(CONFIG), true);
  assert.equal(isParentLinkConfig(null), false);
  assert.equal(isParentLinkConfig({ ...CONFIG, window_days: "seven" }), false);
  assert.equal(isParentLinkConfig({ ...CONFIG, parent_source_type: undefined }), false);
});

test("findParentSignalId returns null when no parent_link config", async () => {
  const sb = mockSupabase([]);
  const result = await findParentSignalId(sb, "ci_signals", { source_type: "annual_report" }, null);
  assert.equal(result, null);
});

test("findParentSignalId returns null when record source_type does not match child_source_type", async () => {
  const sb = mockSupabase([{ id: "P1", source_date: "2026-02-06" }]);
  const result = await findParentSignalId(sb, "ci_signals",
    { source_type: "pressroom", organization_id: "ORG", source_date: "2026-02-06" },
    CONFIG
  );
  assert.equal(result, null);
});

test("findParentSignalId returns null when match_field is missing", async () => {
  const sb = mockSupabase([{ id: "P1", source_date: "2026-02-06" }]);
  const result = await findParentSignalId(sb, "ci_signals",
    { source_type: "annual_report", organization_id: null, source_date: "2026-02-06" },
    CONFIG
  );
  assert.equal(result, null);
});

test("findParentSignalId returns parent id and queries with correct date range", async () => {
  const filters = [];
  const sb = mockSupabase([{ id: "PARENT-1", source_date: "2026-02-06" }], filters);
  const result = await findParentSignalId(sb, "ci_signals",
    { source_type: "annual_report", organization_id: "ORG-A", source_date: "2026-02-06" },
    CONFIG
  );
  assert.equal(result, "PARENT-1");
  // ±7 days around 2026-02-06
  assert.deepEqual(filters.find(f => f[0] === "gte"), ["gte", "source_date", "2026-01-30"]);
  assert.deepEqual(filters.find(f => f[0] === "lte"), ["lte", "source_date", "2026-02-13"]);
  assert.deepEqual(filters.find(f => f[0] === "eq" && f[1] === "source_type"), ["eq", "source_type", "financial_report"]);
  assert.deepEqual(filters.find(f => f[0] === "eq" && f[1] === "organization_id"), ["eq", "organization_id", "ORG-A"]);
});

test("findParentSignalId picks closest in time when multiple candidates", async () => {
  const sb = mockSupabase([
    { id: "P-FAR", source_date: "2026-02-12" }, // 6 days after
    { id: "P-NEAR", source_date: "2026-02-07" }, // 1 day after
    { id: "P-MED", source_date: "2026-02-02" }, // 4 days before
  ]);
  const result = await findParentSignalId(sb, "ci_signals",
    { source_type: "annual_report", organization_id: "ORG", source_date: "2026-02-06" },
    CONFIG
  );
  assert.equal(result, "P-NEAR");
});

test("findOrphanChildIds returns empty when parent source_type does not match", async () => {
  const sb = mockSupabase([{ id: "C-1" }]);
  const result = await findOrphanChildIds(sb, "ci_signals",
    { source_type: "pressroom", organization_id: "ORG", source_date: "2026-02-06" },
    "PARENT-ID", CONFIG
  );
  assert.deepEqual(result, []);
});

test("findOrphanChildIds returns ids and filters on NULL parent_signal_id", async () => {
  const filters = [];
  const sb = mockSupabase([{ id: "C-1" }, { id: "C-2" }, { id: "C-3" }], filters);
  const result = await findOrphanChildIds(sb, "ci_signals",
    { source_type: "financial_report", organization_id: "ORG-A", source_date: "2026-02-06" },
    "PARENT-NEW", CONFIG
  );
  assert.deepEqual(result, ["C-1", "C-2", "C-3"]);
  assert.deepEqual(filters.find(f => f[0] === "is"), ["is", "parent_signal_id", null]);
  assert.deepEqual(filters.find(f => f[0] === "eq" && f[1] === "source_type"), ["eq", "source_type", "annual_report"]);
});

test("findOrphanChildIds respects custom parent_id_column override", async () => {
  const filters = [];
  const sb = mockSupabase([], filters);
  await findOrphanChildIds(sb, "ci_signals",
    { source_type: "financial_report", organization_id: "ORG", source_date: "2026-02-06" },
    "PARENT", { ...CONFIG, parent_id_column: "report_id" }
  );
  assert.deepEqual(filters.find(f => f[0] === "is"), ["is", "report_id", null]);
});

test("findParentSignalId returns null on invalid source_date", async () => {
  const sb = mockSupabase([{ id: "P", source_date: "2026-02-06" }]);
  const result = await findParentSignalId(sb, "ci_signals",
    { source_type: "annual_report", organization_id: "ORG", source_date: "not-a-date" },
    CONFIG
  );
  assert.equal(result, null);
});
