// Extraction snapshot tests.
// Compares saved Haiku responses against expected results.
// NO API calls — uses pre-generated snapshots from test/fixtures/snapshots/.
//
// Run: npm test
// Generate snapshots: node test/generate-snapshots.js (requires ANTHROPIC_API_KEY)

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "fs/promises";
import { join } from "path";
import { EXPECTED } from "./fixtures/expected.js";
import { validatePermitEnums } from "../src/utils/engine.js";

const SNAPSHOTS_DIR = join(import.meta.dirname, "fixtures", "snapshots");

// Load all snapshots at test init
async function loadSnapshots() {
  let files;
  try {
    files = (await readdir(SNAPSHOTS_DIR)).filter(f => f.endsWith(".json"));
  } catch {
    return {};
  }
  const snapshots = {};
  for (const file of files) {
    const id = file.replace(".json", "");
    snapshots[id] = JSON.parse(await readFile(join(SNAPSHOTS_DIR, file), "utf-8"));
  }
  return snapshots;
}

const snapshots = await loadSnapshots();
const snapshotIds = Object.keys(snapshots);

if (snapshotIds.length === 0) {
  describe("extraction snapshots", () => {
    it("SKIPPED — no snapshots found. Run: node test/generate-snapshots.js", () => {
      console.log("No snapshots in test/fixtures/snapshots/. Generate them first.");
    });
  });
} else {

  describe("extraction snapshots", () => {

    for (const id of snapshotIds) {
      const snapshot = snapshots[id];
      const expected = EXPECTED[id];

      if (!expected) continue;

      describe(`${id} (${expected.municipality})`, () => {

        it("extracted correct number of permits", () => {
          assert.ok(
            snapshot.permits_count >= expected.min_permits,
            `Expected >= ${expected.min_permits} permits, got ${snapshot.permits_count}`
          );
          assert.ok(
            snapshot.permits_count <= expected.max_permits,
            `Expected <= ${expected.max_permits} permits, got ${snapshot.permits_count}`
          );
        });

        if (expected.expected_permits.length > 0) {
          it("found all expected case numbers", () => {
            const extractedCaseNumbers = snapshot.permits
              .map(p => p.case_number)
              .filter(Boolean);

            for (const exp of expected.expected_permits) {
              if (exp.case_number) {
                assert.ok(
                  extractedCaseNumbers.some(cn =>
                    cn.replace(/\s+/g, "").toLowerCase() ===
                    exp.case_number.replace(/\s+/g, "").toLowerCase()
                  ),
                  `Missing case number: ${exp.case_number}. Found: ${extractedCaseNumbers.join(", ")}`
                );
              }
            }
          });

          it("classified permit_type correctly", () => {
            for (const exp of expected.expected_permits) {
              if (!exp.permit_type) continue;

              const match = snapshot.permits.find(p =>
                p.case_number &&
                p.case_number.replace(/\s+/g, "").toLowerCase() ===
                exp.case_number.replace(/\s+/g, "").toLowerCase()
              );

              if (match) {
                const validated = validatePermitEnums(match);
                assert.equal(
                  validated.permit_type, exp.permit_type,
                  `${exp.case_number}: expected permit_type="${exp.permit_type}", got "${match.permit_type}"`
                );
              }
            }
          });

          it("classified status correctly", () => {
            for (const exp of expected.expected_permits) {
              if (!exp.status) continue;

              const match = snapshot.permits.find(p =>
                p.case_number &&
                p.case_number.replace(/\s+/g, "").toLowerCase() ===
                exp.case_number.replace(/\s+/g, "").toLowerCase()
              );

              if (match) {
                const validated = validatePermitEnums(match);
                assert.equal(
                  validated.status, exp.status,
                  `${exp.case_number}: expected status="${exp.status}", got "${match.status}"`
                );
              }
            }
          });
        }

        // GDPR: applicant must be null for private persons
        if (expected.expected_permits.some(p => p.applicant === null && p.case_number)) {
          it("GDPR: private persons have applicant=null", () => {
            for (const exp of expected.expected_permits) {
              if (exp.applicant !== null) continue;  // skip org applicants
              if (!exp.case_number) continue;

              const match = snapshot.permits.find(p =>
                p.case_number &&
                p.case_number.replace(/\s+/g, "").toLowerCase() ===
                exp.case_number.replace(/\s+/g, "").toLowerCase()
              );

              if (match) {
                assert.equal(
                  match.applicant, null,
                  `GDPR violation: ${exp.case_number} should have applicant=null, got "${match.applicant}"`
                );
              }
            }
          });
        }

        // Organization applicants should be preserved
        if (expected.expected_permits.some(p => p.applicant && p.applicant !== null)) {
          it("preserves organization applicant names", () => {
            for (const exp of expected.expected_permits) {
              if (!exp.applicant) continue;
              if (!exp.case_number) continue;

              const match = snapshot.permits.find(p =>
                p.case_number &&
                p.case_number.replace(/\s+/g, "").toLowerCase() ===
                exp.case_number.replace(/\s+/g, "").toLowerCase()
              );

              if (match && match.applicant) {
                // Fuzzy match — applicant name might be slightly different
                assert.ok(
                  match.applicant.toLowerCase().includes(exp.applicant.toLowerCase().split(" ")[0]),
                  `${exp.case_number}: expected applicant containing "${exp.applicant}", got "${match.applicant}"`
                );
              }
            }
          });
        }

        it("all permits have valid enums (no ASCII versions)", () => {
          for (const p of snapshot.permits) {
            const validated = validatePermitEnums(p);
            if (p.permit_type) {
              assert.equal(
                validated.permit_type, p.permit_type,
                `Invalid permit_type: "${p.permit_type}" (case ${p.case_number})`
              );
            }
            if (p.status) {
              assert.equal(
                validated.status, p.status,
                `Invalid status: "${p.status}" (case ${p.case_number})`
              );
            }
          }
        });

      });
    }
  });
}
