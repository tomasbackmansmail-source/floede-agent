// Daily runner: fetch HTML → extract with LLM → insert to database → QC
// This is what Railway cron runs daily at 14:00 CET.
// Default: HTTP fetch (no browser). Playwright only for needs_browser configs.

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { createHash } from "crypto";

import { withRetry } from "./utils/retry.js";
import {
  sanitizeFilename, htmlToText, extractLinks,
  filterByKeywords, filterLinks, stripNonContent,

} from "./utils/engine.js";
import { readFileSync } from "fs";
import { normalizeMunicipality as normalizeMuni } from "./utils/normalize.js";
import { fetchCiceronPermits, isCiceronUrl } from "./adapters/ciceron.js";
import { fetchMeetingPlusPermits, isMeetingPlusUrl } from "./adapters/meetingplus.js";
import { fetchNetPublicatorPermits, isNetPublicatorUrl } from "./adapters/netpublicator.js";

const VERTICAL = process.env.VERTICAL || "byggsignal";
const verticalConfig = JSON.parse(readFileSync(new URL(`./config/verticals/${VERTICAL}.json`, import.meta.url), "utf-8"));
const EXTRACTION_PROMPT_V2 = verticalConfig.extraction_prompt;

const HTML_DIR = join(process.cwd(), "data", "html");
const EXTRACTED_DIR = join(process.cwd(), "data", "extracted");
const COST_DIR = join(process.cwd(), "data", "costs");
const RUN_LOG_DIR = join(process.cwd(), "data", "runs");

const MODEL_COSTS = {
  "claude-haiku-4-5-20251001": { input: 0.0000008, output: 0.000004 },
  "claude-sonnet-4-6": { input: 0.000003, output: 0.000015 },
};
const modelCost = MODEL_COSTS[verticalConfig.model] || MODEL_COSTS["claude-haiku-4-5-20251001"];

const USER_AGENT = verticalConfig.user_agent;
const SOURCE_LABEL = verticalConfig.source_label || "Kommun";

async function ensureDirs() {
  for (const dir of [HTML_DIR, EXTRACTED_DIR, COST_DIR, RUN_LOG_DIR]) {
    await mkdir(dir, { recursive: true });
  }
}

async function loadApprovedConfigs(supabase) {
  const configTable = verticalConfig.discovery?.config_table || "discovery_configs";
  const configApprovedField = verticalConfig.discovery?.config_approved_field || "approved";
  const configSourceField = verticalConfig.discovery?.config_source_field || "municipality";

  const { data, error } = await supabase
    .from(configTable)
    .select("*")
    .eq(configApprovedField, true);

  if (error) {
    console.error(`Failed to load configs from Supabase: ${error.message}`);
    return [];
  }

  return data.map((row) => ({
    ...row.config,
    municipality: row[configSourceField] || row.municipality,
    approved: row[configApprovedField],
    needs_browser: row.config.needs_browser || row.needs_browser || false,
    _file: `${row[configSourceField] || row.municipality}_config.json`,
    _id: row.id,
  }));
}

// --- HTTP FETCH (default) ---

async function fetchPageHttp(config) {
  const url = config.listing_url;
  console.log(`  [HTTP] ${url}`);

  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(30000),
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  // PDF detection via content-type
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/pdf")) {
    const arrayBuf = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    console.log(`  [HTTP] PDF detected (${buffer.length} bytes)`);
    return { content: buffer, isPdf: true };
  }

  const rawHtml = await response.text();

  // Handle subpages
  if (config.requires_subpages && config.requires_subpages.required) {
    const selectorHint = config.requires_subpages.link_selector_hint || "a[href*='bygglov'], a[href*='kungorelse']";
    const allLinks = extractLinks(rawHtml, url, selectorHint);
    const domainFiltered = filterLinks(allLinks.map(l => l.href), url);
    // Re-attach text for keyword filtering
    const domainFilteredWithText = allLinks.filter(l => domainFiltered.includes(l.href));
    const bygglovLinks = filterByKeywords(domainFilteredWithText, verticalConfig.keywords);
    const maxSubpages = config.requires_subpages.max_subpages || 200;

    console.log(`  [HTTP] Found ${allLinks.length} links, ${domainFiltered.length} after domain filter, ${bygglovLinks.length} matching bygglov keywords`);

    // If no bygglov-specific links found, fallback to listing page directly
    if (bygglovLinks.length === 0) {
      console.log(`  [HTTP] No bygglov subpage links found — using listing page directly`);
      return { content: htmlToText(rawHtml), isPdf: false };
    }

    const subpageTexts = [];
    for (const link of bygglovLinks.slice(0, maxSubpages)) {
      try {
        const subResp = await fetch(link.href, {
          headers: { "User-Agent": USER_AGENT },
          signal: AbortSignal.timeout(15000),
          redirect: "follow",
        });
        if (subResp.ok) {
          const subHtml = await subResp.text();
          subpageTexts.push(`<!-- SUBPAGE: ${link.href} -->\n${htmlToText(subHtml)}`);
        }
      } catch (err) {
        console.log(`  [HTTP] Subpage failed: ${link.href} — ${err.message}`);
      }
      await new Promise((r) => setTimeout(r, 500)); // Rate limit
    }

    console.log(`  [HTTP] Fetched ${subpageTexts.length} subpages`);
    return { content: subpageTexts.join("\n\n"), isPdf: false };
  }

  return { content: htmlToText(rawHtml), isPdf: false };
}

// --- PLAYWRIGHT FETCH (for needs_browser configs) ---

async function fetchPagePlaywright(page, config) {
  const url = config.listing_url;
  console.log(`  [Browser] ${url}`);

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);

  // Handle interaction recipe (dropdown/search/filter steps from discovery)
  if (config.interaction_recipe && config.interaction_recipe.steps) {
    console.log(`  [Browser] Running ${config.interaction_recipe.steps.length} interaction steps`);
    for (const step of config.interaction_recipe.steps) {
      try {
        if (step.action === 'select') {
          await page.selectOption(step.selector, step.value);
        } else if (step.action === 'click') {
          await page.click(step.selector);
        } else if (step.action === 'type') {
          await page.fill(step.selector, step.value);
          await page.press(step.selector, 'Enter');
        }
        await page.waitForTimeout(config.interaction_recipe.wait_ms || 3000);
      } catch (err) {
        console.log(`  [Browser] Interaction step failed: ${step.action} ${step.selector} — ${err.message}`);
      }
    }
  }

  // Handle pagination
  if (config.pagination && config.pagination.has_pagination) {
    if (config.pagination.type === "load_more_button" && config.pagination.mechanism) {
      for (let i = 0; i < 10; i++) {
        try {
          const btn = await page.$(config.pagination.mechanism);
          if (!btn) break;
          await btn.click();
          await page.waitForTimeout(1500);
        } catch { break; }
      }
    } else if (config.pagination.type === "page_size_selector") {
      try {
        const selectors = ["select[name*='size']", "select[name*='antal']", ".page-size select"];
        for (const sel of selectors) {
          const select = await page.$(sel);
          if (select) {
            const options = await select.$$("option");
            if (options.length > 0) {
              const lastOption = options[options.length - 1];
              const value = await lastOption.getAttribute("value");
              await select.selectOption(value);
              await page.waitForTimeout(2000);
            }
            break;
          }
        }
      } catch (err) {
        console.log(`  [Browser] Could not set page size: ${err.message}`);
      }
    }
  }

  // Handle subpages
  let html;
  if (config.requires_subpages && config.requires_subpages.required) {
    const linkSelector = config.requires_subpages.link_selector_hint || "a[href*='bygglov'], a[href*='kungorelse']";
    const links = await page.$$eval(linkSelector, (els) =>
      els.map((el) => ({ href: el.href, text: el.textContent || "" })).filter((l) => l.href && l.href.startsWith("http"))
    );

    const domainFiltered = filterLinks(links.map(l => l.href), config.listing_url);
    const domainFilteredWithText = links.filter(l => domainFiltered.includes(l.href));
    const bygglovLinks = filterByKeywords(domainFilteredWithText, verticalConfig.keywords);
    const maxSubpages = config.requires_subpages.max_subpages || 200;

    console.log(`  [Browser] Found ${links.length} links, ${domainFiltered.length} after domain filter, ${bygglovLinks.length} matching bygglov keywords`);

    // If no bygglov-specific links found, fallback to listing page directly
    if (bygglovLinks.length === 0) {
      console.log(`  [Browser] No bygglov subpage links found — using listing page directly`);
      await page.goto(config.listing_url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(2000);
      html = await page.evaluate(() => {
        const main = document.querySelector("main, article, .pagecontent, [role='main'], #pageContent");
        return (main || document.body).innerText;
      });
    } else {
      const subpageTexts = [];
      for (const link of bygglovLinks.slice(0, maxSubpages)) {
        try {
          await page.goto(link.href, { waitUntil: "domcontentloaded", timeout: 15000 });
          await page.waitForTimeout(500);
          const text = await page.evaluate(() => {
            const main = document.querySelector("main, article, .pagecontent, [role='main']");
            return (main || document.body).innerText;
          });
          subpageTexts.push(`<!-- SUBPAGE: ${link.href} -->\n${text}`);
        } catch (err) {
          console.log(`  [Browser] Subpage failed: ${link.href} — ${err.message}`);
        }
        await new Promise((r) => setTimeout(r, 1000));
      }

      console.log(`  [Browser] Fetched ${subpageTexts.length} subpages`);
      html = subpageTexts.join("\n\n");
    }
  } else {
    await page.evaluate(() => {
      document.querySelectorAll("details").forEach(d => d.open = true);
      document.querySelectorAll("[aria-expanded='false']").forEach(el => { try { el.click(); } catch {} });
    });
    await page.waitForTimeout(500);
    html = await page.evaluate(() => {
      const main = document.querySelector("main, article, .pagecontent, [role='main'], #pageContent");
      return (main || document.body).innerText;
    });
  }

  return html;
}

// --- EXTRACTION ---

async function extractPermits(client, html, municipalityName, sourceUrl, sourceConfig = {}, { forceExtract = false, isPdf = false } = {}) {
  const contentHash = isPdf
    ? createHash("sha256").update(html).digest("hex").slice(0, 16)
    : createHash("sha256").update(stripNonContent(html)).digest("hex").slice(0, 16);

  if (!forceExtract && sourceConfig.content_hash && sourceConfig.content_hash === contentHash) {
    console.log(`  [${municipalityName}] content unchanged (hash: ${contentHash}), skipping extraction`);
    return { permits: [], cost: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, cost_usd: 0 }, contentHash, skipped: true };
  }

  let contentBlock;
  if (isPdf) {
    contentBlock = {
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: html.toString("base64"),
      },
    };
  } else {
    const cleaned = stripNonContent(html);
    const truncated = cleaned.length > 100000 ? cleaned.slice(0, 100000) : cleaned;
    contentBlock = {
      type: "text",
      text: `${SOURCE_LABEL}: ${municipalityName}\n\nHTML:\n${truncated}`,
    };
  }

  const response = await withRetry(
    () => client.messages.create({
      model: sourceConfig.model || verticalConfig.model,
      max_tokens: 16384,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: isPdf
                ? `${EXTRACTION_PROMPT_V2}\n\n${SOURCE_LABEL}: ${municipalityName}`
                : EXTRACTION_PROMPT_V2,
              cache_control: { type: "ephemeral" }
            },
            contentBlock
          ]
        }
      ]
    }),
    { maxRetries: 3, baseDelay: 30000, label: municipalityName }
  );

  const rawText = response.content[0].text.trim()
    .replace(/```json\s*/g, "").replace(/```\s*/g, "");

  if (sourceConfig.model && sourceConfig.model !== verticalConfig.model) {
    console.log(`  [Extract] Using per-source model: ${sourceConfig.model}`);
  }

  let permits = [];
  try {
    permits = JSON.parse(rawText);
  } catch {
    console.log(`  [Extract] JSON parse error for ${municipalityName}`);
    permits = [];
  }

  // Set source_url on all records if not already set
  for (const p of permits) {
    if (!p.source_url) {
      p.source_url = sourceUrl;
    }
  }

  const cacheCreated = response.usage.cache_creation_input_tokens || 0;
  const cacheRead = response.usage.cache_read_input_tokens || 0;

  const effectiveModel = sourceConfig.model || verticalConfig.model;
  const effectiveModelCost = MODEL_COSTS[effectiveModel] || MODEL_COSTS["claude-haiku-4-5-20251001"];
  const cost = {
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    cache_creation_input_tokens: cacheCreated,
    cache_read_input_tokens: cacheRead,
    cost_usd: (response.usage.input_tokens * effectiveModelCost.input) +
              (response.usage.output_tokens * effectiveModelCost.output)
  };

  return { permits, cost, contentHash, skipped: false };
}

async function updateContentHash(supabase, configId, newHash) {
  const configTable = verticalConfig.discovery?.config_table || "discovery_configs";
  const { data } = await supabase.from(configTable).select("config").eq("id", configId).single();
  if (data) {
    await supabase.from(configTable).update({ config: { ...data.config, content_hash: newHash } }).eq("id", configId);
  }
}

async function insertToSupabase(supabase, records, extractionRun) {
  if (records.length === 0) return { inserted: 0, skipped: 0, errors: 0 };

  const dbConfig = verticalConfig.db;
  const table = dbConfig.table;
  const fieldMapping = dbConfig.field_mapping;
  const primaryIdField = dbConfig.primary_id_field;
  const conflictKey = dbConfig.conflict_key;
  const dedupFields = dbConfig.dedup_fields || [];

  // Enrichment: lookup from reference table (e.g. municipality -> county)
  let enrichmentLookup = {};
  if (dbConfig.enrichment) {
    const e = dbConfig.enrichment;
    const selectFields = [e.lookup_key, ...Object.keys(e.mappings)].join(',');
    const { data: lookupRows } = await supabase
      .from(e.lookup_table)
      .select(selectFields);
    enrichmentLookup = Object.fromEntries(
      (lookupRows || []).map(r => [r[e.lookup_key], r])
    );
  }

  // Build a reverse lookup: normalizeMuni(name) → canonical name from reference table
  const canonicalByNormalized = Object.fromEntries(
    Object.keys(enrichmentLookup).map(name => [normalizeMuni(name), name])
  );

  function normalizeMunicipalityLookup(name) {
    if (!name) return name;
    // 1. Exact match against reference table
    if (enrichmentLookup[name]) return name;
    // 2. Strip kommun/stad suffixes and trailing genitiv-s
    const stripped = name.normalize('NFC')
      .replace(/s?\s+kommun$/i, '').replace(/s?\s+stad$/i, '')
      .replace(/s$/, '').trim();
    if (enrichmentLookup[stripped]) return stripped;
    // 3. Full normalization match (handles ÅÄÖ, case, suffixes)
    const normalized = normalizeMuni(name);
    if (canonicalByNormalized[normalized]) return canonicalByNormalized[normalized];
    return name;
  }

  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  for (const record of records) {
    // Normalize municipality/organization name before mapping (e.g. "Eslövs kommun" -> "Eslöv")
    if (dbConfig.enrichment) {
      const sourceField = dbConfig.enrichment.lookup_source_field;
      if (record[sourceField]) {
        record[sourceField] = normalizeMunicipalityLookup(record[sourceField]);
      }
    }

    // Map fields from extraction output to database columns
    const row = {};
    for (const [extractField, dbField] of Object.entries(fieldMapping)) {
      row[dbField] = record[extractField] || null;
    }

    // Apply enrichment lookups
    if (dbConfig.enrichment) {
      const e = dbConfig.enrichment;
      const lookupValue = record[e.lookup_source_field];
      const lookupRow = enrichmentLookup[lookupValue];
      if (lookupRow) {
        for (const [sourceCol, targetCol] of Object.entries(e.mappings)) {
          row[targetCol] = lookupRow[sourceCol] || null;
        }
      }
    }

    // Add extraction metadata
    row.extraction_model = verticalConfig.model;
    row.extraction_cost_usd = null;
    row.raw_html_hash = null;

    const idValue = row[primaryIdField];

    if (idValue) {
      // Has primary ID — upsert with conflict handling
      const { error } = await withRetry(
        () => supabase
          .from(table)
          .upsert(row, {
            onConflict: conflictKey,
            ignoreDuplicates: true
          }),
        { maxRetries: 3, baseDelay: 5000, label: `DB ${idValue}` }
      );

      if (error) {
        if (error.code === '23505') { skipped++; }
        else { errors++; console.log(`  [DB] Error inserting ${idValue}: ${error.message}`); }
      } else {
        inserted++;
      }
    } else {
      // No primary ID — check for duplicates using dedup fields
      const query = supabase
        .from(table)
        .select('id', { count: 'exact', head: true })
        .is(primaryIdField, null);

      for (const field of dedupFields) {
        const dbField = fieldMapping[field] || field;
        if (row[dbField]) query.eq(dbField, row[dbField]);
        else query.is(dbField, null);
      }

      const { count } = await withRetry(
        () => query,
        { maxRetries: 3, baseDelay: 5000, label: `DB check ${row[fieldMapping.address] || 'unknown'}` }
      );

      if (count > 0) {
        skipped++;
      } else {
        const { error } = await withRetry(
          () => supabase.from(table).insert(row),
          { maxRetries: 3, baseDelay: 5000, label: `DB insert ${row[fieldMapping.address] || 'unknown'}` }
        );
        if (error) { errors++; console.log(`  [DB] Error inserting: ${error.message}`); }
        else { inserted++; }
      }
    }
  }

  return { inserted, skipped, errors };
}

async function main() {
  await ensureDirs();

  const startTime = Date.now();
  const runId = new Date().toISOString().slice(0, 19).replace(/[:.]/g, "-");

  const muniArg = process.argv.find((a) => a.startsWith("--source=") || a.startsWith("--municipality="));
  const onlyMunis = muniArg
    ? muniArg.replace("--source=", "").replace("--municipality=", "").split(",").map((s) => s.trim().toLowerCase())
    : null;
  const forceExtract = process.argv.includes("--force-extract");

  console.log(`=== Floede Agent - Daily Run ${runId} ===\n`);

  const supabaseUrl = verticalConfig.supabase_url || process.env.SUPABASE_URL;
  const supabaseKey = verticalConfig.supabase_key_env
    ? process.env[verticalConfig.supabase_key_env]
    : process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase credentials. Set supabase_url in config or SUPABASE_URL env, and supabase_key_env in config or SUPABASE_SERVICE_KEY env.");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  let configs = await loadApprovedConfigs(supabase);
  if (onlyMunis) {
    configs = configs.filter((c) =>
      onlyMunis.some((m) => c.municipality.toLowerCase().includes(m) ||
        c._file.toLowerCase().includes(m))
    );
    console.log(`Filtered to ${configs.length} configs: ${configs.map((c) => c.municipality).join(", ")}\n`);
  }

  if (configs.length === 0) {
    console.error("No approved configs found in Supabase. Run Discovery first and approve configs.");
    process.exit(1);
  }

  // Separate adapter vs HTTP vs browser configs
  const isAdapter = c => isCiceronUrl(c.listing_url) || isMeetingPlusUrl(c.listing_url) || isNetPublicatorUrl(c.listing_url);
  const ciceronConfigs = configs.filter(c => isCiceronUrl(c.listing_url));
  const meetingPlusConfigs = configs.filter(c => !isCiceronUrl(c.listing_url) && isMeetingPlusUrl(c.listing_url));
  const netPublicatorConfigs = configs.filter(c => !isCiceronUrl(c.listing_url) && !isMeetingPlusUrl(c.listing_url) && isNetPublicatorUrl(c.listing_url));
  const httpConfigs = configs.filter(c => !c.needs_browser && !isAdapter(c));
  const browserConfigs = configs.filter(c => c.needs_browser && !isAdapter(c));
  console.log(`Found ${configs.length} approved configs (${ciceronConfigs.length} Ciceron, ${meetingPlusConfigs.length} MeetingPlus, ${netPublicatorConfigs.length} NetPublicator, ${httpConfigs.length} HTTP, ${browserConfigs.length} browser)\n`);

  const client = new Anthropic();
  const results = [];
  let totalCost = 0;
  let totalPermits = 0;
  let totalInserted = 0;
  let totalCacheCreated = 0;
  let totalCacheRead = 0;
  let httpCount = 0;
  let browserCount = 0;
  let ciceronCount = 0;
  let meetingPlusCount = 0;
  let netPublicatorCount = 0;
  let totalSkipped = 0;

  // --- Phase 0: Ciceron JSON-RPC (structured data, no LLM) ---
  if (ciceronConfigs.length > 0) {
    console.log(`=== Phase 0: Ciceron JSON-RPC (${ciceronConfigs.length} sources) ===`);

    for (const config of ciceronConfigs) {
      const muniName = config.municipality;
      console.log(`\n--- ${muniName} ---`);

      try {
        const { permits, contentHash } = await fetchCiceronPermits(config.listing_url, muniName);

        // Content hash check (same logic as extractPermits)
        if (!forceExtract && contentHash && config.content_hash && config.content_hash === contentHash) {
          console.log(`  [${muniName}] content unchanged (hash: ${contentHash}), skipping`);
          results.push({ municipality: muniName, status: "unchanged", fetch_mode: "ciceron", permits: 0, cost_usd: 0 });
          totalSkipped++;
          continue;
        }

        totalPermits += permits.length;
        console.log(`  Permits: ${permits.length}, Cost: $0 (no LLM)`);

        if (permits.length > 0) {
          await writeFile(
            join(EXTRACTED_DIR, `${sanitizeFilename(muniName)}_extracted.json`),
            JSON.stringify(permits, null, 2),
            "utf-8"
          );

          const db = await insertToSupabase(supabase, permits, runId);
          totalInserted += db.inserted;
          console.log(`  DB: ${db.inserted} inserted, ${db.skipped} skipped, ${db.errors} errors`);
        }

        if (config._id && contentHash) {
          await updateContentHash(supabase, config._id, contentHash);
        }

        results.push({
          municipality: muniName,
          status: "ok",
          fetch_mode: "ciceron",
          permits: permits.length,
          cost_usd: 0,
        });
        ciceronCount++;
      } catch (err) {
        console.error(`  ERROR: ${err.message}`);
        results.push({
          municipality: muniName,
          status: "error",
          fetch_mode: "ciceron",
          error: err.message,
          permits: 0,
          cost_usd: 0,
        });
      }

      await new Promise((r) => setTimeout(r, 300));
    }
  }

  // --- Phase 0b: MeetingPlus REST API (structured data, no LLM) ---
  if (meetingPlusConfigs.length > 0) {
    console.log(`\n=== Phase 0b: MeetingPlus REST API (${meetingPlusConfigs.length} sources) ===`);

    for (const config of meetingPlusConfigs) {
      const muniName = config.municipality;
      console.log(`\n--- ${muniName} ---`);

      try {
        const { permits, contentHash } = await fetchMeetingPlusPermits(config.listing_url, muniName);

        if (!forceExtract && contentHash && config.content_hash && config.content_hash === contentHash) {
          console.log(`  [${muniName}] content unchanged (hash: ${contentHash}), skipping`);
          results.push({ municipality: muniName, status: "unchanged", fetch_mode: "meetingplus", permits: 0, cost_usd: 0 });
          totalSkipped++;
          continue;
        }

        totalPermits += permits.length;
        console.log(`  Permits: ${permits.length}, Cost: $0 (no LLM)`);

        if (permits.length > 0) {
          await writeFile(
            join(EXTRACTED_DIR, `${sanitizeFilename(muniName)}_extracted.json`),
            JSON.stringify(permits, null, 2),
            "utf-8"
          );

          const db = await insertToSupabase(supabase, permits, runId);
          totalInserted += db.inserted;
          console.log(`  DB: ${db.inserted} inserted, ${db.skipped} skipped, ${db.errors} errors`);
        }

        if (config._id && contentHash) {
          await updateContentHash(supabase, config._id, contentHash);
        }

        results.push({
          municipality: muniName,
          status: "ok",
          fetch_mode: "meetingplus",
          permits: permits.length,
          cost_usd: 0,
        });
        meetingPlusCount++;
      } catch (err) {
        console.error(`  ERROR: ${err.message}`);
        results.push({
          municipality: muniName,
          status: "error",
          fetch_mode: "meetingplus",
          error: err.message,
          permits: 0,
          cost_usd: 0,
        });
      }

      await new Promise((r) => setTimeout(r, 300));
    }
  }

  // --- Phase 0c: NetPublicator JSONP (structured data, no LLM) ---
  if (netPublicatorConfigs.length > 0) {
    console.log(`\n=== Phase 0c: NetPublicator JSONP (${netPublicatorConfigs.length} sources) ===`);

    for (const config of netPublicatorConfigs) {
      const muniName = config.municipality;
      console.log(`\n--- ${muniName} ---`);

      try {
        const { permits, contentHash } = await fetchNetPublicatorPermits(config.listing_url, muniName);

        if (!forceExtract && contentHash && config.content_hash && config.content_hash === contentHash) {
          console.log(`  [${muniName}] content unchanged (hash: ${contentHash}), skipping`);
          results.push({ municipality: muniName, status: "unchanged", fetch_mode: "netpublicator", permits: 0, cost_usd: 0 });
          totalSkipped++;
          continue;
        }

        totalPermits += permits.length;
        console.log(`  Permits: ${permits.length}, Cost: $0 (no LLM)`);

        if (permits.length > 0) {
          await writeFile(
            join(EXTRACTED_DIR, `${sanitizeFilename(muniName)}_extracted.json`),
            JSON.stringify(permits, null, 2),
            "utf-8"
          );

          const db = await insertToSupabase(supabase, permits, runId);
          totalInserted += db.inserted;
          console.log(`  DB: ${db.inserted} inserted, ${db.skipped} skipped, ${db.errors} errors`);
        }

        if (config._id && contentHash) {
          await updateContentHash(supabase, config._id, contentHash);
        }

        results.push({
          municipality: muniName,
          status: "ok",
          fetch_mode: "netpublicator",
          permits: permits.length,
          cost_usd: 0,
        });
        netPublicatorCount++;
      } catch (err) {
        console.error(`  ERROR: ${err.message}`);
        results.push({
          municipality: muniName,
          status: "error",
          fetch_mode: "netpublicator",
          error: err.message,
          permits: 0,
          cost_usd: 0,
        });
      }

      await new Promise((r) => setTimeout(r, 300));
    }
  }

  // --- Phase 1: HTTP fetch (fast, no browser) ---
  console.log(`=== Phase 1: HTTP fetch (${httpConfigs.length} sources) ===`);

  for (const config of httpConfigs) {
    const muniName = config.municipality;
    const hasSubpages = config.requires_subpages && config.requires_subpages.required;
    const timeout = hasSubpages ? 300000 : 60000;
    console.log(`\n--- ${muniName} ---`);

    try {
      await Promise.race([
        (async () => {
          const { content: html, isPdf } = await fetchPageHttp(config);
          const hash = createHash("sha256").update(html).digest("hex").slice(0, 16);

          const htmlFile = `${sanitizeFilename(muniName)}_${runId}${isPdf ? ".pdf" : ".html"}`;
          await writeFile(join(HTML_DIR, htmlFile), html);

          const { permits, cost, contentHash, skipped } = await extractPermits(client, html, muniName, config.listing_url, config, { forceExtract, isPdf });

          if (skipped) {
            results.push({ municipality: muniName, status: "unchanged", fetch_mode: "http", permits: 0, cost_usd: 0, html_hash: hash });
            totalSkipped++;
            return;
          }

          totalCost += cost.cost_usd;
          totalPermits += permits.length;
          totalCacheCreated += cost.cache_creation_input_tokens || 0;
          totalCacheRead += cost.cache_read_input_tokens || 0;

          console.log(`  Permits: ${permits.length}, Cost: $${cost.cost_usd.toFixed(4)}${cost.cache_read_input_tokens ? ` (cache hit: ${cost.cache_read_input_tokens} tokens)` : ""}`);

          // Auto-escalate to browser if HTTP yields 0 permits
          if (permits.length === 0 && !config.needs_browser) {
            console.log(`  [HTTP] 0 permits from verified source — escalating to browser: ${muniName}`);
            browserConfigs.push({ ...config, needs_browser: true });
            results.push({
              municipality: muniName,
              status: "escalated",
              fetch_mode: "http",
              permits: 0,
              cost_usd: cost.cost_usd,
              html_hash: hash
            });
            httpCount++;
            return;
          }

          await writeFile(
            join(EXTRACTED_DIR, `${sanitizeFilename(muniName)}_extracted.json`),
            JSON.stringify(permits, null, 2),
            "utf-8"
          );

          const db = await insertToSupabase(supabase, permits, runId);
          totalInserted += db.inserted;
          console.log(`  DB: ${db.inserted} inserted, ${db.skipped} skipped, ${db.errors} errors`);

          if (config._id) {
            await updateContentHash(supabase, config._id, contentHash);
          }

          results.push({
            municipality: muniName,
            status: "ok",
            fetch_mode: "http",
            permits: permits.length,
            inserted: db.inserted,
            skipped: db.skipped,
            errors: db.errors,
            cost_usd: cost.cost_usd,
            html_hash: hash
          });
          httpCount++;
        })(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Municipality timeout: ${timeout / 1000}s exceeded`)), timeout)
        )
      ]);
    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
      results.push({
        municipality: muniName,
        status: "error",
        fetch_mode: "http",
        error: err.message,
        permits: 0,
        cost_usd: 0
      });
    }

    await new Promise((r) => setTimeout(r, 300)); // Lighter rate limit for HTTP
  }

  // --- Phase 2: Playwright fetch (browser-dependent sites) ---
  if (browserConfigs.length > 0) {
    console.log(`\n=== Phase 2: Playwright fetch (${browserConfigs.length} sources) ===`);

    let browser = await chromium.launch({ headless: true });
    let context = await browser.newContext({ userAgent: USER_AGENT });
    let page = await context.newPage();
    let browserProcessed = 0;

    for (const config of browserConfigs) {
      if (browserProcessed > 0 && browserProcessed % 30 === 0) {
        console.log(`\n[Browser] Restarting after ${browserProcessed} municipalities...`);
        await browser.close();
        browser = await chromium.launch({ headless: true });
        context = await browser.newContext({ userAgent: USER_AGENT });
        page = await context.newPage();
        console.log(`[Browser] Restarted`);
      }

      const muniName = config.municipality;
      const hasSubpages = config.requires_subpages && config.requires_subpages.required;
      const timeout = hasSubpages ? 300000 : 60000;
      console.log(`\n--- ${muniName} ---`);

      try {
        await Promise.race([
          (async () => {
            const html = await fetchPagePlaywright(page, config);
            const hash = createHash("sha256").update(html).digest("hex").slice(0, 16);

            const htmlFile = `${sanitizeFilename(muniName)}_${runId}.html`;
            await writeFile(join(HTML_DIR, htmlFile), html, "utf-8");

            const { permits, cost, contentHash, skipped } = await extractPermits(client, html, muniName, config.listing_url, config, { forceExtract });

            if (skipped) {
              results.push({ municipality: muniName, status: "unchanged", fetch_mode: "browser", permits: 0, cost_usd: 0, html_hash: hash });
              totalSkipped++;
              return;
            }

            totalCost += cost.cost_usd;
            totalPermits += permits.length;
            totalCacheCreated += cost.cache_creation_input_tokens || 0;
            totalCacheRead += cost.cache_read_input_tokens || 0;

            console.log(`  Permits: ${permits.length}, Cost: $${cost.cost_usd.toFixed(4)}`);

            await writeFile(
              join(EXTRACTED_DIR, `${sanitizeFilename(muniName)}_extracted.json`),
              JSON.stringify(permits, null, 2),
              "utf-8"
            );

            const db = await insertToSupabase(supabase, permits, runId);
            totalInserted += db.inserted;
            console.log(`  DB: ${db.inserted} inserted, ${db.skipped} skipped, ${db.errors} errors`);

            if (config._id) {
              await updateContentHash(supabase, config._id, contentHash);
            }

            results.push({
              municipality: muniName,
              status: "ok",
              fetch_mode: "browser",
              permits: permits.length,
              inserted: db.inserted,
              skipped: db.skipped,
              errors: db.errors,
              cost_usd: cost.cost_usd,
              html_hash: hash
            });
            browserCount++;
          })(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Municipality timeout: ${timeout / 1000}s exceeded`)), timeout)
          )
        ]);
      } catch (err) {
        console.error(`  ERROR: ${err.message}`);
        results.push({
          municipality: muniName,
          status: "error",
          fetch_mode: "browser",
          error: err.message,
          permits: 0,
          cost_usd: 0
        });
      }

      browserProcessed++;
      await new Promise((r) => setTimeout(r, 1000));
    }

    await browser.close();
  }

  const elapsed = Date.now() - startTime;

  // Save run log
  const runLog = {
    run_id: runId,
    run_at: new Date().toISOString(),
    elapsed_ms: elapsed,
    configs_count: configs.length,
    http_count: httpCount,
    browser_count: browserCount,
    total_permits: totalPermits,
    total_inserted: totalInserted,
    total_cost_usd: totalCost,
    cost_per_permit_usd: totalPermits > 0 ? totalCost / totalPermits : 0,
    results
  };

  await writeFile(join(RUN_LOG_DIR, `run_${runId}.json`), JSON.stringify(runLog, null, 2), "utf-8");

  await writeFile(
    join(COST_DIR, `extraction_cost_${Date.now()}.json`),
    JSON.stringify({
      run_at: new Date().toISOString(),
      agent: "extraction",
      model: verticalConfig.model,
      total_cost_usd: totalCost,
      total_permits: totalPermits,
      cost_per_permit_usd: totalPermits > 0 ? totalCost / totalPermits : 0,
      details: results.map((r) => ({
        municipality: r.municipality,
        permits: r.permits,
        cost_usd: r.cost_usd
      }))
    }, null, 2),
    "utf-8"
  );

  // Summary
  console.log(`\n=== RUN COMPLETE ===`);
  console.log(`Time: ${Math.round(elapsed / 1000)}s`);
  console.log(`Sources: ${configs.length} (${ciceronCount} Ciceron, ${meetingPlusCount} MeetingPlus, ${netPublicatorCount} NetPublicator, ${httpCount} HTTP, ${browserCount} browser)`);
  console.log(`Permits extracted: ${totalPermits}`);
  console.log(`Permits inserted: ${totalInserted}`);
  console.log(`Cost: $${totalCost.toFixed(4)}`);
  console.log(`Cost/permit: $${(totalPermits > 0 ? totalCost / totalPermits : 0).toFixed(6)}`);
  console.log(`Cache: ${totalCacheCreated} created, ${totalCacheRead} read`);

  const ok = results.filter((r) => r.status === "ok").length;
  const failed = results.filter((r) => r.status === "error").length;
  const unchanged = results.filter((r) => r.status === "unchanged").length;
  console.log(`OK: ${ok}, Failed: ${failed}${unchanged > 0 ? `, Unchanged: ${unchanged} (skipped LLM)` : ""}`);

  if (failed > 0) {
    console.log("Failed sources:");
    results.filter((r) => r.status === "error").forEach((r) => {
      console.log(`  - ${r.municipality} [${r.fetch_mode}]: ${r.error}`);
    });
  }

  // --- Alerting: email if zero permits inserted ---
  if (totalInserted === 0 && process.env.RESEND_API_KEY) {
    console.log(`\n=== ALERT: Zero records inserted — sending email ===`);
    try {
      const alertResp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: verticalConfig.alert_from,
          to: [verticalConfig.alert_email],
          subject: `ALERT: Floede Engine — 0 records inserted (${runId})`,
          text: `Floede Engine daily run ${runId} finished with 0 records inserted.\n\nConfigs: ${configs.length}\nExtracted: ${totalPermits}\nInserted: ${totalInserted}\nFailed sources: ${failed}\nCost: $${totalCost.toFixed(4)}\nElapsed: ${Math.round(elapsed / 1000)}s\n\nCheck Railway logs for details.`,
        }),
      });
      if (alertResp.ok) {
        console.log("  Alert email sent.");
      } else {
        console.error(`  Alert email failed: ${alertResp.status} ${await alertResp.text()}`);
      }
    } catch (alertErr) {
      console.error(`  Alert email error: ${alertErr.message}`);
    }
  }

  // --- Phase 4: Trigger vertical notification ---
  if (process.env.NOTIFY_URL) {
    console.log('\n=== Phase 4: Trigger notifications ===');
    try {
      const resp = await fetch(process.env.NOTIFY_URL, {
        headers: { 'Authorization': 'Bearer ' + (process.env.CRON_SECRET || '') }
      });
      const result = await resp.json();
      console.log('Notify response:', JSON.stringify(result));
    } catch (err) {
      console.error('Notify trigger failed (non-fatal):', err.message);
    }
  }

}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
