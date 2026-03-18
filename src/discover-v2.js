import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { EXAMPLE_CONFIG } from "./config/discovery-schema.js";

const CONFIG_DIR = join(process.cwd(), "data", "discovery");
const COST_DIR = join(process.cwd(), "data", "costs");

// Sonnet pricing
const SONNET_INPUT_COST = 0.000003;
const SONNET_OUTPUT_COST = 0.000015;

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

const DISCOVERY_TARGETS = [
  // Fas A (5 befintliga)
  { id: "nacka", name: "Nacka", homepage: "https://www.nacka.se" },
  { id: "helsingborg", name: "Helsingborg", homepage: "https://helsingborg.se" },
  { id: "malmo", name: "Malmö", homepage: "https://malmo.se" },
  { id: "molndal", name: "Mölndal", homepage: "https://www.molndal.se" },
  { id: "lund", name: "Lund", homepage: "https://www.lund.se" },
  // Fas B (15 nya)
  { id: "uppsala", name: "Uppsala", homepage: "https://www.uppsala.se" },
  { id: "linkoping", name: "Linköping", homepage: "https://www.linkoping.se" },
  { id: "norrkoping", name: "Norrköping", homepage: "https://www.norrkoping.se" },
  { id: "umea", name: "Umeå", homepage: "https://www.umea.se" },
  { id: "orebro", name: "Örebro", homepage: "https://www.orebro.se" },
  { id: "jonkoping", name: "Jönköping", homepage: "https://www.jonkoping.se" },
  { id: "karlstad", name: "Karlstad", homepage: "https://karlstad.se" },
  { id: "vasteras", name: "Västerås", homepage: "https://www.vasteras.se" },
  { id: "sundsvall", name: "Sundsvall", homepage: "https://www.sundsvall.se" },
  { id: "halmstad", name: "Halmstad", homepage: "https://www.halmstad.se" },
  { id: "trosa", name: "Trosa", homepage: "https://www.trosa.se" },
  { id: "hoor", name: "Höör", homepage: "https://www.hoor.se" },
  { id: "tibro", name: "Tibro", homepage: "https://www.tibro.se" },
  { id: "kiruna", name: "Kiruna", homepage: "https://www.kiruna.se" },
  { id: "gotland", name: "Gotland", homepage: "https://www.gotland.se" },
  // Fas C (30 nya, kommun 21-50)
  { id: "stockholm", name: "Stockholm", homepage: "https://www.stockholm.se" },
  { id: "goteborg", name: "Göteborg", homepage: "https://www.goteborg.se" },
  { id: "boras", name: "Borås", homepage: "https://www.boras.se" },
  { id: "huddinge", name: "Huddinge", homepage: "https://www.huddinge.se" },
  { id: "eskilstuna", name: "Eskilstuna", homepage: "https://www.eskilstuna.se" },
  { id: "sodertalje", name: "Södertälje", homepage: "https://www.sodertalje.se" },
  { id: "gavle", name: "Gävle", homepage: "https://www.gavle.se" },
  { id: "vaxjo", name: "Växjö", homepage: "https://www.vaxjo.se" },
  { id: "botkyrka", name: "Botkyrka", homepage: "https://www.botkyrka.se" },
  { id: "haninge", name: "Haninge", homepage: "https://www.haninge.se" },
  { id: "trollhattan", name: "Trollhättan", homepage: "https://www.trollhattan.se" },
  { id: "nykoping", name: "Nyköping", homepage: "https://www.nykoping.se" },
  { id: "lidingo", name: "Lidingö", homepage: "https://www.lidingo.se" },
  { id: "osteraker", name: "Österåker", homepage: "https://www.osteraker.se" },
  { id: "kristianstad", name: "Kristianstad", homepage: "https://www.kristianstad.se" },
  { id: "solna", name: "Solna", homepage: "https://www.solna.se" },
  { id: "jarfalla", name: "Järfälla", homepage: "https://www.jarfalla.se" },
  { id: "lulea", name: "Luleå", homepage: "https://www.lulea.se" },
  { id: "taby", name: "Täby", homepage: "https://www.taby.se" },
  { id: "skelleftea", name: "Skellefteå", homepage: "https://www.skelleftea.se" },
  { id: "kalmar", name: "Kalmar", homepage: "https://www.kalmar.se" },
  { id: "varberg", name: "Varberg", homepage: "https://www.varberg.se" },
  { id: "ostersund", name: "Östersund", homepage: "https://www.ostersund.se" },
  { id: "norrtalje", name: "Norrtälje", homepage: "https://www.norrtalje.se" },
  { id: "falun", name: "Falun", homepage: "https://www.falun.se" },
  { id: "landskrona", name: "Landskrona", homepage: "https://www.landskrona.se" },
  { id: "upplands-vasby", name: "Upplands Väsby", homepage: "https://www.upplandsvasby.se" },
  { id: "tyreso", name: "Tyresö", homepage: "https://www.tyreso.se" },
  { id: "vallentuna", name: "Vallentuna", homepage: "https://www.vallentuna.se" },
  // Fas D (30 nya, kommun 51-80)
  { id: "kungsbacka", name: "Kungsbacka", homepage: "https://www.kungsbacka.se" },
  { id: "sollentuna", name: "Sollentuna", homepage: "https://www.sollentuna.se" },
  { id: "karlskrona", name: "Karlskrona", homepage: "https://www.karlskrona.se" },
  { id: "uddevalla", name: "Uddevalla", homepage: "https://www.uddevalla.se" },
  { id: "skovde", name: "Skövde", homepage: "https://www.skovde.se" },
  { id: "sigtuna", name: "Sigtuna", homepage: "https://www.sigtuna.se" },
  { id: "varmdo", name: "Värmdö", homepage: "https://www.varmdo.se" },
  { id: "trelleborg", name: "Trelleborg", homepage: "https://www.trelleborg.se" },
  { id: "enkoping", name: "Enköping", homepage: "https://www.enkoping.se" },
  { id: "motala", name: "Motala", homepage: "https://www.motala.se" },
  { id: "angelholm", name: "Ängelholm", homepage: "https://www.engelholm.se" },
  { id: "lerum", name: "Lerum", homepage: "https://www.lerum.se" },
  { id: "pitea", name: "Piteå", homepage: "https://www.pitea.se" },
  { id: "alingsas", name: "Alingsås", homepage: "https://www.alingsas.se" },
  { id: "partille", name: "Partille", homepage: "https://www.partille.se" },
  { id: "sandviken", name: "Sandviken", homepage: "https://www.sandviken.se" },
  { id: "strangnas", name: "Strängnäs", homepage: "https://www.strangnas.se" },
  { id: "vellinge", name: "Vellinge", homepage: "https://www.vellinge.se" },
  { id: "katrineholm", name: "Katrineholm", homepage: "https://www.katrineholm.se" },
  { id: "varnamo", name: "Värnamo", homepage: "https://www.varnamo.se" },
  { id: "danderyd", name: "Danderyd", homepage: "https://www.danderyd.se" },
  { id: "ystad", name: "Ystad", homepage: "https://www.ystad.se" },
  { id: "nynashamn", name: "Nynäshamn", homepage: "https://www.nynashamn.se" },
  { id: "mjolby", name: "Mjölby", homepage: "https://www.mjolby.se" },
  { id: "ekero", name: "Ekerö", homepage: "https://www.ekero.se" },
  { id: "harnosand", name: "Härnösand", homepage: "https://www.harnosand.se" },
  { id: "lomma", name: "Lomma", homepage: "https://www.lomma.se" },
  { id: "staffanstorp", name: "Staffanstorp", homepage: "https://www.staffanstorp.se" },
  { id: "habo", name: "Håbo", homepage: "https://www.habo.se" },
  { id: "kumla", name: "Kumla", homepage: "https://www.kumla.se" },

  // Fas E (10 nya, kommun 81-90)
  { id: "kungalv", name: "Kungälv", homepage: "https://www.kungalv.se" },
  { id: "sundbyberg", name: "Sundbyberg", homepage: "https://www.sundbyberg.se" },
  { id: "hassleholm", name: "Hässleholm", homepage: "https://www.hassleholm.se" },
  { id: "ornskoldsvik", name: "Örnsköldsvik", homepage: "https://www.ornskoldsvik.se" },
  { id: "falkenberg", name: "Falkenberg", homepage: "https://www.falkenberg.se" },
  { id: "lidkoping", name: "Lidköping", homepage: "https://www.lidkoping.se" },
  { id: "burlov", name: "Burlöv", homepage: "https://www.burlov.se" },
  { id: "svedala", name: "Svedala", homepage: "https://www.svedala.se" },
  { id: "eslov", name: "Eslöv", homepage: "https://www.eslov.se" },
  { id: "laholm", name: "Laholm", homepage: "https://www.laholm.se" },

  // Fas F (10 nya, kommun 91-100)
  { id: "mariestad", name: "Mariestad", homepage: "https://www.mariestad.se" },
  { id: "oskarshamn", name: "Oskarshamn", homepage: "https://www.oskarshamn.se" },
  { id: "sala", name: "Sala", homepage: "https://www.sala.se" },
  { id: "koping", name: "Köping", homepage: "https://www.koping.se" },
  { id: "arvika", name: "Arvika", homepage: "https://www.arvika.se" },
  { id: "tranas", name: "Tranås", homepage: "https://www.tranas.se" },
  { id: "saffle", name: "Säffle", homepage: "https://www.saffle.se" },
  { id: "lysekil", name: "Lysekil", homepage: "https://www.lysekil.se" },
  { id: "osby", name: "Osby", homepage: "https://www.osby.se" },
  { id: "tierp", name: "Tierp", homepage: "https://www.tierp.se" },

  // Fas G (10 nya, kommun 101-110)
  { id: "oxelosund", name: "Oxelösund", homepage: "https://www.oxelosund.se" },
  { id: "leksand", name: "Leksand", homepage: "https://www.leksand.se" },
  { id: "mora", name: "Mora", homepage: "https://www.mora.se" },
  { id: "avesta", name: "Avesta", homepage: "https://www.avesta.se" },
  { id: "hedemora", name: "Hedemora", homepage: "https://www.hedemora.se" },
  { id: "almhult", name: "Älmhult", homepage: "https://www.almhult.se" },
  { id: "hultsfred", name: "Hultsfred", homepage: "https://www.hultsfred.se" },
  { id: "vetlanda", name: "Vetlanda", homepage: "https://www.vetlanda.se" },
  { id: "gislaved", name: "Gislaved", homepage: "https://www.gislaved.se" },
  { id: "vaggeryd", name: "Vaggeryd", homepage: "https://www.vaggeryd.se" },

  // Fas H (10 nya, kommun 111-120)
  { id: "horby", name: "Hörby", homepage: "https://www.horby.se" },
  { id: "lilla-edet", name: "Lilla Edet", homepage: "https://www.lillaedet.se" },
  { id: "bollebygd", name: "Bollebygd", homepage: "https://www.bollebygd.se" },
  { id: "solvesborg", name: "Sölvesborg", homepage: "https://www.solvesborg.se" },
  { id: "filipstad", name: "Filipstad", homepage: "https://www.filipstad.se" },
  { id: "bengtsfors", name: "Bengtsfors", homepage: "https://www.bengtsfors.se" },
  { id: "simrishamn", name: "Simrishamn", homepage: "https://www.simrishamn.se" },
  { id: "svalov", name: "Svalöv", homepage: "https://www.svalov.se" },
  { id: "klippan", name: "Klippan", homepage: "https://www.klippan.se" },
  { id: "hoganas", name: "Höganäs", homepage: "https://www.hoganas.se" },

  // Fas I (10 nya, kommun 121-130)
  { id: "bastad", name: "Båstad", homepage: "https://www.bastad.se" },
  { id: "orust", name: "Orust", homepage: "https://www.orust.se" },
  { id: "munkedal", name: "Munkedal", homepage: "https://www.munkedal.se" },
  { id: "tanum", name: "Tanum", homepage: "https://www.tanum.se" },
  { id: "stenungsund", name: "Stenungsund", homepage: "https://www.stenungsund.se" },
  { id: "tjorn", name: "Tjörn", homepage: "https://www.tjorn.se" },
  { id: "herrljunga", name: "Herrljunga", homepage: "https://www.herrljunga.se" },
  { id: "vara", name: "Vara", homepage: "https://www.vara.se" },
  { id: "mark", name: "Mark", homepage: "https://www.mark.se" },
  { id: "ulricehamn", name: "Ulricehamn", homepage: "https://www.ulricehamn.se" },
];

// Parse --only=nacka,malmo CLI argument
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const onlyIds = onlyArg ? onlyArg.replace("--only=", "").split(",") : null;

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

async function discoverMunicipality(client, browser, target) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`DISCOVERING: ${target.name}`);
  console.log("=".repeat(60));

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let navigations = 0;
  const maxNavigations = 6;

  // ═══════════════════════════════════════
  // PHASE 1: Web search to find URL
  // ═══════════════════════════════════════

  console.log(`[Phase 1] Web search for anslagstavla URL...`);

  const searchResponse = await callWithRetry(() => client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    tools: [
      {
        type: "web_search_20250305",
        name: "web_search"
      }
    ],
    messages: [
      {
        role: "user",
        content: `Hitta URL:en till ${target.name} kommuns anslagstavla for bygglov/kungorelser.

Sok efter: "${target.name} kommun anslagstavla bygglov" och liknande.

Jag behover den exakta URL:en dar kommunen publicerar sina bygglovsbeslut/kungorelser.
Det kan vara pa kommunens huvuddomän eller en subdomän (t.ex. anslagstavla.helsingborg.se).

Svara ENBART med:
URL: [den mest troliga URL:en]
ALTERNATIV: [eventuella andra kandidater, kommaseparerade]
KONFIDENS: hog/medel/lag`
      }
    ]
  }));

  totalInputTokens += searchResponse.usage.input_tokens;
  totalOutputTokens += searchResponse.usage.output_tokens;

  // Extract the text response (may contain multiple content blocks due to tool use)
  let searchResult = "";
  for (const block of searchResponse.content) {
    if (block.type === "text") {
      searchResult += block.text;
    }
  }

  console.log(`[Phase 1] Search result:\n${searchResult}`);

  // Parse URL from response
  const urlMatch = searchResult.match(/URL:\s*\*{0,2}(https?:\/\/[^\s\n*]+)\*{0,2}/i);
  let candidateUrl = urlMatch ? urlMatch[1].trim() : null;

  // If no URL found, try a second search with different query
  if (!candidateUrl) {
    console.log(`[Phase 1] First search failed, trying alternative query...`);

    const retryResponse = await callWithRetry(() => client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search"
        }
      ],
      messages: [
        {
          role: "user",
          content: `Sok efter "${target.name} bygglov beslut kungorelse digital anslagstavla".
Jag letar efter sidan dar ${target.name} kommun publicerar sina bygglovsarenden offentligt.
Svara ENBART med:
URL: [URL]
KONFIDENS: hog/medel/lag`
        }
      ]
    }));

    totalInputTokens += retryResponse.usage.input_tokens;
    totalOutputTokens += retryResponse.usage.output_tokens;

    let retryResult = "";
    for (const block of retryResponse.content) {
      if (block.type === "text") {
        retryResult += block.text;
      }
    }

    console.log(`[Phase 1] Retry result:\n${retryResult}`);

    const retryUrlMatch = retryResult.match(/URL:\s*\*{0,2}(https?:\/\/[^\s\n*]+)\*{0,2}/i);
    candidateUrl = retryUrlMatch ? retryUrlMatch[1].trim() : null;
  }

  // FALLBACK: if still no URL, flag as needs_manual_url
  if (!candidateUrl) {
    console.log(`[${target.name}] FALLBACK: needs_manual_url — web search could not find anslagstavla`);

    const cost = (totalInputTokens * SONNET_INPUT_COST) + (totalOutputTokens * SONNET_OUTPUT_COST);
    return {
      municipality: target.name,
      municipality_id: target.id,
      success: false,
      needs_manual_url: true,
      config: null,
      navigations_used: 0,
      tokens: { input: totalInputTokens, output: totalOutputTokens, cost_usd: cost },
      failure_reason: "Web search could not find anslagstavla URL after 2 attempts"
    };
  }

  console.log(`[Phase 1] Best candidate URL: ${candidateUrl}`);

  // ═══════════════════════════════════════
  // PHASE 2: Load page with Playwright
  // ═══════════════════════════════════════

  console.log(`[Phase 2] Loading page with Playwright...`);

  const context = await browser.newContext({
    userAgent: "FloedAgent/0.1 (byggsignal.se; datainsamling fran offentliga anslagstavlor)"
  });
  const page = await context.newPage();

  let currentUrl = candidateUrl;
  let currentHtml = "";

  try {
    await page.goto(candidateUrl, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(1500);
    currentUrl = page.url();
    currentHtml = stripHtmlForContext(await page.content());
    navigations++;
    console.log(`[Phase 2] Page loaded: ${currentUrl} (${currentHtml.length} chars)`);
  } catch (err) {
    console.error(`[Phase 2] Failed to load ${candidateUrl}: ${err.message}`);
    await context.close();

    const cost = (totalInputTokens * SONNET_INPUT_COST) + (totalOutputTokens * SONNET_OUTPUT_COST);
    return {
      municipality: target.name,
      municipality_id: target.id,
      success: false,
      needs_manual_url: true,
      config: null,
      navigations_used: navigations,
      tokens: { input: totalInputTokens, output: totalOutputTokens, cost_usd: cost },
      failure_reason: `Could not load candidate URL: ${err.message}`
    };
  }

  // ═══════════════════════════════════════
  // PHASE 3: Sonnet analyzes page + builds config
  // ═══════════════════════════════════════

  console.log(`[Phase 3] Sonnet analyzing page structure...`);

  const conversationHistory = [
    {
      role: "user",
      content: `Kommun: ${target.name}
URL: ${currentUrl}

HTML-struktur (forkortat):
${currentHtml}

Ar detta ${target.name} kommuns anslagstavla for bygglov/kungorelser?

Om JA: svara ANALYZE och jag ber dig producera en config.
Om NEJ: svara NAVIGATE: <battre-url> om du ser en lank till ratt sida.
Om OSAKER: svara vad du ser och vad som saknas.`
    }
  ];

  let configJson = null;
  let attempts = 0;
  const maxAttempts = 4;

  while (attempts < maxAttempts && !configJson) {
    attempts++;

    const response = await callWithRetry(() => client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      messages: conversationHistory
    }));

    totalInputTokens += response.usage.input_tokens;
    totalOutputTokens += response.usage.output_tokens;

    const reply = response.content[0].text.trim();
    conversationHistory.push({ role: "assistant", content: reply });

    console.log(`[Sonnet] ${reply.slice(0, 300)}${reply.length > 300 ? "..." : ""}`);

    if (reply.includes("ANALYZE")) {
      // Get fresh HTML with more context for config generation
      currentHtml = stripHtmlForContext(await page.content(), 30000);

      const configResponse = await callWithRetry(() => client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        messages: [
          ...conversationHistory,
          {
            role: "user",
            content: `Bra. Producera en insamlingskonfiguration for denna anslagstavla.

URL: ${currentUrl}
HTML (forkortat):
${currentHtml}

${CONFIG_GENERATION_PROMPT}`
          }
        ]
      }));

      totalInputTokens += configResponse.usage.input_tokens;
      totalOutputTokens += configResponse.usage.output_tokens;

      const configText = configResponse.content[0].text.trim()
        .replace(/```json\s*/g, "").replace(/```\s*/g, "");

      try {
        configJson = JSON.parse(configText);
        configJson.approved = false;
        console.log(`[Phase 3] Config generated successfully`);
      } catch (err) {
        console.error(`[Phase 3] Failed to parse config: ${err.message}`);
      }

    } else if (reply.startsWith("NAVIGATE:") || reply.includes("NAVIGATE:")) {
      const navMatch = reply.match(/NAVIGATE:\s*(https?:\/\/[^\s\n]+)/);
      if (navMatch && navigations < maxNavigations) {
        const navUrl = navMatch[1].trim();
        console.log(`[Nav ${navigations + 1}] Going to: ${navUrl}`);

        try {
          await page.goto(navUrl, { waitUntil: "networkidle", timeout: 30000 });
          await page.waitForTimeout(1000);
          navigations++;
          currentUrl = page.url();
          currentHtml = stripHtmlForContext(await page.content());

          conversationHistory.push({
            role: "user",
            content: `Navigerade till: ${currentUrl}\n\nHTML-struktur:\n${currentHtml}\n\nAr detta anslagstavlan? Svara ANALYZE eller NAVIGATE.`
          });
        } catch (err) {
          conversationHistory.push({
            role: "user",
            content: `Kunde inte ladda ${navUrl}: ${err.message}. Forsok annorlunda.`
          });
        }

        await new Promise((r) => setTimeout(r, 1000));
      } else {
        // navMatch failed or max navigations reached — ask to ANALYZE instead
        conversationHistory.push({
          role: "user",
          content: "URL:en var ogiltig eller max navigeringar nadda. Svara ANALYZE for nuvarande sida eller ge en giltig https-URL med NAVIGATE: <url>."
        });
      }
    } else {
      conversationHistory.push({
        role: "user",
        content: "Svara med ANALYZE om detta ar anslagstavlan, eller NAVIGATE: <url> om du behover navigera vidare."
      });
    }
  }

  await context.close();

  const cost = (totalInputTokens * SONNET_INPUT_COST) + (totalOutputTokens * SONNET_OUTPUT_COST);

  return {
    municipality: target.name,
    municipality_id: target.id,
    success: configJson !== null,
    needs_manual_url: false,
    config: configJson,
    navigations_used: navigations,
    candidate_url: candidateUrl,
    final_url: currentUrl,
    tokens: { input: totalInputTokens, output: totalOutputTokens, cost_usd: cost },
    failure_reason: configJson ? null : "Could not generate valid config after analysis"
  };
}

async function main() {
  await mkdir(CONFIG_DIR, { recursive: true });
  await mkdir(COST_DIR, { recursive: true });

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY not set.");
    process.exit(1);
  }

  const supabase = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY)
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
    : null;

  const client = new Anthropic();
  const browser = await chromium.launch({ headless: true });

  let targets = DISCOVERY_TARGETS;
  if (onlyIds) {
    targets = targets.filter((t) => onlyIds.includes(t.id));
  }

  console.log("=== Floede Agent - Discovery v2 (Web Search) ===");
  console.log(`Discovering ${targets.length} municipalities\n`);

  const allResults = [];
  let totalCost = 0;

  for (const target of targets) {
    const result = await discoverMunicipality(client, browser, target);
    allResults.push(result);
    totalCost += result.tokens.cost_usd;

    if (result.config) {
      // Local backup
      await writeFile(
        join(CONFIG_DIR, `${result.municipality_id}_config.json`),
        JSON.stringify(result.config, null, 2),
        "utf-8"
      );

      // Primary: Supabase
      if (supabase) {
        const { error } = await supabase
          .from("discovery_configs")
          .upsert({
            municipality: result.config.municipality,
            config: result.config,
            approved: false,
            confidence: result.config.confidence || null,
            updated_at: new Date().toISOString(),
          }, { onConflict: "municipality" });

        if (error) {
          console.log(`  [Supabase] Error saving config: ${error.message}`);
        } else {
          console.log(`  [Supabase] Config saved for ${result.config.municipality}`);
        }
      }
    }

    await writeFile(
      join(CONFIG_DIR, `${result.municipality_id}_discovery_v2_log.json`),
      JSON.stringify(result, null, 2),
      "utf-8"
    );

    const status = result.success ? "SUCCESS" : (result.needs_manual_url ? "NEEDS_MANUAL_URL" : "FAILED");
    console.log(`\n[${result.municipality}] ${status} — ${result.navigations_used} navs, $${result.tokens.cost_usd.toFixed(4)}`);
  }

  await browser.close();

  // Summary
  console.log("\n\n=== DISCOVERY v2 SUMMARY ===");
  console.log("Municipality  | Status          | Navs | Candidate URL                              | Cost");
  console.log("--------------|-----------------|------|--------------------------------------------|---------");
  allResults.forEach((r) => {
    const status = r.success ? "SUCCESS" : (r.needs_manual_url ? "MANUAL_URL" : "FAILED");
    console.log(
      `${r.municipality.padEnd(13)} | ${status.padEnd(15)} | ${String(r.navigations_used).padEnd(4)} | ${(r.candidate_url || "N/A").slice(0, 42).padEnd(42)} | $${r.tokens.cost_usd.toFixed(4)}`
    );
  });

  const succeeded = allResults.filter((r) => r.success).length;
  const manualNeeded = allResults.filter((r) => r.needs_manual_url).length;
  console.log(`\nSuccess: ${succeeded}/${allResults.length}`);
  console.log(`Needs manual URL: ${manualNeeded}/${allResults.length}`);
  console.log(`Total cost: $${totalCost.toFixed(4)}`);

  // Save cost log
  await writeFile(
    join(COST_DIR, `discovery_v2_cost_${Date.now()}.json`),
    JSON.stringify({
      run_at: new Date().toISOString(),
      agent: "discovery_v2",
      model: "claude-sonnet-4-6",
      total_cost_usd: totalCost,
      success_rate: `${succeeded}/${allResults.length}`,
      details: allResults.map((r) => ({
        municipality: r.municipality,
        success: r.success,
        needs_manual_url: r.needs_manual_url,
        navigations: r.navigations_used,
        candidate_url: r.candidate_url,
        input_tokens: r.tokens.input,
        output_tokens: r.tokens.output,
        cost_usd: r.tokens.cost_usd
      }))
    }, null, 2),
    "utf-8"
  );
}

main().catch(console.error);
