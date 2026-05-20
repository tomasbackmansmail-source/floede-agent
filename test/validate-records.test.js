import { test } from "node:test";
import assert from "node:assert/strict";
import { validateRecords } from "../src/qc.js";

const VALIDATION = {
  required_fields: ["title", "description", "maturity", "region"],
  allowed_values: { maturity: ["rumor", "planned", "tender", "awarded"] },
  numeric_ranges: { amount_sek: { min: 1000000, max: 50000000000 } },
  skip_required_for_source_type: { financial_report: ["maturity"] }
};

test("flags missing maturity on regular pressroom signal", () => {
  const issues = validateRecords([
    { title: "T", description: "D", region: "Stockholm", source_type: "pressroom" }
  ], VALIDATION);
  assert.equal(issues.length, 1);
  assert.ok(issues[0].issues.some(s => s.includes("maturity")));
});

test("does NOT flag missing maturity on financial_report signal", () => {
  const issues = validateRecords([
    { title: "Bokslutskommuniké 2025", description: "Vasakronans bokslut", region: "Nationellt", source_type: "financial_report" }
  ], VALIDATION);
  assert.equal(issues.length, 0);
});

test("still flags missing title even on financial_report", () => {
  const issues = validateRecords([
    { description: "Bokslut", region: "Nationellt", source_type: "financial_report" }
  ], VALIDATION);
  assert.equal(issues.length, 1);
  assert.ok(issues[0].issues.some(s => s.includes("title")));
});

test("financial_report with null maturity does not trigger invalid maturity check", () => {
  const issues = validateRecords([
    { title: "T", description: "D", region: "Nationellt", maturity: null, source_type: "financial_report" }
  ], VALIDATION);
  assert.equal(issues.length, 0);
});

test("invalid maturity is still caught on regular pressroom", () => {
  const issues = validateRecords([
    { title: "T", description: "D", region: "Stockholm", maturity: "completed", source_type: "pressroom" }
  ], VALIDATION);
  assert.ok(issues[0].issues.some(s => s.includes("invalid maturity")));
});

test("validateRecords returns empty when no validation config", () => {
  const issues = validateRecords([{ title: "T" }], null);
  assert.deepEqual(issues, []);
});
