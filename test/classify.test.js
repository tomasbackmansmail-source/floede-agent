import { test } from "node:test";
import assert from "node:assert/strict";
import { classifySignal } from "../src/utils/classify.js";

const FINANCIAL_RULES = [
  {
    match_field: "title",
    set_source_type: "financial_report",
    kinds: [
      ["bokslutskommunike", "(?<![a-zåäö])bokslutskommunik[eé](?![a-zåäö])"],
      ["ars_och_hallbarhetsredovisning", "(?<![a-zåäö])(?:års|ars)-?\\s*och\\s*h[åa]llbarhetsredovisning(?![a-zåäö])"],
      ["arsredovisning", "(?<![a-zåäö])(?:års|ars)redovisning(?![a-zåäö])"],
      ["delarsrapport", "(?<![a-zåäö])del[åa]rsrapport(?![a-zåäö])"],
      ["kvartalsrapport", "(?<![a-zåäö])kvartalsrapport(?![a-zåäö])"],
      ["Q1-rapport", "(?<![a-zåäö])Q1[-\\s]*rapport(?![a-zåäö])"],
      ["Q2-rapport", "(?<![a-zåäö])Q2[-\\s]*rapport(?![a-zåäö])"],
      ["Q3-rapport", "(?<![a-zåäö])Q3[-\\s]*rapport(?![a-zåäö])"],
      ["Q4-rapport", "(?<![a-zåäö])Q4[-\\s]*rapport(?![a-zåäö])"],
      ["verksamhetsberattelse", "(?<![a-zåäö])verksamhetsber[aä]ttelse(?![a-zåäö])"],
      ["hallbarhetsredovisning", "(?<![a-zåäö])h[åa]llbarhetsredovisning(?![a-zåäö])"],
      ["bokslut", "(?<![a-zåäö])bokslut(?![a-zåäö])"]
    ]
  }
];

function classify(title) {
  const s = { title, source_type: "pressroom" };
  classifySignal(s, FINANCIAL_RULES);
  return s;
}

test("klassificerar bokslutskommuniké", () => {
  const s = classify("Bokslutskommuniké 2025");
  assert.equal(s.source_type, "financial_report");
  assert.equal(s.document_kind, "bokslutskommunike");
});

test("klassificerar bokslut utan att fångas av bokslutskommuniké-regeln", () => {
  const s = classify("Bokslut 2024");
  assert.equal(s.source_type, "financial_report");
  assert.equal(s.document_kind, "bokslut");
});

test("klassificerar årsredovisning", () => {
  const s = classify("Vasakronan årsredovisning 2025");
  assert.equal(s.source_type, "financial_report");
  assert.equal(s.document_kind, "arsredovisning");
});

test("klassificerar arsredovisning utan diakritik", () => {
  const s = classify("Akademiska Hus arsredovisning 2024");
  assert.equal(s.document_kind, "arsredovisning");
});

test("klassificerar års- och hållbarhetsredovisning som kombinerat kind", () => {
  const s = classify("Hållbara kunskapsmiljöer års- och hållbarhetsredovisning 2025");
  assert.equal(s.document_kind, "ars_och_hallbarhetsredovisning");
});

test("klassificerar delårsrapport", () => {
  const s = classify("Delårsrapport januari–mars 2026");
  assert.equal(s.source_type, "financial_report");
  assert.equal(s.document_kind, "delarsrapport");
});

test("klassificerar Q1-rapport", () => {
  const s = classify("Akademiska Hus Q1-rapport 2025");
  assert.equal(s.document_kind, "Q1-rapport");
});

test("klassificerar verksamhetsberättelse", () => {
  const s = classify("Verksamhetsberättelse 2025 för Fastighetsnämnden");
  assert.equal(s.document_kind, "verksamhetsberattelse");
});

test("klassificerar hållbarhetsredovisning", () => {
  const s = classify("Hållbarhetsredovisning 2025");
  assert.equal(s.document_kind, "hallbarhetsredovisning");
});

test("klassificerar inte vanlig pressrelease", () => {
  const s = classify("Vasakronan startar nytt kontorshus i Solna");
  assert.equal(s.source_type, "pressroom");
  assert.equal(s.document_kind, undefined);
});

test("klassificerar inte projekt-titel som råkar innehålla 'bokslut' inom annat ord", () => {
  const s = classify("Bokslutsanalys av byggprojekt");
  assert.equal(s.source_type, "pressroom");
});

test("ignorerar signal utan title", () => {
  const s = { source_type: "pressroom" };
  classifySignal(s, FINANCIAL_RULES);
  assert.equal(s.source_type, "pressroom");
  assert.equal(s.document_kind, undefined);
});

test("ignorerar tom rules-lista", () => {
  const s = { title: "Bokslutskommuniké 2025", source_type: "pressroom" };
  classifySignal(s, []);
  assert.equal(s.source_type, "pressroom");
});

test("ignorerar undefined rules", () => {
  const s = { title: "Bokslutskommuniké 2025", source_type: "pressroom" };
  classifySignal(s, undefined);
  assert.equal(s.source_type, "pressroom");
});

test("ignorerar ogiltig regex utan att krascha", () => {
  const s = { title: "Bokslutskommuniké 2025", source_type: "pressroom" };
  classifySignal(s, [{
    match_field: "title",
    set_source_type: "financial_report",
    kinds: [["broken", "([unclosed"]]
  }]);
  assert.equal(s.source_type, "pressroom");
});
