// src/group-signals.js — Group ci_signals into ci_projects
// Step 1: Exact match on property designation (permit signals)
// Step 2: LLM match via Haiku (pressroom + TED signals)
// Run: node src/group-signals.js --dry-run   (report only)
//      node src/group-signals.js              (write to database)

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
const log = (...args) => console.log('[group-signals]', ...args);
const warn = (...args) => console.warn('[group-signals]', ...args);

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const HAIKU_COST = { input: 1.0 / 1_000_000, output: 5.0 / 1_000_000 };

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

async function updateSignalProject(signalId, projectId) {
  const res = await fetch(`${CI_SUPABASE_URL}/rest/v1/ci_signals?id=eq.${signalId}`, {
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
  log(`Mode: ${isDryRun ? 'DRY RUN' : 'LIVE'}`);

  // Load all signals without project_id
  const signals = await fetchAll('ci_signals', 'id,title,description,source_type,organization_id,organization_name', '&project_id=is.null');
  log(`Loaded ${signals.length} ungrouped signals`);

  // Load existing projects
  let existingProjects = await fetchAll('ci_projects', 'id,title,property_designation,organization_id');
  log(`Loaded ${existingProjects.length} existing projects`);

  const permitSignals = signals.filter(s => s.source_type === 'permit');
  const otherSignals = signals.filter(s => s.source_type !== 'permit');
  log(`Permit signals: ${permitSignals.length}, Other: ${otherSignals.length}`);

  let groupedToExisting = 0;
  let newProjectsCreated = 0;
  let totalCost = 0;
  const dryRunReport = [];

  // ── Step 1: Exact match for permit signals ──────────────────────

  log('\n=== Step 1: Permit signals (exact match) ===');

  for (const signal of permitSignals) {
    // Extract property designation from title "Bygglov — Dragarbrunn 28:5"
    const match = signal.title.match(/^.+?\s*—\s*(.+)$/);
    if (!match) {
      warn(`Cannot parse property from title: ${signal.title}`);
      continue;
    }
    const propDesignation = match[1].trim();

    // Find existing project with same property + org
    const existingProject = existingProjects.find(p =>
      p.organization_id === signal.organization_id &&
      p.property_designation === propDesignation
    );

    if (existingProject) {
      groupedToExisting++;
      if (!isDryRun) await updateSignalProject(signal.id, existingProject.id);
      dryRunReport.push({ signal: signal.title, action: 'grouped', project: existingProject.title });
    } else {
      newProjectsCreated++;
      const newProject = {
        organization_id: signal.organization_id,
        title: signal.title,
        property_designation: propDesignation,
        source: 'auto',
      };
      if (!isDryRun) {
        const created = await insertProject(newProject);
        existingProjects.push(created);
        await updateSignalProject(signal.id, created.id);
      } else {
        // Simulate project for subsequent matching
        const fakeId = `dry-run-${newProjectsCreated}`;
        existingProjects.push({ ...newProject, id: fakeId });
      }
      dryRunReport.push({ signal: signal.title, action: 'new_project', project: newProject.title });
    }
  }

  log(`Step 1 done: ${permitSignals.length} permit signals — ${groupedToExisting} grouped, ${newProjectsCreated} new projects`);

  // ── Step 2: LLM match for pressroom + TED signals ──────────────

  log('\n=== Step 2: Pressroom + TED signals (LLM match) ===');

  if (!ANTHROPIC_API_KEY && otherSignals.length > 0) {
    warn('Missing ANTHROPIC_API_KEY — skipping LLM matching');
  } else {
    for (const signal of otherSignals) {
      const orgProjects = existingProjects.filter(p => p.organization_id === signal.organization_id);

      if (orgProjects.length === 0) {
        // No existing projects — create new
        newProjectsCreated++;
        const newProject = {
          organization_id: signal.organization_id,
          title: signal.title.slice(0, 80),
          property_designation: null,
          source: 'auto',
        };
        if (!isDryRun) {
          const created = await insertProject(newProject);
          existingProjects.push(created);
          await updateSignalProject(signal.id, created.id);
        } else {
          const fakeId = `dry-run-${newProjectsCreated}`;
          existingProjects.push({ ...newProject, id: fakeId });
        }
        dryRunReport.push({ signal: signal.title, action: 'new_project', project: newProject.title });
        continue;
      }

      // Ask Haiku
      const { answer, cost } = await askHaikuForMatch(signal, orgProjects);
      totalCost += cost;

      if (answer !== 'new') {
        groupedToExisting++;
        if (!isDryRun) await updateSignalProject(signal.id, answer);
        const matchedProject = orgProjects.find(p => p.id === answer);
        dryRunReport.push({ signal: signal.title, action: 'grouped', project: matchedProject?.title || answer });
      } else {
        newProjectsCreated++;
        const newProject = {
          organization_id: signal.organization_id,
          title: signal.title.slice(0, 80),
          property_designation: null,
          source: 'auto',
        };
        if (!isDryRun) {
          const created = await insertProject(newProject);
          existingProjects.push(created);
          await updateSignalProject(signal.id, created.id);
        } else {
          const fakeId = `dry-run-${newProjectsCreated}`;
          existingProjects.push({ ...newProject, id: fakeId });
        }
        dryRunReport.push({ signal: signal.title, action: 'new_project', project: newProject.title });
      }
    }
  }

  // ── Step 3: Report ──────────────────────────────────────────────

  log('\n=== GROUPING COMPLETE ===');
  log(`Grouped to existing projects: ${groupedToExisting}`);
  log(`New projects created: ${newProjectsCreated}`);
  log(`LLM cost: $${totalCost.toFixed(4)}`);
  log(`Remaining ungrouped: ${signals.length - groupedToExisting - newProjectsCreated}`);

  if (isDryRun) {
    await mkdir(join(process.cwd(), 'results'), { recursive: true });

    // Build project groups for report
    const projectGroups = {};
    for (const entry of dryRunReport) {
      const key = entry.project;
      if (!projectGroups[key]) projectGroups[key] = { action: entry.action, signals: [] };
      projectGroups[key].signals.push(entry.signal);
    }

    let md = `# group-signals dry-run — ${new Date().toISOString().slice(0, 10)}\n\n`;
    md += `## Sammanfattning\n\n`;
    md += `- Signaler utan projekt: ${signals.length}\n`;
    md += `- Grupperade till befintliga projekt: ${groupedToExisting}\n`;
    md += `- Nya projekt skapade: ${newProjectsCreated}\n`;
    md += `- LLM-kostnad: $${totalCost.toFixed(4)}\n\n`;
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

main().catch((err) => {
  warn(`Fatal: ${err.message}`);
  process.exit(1);
});
