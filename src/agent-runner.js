// src/agent-runner.js — Floede task orchestrator
// Runs via Railway cron. Picks pending tasks from Supabase, dispatches them,
// tracks budget, and sends a summary email via Resend.

import { execSync } from 'node:child_process';
import { runResearchTask } from './sdk-runner.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const MAX_COST = parseFloat(process.env.AGENT_MAX_COST_PER_RUN_USD || '10.00');

const DEFAULT_VERTICALS = ['byggsignal', 'ci-pressroom'];

const log = (...args) => console.log('[agent-runner]', ...args);
const warn = (...args) => console.warn('[agent-runner]', ...args);

// ── Supabase helpers ──────────────────────────────────────────────────

const sbHeaders = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

async function fetchPendingTasks() {
  const url = `${SUPABASE_URL}/rest/v1/agent_tasks?status=eq.pending&order=priority.asc,created_at.asc`;
  const res = await fetch(url, { headers: sbHeaders });
  if (!res.ok) throw new Error(`Supabase GET failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function patchTask(taskId, fields) {
  const url = `${SUPABASE_URL}/rest/v1/agent_tasks?id=eq.${taskId}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { ...sbHeaders, Prefer: 'return=minimal' },
    body: JSON.stringify(fields),
  });
  if (!res.ok) warn(`Supabase PATCH failed for task ${taskId}: ${res.status} ${await res.text()}`);
}

// ── Task dispatch ─────────────────────────────────────────────────────

function runShellTask(task) {
  const command = task.command || `VERTICAL=${task.vertical} node src/daily-run.js`;
  const start = Date.now();
  const result = execSync(command, {
    timeout: 3_600_000,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, VERTICAL: task.vertical },
  });
  return {
    stdout: result,
    stderr: '',
    exit_code: 0,
    duration_ms: Date.now() - start,
  };
}

async function dispatchTask(task) {
  const { id, job_type } = task;

  if (job_type === 'shell') {
    const result = runShellTask(task);
    return { status: 'completed', result, cost_usd: 0 };
  }

  if (job_type === 'research' || job_type === 'debug') {
    log(`Running ${job_type} task ${id} via sdk-runner`);
    const startTime = Date.now();
    const sdkResult = await runResearchTask(task);
    return {
      status: sdkResult.status === 'error' ? 'failed' : 'completed',
      result: { response: sdkResult.result, turns_used: sdkResult.turns_used },
      cost_usd: sdkResult.cost_usd,
      duration_ms: Date.now() - startTime,
      error: sdkResult.error || null,
    };
  }

  return {
    status: 'skipped',
    error: `Unknown job_type: ${job_type}`,
    cost_usd: 0,
  };
}

// ── Fallback: default daily extraction ────────────────────────────────

function runDefaultExtraction() {
  log('No pending tasks, running default daily extraction');
  const results = [];

  for (const vertical of DEFAULT_VERTICALS) {
    const entry = { vertical, job_type: 'shell', status: 'completed', cost_usd: 0 };
    const start = Date.now();
    try {
      const stdout = execSync(`VERTICAL=${vertical} node src/daily-run.js`, {
        timeout: 3_600_000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, VERTICAL: vertical },
      });
      entry.duration_ms = Date.now() - start;
      entry.result = { stdout, stderr: '', exit_code: 0, duration_ms: entry.duration_ms };
      log(`Default extraction OK: ${vertical} (${entry.duration_ms} ms)`);
    } catch (err) {
      entry.duration_ms = Date.now() - start;
      entry.status = 'failed';
      entry.error = err.message;
      warn(`Default extraction FAILED: ${vertical} — ${err.message}`);
    }
    results.push(entry);

    // QC pass
    const qcEntry = { vertical, job_type: 'qc', status: 'completed', cost_usd: 0 };
    const qcStart = Date.now();
    try {
      log(`Running QC for ${vertical}`);
      const qcStdout = execSync(`VERTICAL=${vertical} node src/qc.js`, {
        timeout: 300_000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, VERTICAL: vertical },
      });
      qcEntry.duration_ms = Date.now() - qcStart;
      qcEntry.result = { stdout: qcStdout, stderr: '', exit_code: 0, duration_ms: qcEntry.duration_ms };
      log(`QC OK: ${vertical} (${qcEntry.duration_ms} ms)`);
    } catch (err) {
      qcEntry.duration_ms = Date.now() - qcStart;
      qcEntry.status = 'failed';
      qcEntry.error = err.message;
      warn(`QC FAILED: ${vertical} — ${err.message}`);
    }
    results.push(qcEntry);
  }

  // Property matching: CI fastigheter mot ByggSignal bygglov
  const matchEntry = { vertical: 'ci-match', job_type: 'shell', status: 'completed', cost_usd: 0 };
  const matchStart = Date.now();
  try {
    log('Running property matching (ci_properties vs permits_v2)');
    const matchStdout = execSync('node src/match-properties.js', {
      timeout: 300_000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });
    matchEntry.duration_ms = Date.now() - matchStart;
    matchEntry.result = { stdout: matchStdout, stderr: '', exit_code: 0, duration_ms: matchEntry.duration_ms };
    log(`Property matching OK (${matchEntry.duration_ms} ms)`);
  } catch (err) {
    matchEntry.duration_ms = Date.now() - matchStart;
    matchEntry.status = 'failed';
    matchEntry.error = err.message;
    warn(`Property matching FAILED: ${err.message}`);
  }
  results.push(matchEntry);

  // TED sync: EU public procurement notices
  const tedEntry = { vertical: 'ci-ted', job_type: 'shell', status: 'completed', cost_usd: 0 };
  const tedStart = Date.now();
  try {
    log('Running TED sync');
    const tedStdout = execSync('node src/ted-sync.js', {
      timeout: 300_000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });
    tedEntry.duration_ms = Date.now() - tedStart;
    tedEntry.result = { stdout: tedStdout, stderr: '', exit_code: 0, duration_ms: tedEntry.duration_ms };
    log('TED sync OK (' + tedEntry.duration_ms + ' ms)');
  } catch (err) {
    tedEntry.duration_ms = Date.now() - tedStart;
    tedEntry.status = 'failed';
    tedEntry.error = err.message;
    warn('TED sync FAILED: ' + err.message);
  }
  results.push(tedEntry);

  return results;
}

// ── Email summary via Resend ──────────────────────────────────────────

async function sendSummary(taskResults, budgetExhaustedTasks) {
  const completed = taskResults.filter((t) => t.status === 'completed').length;
  const failed = taskResults.filter((t) => t.status === 'failed').length;
  const skipped = taskResults.filter((t) => t.status === 'skipped').length;
  const date = new Date().toISOString().slice(0, 10);

  const subject = `Floede Agent: ${completed} OK, ${failed} fel, ${skipped} skipped — ${date}`;

  let body = `<h2>Floede Agent — körning ${date}</h2><table border="1" cellpadding="4" cellspacing="0">`;
  body += '<tr><th>ID</th><th>Vertical</th><th>Type</th><th>Status</th><th>Duration</th><th>Cost</th></tr>';

  for (const t of taskResults) {
    const dur = t.duration_ms != null ? `${(t.duration_ms / 1000).toFixed(1)}s` : '—';
    const cost = t.cost_usd != null ? `$${t.cost_usd.toFixed(4)}` : '—';
    body += `<tr><td>${t.id || '—'}</td><td>${t.vertical || '—'}</td><td>${t.job_type || '—'}</td><td>${t.status}</td><td>${dur}</td><td>${cost}</td></tr>`;
  }
  body += '</table>';

  if (budgetExhaustedTasks.length > 0) {
    body += `<h3 style="color:red">Budget exhausted — ${budgetExhaustedTasks.length} task(s) not executed</h3><ul>`;
    for (const t of budgetExhaustedTasks) {
      body += `<li>Task ${t.id} (${t.vertical || '—'} / ${t.job_type}) — max_cost_usd: ${t.max_cost_usd}</li>`;
    }
    body += `</ul><p>Budget limit: $${MAX_COST.toFixed(2)}</p>`;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Floede Agent <tomasbackman@mac.com>',
      to: 'tomasbackman@mac.com',
      subject,
      html: body,
    }),
  });

  if (!res.ok) {
    warn(`Resend failed: ${res.status} ${await res.text()}`);
  } else {
    log('Summary email sent');
  }
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  log('Starting run');
  let accumulatedCost = 0;
  const taskResults = [];
  const budgetExhaustedTasks = [];

  // 1. Fetch pending tasks
  let tasks;
  try {
    tasks = await fetchPendingTasks();
  } catch (err) {
    warn(`Failed to fetch tasks: ${err.message}`);
    tasks = [];
  }
  log(`Found ${tasks.length} pending task(s)`);

  // 2. No tasks → fallback
  if (tasks.length === 0) {
    const fallbackResults = runDefaultExtraction();
    taskResults.push(...fallbackResults);
    await sendSummary(taskResults, budgetExhaustedTasks);
    log('Done (fallback)');
    process.exit(0);
  }

  // 3. Process tasks
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const taskMaxCost = task.max_cost_usd || 0;

    // Budget check
    if (accumulatedCost + taskMaxCost > MAX_COST) {
      warn(`Budget exhausted at task ${task.id} — accumulated: $${accumulatedCost.toFixed(2)}, task max: $${taskMaxCost}, limit: $${MAX_COST.toFixed(2)}`);
      const remaining = tasks.slice(i);
      for (const t of remaining) {
        await patchTask(t.id, { status: 'budget_exhausted' });
        budgetExhaustedTasks.push(t);
      }
      break;
    }

    // Mark running
    await patchTask(task.id, { status: 'running', started_at: new Date().toISOString() });

    // Dispatch
    let outcome;
    try {
      outcome = await dispatchTask(task);
    } catch (err) {
      const duration_ms = 0;
      outcome = { status: 'failed', error: err.message, cost_usd: 0, duration_ms };
      warn(`Task ${task.id} crashed: ${err.message}`);
    }

    // Persist result
    const patch = {
      status: outcome.status,
      cost_usd: outcome.cost_usd || 0,
      completed_at: new Date().toISOString(),
    };
    if (outcome.result) patch.result = outcome.result;
    if (outcome.error) patch.error = outcome.error;
    await patchTask(task.id, patch);

    accumulatedCost += outcome.cost_usd || 0;

    taskResults.push({
      id: task.id,
      vertical: task.vertical,
      job_type: task.job_type,
      status: outcome.status,
      duration_ms: outcome.result?.duration_ms,
      cost_usd: outcome.cost_usd || 0,
      error: outcome.error,
    });

    log(`Task ${task.id} → ${outcome.status}${outcome.result?.duration_ms ? ` (${outcome.result.duration_ms} ms)` : ''}`);
  }

  // 4. Summary email
  await sendSummary(taskResults, budgetExhaustedTasks);
  log(`Done — ${taskResults.length} processed, ${budgetExhaustedTasks.length} budget-exhausted`);
  process.exit(0);
}

main().catch((err) => {
  warn(`Fatal: ${err.message}`);
  process.exit(1);
});
