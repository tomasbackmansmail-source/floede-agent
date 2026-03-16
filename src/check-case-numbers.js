// Quick check: do Malmö and Mölndal anslagstavlor show diarienummer in HTML?
// Run this BEFORE fixing anything — determines if null case_number is correct behavior.

import { readFile, readdir } from "fs/promises";
import { join } from "path";

const HTML_DIR = join(process.cwd(), "data", "html");

// Common patterns for Swedish diarienummer
const CASE_NUMBER_PATTERNS = [
  /\b[A-Z]{1,4}\s?\d{4}[\-\/]\d{3,6}\b/g,          // BN 2024-001234, SBN-2024/123
  /\b\d{4}[\-\/]\d{3,6}\b/g,                          // 2024-001234
  /\bdnr[:\s]+[^\s<]+/gi,                             // Dnr: something
  /\bdiarienummer[:\s]+[^\s<]+/gi,                     // Diarienummer: something
  /\b[Ää]rendenummer[:\s]+[^\s<]+/gi,                  // Ärendenummer: something
  /\b[Ää]rende-id[:\s]+[^\s<]+/gi,                     // Ärende-id: something
];

async function checkMunicipality(municipalityId) {
  const htmlFiles = (await readdir(HTML_DIR)).filter((f) => f.startsWith(municipalityId));

  if (htmlFiles.length === 0) {
    console.log(`[${municipalityId}] No HTML files found`);
    return;
  }

  for (const file of htmlFiles) {
    const html = await readFile(join(HTML_DIR, file), "utf-8");
    console.log(`\n[${municipalityId}] File: ${file} (${html.length} chars)`);

    for (const pattern of CASE_NUMBER_PATTERNS) {
      const matches = html.match(pattern);
      if (matches && matches.length > 0) {
        const unique = [...new Set(matches)].slice(0, 10);
        console.log(`  FOUND pattern ${pattern.source}: ${unique.join(", ")}`);
      }
    }

    // Also search for common label text near permit data
    const labelPatterns = [
      /dnr/gi,
      /diarienummer/gi,
      /[Ää]rendenummer/gi,
      /[Ää]rende-id/gi,
      /beteckning/gi,
    ];

    console.log(`\n  Label search:`);
    for (const lp of labelPatterns) {
      const matches = html.match(lp);
      if (matches) {
        console.log(`    "${lp.source}" appears ${matches.length} times`);

        // Show context around first match
        const idx = html.search(lp);
        if (idx >= 0) {
          const context = html.slice(Math.max(0, idx - 50), idx + 100)
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim();
          console.log(`    Context: ...${context}...`);
        }
      }
    }
  }
}

async function main() {
  console.log("=== Stickprov: Diarienummer i HTML ===\n");
  await checkMunicipality("malmo");
  await checkMunicipality("molndal");
}

main().catch(console.error);
