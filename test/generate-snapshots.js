#!/usr/bin/env node
// Generate extraction snapshots by running Haiku on each HTML fixture.
// Run ONCE: node test/generate-snapshots.js
// Requires: ANTHROPIC_API_KEY in environment.
// Saves Haiku responses to test/fixtures/snapshots/ as JSON files.
// These snapshots are committed to git and used by npm test.

import Anthropic from "@anthropic-ai/sdk";
import { readFile, readdir, writeFile } from "fs/promises";
import { join } from "path";
import { EXTRACTION_PROMPT_V2 } from "../src/config/extraction-prompt-v2.js";
import { stripNonContent } from "../src/utils/engine.js";
import { EXPECTED } from "./fixtures/expected.js";

const FIXTURES_DIR = join(import.meta.dirname, "fixtures", "html");
const SNAPSHOTS_DIR = join(import.meta.dirname, "fixtures", "snapshots");

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY required. Set it in .env or environment.");
    process.exit(1);
  }

  const client = new Anthropic();

  const files = (await readdir(FIXTURES_DIR))
    .filter(f => f.endsWith(".html"))
    .sort();

  console.log(`=== Generating extraction snapshots ===`);
  console.log(`Fixtures: ${files.length}`);
  console.log(`Model: claude-haiku-4-5-20251001\n`);

  let totalCost = 0;

  for (const file of files) {
    const fixtureId = file.replace(".html", "");
    const expected = EXPECTED[fixtureId];

    if (!expected) {
      console.log(`  SKIP ${file}: no expected data in expected.js`);
      continue;
    }

    const html = await readFile(join(FIXTURES_DIR, file), "utf-8");
    const cleaned = stripNonContent(html);

    console.log(`  ${fixtureId} (${expected.municipality})...`);

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 16384,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: EXTRACTION_PROMPT_V2,
              cache_control: { type: "ephemeral" },
            },
            {
              type: "text",
              text: `Kommun: ${expected.municipality}\n\nHTML:\n${cleaned}`,
            },
          ],
        },
      ],
    });

    const rawText = response.content[0].text.trim()
      .replace(/```json\s*/g, "").replace(/```\s*/g, "");

    let permits = [];
    try {
      permits = JSON.parse(rawText);
    } catch (err) {
      console.error(`    JSON parse error: ${err.message}`);
      console.error(`    Raw: ${rawText.slice(0, 200)}`);
      permits = [];
    }

    const cost = (response.usage.input_tokens * 0.0000008) +
                 (response.usage.output_tokens * 0.000004);
    totalCost += cost;

    const snapshot = {
      fixture: fixtureId,
      municipality: expected.municipality,
      generated_at: new Date().toISOString(),
      model: "claude-haiku-4-5-20251001",
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cost_usd: cost,
      permits_count: permits.length,
      permits,
      raw_response: rawText,
    };

    await writeFile(
      join(SNAPSHOTS_DIR, `${fixtureId}.json`),
      JSON.stringify(snapshot, null, 2),
      "utf-8"
    );

    console.log(`    ${permits.length} permits, $${cost.toFixed(6)}`);

    // Rate limit
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\n=== DONE ===`);
  console.log(`Total cost: $${totalCost.toFixed(6)}`);
  console.log(`Snapshots saved to test/fixtures/snapshots/`);
  console.log(`\nCommit these snapshots to git. They are the regression baseline.`);
}

main().catch(err => { console.error(err); process.exit(1); });
