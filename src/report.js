import { readFile, readdir, writeFile, mkdir } from "fs/promises";
import { join } from "path";

const COST_DIR = join(process.cwd(), "data", "costs");
const COMPARE_DIR = join(process.cwd(), "data", "comparison");
const REPORT_DIR = join(process.cwd(), "data", "reports");

async function loadLatestJson(dir, prefix) {
  try {
    const files = (await readdir(dir))
      .filter((f) => f.startsWith(prefix) && f.endsWith(".json"))
      .sort()
      .reverse();
    if (files.length === 0) return null;
    return JSON.parse(await readFile(join(dir, files[0]), "utf-8"));
  } catch {
    return null;
  }
}

async function main() {
  await mkdir(REPORT_DIR, { recursive: true });

  console.log("=== Floede Agent - Phase A Report ===\n");

  const costData = await loadLatestJson(COST_DIR, "extraction_cost");
  const comparisonData = await loadLatestJson(COMPARE_DIR, "comparison");

  if (!costData) {
    console.error("No cost data found. Run extract.js first.");
    process.exit(1);
  }

  const report = {
    generated_at: new Date().toISOString(),
    phase: "A",
    week: 1,

    // Cost section
    cost: {
      total_usd: costData.total_cost_usd,
      cost_per_permit_usd: costData.cost_per_permit_usd,
      budget_remaining_usd: 150 - costData.total_cost_usd,
      budget_used_pct: ((costData.total_cost_usd / 150) * 100).toFixed(2) + "%",
      by_agent: {
        discovery: { cost_usd: 0, note: "Not yet implemented in Phase A week 1" },
        extraction: { cost_usd: costData.total_cost_usd, model: costData.model },
        qc: { cost_usd: 0, note: "Not yet implemented in Phase A week 1" }
      },
      by_municipality: costData.details
    },

    // Quality section
    quality: {
      total_permits_extracted: costData.total_permits,
      by_municipality: costData.details.map((d) => ({
        municipality: d.municipality,
        permits: d.permits
      })),
      comparison_vs_legacy: comparisonData ? comparisonData.summary : "Run compare.js for comparison data"
    },

    // Performance
    performance: {
      total_extraction_time_ms: costData.details.reduce((s, d) => s + d.elapsed_ms, 0),
      avg_time_per_municipality_ms: Math.round(
        costData.details.reduce((s, d) => s + d.elapsed_ms, 0) / costData.details.length
      ),
      total_input_tokens: costData.details.reduce((s, d) => s + d.input_tokens, 0),
      total_output_tokens: costData.details.reduce((s, d) => s + d.output_tokens, 0),
      avg_tokens_per_permit: {
        input: Math.round(
          costData.details.reduce((s, d) => s + d.input_tokens, 0) /
          Math.max(1, costData.total_permits)
        ),
        output: Math.round(
          costData.details.reduce((s, d) => s + d.output_tokens, 0) /
          Math.max(1, costData.total_permits)
        )
      }
    },

    // Decision point
    verdict: null // Filled in after manual review
  };

  // Print human-readable report
  console.log("--- COST ---");
  console.log(`Total: $${report.cost.total_usd.toFixed(4)}`);
  console.log(`Per permit: $${report.cost.cost_per_permit_usd.toFixed(6)}`);
  console.log(`Budget remaining: $${report.cost.budget_remaining_usd.toFixed(2)} (${report.cost.budget_used_pct} used)`);
  console.log(`\nBy municipality:`);
  report.cost.by_municipality.forEach((m) => {
    console.log(`  ${m.municipality}: ${m.permits} permits, $${m.cost_usd.toFixed(6)}, ${m.input_tokens}/${m.output_tokens} tokens`);
  });

  console.log("\n--- QUALITY ---");
  console.log(`Total permits extracted: ${report.quality.total_permits_extracted}`);
  if (comparisonData) {
    console.log(`Overlap vs legacy: ${comparisonData.summary.avg_overlap_pct}%`);
  }

  console.log("\n--- PERFORMANCE ---");
  console.log(`Total extraction time: ${report.performance.total_extraction_time_ms}ms`);
  console.log(`Avg tokens per permit: ${report.performance.avg_tokens_per_permit.input} in / ${report.performance.avg_tokens_per_permit.output} out`);

  console.log("\n--- MONTHLY PROJECTION ---");
  const dailyCost = report.cost.total_usd; // This is for 5 municipalities
  const projectedMonthly128 = (dailyCost / 5) * 128 * 30;
  console.log(`If we scale to 128 municipalities, daily runs:`);
  console.log(`  Estimated: $${projectedMonthly128.toFixed(2)}/month`);
  console.log(`  Budget: $150/month`);
  console.log(`  ${projectedMonthly128 <= 150 ? "WITHIN BUDGET" : "OVER BUDGET - need optimization"}`);

  // Save report
  const filename = `report_phase_a_week1_${Date.now()}.json`;
  await writeFile(join(REPORT_DIR, filename), JSON.stringify(report, null, 2), "utf-8");
  console.log(`\nReport saved: data/reports/${filename}`);
}

main().catch(console.error);
