import { test } from "node:test";
import assert from "node:assert/strict";
import { findReportDuplicate, isReportDedupConfig } from "../src/utils/report-dedup.js";

const CONFIG = {
  applies_to_source_type: "financial_report",
  match_fields: ["organization_id", "source_date"],
  kind_field: "document_kind",
};

function mockSupabase(rows, capturedFilters = []) {
  const builder = {
    from(t) { capturedFilters.push(["from", t]); return this; },
    select(c) { capturedFilters.push(["select", c]); return this; },
    eq(c, v) { capturedFilters.push(["eq", c, v]); return this; },
    then(onResolve) {
      onResolve({ data: rows, error: null });
      return Promise.resolve({ data: rows, error: null });
    },
  };
  return builder;
}

test("isReportDedupConfig validates required fields", () => {
  assert.equal(isReportDedupConfig(CONFIG), true);
  assert.equal(isReportDedupConfig(null), false);
  assert.equal(isReportDedupConfig({ ...CONFIG, match_fields: [] }), false);
  assert.equal(isReportDedupConfig({ ...CONFIG, kind_field: undefined }), false);
});

test("returns null when no kind", async () => {
  const sb = mockSupabase([{ id: "X", structured_meta: { document_kind: "bokslut" } }]);
  const result = await findReportDuplicate(sb, "ci_signals",
    { organization_id: "ORG", source_date: "2026-02-06" }, null, CONFIG);
  assert.equal(result, null);
});

test("returns null when match_field missing", async () => {
  const sb = mockSupabase([{ id: "X", structured_meta: { document_kind: "bokslut" } }]);
  const result = await findReportDuplicate(sb, "ci_signals",
    { organization_id: "ORG", source_date: null }, "bokslut", CONFIG);
  assert.equal(result, null);
});

test("returns id when (org, date, kind) match", async () => {
  const filters = [];
  const sb = mockSupabase([
    { id: "ROW-A", structured_meta: { document_kind: "delarsrapport" }, title: "Delårsrapport" },
    { id: "ROW-B", structured_meta: { document_kind: "bokslut" }, title: "Bokslut" },
  ], filters);
  const result = await findReportDuplicate(sb, "ci_signals",
    { organization_id: "ORG-A", source_date: "2026-02-06" }, "bokslut", CONFIG);
  assert.equal(result, "ROW-B");
  assert.deepEqual(filters.find(f => f[0] === "eq" && f[1] === "source_type"),
    ["eq", "source_type", "financial_report"]);
  assert.deepEqual(filters.find(f => f[0] === "eq" && f[1] === "organization_id"),
    ["eq", "organization_id", "ORG-A"]);
  assert.deepEqual(filters.find(f => f[0] === "eq" && f[1] === "source_date"),
    ["eq", "source_date", "2026-02-06"]);
});

test("returns null when org+date match but kind differs", async () => {
  const sb = mockSupabase([
    { id: "ROW-A", structured_meta: { document_kind: "delarsrapport" }, title: "Q1" },
  ]);
  const result = await findReportDuplicate(sb, "ci_signals",
    { organization_id: "ORG", source_date: "2026-02-06" }, "bokslut", CONFIG);
  assert.equal(result, null);
});

test("returns null when row has no structured_meta", async () => {
  const sb = mockSupabase([
    { id: "ROW-A", structured_meta: null, title: "Untagged" },
  ]);
  const result = await findReportDuplicate(sb, "ci_signals",
    { organization_id: "ORG", source_date: "2026-02-06" }, "bokslut", CONFIG);
  assert.equal(result, null);
});

test("respects custom kind_column override", async () => {
  const filters = [];
  const sb = mockSupabase([{ id: "X", meta: { document_kind: "bokslut" } }], filters);
  const result = await findReportDuplicate(sb, "ci_signals",
    { organization_id: "ORG", source_date: "2026-02-06" }, "bokslut",
    { ...CONFIG, kind_column: "meta" });
  assert.equal(result, "X");
  assert.deepEqual(filters.find(f => f[0] === "select"), ["select", "id, meta, title"]);
});
