// Agent 3 — Quality Control (Claude Sonnet)
// Runs after each extraction cycle.
// Validates data, detects stale sources, produces daily QC report.

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { readFile, readdir, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { readFileSync } from "fs";

const VERTICAL = process.env.VERTICAL || "byggsignal";
const verticalConfig = JSON.parse(readFileSync(new URL(`./config/verticals/${VERTICAL}.json`, import.meta.url), "utf-8"));

const QC_DIR = join(process.cwd(), "data", "qc");
const COST_DIR = join(process.cwd(), "data", "costs");
const CONFIG_DIR = join(process.cwd(), "data", "discovery");

const SONNET_INPUT_COST = 0.000003;
const SONNET_OUTPUT_COST = 0.000015;

const VALID_PERMIT_TYPES = verticalConfig.valid_permit_types;
const VALID_STATUSES = verticalConfig.valid_statuses;

async function loadBaselines(supabase) {
  // Calculate baseline per municipality: average permits per extraction
  // over the last 4 runs
  const { data, error } = await supabase
    .from("permits_v2")
    .select("municipality, extracted_at")
    .order("extracted_at", { ascending: false });

  if (error || !data) return {};

  // Group by municipality and extraction date
  const byMuni = {};
  for (const row of data) {
    const muni = row.municipality;
    const date = row.extracted_at ? row.extracted_at.slice(0, 10) : null;
    if (!date) continue;
    if (!byMuni[muni]) byMuni[muni] = {};
    if (!byMuni[muni][date]) byMuni[muni][date] = 0;
    byMuni[muni][date]++;
  }

  // Calculate baseline: avg permits per run over last 4 unique dates
  const baselines = {};
  for (const [muni, dates] of Object.entries(byMuni)) {
    const sortedDates = Object.keys(dates).sort().reverse().slice(0, 4);
    if (sortedDates.length === 0) continue;
    const avg = sortedDates.reduce((sum, d) => sum + dates[d], 0) / sortedDates.length;
    const lastDate = sortedDates[0];
    baselines[muni] = {
      avg_permits_per_run: Math.round(avg),
      last_data_date: lastDate,
      run_count: sortedDates.length
    };
  }

  return baselines;
}

function validatePermits(permits, municipality) {
  const issues = [];

  for (const p of permits) {
    const permitIssues = [];

    // Validate permit_type
    if (p.permit_type && !VALID_PERMIT_TYPES.includes(p.permit_type)) {
      permitIssues.push(`invalid permit_type: "${p.permit_type}"`);
    }

    // Validate status
    if (p.status && !VALID_STATUSES.includes(p.status)) {
      permitIssues.push(`invalid status: "${p.status}"`);
    }

    // Check for suspicious data
    if (p.date) {
      const date = new Date(p.date);
      const now = new Date();
      if (date > now) {
        permitIssues.push(`future date: ${p.date}`);
      }
      const fiveYearsAgo = new Date(now.getFullYear() - 5, now.getMonth(), now.getDate());
      if (date < fiveYearsAgo) {
        permitIssues.push(`very old date: ${p.date}`);
      }
    }

    // Check for empty critical fields
    if (!p.case_number && !p.address && !p.description) {
      permitIssues.push("all identifying fields are null");
    }

    if (permitIssues.length > 0) {
      issues.push({
        case_number: p.case_number,
        address: p.address,
        issues: permitIssues
      });
    }
  }

  return issues;
}

function detectStale(baselines, extractedToday) {
  const stale = [];
  const now = new Date();

  for (const [muni, baseline] of Object.entries(baselines)) {
    const lastDate = new Date(baseline.last_data_date);
    const daysSinceData = Math.floor((now - lastDate) / (1000 * 60 * 60 * 24));

    // Stale if no data for 2x the normal frequency
    // Most municipalities publish weekly, so default threshold is 14 days
    // But use baseline if available
    const normalFrequencyDays = baseline.run_count >= 2 ? 7 : 14;
    const staleThreshold = normalFrequencyDays * 2;

    if (daysSinceData > staleThreshold) {
      stale.push({
        municipality: muni,
        days_since_data: daysSinceData,
        threshold: staleThreshold,
        last_data_date: baseline.last_data_date,
        avg_permits: baseline.avg_permits_per_run,
        action: "trigger_discovery"
      });
    }
  }

  return stale;
}

function detectAnomalies(baselines, todayCounts) {
  const anomalies = [];

  for (const [muni, count] of Object.entries(todayCounts)) {
    const baseline = baselines[muni];
    if (!baseline || baseline.run_count < 2) continue;

    const expected = baseline.avg_permits_per_run;
    const deviation = Math.abs(count - expected) / Math.max(1, expected);

    // Flag if more than 50% deviation from baseline
    if (deviation > 0.5 && Math.abs(count - expected) > 3) {
      anomalies.push({
        municipality: muni,
        expected,
        actual: count,
        deviation_pct: Math.round(deviation * 100),
        direction: count > expected ? "MORE than expected" : "FEWER than expected"
      });
    }
  }

  return anomalies;
}

const POPULATION = (verticalConfig.qc && verticalConfig.qc.population) || {};

function populationFlags(todayCounts, baselines) {
  const flags = [];
  for (const [muniFile, count] of Object.entries(todayCounts)) {
    // Match sanitized filename to population key
    const popEntry = Object.entries(POPULATION).find(([name]) => {
      const sanitized = name.toLowerCase()
        .replace(/å/g, "a").replace(/ä/g, "a").replace(/ö/g, "o")
        .replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
      return sanitized === muniFile;
    });
    if (!popEntry) continue;
    const [muniName, pop] = popEntry;

    // Estimate days covered from baseline
    const baseline = baselines[muniFile];
    const daysCovered = baseline ? Math.floor((Date.now() - new Date(baseline.last_data_date).getTime()) / 86400000) : 3;
    const monthlyRate = (count / Math.max(daysCovered, 1)) * 30;

    if (pop > 100000 && monthlyRate < 10) {
      flags.push(`${muniName} (${(pop / 1000).toFixed(0)}k inv): ${monthlyRate.toFixed(1)} ärenden/mån, förväntat >= 10`);
    } else if (pop > 50000 && monthlyRate < 5) {
      flags.push(`${muniName} (${(pop / 1000).toFixed(0)}k inv): ${monthlyRate.toFixed(1)} ärenden/mån, förväntat >= 5`);
    }
    if (pop > 20000 && daysCovered >= 14 && count === 0) {
      flags.push(`${muniName} (${(pop / 1000).toFixed(0)}k inv): 0 ärenden på ${daysCovered} dagar`);
    }
  }
  return flags;
}

async function main() {
  await mkdir(QC_DIR, { recursive: true });
  await mkdir(COST_DIR, { recursive: true });

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_KEY required.");
    process.exit(1);
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  console.log("=== Floede Agent - Quality Control ===\n");

  // Load today's extracted data from files
  const extractedDir = join(process.cwd(), "data", "extracted");
  const extractedFiles = (await readdir(extractedDir)).filter((f) => f.endsWith("_extracted.json"));

  const todayCounts = {};
  const allIssues = {};
  let totalPermits = 0;
  let totalFlagged = 0;

  for (const file of extractedFiles) {
    const muniId = file.replace("_extracted.json", "");
    const permits = JSON.parse(await readFile(join(extractedDir, file), "utf-8"));

    todayCounts[muniId] = permits.length;
    totalPermits += permits.length;

    const issues = validatePermits(permits, muniId);
    if (issues.length > 0) {
      allIssues[muniId] = issues;
      totalFlagged += issues.length;
    }
  }

  // Load baselines from database
  const baselines = await loadBaselines(supabase);

  // Detect stale sources
  const staleSources = detectStale(baselines, todayCounts);

  // Detect anomalies
  const anomalies = detectAnomalies(baselines, todayCounts);

  // Population-based flags
  const popFlags = populationFlags(todayCounts, baselines);

  // Calculate cost for today's extraction
  const costFiles = (await readdir(COST_DIR))
    .filter((f) => f.startsWith("extraction_cost"))
    .sort()
    .reverse();
  let todayCost = null;
  if (costFiles.length > 0) {
    todayCost = JSON.parse(await readFile(join(COST_DIR, costFiles[0]), "utf-8"));
  }

  // Build QC report
  const report = {
    run_at: new Date().toISOString(),
    summary: {
      total_permits_extracted: totalPermits,
      total_municipalities: Object.keys(todayCounts).length,
      total_flagged_permits: totalFlagged,
      stale_sources: staleSources.length,
      anomalies: anomalies.length
    },
    per_municipality: Object.entries(todayCounts).map(([muni, count]) => ({
      municipality: muni,
      permits_today: count,
      baseline: baselines[muni] || null,
      issues: allIssues[muni] || [],
      issue_count: (allIssues[muni] || []).length
    })),
    stale_sources: staleSources,
    anomalies: anomalies,
    population_flags: popFlags,
    cost: todayCost ? {
      extraction_usd: todayCost.total_cost_usd,
      cost_per_permit_usd: todayCost.cost_per_permit_usd,
      qc_usd: 0 // QC validation is pure code, no LLM calls for basic checks
    } : null
  };

  // Print human-readable report
  console.log("--- SUMMARY ---");
  console.log(`Permits extracted: ${totalPermits}`);
  console.log(`Municipalities: ${Object.keys(todayCounts).length}`);
  console.log(`Flagged permits: ${totalFlagged}`);
  console.log(`Stale sources: ${staleSources.length}`);
  console.log(`Anomalies: ${anomalies.length}`);
  console.log(`Population flags: ${popFlags.length}`);

  console.log("\n--- PER MUNICIPALITY ---");
  for (const [muni, count] of Object.entries(todayCounts).sort((a, b) => b[1] - a[1])) {
    const issueCount = (allIssues[muni] || []).length;
    const flag = issueCount > 0 ? ` [${issueCount} issues]` : "";
    console.log(`  ${muni}: ${count} permits${flag}`);
  }

  if (totalFlagged > 0) {
    console.log("\n--- FLAGGED PERMITS ---");
    for (const [muni, issues] of Object.entries(allIssues)) {
      console.log(`  ${muni}:`);
      issues.forEach((i) => {
        console.log(`    ${i.case_number || i.address || "unknown"}: ${i.issues.join(", ")}`);
      });
    }
  }

  if (staleSources.length > 0) {
    console.log("\n--- STALE SOURCES (trigger Discovery) ---");
    staleSources.forEach((s) => {
      console.log(`  ${s.municipality}: ${s.days_since_data} days since data (threshold: ${s.threshold})`);
    });
  }

  if (anomalies.length > 0) {
    console.log("\n--- ANOMALIES ---");
    anomalies.forEach((a) => {
      console.log(`  ${a.municipality}: expected ~${a.expected}, got ${a.actual} (${a.deviation_pct}% ${a.direction})`);
    });
  }

  if (popFlags.length > 0) {
    console.log("\n--- POPULATION FLAGS ---");
    popFlags.forEach((f) => console.log(`  ${f}`));
  }

  if (todayCost) {
    console.log("\n--- COST ---");
    console.log(`Extraction: $${todayCost.total_cost_usd.toFixed(4)}`);
    console.log(`Per permit: $${todayCost.cost_per_permit_usd.toFixed(6)}`);
  }

  // Save report
  const filename = `qc_report_${new Date().toISOString().slice(0, 10)}_${Date.now()}.json`;
  await writeFile(join(QC_DIR, filename), JSON.stringify(report, null, 2), "utf-8");
  console.log(`\nReport saved: data/qc/${filename}`);

  // Return stale sources for potential Discovery trigger
  if (staleSources.length > 0) {
    console.log(`\n=== ACTION REQUIRED ===`);
    console.log(`${staleSources.length} stale source(s) detected. Run Discovery for:`);
    staleSources.forEach((s) => console.log(`  - ${s.municipality}`));
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
