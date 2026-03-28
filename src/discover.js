// Floede Engine — Autonomous Discovery
// Finds data sources for any vertical. No vertical-specific logic.
// Config-driven: reads source table, search terms, prompts from vertical JSON.
// Runs cheap steps first (url_variants, crawl, sitemap), Sonnet only as fallback.

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { readFileSync } from "fs";
import { discoverSource, detectPlatform, verifyExtraction, resolveHomepage } from "./utils/discovery.js";

const CONFIG_DIR = join(process.cwd(), "data", "discovery");
const COST_DIR = join(process.cwd(), "data", "costs");

const VERTICAL = process.env.VERTICAL || "byggsignal";
const verticalConfig = JSON.parse(
  readFileSync(new URL(`./config/verticals/${VERTICAL}.json`, import.meta.url), "utf-8")
);
const discoveryConfig = verticalConfig.discovery;

const onlyArg = process.argv.find(a => a.startsWith("--only="));
const onlyNames = onlyArg
  ? onlyArg.replace("--only=", "").split(",").map(s => s.trim().toLowerCase())
  : null;

async function callWithRetry(fn, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err.status === 429 && attempt < maxRetries) {
        const wait = Math.max(60, parseInt(err.headers?.["retry-after"] || "60", 10));
        console.log(`  [Rate limit] Waiting ${wait}s before retry ${attempt + 1}/${maxRetries}...`);
        await new Promise(r => setTimeout(r, wait * 1000));
      } else {
        throw err;
      }
    }
  }
}

function stripHtmlForContext(html, maxChars = 20000) {
  let stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<img[^>]*>/gi, "")
    .replace(/<link[^>]*>/gi, "")
    .replace(/<meta[^>]*>/gi, "")
    .replace(/\s{2,}/g, " ");
  if (stripped.length > maxChars) {
    stripped = stripped.slice(0, maxChars) + "\n[TRUNCATED]";
  }
  return stripped;
}

async function loadTargets(supabase) {
  const table = discoveryConfig.source_table;
  const idField = discoveryConfig.source_id_field;
  const urlField = discoveryConfig.source_url_field;

  const { data, error } = await supabase
    .from(table)
    .select(`${idField}, ${urlField}`);

  if (error) {
    console.error(`Failed to load targets from ${table}: ${error.message}`);
    return [];
  }

  let targets = data.map(row => ({
    name: row[idField],
    url: row[urlField] || null,
  }));

  // Resolve missing homepages before filtering
  const userAgent = verticalConfig.user_agent;
  const missing = targets.filter(t => !t.url);
  if (missing.length > 0) {
    console.log(`Resolving homepage for ${missing.length} municipalities without URL...`);
    for (const target of missing) {
      const result = await resolveHomepage(target.name, userAgent);
      if (result.found) {
        target.url = result.url;
        console.log(`  Resolved homepage for ${target.name}: ${result.url}`);
        // Update DB so we don't resolve again next time
        await supabase.from(table).update({ [urlField]: result.url }).eq(idField, target.name);
      } else {
        console.log(`  Could not resolve homepage for ${target.name}`);
      }
      await new Promise(r => setTimeout(r, 500));
    }
  }

  // Filter out targets still without URL
  targets = targets.filter(t => t.url);

  if (onlyNames) {
    targets = targets.filter(t =>
      onlyNames.some(n => t.name.toLowerCase().includes(n))
    );
  }

  return targets;
}

async function sonnetDiscovery(client, browser, target) {
  const model = discoveryConfig.discovery_model;
  const maxNavigations = discoveryConfig.max_navigations || 6;
  const userAgent = verticalConfig.user_agent;
  const SONNET_INPUT_COST = 0.000003;
  const SONNET_OUTPUT_COST = 0.000015;

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let navigations = 0;

  const searchPrompt = discoveryConfig.search_prompt.replace(/\{source_name\}/g, target.name);

  console.log(`  [Sonnet] Web search...`);
  const searchResponse = await callWithRetry(() => client.messages.create({
    model,
    max_tokens: 2048,
    tools: [{ type: "web_search_20250305", name: "web_search" }],
    messages: [{ role: "user", content: searchPrompt }],
  }));

  totalInputTokens += searchResponse.usage.input_tokens;
  totalOutputTokens += searchResponse.usage.output_tokens;

  let searchResult = "";
  for (const block of searchResponse.content) {
    if (block.type === "text") searchResult += block.text;
  }

  console.log(`  [Sonnet] Search result: ${searchResult.slice(0, 200)}...`);

  const urlMatch = searchResult.match(/URL:\s*\*{0,2}(https?:\/\/[^\s\n*]+)\*{0,2}/i);
  let candidateUrl = urlMatch ? urlMatch[1].trim() : null;

  if (!candidateUrl) {
    const cost = (totalInputTokens * SONNET_INPUT_COST) + (totalOutputTokens * SONNET_OUTPUT_COST);
    return {
      success: false,
      config: null,
      navigations_used: 0,
      cost_usd: cost,
      failure_reason: "Web search could not find URL",
    };
  }

  console.log(`  [Sonnet] Loading ${candidateUrl}...`);
  const context = await browser.newContext({ userAgent });
  const page = await context.newPage();

  let currentUrl = candidateUrl;
  let currentHtml = "";

  try {
    await page.goto(candidateUrl, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(1500);
    currentUrl = page.url();
    currentHtml = stripHtmlForContext(await page.content());
    navigations++;
  } catch (err) {
    await context.close();
    const cost = (totalInputTokens * SONNET_INPUT_COST) + (totalOutputTokens * SONNET_OUTPUT_COST);
    return {
      success: false,
      config: null,
      navigations_used: navigations,
      cost_usd: cost,
      failure_reason: `Could not load URL: ${err.message}`,
    };
  }

  const analysisPrompt = discoveryConfig.analysis_prompt.replace(/\{source_name\}/g, target.name);

  const conversationHistory = [
    {
      role: "user",
      content: `Source: ${target.name}\nURL: ${currentUrl}\n\nHTML (truncated):\n${currentHtml}\n\n${analysisPrompt}`,
    },
  ];

  let configJson = null;
  let attempts = 0;
  const maxAttempts = 4;

  while (attempts < maxAttempts && !configJson) {
    attempts++;

    const response = await callWithRetry(() => client.messages.create({
      model,
      max_tokens: 2048,
      messages: conversationHistory,
    }));

    totalInputTokens += response.usage.input_tokens;
    totalOutputTokens += response.usage.output_tokens;

    const reply = response.content[0].text.trim();
    conversationHistory.push({ role: "assistant", content: reply });

    console.log(`  [Sonnet] ${reply.slice(0, 200)}${reply.length > 200 ? "..." : ""}`);

    if (reply.includes("ANALYZE")) {
      currentHtml = stripHtmlForContext(await page.content(), 30000);

      const { EXAMPLE_CONFIG } = await import("./config/discovery-schema.js");
      const configGenPrompt = `Produce a data collection config.\n\nURL: ${currentUrl}\nHTML (truncated):\n${currentHtml}\n\nRespond ONLY with valid JSON.\n\nFormat:\n${JSON.stringify(EXAMPLE_CONFIG, null, 2)}`;

      const configResponse = await callWithRetry(() => client.messages.create({
        model,
        max_tokens: 4096,
        messages: [...conversationHistory, { role: "user", content: configGenPrompt }],
      }));

      totalInputTokens += configResponse.usage.input_tokens;
      totalOutputTokens += configResponse.usage.output_tokens;

      const configText = configResponse.content[0].text.trim()
        .replace(/```json\s*/g, "").replace(/```\s*/g, "");

      try {
        configJson = JSON.parse(configText);
        configJson.approved = false;
      } catch (err) {
        console.error(`  [Sonnet] Config parse error: ${err.message}`);
      }

    } else if (reply.includes("NAVIGATE:")) {
      const navMatch = reply.match(/NAVIGATE:\s*(https?:\/\/[^\s\n]+)/);
      if (navMatch && navigations < maxNavigations) {
        try {
          await page.goto(navMatch[1].trim(), { waitUntil: "networkidle", timeout: 30000 });
          await page.waitForTimeout(1000);
          navigations++;
          currentUrl = page.url();
          currentHtml = stripHtmlForContext(await page.content());
          conversationHistory.push({
            role: "user",
            content: `Navigated to: ${currentUrl}\n\nHTML:\n${currentHtml}\n\n${analysisPrompt}`,
          });
        } catch (err) {
          conversationHistory.push({
            role: "user",
            content: `Could not load ${navMatch[1]}: ${err.message}. Try a different approach.`,
          });
        }
      } else {
        conversationHistory.push({
          role: "user",
          content: "Max navigations reached. Respond ANALYZE for current page.",
        });
      }
    } else {
      conversationHistory.push({
        role: "user",
        content: "Respond with ANALYZE if this is the right page, or NAVIGATE: <url> to navigate further.",
      });
    }
  }

  await context.close();

  const cost = (totalInputTokens * SONNET_INPUT_COST) + (totalOutputTokens * SONNET_OUTPUT_COST);

  return {
    success: configJson !== null,
    config: configJson,
    navigations_used: navigations,
    candidate_url: candidateUrl,
    final_url: currentUrl,
    cost_usd: cost,
    failure_reason: configJson ? null : "Could not generate valid config",
  };
}

async function saveConfig(supabase, sourceName, config) {
  const filename = sourceName.toLowerCase().replace(/[^a-z0-9]/g, "-") + "_config.json";
  await writeFile(join(CONFIG_DIR, filename), JSON.stringify(config, null, 2), "utf-8");

  const { error } = await supabase
    .from("discovery_configs")
    .upsert({
      municipality: sourceName,
      config,
      approved: false,
      confidence: config.confidence || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "municipality" });

  if (error) {
    console.log(`  [DB] Error saving config: ${error.message}`);
  } else {
    console.log(`  [DB] Config saved`);
  }
}

async function verifyAndUpdateConfig(supabase, sourceName, listingUrl) {
  const verifyConfig = discoveryConfig.verify_extraction;
  if (!verifyConfig || !verifyConfig.enabled) {
    console.log(`  [Verify] Disabled in config — skipping`);
    return null;
  }

  console.log(`  [Verify] Testing extraction from ${listingUrl}...`);
  const result = await verifyExtraction(listingUrl, verticalConfig, discoveryConfig.search_terms);

  console.log(`  [Verify] Results: ${result.result_count} items${result.error ? ` (error: ${result.error})` : ""}`);

  // Update discovery_configs with verification result
  const { error } = await supabase
    .from("discovery_configs")
    .update({
      verified: result.verified,
      verified_at: new Date().toISOString(),
      verify_result_count: result.result_count,
      needs_browser: result.needs_browser || false,
    })
    .eq("municipality", sourceName);

  if (error) {
    console.log(`  [Verify] DB update error: ${error.message}`);
  }

  if (!result.verified && result.needs_browser) {
    console.log(`  [Verify] URL looks correct but needs JS rendering — flagged needs_browser: true`);
  } else if (!result.verified && verifyConfig.flag_if_zero) {
    console.log(`  [Verify] WARNING: Zero results from ${listingUrl} — config may be invalid`);
  }

  if (result.verified && result.sample.length > 0) {
    console.log(`  [Verify] Sample: ${JSON.stringify(result.sample[0]).slice(0, 150)}...`);
  }

  return result;
}

async function main() {
  await mkdir(CONFIG_DIR, { recursive: true });
  await mkdir(COST_DIR, { recursive: true });

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_KEY required.");
    process.exit(1);
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const targets = await loadTargets(supabase);

  if (targets.length === 0) {
    console.error("No targets found. Check source_table config and database.");
    process.exit(1);
  }

  console.log(`=== Floede Engine — Discovery ===`);
  console.log(`Vertical: ${verticalConfig.name}`);
  console.log(`Targets: ${targets.length}\n`);

  let client = null;
  let browser = null;

  const allResults = [];
  let totalCost = 0;

  for (const target of targets) {
    console.log(`\n--- ${target.name} ---`);

    const cheapResult = await discoverSource(target.name, target.url, discoveryConfig);
    totalCost += cheapResult.cost_usd || 0;

    if (cheapResult.found) {
      console.log(`  [${cheapResult.method}] Found: ${cheapResult.url} (confidence: ${cheapResult.confidence})`);

      allResults.push({
        source: target.name,
        success: true,
        url: cheapResult.url,
        method: cheapResult.method,
        confidence: cheapResult.confidence,
        cost_usd: cheapResult.cost_usd || 0,
      });

      const configStub = {
        source_name: target.name,
        listing_url: cheapResult.url,
        platform_guess: cheapResult.platform || "unknown",
        discovery_method: cheapResult.method,
        confidence: cheapResult.confidence,
        approved: false,
      };

      await saveConfig(supabase, target.name, configStub);
      await verifyAndUpdateConfig(supabase, target.name, cheapResult.url);
      continue;
    }

    console.log(`  [Cheap steps failed] Escalating to Sonnet...`);

    if (!client) client = new Anthropic();
    if (!browser) browser = await chromium.launch({ headless: true });

    const sonnetResult = await sonnetDiscovery(client, browser, target);
    totalCost += sonnetResult.cost_usd;

    if (sonnetResult.success) {
      console.log(`  [Sonnet] Found: ${sonnetResult.config.listing_url} (${sonnetResult.cost_usd.toFixed(4)})`);
      await saveConfig(supabase, target.name, sonnetResult.config);
      if (sonnetResult.config?.listing_url) {
        await verifyAndUpdateConfig(supabase, target.name, sonnetResult.config.listing_url);
      }
    } else {
      console.log(`  [Sonnet] Failed: ${sonnetResult.failure_reason} (${sonnetResult.cost_usd.toFixed(4)})`);
    }

    allResults.push({
      source: target.name,
      success: sonnetResult.success,
      url: sonnetResult.config?.listing_url || null,
      method: sonnetResult.success ? "sonnet" : null,
      confidence: sonnetResult.config?.confidence || null,
      cost_usd: sonnetResult.cost_usd,
      failure_reason: sonnetResult.failure_reason,
    });

    await new Promise(r => setTimeout(r, 1000));
  }

  if (browser) await browser.close();

  const succeeded = allResults.filter(r => r.success).length;
  const cheapSucceeded = allResults.filter(r => r.success && r.cost_usd === 0).length;
  const sonnetSucceeded = allResults.filter(r => r.success && r.cost_usd > 0).length;
  const failed = allResults.filter(r => !r.success).length;

  console.log(`\n=== DISCOVERY SUMMARY ===`);
  console.log(`Total: ${allResults.length}`);
  console.log(`Success: ${succeeded} (${cheapSucceeded} cheap + ${sonnetSucceeded} Sonnet)`);
  console.log(`Failed: ${failed}`);
  console.log(`Cost: $${totalCost.toFixed(4)}`);

  await writeFile(
    join(COST_DIR, `discovery_cost_${Date.now()}.json`),
    JSON.stringify({
      run_at: new Date().toISOString(),
      vertical: verticalConfig.name,
      model: discoveryConfig.discovery_model,
      total_cost_usd: totalCost,
      success_rate: `${succeeded}/${allResults.length}`,
      cheap_success: cheapSucceeded,
      sonnet_success: sonnetSucceeded,
      failed,
      details: allResults,
    }, null, 2),
    "utf-8"
  );
}

main().catch(console.error);
