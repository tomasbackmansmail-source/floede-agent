// src/group-signals.js — Group ci_signals into ci_projects
// Step 1: Exact match on property designation (permit signals)
// Step 2: LLM match via Haiku (pressroom + TED signals)
// Run: node src/group-signals.js --dry-run   (report only)
//      node src/group-signals.js              (write, nattens fönster = 14d)
//      node src/group-signals.js --all        (write, HELA backloggen — manuell
//                                              backfill utanför cron/execSync-taket)
//
// Prestanda-design (agent-runner kör oss under execSync timeout 300s — vi ska
// ALDRIG nå det taket; det är backstop, inte kontrollmekanism):
//   1. Arbetsfönster: nattens default är project_id=is.null AND created_at >=
//      now()-GROUP_WINDOW_DAYS. Utan fönstret omprocessas hela den historiska
//      backloggen (Haiku-failade + NULL-org-rader) varje natt → körningen växer
//      för varje timeout-natt. --all finns för medveten backfill.
//   2. Bounded concurrency: per-org-SERIELL (Step 2 muterar projektlistan —
//      två parallella signaler om samma nya projekt skulle skapa varsitt),
//      cross-org-PARALLELL med pool GROUP_CONCURRENCY. Wall-clock ≈ långsammaste
//      org, inte summan av alla.
//   3. Mjuk deadline SOFT_BUDGET_MS: överskriden → starta inga nya signaler,
//      logga "partial", exit 0. Resten tas nästa natt. Gäller ej --all.
//
// Idempotens/partiell failure:
//   - Skrivordning PER SIGNAL, aldrig buffrat: beslut → ev. insertProject →
//     updateSignalProject. En krasch lämnar högst ETT föräldralöst projekt och
//     noll felaktiga tilldelningar; obehandlade signaler är kvar på NULL och
//     plockas av nästa körning (re-runs idempotenta: fetch-filtret är is.null).
//   - Claim-guard: PATCH:en villkoras med &project_id=is.null → en redan
//     tilldelad signal skrivs aldrig över; överlappande körningar no-op:ar.
//   - Orphan-återanvändning: före insert för "new" slås befintligt projekt med
//     samma org + exakt titel upp (föräldralöst från tidigare krasch) → återanvänds.

import { readFileSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const ciConfig = JSON.parse(readFileSync(new URL('./config/verticals/ci-pressroom.json', import.meta.url), 'utf8'));

const CI_SUPABASE_URL = ciConfig.supabase_url;
const CI_SUPABASE_KEY = process.env.CI_SUPABASE_SERVICE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!CI_SUPABASE_KEY) {
  console.error('[group-signals] Missing CI_SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const isDryRun = process.argv.includes('--dry-run');
const isAll = process.argv.includes('--all');
const log = (...args) => console.log('[group-signals]', ...args);
const warn = (...args) => console.warn('[group-signals]', ...args);

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const HAIKU_COST = { input: 1.0 / 1_000_000, output: 5.0 / 1_000_000 };
const HAIKU_TIMEOUT_MS = 30000;   // per-anrop-timeout på Haiku (samma anda som runWithTimeout i daily-run)

const GROUP_WINDOW_DAYS = 14;     // nattens arbetsfönster (created_at); --all kringgår
const GROUP_CONCURRENCY = 4;      // antal orgar som processas parallellt
const SOFT_BUDGET_MS = 240_000;   // mjuk deadline < execSyncs 300s; inga nya signaler efter denna

const ciHeaders = {
  apikey: CI_SUPABASE_KEY,
  Authorization: `Bearer ${CI_SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

// ── Supabase helpers ────────────────────────────────────────────────

async function fetchAll(table, select, filters = '') {
  const rows = [];
  const pageSize = 1000;
  let offset = 0;
  while (true) {
    const url = `${CI_SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}${filters}&limit=${pageSize}&offset=${offset}`;
    const res = await fetch(url, { headers: ciHeaders });
    if (!res.ok) throw new Error(`GET ${table} failed: ${res.status} ${await res.text()}`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return rows;
}

async function insertProject(project) {
  const res = await fetch(`${CI_SUPABASE_URL}/rest/v1/ci_projects`, {
    method: 'POST',
    headers: { ...ciHeaders, Prefer: 'return=representation' },
    body: JSON.stringify(project),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Insert project failed: ${res.status} ${body}`);
  }
  const rows = await res.json();
  return rows[0];
}

// Claim-guard: &project_id=is.null → tilldelar bara fortfarande osorterade
// signaler. Redan tilldelad (parallell/tidigare körning) → no-op, ingen
// dubbel-tilldelning. En signal i taget, atomärt i PostgREST.
async function updateSignalProject(signalId, projectId) {
  const res = await fetch(`${CI_SUPABASE_URL}/rest/v1/ci_signals?id=eq.${signalId}&project_id=is.null`, {
    method: 'PATCH',
    headers: { ...ciHeaders, Prefer: 'return=minimal' },
    body: JSON.stringify({ project_id: projectId }),
  });
  if (!res.ok) {
    const body = await res.text();
    warn(`Update signal ${signalId} failed: ${res.status} ${body}`);
  }
}

// ── LLM matching ────────────────────────────────────────────────────

async function askHaikuForMatch(signal, projects) {
  const projectList = projects.map(p =>
    `- id: ${p.id} | "${p.title}"${p.property_designation ? ` (${p.property_designation})` : ''}`
  ).join('\n');

  const prompt = `Här är en signal:
Titel: ${signal.title}
Beskrivning: ${signal.description || '(ingen)'}

Här är befintliga projekt för samma organisation:
${projectList}

Tillhör signalen ett befintligt projekt? Om ja, svara med ENBART projekt-id:t (uuid). Om nej eller om du är osäker, svara med ENBART ordet "new".

Svara med ett enda ord — antingen ett uuid eller "new". Ingen annan text.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: HAIKU_MODEL,
      max_tokens: 100,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(HAIKU_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text();
    warn(`Haiku API error: ${res.status} ${text.slice(0, 200)}`);
    return { answer: 'new', cost: 0 };
  }

  const data = await res.json();
  const cost = (data.usage?.input_tokens || 0) * HAIKU_COST.input +
               (data.usage?.output_tokens || 0) * HAIKU_COST.output;

  const answer = (data.content?.[0]?.text || 'new').trim().toLowerCase();

  // Validate: must be a valid project uuid or "new"
  const validIds = new Set(projects.map(p => p.id));
  if (validIds.has(answer)) return { answer, cost };
  return { answer: 'new', cost };
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  log(`Mode: ${isDryRun ? 'DRY RUN' : 'LIVE'}${isAll ? ' (--all: hela backloggen)' : ` (fönster: ${GROUP_WINDOW_DAYS}d)`}`);
  const startedAt = Date.now();
  // --all = medveten manuell backfill utanför cron → ingen mjuk deadline.
  const softDeadline = isAll ? Infinity : startedAt + SOFT_BUDGET_MS;

  // Nattens arbetsmängd: osorterade inom fönstret. Utan fönstret omprocessas
  // hela historiska backloggen varje natt (självförstärkande timeout-spiral).
  const windowFilter = isAll ? '' :
    `&created_at=gte.${encodeURIComponent(new Date(Date.now() - GROUP_WINDOW_DAYS * 86400000).toISOString())}`;
  const loaded = await fetchAll('ci_signals', 'id,title,description,source_type,organization_id,organization_name', `&project_id=is.null${windowFilter}`);
  log(`Loaded ${loaded.length} ungrouped signals${isAll ? '' : ` (senaste ${GROUP_WINDOW_DAYS} dagarna)`}`);

  // NULL-org skulle skapa skräpprojekt utan organisation (känt Engine-data-
  // kvalitetsproblem) — skippa med varning; kvar på NULL tills org-fixen.
  const signals = loaded.filter(s => s.organization_id);
  const skippedNullOrg = loaded.length - signals.length;
  if (skippedNullOrg > 0) warn(`Skipping ${skippedNullOrg} signals with organization_id=NULL (Engine-datakvalitet)`);

  // Load existing projects
  const existingProjects = await fetchAll('ci_projects', 'id,title,property_designation,organization_id');
  log(`Loaded ${existingProjects.length} existing projects`);

  const permitCount = signals.filter(s => s.source_type === 'permit').length;
  log(`Permit signals: ${permitCount}, Other: ${signals.length - permitCount}`);

  // Delade räknare (single-threaded event loop → säkra trots org-parallellism).
  const state = {
    groupedToExisting: 0,
    newProjectsCreated: 0,
    totalCost: 0,
    budgetSkipped: 0,
    dryRunReport: [],
  };

  // Skapa-eller-återanvänd: föräldralöst projekt med samma org + exakt titel
  // (från tidigare kraschad körning) återanvänds i stället för att dubbleras.
  async function findOrCreateProject(orgId, title, propDesignation) {
    const existing = existingProjects.find(p => p.organization_id === orgId && p.title === title);
    if (existing) return existing;
    state.newProjectsCreated++;
    const newProject = { organization_id: orgId, title, property_designation: propDesignation, source: 'auto' };
    if (isDryRun) {
      const fake = { ...newProject, id: `dry-run-${state.newProjectsCreated}` };
      existingProjects.push(fake);
      return fake;
    }
    const created = await insertProject(newProject);
    existingProjects.push(created);
    return created;
  }

  // ── Per-signal-hantering. Skrivordning per signal: beslut → ev. insert →
  // PATCH. Aldrig buffrade skrivningar (partiell failure = noll feltilldelningar).

  async function processPermitSignal(signal) {
    // Extract property designation from title "Bygglov — Dragarbrunn 28:5"
    const match = signal.title.match(/^.+?\s*—\s*(.+)$/);
    if (!match) {
      warn(`Cannot parse property from title: ${signal.title}`);
      return;
    }
    const propDesignation = match[1].trim();
    const existingProject = existingProjects.find(p =>
      p.organization_id === signal.organization_id &&
      p.property_designation === propDesignation
    );
    if (existingProject) {
      state.groupedToExisting++;
      if (!isDryRun) await updateSignalProject(signal.id, existingProject.id);
      state.dryRunReport.push({ signal: signal.title, action: 'grouped', project: existingProject.title });
    } else {
      const project = await findOrCreateProject(signal.organization_id, signal.title, propDesignation);
      if (!isDryRun) await updateSignalProject(signal.id, project.id);
      state.dryRunReport.push({ signal: signal.title, action: 'new_project', project: project.title });
    }
  }

  async function processOtherSignal(signal) {
    const orgProjects = existingProjects.filter(p => p.organization_id === signal.organization_id);

    let answer = 'new';
    if (orgProjects.length > 0) {
      let cost;
      try {
        ({ answer, cost } = await askHaikuForMatch(signal, orgProjects));
      } catch (err) {
        warn(`Haiku timeout/fel för signal ${signal.id}, lämnas ogrupperad`);
        return;
      }
      state.totalCost += cost;
    }

    if (answer !== 'new') {
      state.groupedToExisting++;
      if (!isDryRun) await updateSignalProject(signal.id, answer);
      const matchedProject = orgProjects.find(p => p.id === answer);
      state.dryRunReport.push({ signal: signal.title, action: 'grouped', project: matchedProject?.title || answer });
    } else {
      const project = await findOrCreateProject(signal.organization_id, signal.title.slice(0, 80), null);
      if (!isDryRun) await updateSignalProject(signal.id, project.id);
      state.dryRunReport.push({ signal: signal.title, action: 'new_project', project: project.title });
    }
  }

  // ── Org-köer: SERIELLT inom org (skapa-sedan-matcha-semantiken bevaras —
  // parallella signaler om samma nya projekt hade skapat varsitt projekt),
  // PARALLELLT mellan orgar (pool GROUP_CONCURRENCY). Permits först (exakt
  // match, billigt), sen LLM-signalerna. Mjuk deadline kollas FÖRE varje ny
  // signal — pågående får slutföra, resten skjuts till nästa körning. ──

  const haveKey = !!ANTHROPIC_API_KEY;
  if (!haveKey && signals.some(s => s.source_type !== 'permit')) {
    warn('Missing ANTHROPIC_API_KEY — skipping LLM matching');
  }

  const byOrg = new Map();
  for (const s of signals) {
    if (!byOrg.has(s.organization_id)) byOrg.set(s.organization_id, []);
    byOrg.get(s.organization_id).push(s);
  }

  async function processOrg(orgId, orgSignals) {
    const orgStart = Date.now();
    const queue = [
      ...orgSignals.filter(s => s.source_type === 'permit'),
      ...(haveKey ? orgSignals.filter(s => s.source_type !== 'permit') : []),
    ];
    let done = 0;
    for (const signal of queue) {
      if (Date.now() > softDeadline) {
        state.budgetSkipped += queue.length - done;
        warn(`Soft budget nådd — org ${orgSignals[0].organization_name || orgId}: ${queue.length - done} signaler skjuts till nästa körning`);
        return;
      }
      if (signal.source_type === 'permit') await processPermitSignal(signal);
      else await processOtherSignal(signal);
      done++;
    }
    log(`Org ${orgSignals[0].organization_name || orgId}: ${done} signaler på ${Date.now() - orgStart} ms`);
  }

  const orgEntries = [...byOrg.entries()];
  let cursor = 0;
  async function worker() {
    while (cursor < orgEntries.length) {
      const [orgId, orgSignals] = orgEntries[cursor++];
      await processOrg(orgId, orgSignals);
    }
  }
  await Promise.all(Array.from({ length: Math.min(GROUP_CONCURRENCY, orgEntries.length) || 1 }, worker));

  // ── Report ──────────────────────────────────────────────────────

  log('\n=== GROUPING COMPLETE ===');
  log(`Grouped to existing projects: ${state.groupedToExisting}`);
  log(`New projects created: ${state.newProjectsCreated}`);
  log(`LLM cost: $${state.totalCost.toFixed(4)}`);
  log(`Duration: ${Date.now() - startedAt} ms`);
  if (state.budgetSkipped > 0) log(`PARTIAL: ${state.budgetSkipped} signaler skjutna till nästa körning (soft budget ${SOFT_BUDGET_MS} ms)`);
  if (skippedNullOrg > 0) log(`Skipped (NULL org): ${skippedNullOrg}`);
  log(`Remaining ungrouped in window: ${signals.length - state.groupedToExisting - state.newProjectsCreated}`);

  if (isDryRun) {
    await mkdir(join(process.cwd(), 'results'), { recursive: true });

    // Build project groups for report
    const projectGroups = {};
    for (const entry of state.dryRunReport) {
      const key = entry.project;
      if (!projectGroups[key]) projectGroups[key] = { action: entry.action, signals: [] };
      projectGroups[key].signals.push(entry.signal);
    }

    let md = `# group-signals dry-run — ${new Date().toISOString().slice(0, 10)}\n\n`;
    md += `## Sammanfattning\n\n`;
    md += `- Signaler utan projekt: ${signals.length}\n`;
    md += `- Grupperade till befintliga projekt: ${state.groupedToExisting}\n`;
    md += `- Nya projekt skapade: ${state.newProjectsCreated}\n`;
    md += `- LLM-kostnad: $${state.totalCost.toFixed(4)}\n\n`;
    md += `## Projektgrupperingar\n\n`;

    for (const [projectTitle, group] of Object.entries(projectGroups)) {
      md += `### ${projectTitle}\n`;
      md += `Åtgärd: ${group.action === 'new_project' ? 'Nytt projekt' : 'Befintligt projekt'}\n`;
      for (const sig of group.signals) {
        md += `- ${sig}\n`;
      }
      md += '\n';
    }

    const outPath = join(process.cwd(), 'results', 'group-signals-dryrun.md');
    await writeFile(outPath, md, 'utf-8');
    log(`Dry-run report written to ${outPath}`);
  }
}

export { main, askHaikuForMatch };

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    warn(`Fatal: ${err.message}`);
    process.exit(1);
  });
}
