// Agent 3 — Quality Control (Claude Sonnet)
// Runs after each extraction cycle.
// Validates data, detects stale sources, produces daily QC report.

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { readFile, readdir, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { readFileSync } from "fs";
import { discoverSource, verifyExtraction } from "./utils/discovery.js";
import { normalizeToAscii } from "./utils/normalize.js";

const VERTICAL = process.env.VERTICAL || "byggsignal";
const verticalConfig = JSON.parse(readFileSync(new URL(`./config/verticals/${VERTICAL}.json`, import.meta.url), "utf-8"));
const feedbackConfig = verticalConfig.feedback || {};
const discoveryConfig = verticalConfig.discovery;

const QC_DIR = join(process.cwd(), "data", "qc");
const COST_DIR = join(process.cwd(), "data", "costs");
const CONFIG_DIR = join(process.cwd(), "data", "discovery");

const SONNET_INPUT_COST = 0.000003;
const SONNET_OUTPUT_COST = 0.000015;

const VALID_PERMIT_TYPES = verticalConfig.valid_permit_types;
const VALID_STATUSES = verticalConfig.valid_statuses;

async function loadBaselines(supabase) {
  const sourceField = verticalConfig.qc?.validation?.source_field || "municipality";
  const dateField = verticalConfig.qc?.validation?.date_field || "extracted_at";

  // Calculate baseline per source: average records per extraction
  // over the last 4 runs
  const { data, error } = await supabase
    .from(verticalConfig.db.table)
    .select(`${sourceField}, ${dateField}`)
    .order(dateField, { ascending: false });

  if (error || !data) return {};

  // Group by source and extraction date
  const bySource = {};
  for (const row of data) {
    const source = row[sourceField];
    const date = row[dateField] ? row[dateField].slice(0, 10) : null;
    if (!date) continue;
    if (!bySource[source]) bySource[source] = {};
    if (!bySource[source][date]) bySource[source][date] = 0;
    bySource[source][date]++;
  }

  // Calculate baseline: avg records per run over last 4 unique dates
  const baselines = {};
  for (const [source, dates] of Object.entries(bySource)) {
    const sortedDates = Object.keys(dates).sort().reverse().slice(0, 4);
    if (sortedDates.length === 0) continue;
    const avg = sortedDates.reduce((sum, d) => sum + dates[d], 0) / sortedDates.length;
    const lastDate = sortedDates[0];
    baselines[source] = {
      avg_permits_per_run: Math.round(avg),
      last_data_date: lastDate,
      run_count: sortedDates.length
    };
  }

  return baselines;
}

function validatePermits(records) {
  const validation = verticalConfig.qc?.validation;
  if (!validation) return [];

  const { required_fields = [], allowed_values = {}, numeric_ranges = {} } = validation;
  const issues = [];

  for (const r of records) {
    const recordIssues = [];

    // Check required fields
    for (const field of required_fields) {
      if (r[field] === null || r[field] === undefined) {
        recordIssues.push(`missing required field: ${field}`);
      }
    }

    // Check allowed values
    for (const [field, allowed] of Object.entries(allowed_values)) {
      if (r[field] != null && !allowed.includes(r[field])) {
        recordIssues.push(`invalid ${field}: ${r[field]}`);
      }
    }

    // Check numeric ranges
    for (const [field, range] of Object.entries(numeric_ranges)) {
      if (r[field] != null) {
        if (range.min != null && r[field] < range.min) {
          recordIssues.push(`${field} out of range: ${r[field]} (expected ${range.min}-${range.max})`);
        }
        if (range.max != null && r[field] > range.max) {
          recordIssues.push(`${field} out of range: ${r[field]} (expected ${range.min}-${range.max})`);
        }
      }
    }

    if (recordIssues.length > 0) {
      // Identify record by first available required field value, or title/case_number
      const identifier = r.title || r.case_number ||
        required_fields.map(f => r[f]).find(v => v != null) || "unknown";
      issues.push({
        case_number: r.case_number,
        address: r.address,
        identifier,
        issues: recordIssues
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
      const sanitized = normalizeToAscii(name)
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


async function saveToQcRuns(supabase, todayCounts, baselines, allFlags) {
  const today = new Date().toISOString().slice(0, 10);

  for (const [muniId, count] of Object.entries(todayCounts)) {
    const baseline = baselines[muniId];
    const flags = allFlags[muniId] || [];

    const { error } = await supabase
      .from('qc_runs')
      .upsert({
        vertical: VERTICAL,
        municipality: muniId,
        run_date: today,
        permits_extracted: count,
        permits_inserted: 0,
        expected_avg: baseline ? baseline.avg_permits_per_run : null,
        flags: flags,
        alert_sent: false
      }, {
        onConflict: 'vertical,municipality,run_date'
      });

    if (error) {
      console.log('  [QC DB] Error saving ' + muniId + ': ' + error.message);
    }
  }

  console.log('QC results saved to qc_runs: ' + Object.keys(todayCounts).length + ' rows');
}

export async function checkZeroStreak(supabase) {
  const threshold = feedbackConfig.zero_streak_threshold || 3;
  // Look back further to handle missed QC runs (deploy gaps, timeouts)
  const lookbackDays = threshold * 2;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - lookbackDays);

  // Fetch ALL qc_runs in lookback (both zero and non-zero)
  const { data, error } = await supabase
    .from('qc_runs')
    .select('municipality, run_date, permits_extracted')
    .eq('vertical', VERTICAL)
    .gte('run_date', cutoff.toISOString().slice(0, 10))
    .order('municipality')
    .order('run_date', { ascending: false });

  if (error || !data) return [];

  // Group all runs by municipality
  const byMuni = {};
  for (const row of data) {
    if (!byMuni[row.municipality]) byMuni[row.municipality] = [];
    byMuni[row.municipality].push(row);
  }

  const today = new Date().toISOString().slice(0, 10);
  const zeroStreaks = [];

  for (const [muni, runs] of Object.entries(byMuni)) {
    // Find the most recent run with permits > 0
    const lastWithData = runs.find(r => r.permits_extracted > 0);
    const lastDataDate = lastWithData ? lastWithData.run_date : null;

    // Count consecutive days without data from today backwards
    // A day counts as zero if: there's a QC run with 0, OR there's no run at all
    // (missed runs should not break the streak)
    let zeroDays = 0;
    const zeroDates = [];
    const runsByDate = Object.fromEntries(runs.map(r => [r.run_date, r]));

    for (let d = 0; d < lookbackDays; d++) {
      const checkDate = new Date();
      checkDate.setDate(checkDate.getDate() - d);
      const dateStr = checkDate.toISOString().slice(0, 10);

      const run = runsByDate[dateStr];
      if (run && run.permits_extracted > 0) {
        // Found a day with data — streak ends
        break;
      }
      // Either a zero-run or no run at all — streak continues
      zeroDays++;
      zeroDates.push(dateStr);
    }

    if (zeroDays >= threshold) {
      zeroStreaks.push({ municipality: muni, zero_days: zeroDays, dates: zeroDates });
    }
  }

  return zeroStreaks;
}

export async function triggerRediscovery(municipalityName, currentUrl, homepageUrl, supabase) {
  if (!municipalityName || !supabase || !discoveryConfig) {
    return { success: false, new_url: null, verified: false, cost_usd: 0, error: "missing required parameters" };
  }

  const logRow = {
    municipality: municipalityName,
    triggered_by: 'qc_zero_streak',
    previous_url: currentUrl || null,
    new_url: null,
    method: null,
    verified: false,
    verify_result_count: 0,
    cost_usd: 0,
    success: false,
    error: null,
  };

  try {
    const sourceUrl = homepageUrl || currentUrl;
    if (!sourceUrl) {
      logRow.error = "no homepage or current URL available";
      await supabase.from('discovery_runs').insert(logRow);
      return { success: false, new_url: null, verified: false, cost_usd: 0, error: logRow.error };
    }

    const result = await discoverSource(municipalityName, sourceUrl, discoveryConfig);
    logRow.cost_usd = result.cost_usd || 0;
    logRow.method = result.method;

    if (!result.found) {
      logRow.error = "discovery found no URL";
      await supabase.from('discovery_runs').insert(logRow);
      return { success: false, new_url: null, verified: false, cost_usd: logRow.cost_usd, error: logRow.error };
    }

    // Same URL as before — increment stale counter and skip
    if (result.url === currentUrl) {
      logRow.error = "same URL found, skipping";
      logRow.new_url = result.url;
      await supabase.from('discovery_runs').insert(logRow);

      // Track how many times re-discovery returns the same URL
      const { data: configRow } = await supabase
        .from('discovery_configs')
        .select('stale_rediscovery_count')
        .eq('municipality', municipalityName)
        .limit(1)
        .single();
      const prevCount = configRow?.stale_rediscovery_count || 0;
      const newCount = prevCount + 1;
      await supabase
        .from('discovery_configs')
        .update({
          stale_rediscovery_count: newCount,
          updated_at: new Date().toISOString(),
        })
        .eq('municipality', municipalityName);

      if (newCount >= 3) {
        console.log(`    [Re-discovery] Same URL found ${newCount} times — flagging for manual review`);
      } else {
        console.log(`    [Re-discovery] Same URL found (attempt ${newCount}/3)`);
      }
      return { success: false, new_url: result.url, verified: false, cost_usd: logRow.cost_usd, error: logRow.error };
    }

    // New URL found — verify extraction
    logRow.new_url = result.url;
    console.log(`    [Re-discovery] New URL: ${result.url} (was: ${currentUrl})`);

    const verifyResult = await verifyExtraction(result.url, verticalConfig, discoveryConfig.search_terms);
    logRow.verify_result_count = verifyResult.result_count;
    logRow.cost_usd += verifyResult.cost_usd || 0;

    const shouldApprove = verifyResult.verified && verifyResult.result_count > 0;
    logRow.verified = verifyResult.verified;
    logRow.needs_browser = verifyResult.needs_browser || false;
    logRow.success = shouldApprove;

    if (shouldApprove) {
      // Update discovery_configs with new URL
      const configStub = {
        source_name: municipalityName,
        listing_url: result.url,
        platform_guess: result.platform || "unknown",
        discovery_method: result.method,
        confidence: result.confidence,
        approved: false,
      };

      await supabase
        .from("discovery_configs")
        .update({
          config: configStub,
          verified: verifyResult.verified,
          verified_at: new Date().toISOString(),
          verify_result_count: verifyResult.result_count,
          needs_browser: verifyResult.needs_browser || false,
          approved: true,
          stale_rediscovery_count: 0,
          updated_at: new Date().toISOString(),
        })
        .eq("municipality", municipalityName);

      console.log(`    [Re-discovery] Updated & auto-approved (${verifyResult.result_count} items, needs_browser: ${verifyResult.needs_browser || false})`);
    } else {
      logRow.error = "verification failed";
      console.log(`    [Re-discovery] Verification failed — not approved`);
    }

    await supabase.from('discovery_runs').insert(logRow);
    return { success: logRow.success, new_url: result.url, verified: logRow.verified, cost_usd: logRow.cost_usd, error: logRow.error };
  } catch (err) {
    logRow.error = err.message;
    try { await supabase.from('discovery_runs').insert(logRow); } catch {}
    return { success: false, new_url: null, verified: false, cost_usd: logRow.cost_usd, error: err.message };
  }
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

    const issues = validatePermits(permits);
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

  // --- Save to qc_runs table ---
  const allFlags = {};
  for (const [muni, count] of Object.entries(todayCounts)) {
    const flags = [];
    if ((allIssues[muni] || []).length > 0) flags.push('validation_issues');
    if (staleSources.some(s => s.municipality === muni)) flags.push('stale');
    if (anomalies.some(a => a.municipality === muni)) flags.push('anomaly');
    if (count === 0) flags.push('zero_permits');
    if (flags.length > 0) allFlags[muni] = flags;
  }

  await saveToQcRuns(supabase, todayCounts, baselines, allFlags);

  // --- Check for three-day zero streaks ---
  const zeroStreaks = await checkZeroStreak(supabase);
  if (zeroStreaks.length > 0) {
    // Build display name lookup: normalized/sanitized name → proper ÅÄÖ name
    const { data: muniNameRows } = await supabase
      .from(discoveryConfig.source_table)
      .select(discoveryConfig.source_id_field);
    const displayNameMap = Object.fromEntries(
      (muniNameRows || []).flatMap(r => {
        const name = r[discoveryConfig.source_id_field];
        const sanitized = normalizeToAscii(name)
          .replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
        return [[sanitized, name], [name.normalize('NFC').toLowerCase(), name], [name, name]];
      })
    );
    const displayName = (id) => displayNameMap[id] || displayNameMap[id.toLowerCase()] || id;

    console.log(`\n=== ZERO STREAK ALERT (3+ days) ===`);
    zeroStreaks.forEach(z => {
      console.log(`  ${displayName(z.municipality)}: ${z.zero_days} consecutive days with 0 permits`);
    });

    if (process.env.RESEND_API_KEY) {
      const muniList = zeroStreaks.map(z => `- ${displayName(z.municipality)} (${z.zero_days} dagar)`).join('\n');
      try {
        const resp = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: verticalConfig.alert_from,
            to: [verticalConfig.alert_email],
            subject: `QC ALERT: ${zeroStreaks.length} kommuner med 0 ärenden 3+ dagar`,
            text: `Följande kommuner har extraherat 0 ärenden tre eller fler dagar i rad:\n\n${muniList}\n\nKontrollera discovery-configs och källsidor.`,
          }),
        });
        if (resp.ok) console.log('  Zero-streak alert email sent.');
        else console.error(`  Alert email failed: ${resp.status}`);
      } catch (err) {
        console.error(`  Alert email error: ${err.message}`);
      }

      for (const z of zeroStreaks) {
        await supabase
          .from('qc_runs')
          .update({ alert_sent: true })
          .eq('vertical', VERTICAL)
          .eq('municipality', z.municipality)
          .eq('run_date', new Date().toISOString().slice(0, 10));
      }
    }

    // --- Trigger re-discovery for zero-streak municipalities ---
    let maxRediscoveries = feedbackConfig.max_rediscoveries_per_run || 5;
    const maxCost = feedbackConfig.max_cost_per_run_usd || 2.0;

    // Escalation: if >20% of approved configs have zero-streak, expand re-discovery
    const { count: totalConfigs } = await supabase
      .from(discoveryConfig.config_table)
      .select('*', { count: 'exact', head: true })
      .eq(discoveryConfig.config_approved_field, true);

    if (totalConfigs && zeroStreaks.length > totalConfigs * 0.2) {
      maxRediscoveries = Math.min(zeroStreaks.length, 50);
      console.log(`[QC] ESCALATION: ${zeroStreaks.length} of ${totalConfigs} sources have zero-streak — running expanded re-discovery`);
    }

    // Sort by streak length (worst first), take top N
    const candidates = [...zeroStreaks].sort((a, b) => b.zero_days - a.zero_days).slice(0, maxRediscoveries);

    if (candidates.length > 0) {
      console.log(`\n=== RE-DISCOVERY (${candidates.length} candidates, max $${maxCost}) ===`);

      // Load current configs and homepage URLs for these municipalities
      const { data: configRows } = await supabase
        .from('discovery_configs')
        .select('municipality, config')
        .in('municipality', candidates.map(c => c.municipality));
      const configMap = Object.fromEntries((configRows || []).map(r => [r.municipality, r.config]));

      const { data: muniRows } = await supabase
        .from(discoveryConfig.source_table)
        .select(`${discoveryConfig.source_id_field}, ${discoveryConfig.source_url_field}`);
      const homepageMap = Object.fromEntries(
        (muniRows || []).flatMap(r => {
          const name = r[discoveryConfig.source_id_field];
          const url = r[discoveryConfig.source_url_field];
          const ascii = normalizeToAscii(name)
            .replace(/\s*kommun$/i, '').replace(/\s*stad$/i, '');
          return [[name, url], [ascii, url], [name.normalize('NFC').toLowerCase(), url]];
        })
      );

      let totalRediscoveryCost = 0;
      let succeeded = 0;
      let failed = 0;

      for (const candidate of candidates) {
        if (totalRediscoveryCost >= maxCost) {
          console.log(`  [Re-discovery] Budget exhausted ($${totalRediscoveryCost.toFixed(2)} / $${maxCost})`);
          break;
        }

        const currentConfig = configMap[candidate.municipality];
        const currentUrl = currentConfig?.listing_url || null;
        const homepageUrl = homepageMap[candidate.municipality]
          || homepageMap[normalizeToAscii(candidate.municipality)]
          || homepageMap[candidate.municipality.normalize('NFC').toLowerCase()]
          || null;

        console.log(`  ${displayName(candidate.municipality)} (${candidate.zero_days} days zero):`);
        const result = await triggerRediscovery(candidate.municipality, currentUrl, homepageUrl, supabase);
        totalRediscoveryCost += result.cost_usd;

        if (result.success) {
          succeeded++;
          console.log(`    OK — new URL: ${result.new_url}`);
        } else {
          failed++;
          console.log(`    FAIL — ${result.error}`);
        }
      }

      console.log(`\nRe-discovery: ${candidates.length} triggered, ${succeeded} succeeded, ${failed} failed, $${totalRediscoveryCost.toFixed(4)} spent`);
    }
  }

  // Return stale sources for potential Discovery trigger
  if (staleSources.length > 0) {
    console.log(`\n=== ACTION REQUIRED ===`);
    console.log(`${staleSources.length} stale source(s) detected. Run Discovery for:`);
    staleSources.forEach((s) => console.log(`  - ${s.municipality}`));
  }
}

// Only run main when executed directly (not imported for testing)
const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('/qc.js') || process.argv[1].endsWith('\\qc.js')
);
if (isDirectRun) {
  main()
    .then(() => process.exit(0))
    .catch((err) => { console.error(err); process.exit(1); });
}
