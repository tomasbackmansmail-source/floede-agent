// Tester för group-signals prestanda-/idempotens-ombyggnaden:
//   (a) seriell inom org — två "new"-signaler med samma titel ger EN projekt-
//       skapelse (den andra återanvänder via orphan-lookupen)
//   (b) claim-guard — varje PATCH bär &project_id=is.null i URL:en
//   (c) soft budget — överskriden deadline startar inga nya signaler; inga
//       skrivningar görs, allt skjuts till nästa körning
//   (d) NULL-org-signaler skippas (varken Haiku, projekt eller PATCH)
//   (e) orphan-återanvändning — befintligt projekt med samma org + exakt titel
//       återanvänds i stället för att dubbleras (ingen POST)
//
// Samma mock-stil som group-signals-timeout.test.js: global.fetch routas per URL.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.CI_SUPABASE_SERVICE_KEY = "test-key";
process.env.ANTHROPIC_API_KEY = "test-anthropic-key";

const { main } = await import("../src/group-signals.js");

function jsonResponse(data) {
  return new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
}

// Generisk scenario-rigg: ges signaler, projekt och en haikuAnswer-funktion.
function makeScenario({ signals, projects, haikuAnswer }) {
  const anthropicCalls = [];
  const patchCalls = [];
  const postProjectCalls = [];
  let createdSeq = 0;

  const fetchMock = async (url, options = {}) => {
    const u = String(url);

    if (u.includes("api.anthropic.com")) {
      const content = JSON.parse(options.body).messages[0].content;
      anthropicCalls.push({ content });
      const answer = haikuAnswer(content);
      return jsonResponse({ content: [{ text: answer }], usage: { input_tokens: 10, output_tokens: 1 } });
    }

    if (u.includes("/rest/v1/ci_signals") && options.method === "PATCH") {
      const m = u.match(/id=eq\.([^&]+)/);
      patchCalls.push({ id: m && m[1], url: u, body: options.body });
      return new Response(null, { status: 204 });
    }
    if (u.includes("/rest/v1/ci_signals")) return jsonResponse(signals); // GET ungrouped

    if (u.includes("/rest/v1/ci_projects") && options.method === "POST") {
      createdSeq++;
      postProjectCalls.push(options.body);
      return jsonResponse([{ id: `created-${createdSeq}`, ...JSON.parse(options.body) }]);
    }
    if (u.includes("/rest/v1/ci_projects")) return jsonResponse(projects); // GET existing

    throw new Error("unexpected fetch in test: " + u);
  };

  return { anthropicCalls, patchCalls, postProjectCalls, fetchMock };
}

async function runMain(scenario, { patchNow } = {}) {
  const origFetch = global.fetch;
  const origLog = console.log;
  const origWarn = console.warn;
  const origNow = Date.now;
  global.fetch = scenario.fetchMock;
  console.log = () => {};
  console.warn = () => {};
  if (patchNow) Date.now = patchNow(origNow);
  try {
    await main();
  } finally {
    global.fetch = origFetch;
    console.log = origLog;
    console.warn = origWarn;
    Date.now = origNow;
  }
}

describe("(a)+(e) seriell inom org + orphan-återanvändning", () => {
  it("två 'new'-signaler med samma titel ger EN projekt-skapelse; båda PATCHas till samma id", async () => {
    // Org har ETT befintligt projekt så Haiku faktiskt frågas (annars genvägen
    // 'inga projekt → skapa direkt'). Haiku svarar 'new' för båda.
    const title = "Nybyggnation kvarteret Exemplet";
    const scenario = makeScenario({
      signals: [
        { id: "sig-1", title, description: "a", source_type: "ted", organization_id: "org-1", organization_name: "Org1" },
        { id: "sig-2", title, description: "b", source_type: "ted", organization_id: "org-1", organization_name: "Org1" },
      ],
      projects: [{ id: "proj-other", title: "Annat projekt", property_designation: null, organization_id: "org-1" }],
      haikuAnswer: () => "new",
    });
    await runMain(scenario);
    assert.equal(scenario.postProjectCalls.length, 1, "exakt EN projekt-POST (seriell inom org + titel-återanvändning)");
    const patched = scenario.patchCalls.map(c => JSON.parse(c.body).project_id);
    assert.equal(patched.length, 2, "båda signalerna PATCHas");
    assert.equal(patched[0], patched[1], "båda får SAMMA projekt-id");
  });

  it("orphan med samma org + exakt titel återanvänds — ingen POST alls", async () => {
    const title = "Renovering Gamla Tullhuset";
    const scenario = makeScenario({
      signals: [
        { id: "sig-3", title, description: "x", source_type: "ted", organization_id: "org-2", organization_name: "Org2" },
      ],
      // Föräldralöst projekt från en tidigare kraschad körning: samma org + titel.
      projects: [{ id: "orphan-1", title, property_designation: null, organization_id: "org-2" }],
      haikuAnswer: () => "new",
    });
    await runMain(scenario);
    assert.equal(scenario.postProjectCalls.length, 0, "ingen ny projekt-POST — orphan återanvänds");
    assert.equal(JSON.parse(scenario.patchCalls[0].body).project_id, "orphan-1", "signalen knyts till orphan-projektet");
  });
});

describe("(b) claim-guard på PATCH", () => {
  it("varje PATCH-URL bär project_id=is.null (ingen dubbel-tilldelning möjlig)", async () => {
    const scenario = makeScenario({
      signals: [
        { id: "sig-4", title: "Signal fyra", description: "x", source_type: "ted", organization_id: "org-3", organization_name: "Org3" },
      ],
      projects: [{ id: "proj-q", title: "Projekt Q", property_designation: null, organization_id: "org-3" }],
      haikuAnswer: () => "proj-q",
    });
    await runMain(scenario);
    assert.ok(scenario.patchCalls.length > 0, "minst en PATCH gjordes");
    for (const c of scenario.patchCalls) {
      assert.ok(c.url.includes("project_id=is.null"), "PATCH-URL:en måste bära claim-guarden: " + c.url);
    }
  });
});

describe("(c) soft budget", () => {
  it("överskriden deadline → inga Haiku-anrop, inga skrivningar; allt skjuts framåt", async () => {
    const scenario = makeScenario({
      signals: [
        { id: "sig-5", title: "Signal fem", description: "x", source_type: "ted", organization_id: "org-4", organization_name: "Org4" },
        { id: "sig-6", title: "Signal sex", description: "y", source_type: "ted", organization_id: "org-4", organization_name: "Org4" },
      ],
      projects: [{ id: "proj-r", title: "Projekt R", property_designation: null, organization_id: "org-4" }],
      haikuAnswer: () => "proj-r",
    });
    // Date.now: första anropet (startedAt) = t0; alla följande = långt efter
    // deadline → kollen före FÖRSTA signalen slår till, inget startas.
    await runMain(scenario, {
      patchNow: (origNow) => {
        const t0 = origNow();
        let calls = 0;
        return () => (++calls === 1 ? t0 : t0 + 10_000_000);
      },
    });
    assert.equal(scenario.anthropicCalls.length, 0, "inga nya signaler får startas efter deadline");
    assert.equal(scenario.patchCalls.length, 0, "inga skrivningar efter deadline");
    assert.equal(scenario.postProjectCalls.length, 0, "inga projekt skapas efter deadline");
  });
});

describe("(d) NULL-org skippas", () => {
  it("signal utan organization_id rör varken Haiku, projekt eller PATCH", async () => {
    const scenario = makeScenario({
      signals: [
        { id: "sig-7", title: "Hemlös signal", description: "x", source_type: "project_page", organization_id: null, organization_name: null },
      ],
      projects: [],
      haikuAnswer: () => "new",
    });
    await runMain(scenario);
    assert.equal(scenario.anthropicCalls.length, 0, "ingen Haiku för NULL-org");
    assert.equal(scenario.patchCalls.length, 0, "ingen PATCH för NULL-org");
    assert.equal(scenario.postProjectCalls.length, 0, "inget skräpprojekt för NULL-org");
  });
});
