import Anthropic from "@anthropic-ai/sdk";
import { chromium } from "playwright";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { EXAMPLE_CONFIG } from "./config/discovery-schema.js";

const CONFIG_DIR = join(process.cwd(), "data", "discovery");
const COST_DIR = join(process.cwd(), "data", "costs");

// CLI: --only nacka,malmo to discover specific municipalities
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const onlyIds = onlyArg ? onlyArg.split("=")[1].split(",") : null;

// Retry wrapper for rate-limited API calls
async function callWithRetry(fn, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err.status === 429 && attempt < maxRetries) {
        const wait = Math.max(60, parseInt(err.headers?.["retry-after"] || "60", 10));
        console.log(`  [Rate limit] Waiting ${wait}s before retry ${attempt + 1}/${maxRetries}...`);
        await new Promise((r) => setTimeout(r, wait * 1000));
      } else {
        throw err;
      }
    }
  }
}

// Sonnet pricing (per token)
// Input: $3.00 per 1M tokens = $0.000003/token
// Output: $15.00 per 1M tokens = $0.000015/token
const SONNET_INPUT_COST = 0.000003;
const SONNET_OUTPUT_COST = 0.000015;

// Municipalities to discover - only name and homepage, NO anslagstavla URL
const DISCOVERY_TARGETS = [
  { id: "nacka", name: "Nacka", homepage: "https://www.nacka.se" },
  { id: "helsingborg", name: "Helsingborg", homepage: "https://helsingborg.se" },
  { id: "malmo", name: "Malmö", homepage: "https://malmo.se" },
  { id: "molndal", name: "Mölndal", homepage: "https://www.molndal.se" },
  { id: "lund", name: "Lund", homepage: "https://www.lund.se" }
];

const DISCOVERY_SYSTEM_PROMPT = `Du ar en Discovery-agent. Din uppgift ar att hitta var en svensk kommun publicerar sina bygglovsarenden (anslagstavla/kungorelser) och producera en konfiguration for automatisk datainsamling.

Du far tillgang till en kommuns webbsida via screenshots och HTML-utdrag. Du kan navigera genom att svara med kommandon.

STEG:
1. Analysera kommunens startsida. Leta efter lankar som "Bygga & bo", "Bygglov", "Anslagstavla", "Kungorelser".
2. Folj den mest troliga lanken till bygglovsrelaterat innehall.
3. Nar du hittar en sida som listar bygglovsarenden, analysera:
   - Hur arenden presenteras (tabell, lista, kort, lankar till undersidor)
   - Om det finns paginering (sidnumrering, "visa fler", oandlig scroll)
   - Om detaljinformation finns direkt pa sidan eller kraver klick till undersida
   - Vilken CMS/plattform sidan kors pa (Sitevision, Netpublicator, etc)
4. Producera en JSON-konfiguration.

KOMMANDON du kan svara med (ett per svar):
- NAVIGATE: <url> — navigera till en ny URL
- CLICK: <text eller selektor> — klicka pa ett element
- ANALYZE — du har hittat ratten sida, analysera den

REGLER:
- Max 8 navigeringar per kommun. Om du inte hittat anslagstavlan efter 8 forsoker, rapportera failure.
- Var specifik med varfor du valjer varje lank.
- Om du ar osakar, valj den mest troliga vagen och notera din osakerhet.`;

const CONFIG_GENERATION_PROMPT = `Baserat pa din analys av kommunens anslagstavla, producera en JSON-konfiguration.

Svara ENBART med giltig JSON, inga markdown-backticks, ingen annan text.

Formatet:
${JSON.stringify(EXAMPLE_CONFIG, null, 2)}

Falt:
- municipality: Kommunens namn
- platform_guess: sitevision, netpublicator, meetingsplus, wordpress, custom, unknown
- listing_url: Direkt URL till sidan som listar arenden
- listing_type: table, list, cards, links_to_subpages, pdf_list, unknown
- pagination.has_pagination: true/false
- pagination.type: none, numbered_pages, load_more_button, infinite_scroll, page_size_selector, unknown
- pagination.mechanism: Beskriv hur man paginerar
- requires_subpages.required: true om listningen bara visar rubriker/lankar och detaljer finns pa undersidor
- requires_subpages.reason: Varfor undersidor kravs
- selectors_hint: CSS-selektorer som kan hjalpa extraction-agenten
- notes: Observationer om sidan
- confidence: high, medium, low
- approved: false (alltid false - manniska godkanner)`;

function stripHtmlForContext(html, maxChars = 15000) {
  // Aggressive stripping for Discovery - we need structure, not content
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

async function discoverMunicipality(client, browser, target) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`DISCOVERING: ${target.name} (${target.homepage})`);
  console.log("=".repeat(60));

  const context = await browser.newContext({
    userAgent: "FloedAgent/0.1 (byggsignal.se; datainsamling fran offentliga anslagstavlor)"
  });
  const page = await context.newPage();

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let navigations = 0;
  const maxNavigations = 8;
  const conversationHistory = [];

  // Step 1: Navigate to homepage and get initial HTML
  console.log(`[Nav ${navigations + 1}] Going to: ${target.homepage}`);
  await page.goto(target.homepage, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(1000);
  navigations++;

  let currentUrl = page.url();
  let currentHtml = stripHtmlForContext(await page.content());

  // Start conversation with Sonnet
  conversationHistory.push({
    role: "user",
    content: `Kommun: ${target.name}\nStartsida: ${currentUrl}\n\nHTML-struktur (forkortat):\n${currentHtml}\n\nHitta var denna kommun publicerar sina bygglovsarenden/anslagstavla. Svara med ett kommando: NAVIGATE: <url>, CLICK: <text>, eller ANALYZE om du redan ser arendelistan.`
  });

  let discoveryResult = null;
  let configJson = null;

  while (navigations < maxNavigations) {
    // Ask Sonnet (with rate limit retry)
    const response = await callWithRetry(() => client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: DISCOVERY_SYSTEM_PROMPT,
      messages: conversationHistory
    }));

    totalInputTokens += response.usage.input_tokens;
    totalOutputTokens += response.usage.output_tokens;

    const reply = response.content[0].text.trim();
    conversationHistory.push({ role: "assistant", content: reply });

    console.log(`[Sonnet] ${reply.slice(0, 200)}${reply.length > 200 ? "..." : ""}`);

    // Parse command
    if (reply.startsWith("NAVIGATE:")) {
      const url = reply.replace("NAVIGATE:", "").trim();
      console.log(`[Nav ${navigations + 1}] Going to: ${url}`);

      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
        await page.waitForTimeout(1000);
        navigations++;
        currentUrl = page.url();
        currentHtml = stripHtmlForContext(await page.content());

        conversationHistory.push({
          role: "user",
          content: `Navigerade till: ${currentUrl}\n\nHTML-struktur:\n${currentHtml}\n\nSvara med naesta kommando: NAVIGATE, CLICK, eller ANALYZE.`
        });
      } catch (err) {
        conversationHistory.push({
          role: "user",
          content: `FEL: Kunde inte navigera till ${url}. Felmeddelande: ${err.message}\nForsoek med en annan URL.`
        });
      }

      await new Promise((r) => setTimeout(r, 1000)); // Rate limit

    } else if (reply.startsWith("CLICK:")) {
      const selector = reply.replace("CLICK:", "").trim();
      console.log(`[Click] Trying: ${selector}`);

      try {
        // Try clicking by text first, then by selector
        try {
          await page.click(`text="${selector}"`, { timeout: 5000 });
        } catch {
          await page.click(selector, { timeout: 5000 });
        }
        await page.waitForTimeout(2000);
        navigations++;
        currentUrl = page.url();
        currentHtml = stripHtmlForContext(await page.content());

        conversationHistory.push({
          role: "user",
          content: `Klickade pa "${selector}". Nu pa: ${currentUrl}\n\nHTML-struktur:\n${currentHtml}\n\nSvara med naesta kommando: NAVIGATE, CLICK, eller ANALYZE.`
        });
      } catch (err) {
        conversationHistory.push({
          role: "user",
          content: `FEL: Kunde inte klicka pa "${selector}". Felmeddelande: ${err.message}\nForsoek annorlunda.`
        });
      }

      await new Promise((r) => setTimeout(r, 1000));

    } else if (reply.includes("ANALYZE")) {
      console.log("[Discovery] Found target page. Generating config...");

      // Get fresh HTML for analysis
      currentHtml = stripHtmlForContext(await page.content(), 30000);
      discoveryResult = {
        final_url: currentUrl,
        navigations_used: navigations,
        html_sample: currentHtml.slice(0, 2000)
      };

      // Ask Sonnet to produce config (with rate limit retry)
      const configResponse = await callWithRetry(() => client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        messages: [
          ...conversationHistory,
          {
            role: "user",
            content: `Bra. Du ar nu pa anslagstavlan: ${currentUrl}\n\nFullstandig HTML (forkortat):\n${currentHtml}\n\n${CONFIG_GENERATION_PROMPT}`
          }
        ]
      }));

      totalInputTokens += configResponse.usage.input_tokens;
      totalOutputTokens += configResponse.usage.output_tokens;

      const configText = configResponse.content[0].text.trim()
        .replace(/```json\s*/g, "").replace(/```\s*/g, "");

      try {
        configJson = JSON.parse(configText);
        configJson.approved = false; // Always false until human approves
        console.log("[Discovery] Config generated successfully");
      } catch (err) {
        console.error(`[Discovery] Failed to parse config JSON: ${err.message}`);
        console.error(`Raw: ${configText.slice(0, 500)}`);
        configJson = null;
      }

      break;

    } else {
      // Sonnet didn't follow the command format — nudge it
      conversationHistory.push({
        role: "user",
        content: "Svara med exakt ett kommando: NAVIGATE: <url>, CLICK: <text/selektor>, eller ANALYZE."
      });
    }
  }

  await context.close();

  const cost = (totalInputTokens * SONNET_INPUT_COST) + (totalOutputTokens * SONNET_OUTPUT_COST);

  return {
    municipality: target.name,
    municipality_id: target.id,
    homepage: target.homepage,
    success: configJson !== null,
    config: configJson,
    discovery_result: discoveryResult,
    navigations_used: navigations,
    max_navigations: maxNavigations,
    tokens: {
      input: totalInputTokens,
      output: totalOutputTokens,
      cost_usd: cost
    }
  };
}

async function main() {
  await mkdir(CONFIG_DIR, { recursive: true });
  await mkdir(COST_DIR, { recursive: true });

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY not set.");
    process.exit(1);
  }

  const client = new Anthropic();
  const browser = await chromium.launch({ headless: true });

  let targets = DISCOVERY_TARGETS;
  if (onlyIds) {
    targets = DISCOVERY_TARGETS.filter((t) => onlyIds.includes(t.id));
  }

  console.log("=== Floede Agent - Discovery ===");
  console.log(`Discovering ${targets.length} municipalities\n`);

  const allResults = [];
  let totalCost = 0;

  for (const target of targets) {
    const result = await discoverMunicipality(client, browser, target);
    allResults.push(result);
    totalCost += result.tokens.cost_usd;

    // Save individual config
    if (result.config) {
      await writeFile(
        join(CONFIG_DIR, `${result.municipality_id}_config.json`),
        JSON.stringify(result.config, null, 2),
        "utf-8"
      );
    }

    // Save full discovery log
    await writeFile(
      join(CONFIG_DIR, `${result.municipality_id}_discovery_log.json`),
      JSON.stringify(result, null, 2),
      "utf-8"
    );

    console.log(`\n[${result.municipality}] ${result.success ? "SUCCESS" : "FAILED"} - ${result.navigations_used} navs, $${result.tokens.cost_usd.toFixed(4)}`);
  }

  await browser.close();

  // Summary
  console.log("\n\n=== DISCOVERY SUMMARY ===");
  console.log("Municipality  | Success | Navs | Tokens (in/out) | Cost");
  console.log("--------------|---------|------|-----------------|------");
  allResults.forEach((r) => {
    console.log(
      `${r.municipality.padEnd(13)} | ${(r.success ? "YES" : "NO").padEnd(7)} | ${String(r.navigations_used).padEnd(4)} | ${r.tokens.input}/${r.tokens.output} | $${r.tokens.cost_usd.toFixed(4)}`
    );
  });
  console.log(`\nTotal cost: $${totalCost.toFixed(4)}`);
  console.log(`Success rate: ${allResults.filter((r) => r.success).length}/${allResults.length}`);

  // Save cost log
  await writeFile(
    join(COST_DIR, `discovery_cost_${Date.now()}.json`),
    JSON.stringify({
      run_at: new Date().toISOString(),
      agent: "discovery",
      model: "claude-sonnet-4-6",
      total_cost_usd: totalCost,
      details: allResults.map((r) => ({
        municipality: r.municipality,
        success: r.success,
        navigations: r.navigations_used,
        input_tokens: r.tokens.input,
        output_tokens: r.tokens.output,
        cost_usd: r.tokens.cost_usd
      }))
    }, null, 2),
    "utf-8"
  );

  // Save full summary
  await writeFile(
    join(CONFIG_DIR, `discovery_summary_${Date.now()}.json`),
    JSON.stringify({
      run_at: new Date().toISOString(),
      total_cost_usd: totalCost,
      success_rate: `${allResults.filter((r) => r.success).length}/${allResults.length}`,
      results: allResults
    }, null, 2),
    "utf-8"
  );
}

main().catch(console.error);
