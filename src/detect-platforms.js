// CMS platform detection for all 290 Swedish municipalities.
// Detects: Sitevision, EPiServer/Optimizely, WordPress, Municipio, Ciceron, Netpublicator
// Run: node src/detect-platforms.js
// Rate limit: max 2 req/sec. Budget: $0 (Playwright only, no API calls).

import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

// All 290 Swedish municipalities with their primary domain.
// Most follow [name].se pattern. Known exceptions listed explicitly.
const MUNICIPALITIES = [
  "ale", "alingsas", "alvesta", "aneby", "arboga", "arjeplog", "arvidsjaur",
  "arvika", "askersund", "avesta", "bengtsfors", "berg", "bjurholm", "bjuv",
  "boden", "bollebygd", "bollnas", "borgholm", "borlange", "boras",
  "botkyrka", "boxholm", "bromolla", "branas", "bstad",
  "burlov", "bastad", "dals-ed", "danderyd", "degerfors", "dorotea",
  "eda", "ekero", "eksjo", "emmaboda", "enkoping", "eskilstuna",
  "eslov", "essunga", "fagersta", "falkenberg", "falkoping", "falun",
  "filipstad", "finspang", "flen", "forshaga", "gagnef", "gislaved",
  "gnesta", "gnosjo", "goteborg", "gotland", "grums", "grastorp",
  "gullspang", "gavle", "haninge", "haparanda", "heby", "hedemora",
  "helsingborg", "herrljunga", "hjo", "hofors", "huddinge", "hudiksvall",
  "hultsfred", "hylte", "hagfors", "harjedalen", "harnosand", "harryda",
  "hassleholm", "habo", "hoganas", "hogsby", "hallefors", "hallsberg",
  "hallstahammar", "hoor", "horby", "jokkmokk", "jarfalla", "jonkoping",
  "kalix", "kalmar", "karlsborg", "karlshamn", "karlskoga", "karlskrona",
  "karlstad", "katrineholm", "kil", "kinda", "kiruna", "klippan",
  "knivsta", "kramfors", "kristianstad", "kristinehamn", "krokom",
  "kumla", "kungsbacka", "kungalv", "kungsor", "koping",
  "laholm", "landskrona", "laxå", "lekeberg", "leksand", "lerum",
  "lessebo", "lidingo", "lidkoping", "lilla-edet", "lindesberg",
  "linkoping", "ljungby", "ljusdal", "ljusnarsberg", "lomma", "ludvika",
  "lulea", "lund", "lycksele", "lysekil", "malmo", "malung-salen",
  "mala", "mariestad", "mark", "markaryd", "mellerud", "mjolby",
  "mora", "motala", "mullsjo", "munkedal", "munkfors", "molndal",
  "monsterås", "nacka", "nora", "norberg", "nordanstig", "nordmaling",
  "norrkoping", "norrtalje", "norsjö", "nybro", "nykoping", "nynashamn",
  "nassjo", "ockelbo", "olofstrom", "orsa", "orust", "osby",
  "oskarshamn", "ovanaker", "oxelosund", "pajala", "partille", "perstorp",
  "pitea", "ragunda", "robertsfors", "ronneby", "rattvik",
  "sala", "salem", "sandviken", "sigtuna", "simrishamn", "sjöbo",
  "skara", "skelleftea", "skinnskatteberg", "skurup", "skovde",
  "smedjebacken", "soderhamn", "soderkoping", "sodertalje", "solleftea",
  "sollentuna", "solna", "sorsele", "sotenas", "staffanstorp",
  "stenungsund", "stockholm", "storfors", "storuman", "strangnas",
  "stromsund", "sundbyberg", "sundsvall", "sunne", "surahammar",
  "svalov", "svenljunga", "saffle", "sater", "savenas",
  "solvesborg", "tanum", "tibro", "tidaholm", "tierp",
  "timra", "tingsryd", "tjorn", "tomelilla", "torsby", "torsas",
  "tranemo", "tranas", "trelleborg", "trollhattan", "trosa", "tyreso",
  "taby", "toreboda", "uddevalla", "ulricehamn", "umea", "upplands-vasby",
  "upplandsbro", "uppvidinge", "uppsala", "vaggeryd", "valdemarsvik",
  "vallentuna", "vanersborg", "vansbro", "vara", "varberg", "varmdo",
  "varnamo", "vasteras", "vaxholm", "vaxjo", "vellinge", "vetlanda",
  "vilhelmina", "vindeln", "vingaker", "vimmerby",
  "vårgårda", "vannas", "ydre", "ystad", "åmål",
  "ånge", "åre", "åtvidaberg", "alvdalen", "alvkarleby",
  "alvsbyn", "almhult", "angelholm", "orkelljunga", "ornskoldsvik",
  "ostersund", "osteraker", "osthammar", "orebro", "overkalix",
  "overtornea", "ostra-goinge",
];

// Domain exceptions: municipalities whose domain doesn't follow [name].se
const DOMAIN_OVERRIDES = {
  "goteborg": "goteborg.se",
  "malmo": "malmo.se",
  "boras": "boras.se",
  "linkoping": "linkoping.se",
  "norrkoping": "norrkoping.se",
  "jonkoping": "jonkoping.se",
  "vasteras": "vasteras.se",
  "orebro": "orebro.se",
  "gavle": "gavle.se",
  "umea": "umea.se",
  "lulea": "lulea.se",
  "eskilstuna": "eskilstuna.se",
  "sodertalje": "sodertalje.se",
  "helsingborg": "helsingborg.se",
  "lilla-edet": "lillaedet.se",
  "upplands-vasby": "upplandsvasby.se",
  "dals-ed": "dalsed.se",
  "malung-salen": "malung-salen.se",
  "ostra-goinge": "ostragoinge.se",
  "bastad": "bastad.se",
  "angelholm": "engelholm.se",
  "hassleholm": "hassleholm.se",
  "harnosand": "harnosand.se",
  "harryda": "harryda.se",
  "hoganas": "hoganas.se",
  "hogsby": "hogsby.se",
  "hallefors": "hallefors.se",
  "hallsberg": "hallsberg.se",
  "hallstahammar": "hallstahammar.se",
  "hoor": "hoor.se",
  "horby": "horby.se",
  "harjedalen": "herjedalen.se",
  "hagfors": "hagfors.se",
  "nassjo": "nassjo.se",
  "savenas": "savsjo.se",
  "sater": "sater.se",
  "eksjo": "eksjo.se",
  "sjöbo": "sjobo.se",
  "stromsund": "stromsund.se",
  "vanersborg": "vanersborg.se",
  "toreboda": "toreboda.se",
  "rattvik": "rattvik.se",
  "alvdalen": "alvdalen.se",
  "alvkarleby": "alvkarleby.se",
  "alvsbyn": "alvsbyn.se",
  "åmål": "amal.se",
  "ånge": "ange.se",
  "åre": "are.se",
  "åtvidaberg": "atvidaberg.se",
  "vårgårda": "vargarda.se",
  "norsjö": "norsjo.se",
  "monsterås": "monsteras.se",
  "laxå": "laxa.se",
  "orkelljunga": "orkelljunga.se",
  "ostersund": "ostersund.se",
  "osteraker": "osteraker.se",
  "osthammar": "osthammar.se",
  "overkalix": "overkalix.se",
  "overtornea": "overtornea.se",
  "vannas": "vannas.se",
  "branas": "brantorp.se",
};

function getDomain(id) {
  if (DOMAIN_OVERRIDES[id]) return DOMAIN_OVERRIDES[id];
  return `${id}.se`;
}

function detectPlatform(html, url) {
  const lower = html.toLowerCase();
  const detections = [];

  // Sitevision: /sitevision/ paths, sv-template/sv-portlet classes, sv-cookie
  if (/\/sitevision\//i.test(html) || /class="sv-/i.test(html) || /sv-template/i.test(html) ||
      /sv-portlet/i.test(html) || /sv-cookie/i.test(html) || /sitevision/i.test(html)) {
    detections.push({ platform: "sitevision", confidence: "high" });
  }

  // EPiServer / Optimizely
  if (/episerver/i.test(html) || /optimizely/i.test(html) || /epi-contentarea/i.test(html) ||
      /EPiServer\.Forms/i.test(html) || /data-epi-/i.test(html)) {
    detections.push({ platform: "episerver", confidence: "high" });
  }

  // WordPress
  if (/wp-content/i.test(html) || /wp-includes/i.test(html) || /wp-json/i.test(html) ||
      /wordpress/i.test(html)) {
    detections.push({ platform: "wordpress", confidence: "high" });
  }

  // Municipio (Helsingborg-based WordPress theme for municipalities)
  if (/municipio/i.test(html) || /theme\/municipio/i.test(html)) {
    detections.push({ platform: "municipio", confidence: "high" });
  }

  // Ciceron
  if (/ciceron/i.test(html)) {
    detections.push({ platform: "ciceron", confidence: "high" });
  }

  // Netpublicator
  if (/netpublicator/i.test(html)) {
    detections.push({ platform: "netpublicator", confidence: "high" });
  }

  // Drupal
  if (/drupal/i.test(html) || /sites\/default\/files/i.test(html) || /\/core\/misc\/drupal/i.test(html)) {
    detections.push({ platform: "drupal", confidence: "high" });
  }

  // Liferay
  if (/liferay/i.test(html)) {
    detections.push({ platform: "liferay", confidence: "high" });
  }

  // Formpipe / Evolution
  if (/formpipe/i.test(html) || /ondemand\.formpipe/i.test(html)) {
    detections.push({ platform: "formpipe", confidence: "high" });
  }

  // Sharepoint
  if (/sharepoint/i.test(html) || /_layouts\//i.test(html) || /sp\.js/i.test(html)) {
    detections.push({ platform: "sharepoint", confidence: "medium" });
  }

  if (detections.length === 0) {
    return { platform: "unknown", confidence: "low" };
  }

  // Municipio is a WordPress theme — prefer "municipio" over "wordpress"
  const municipio = detections.find((d) => d.platform === "municipio");
  if (municipio) return municipio;

  return detections[0];
}

async function main() {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "FloedAgent/0.1 (byggsignal.se; CMS-detektion for research)",
  });

  const results = [];
  const errors = [];
  let processed = 0;

  console.log(`=== CMS Platform Detection ===`);
  console.log(`Municipalities: ${MUNICIPALITIES.length}\n`);

  for (const id of MUNICIPALITIES) {
    const domain = getDomain(id);
    const url = `https://www.${domain}`;
    processed++;

    try {
      const page = await context.newPage();
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
      const html = await page.content();
      const finalUrl = page.url();
      await page.close();

      const { platform, confidence } = detectPlatform(html, finalUrl);
      results.push({ municipality: id, domain, platform, confidence });

      if (processed % 20 === 0 || processed === MUNICIPALITIES.length) {
        console.log(`[${processed}/${MUNICIPALITIES.length}] ${id} → ${platform} (${confidence})`);
      }
    } catch (err) {
      const msg = err.message.length > 80 ? err.message.slice(0, 80) + "..." : err.message;
      results.push({ municipality: id, domain, platform: "error", confidence: "low" });
      errors.push({ municipality: id, domain, error: msg });
      if (processed % 20 === 0) {
        console.log(`[${processed}/${MUNICIPALITIES.length}] ${id} → ERROR: ${msg}`);
      }
    }

    // Rate limit: ~2 req/sec
    await new Promise((r) => setTimeout(r, 500));
  }

  await browser.close();

  // Insert to Supabase
  console.log(`\nSaving ${results.length} results to Supabase...`);
  let saved = 0;
  for (const r of results) {
    const { error } = await supabase
      .from("municipality_platforms")
      .upsert({
        municipality: r.municipality,
        domain: r.domain,
        platform: r.platform,
        confidence: r.confidence,
        checked_at: new Date().toISOString(),
      }, { onConflict: "municipality" });

    if (error) {
      console.log(`  Error saving ${r.municipality}: ${error.message}`);
    } else {
      saved++;
    }
  }
  console.log(`Saved: ${saved}/${results.length}`);

  // Distribution
  const dist = {};
  for (const r of results) {
    dist[r.platform] = (dist[r.platform] || 0) + 1;
  }

  console.log(`\nPLATFORM DISTRIBUTION:`);
  const sorted = Object.entries(dist).sort((a, b) => b[1] - a[1]);
  for (const [platform, count] of sorted) {
    console.log(`  ${platform}: ${count} kommuner`);
  }
  console.log(`\nTOTAL: ${results.length}`);

  if (errors.length > 0) {
    console.log(`\nERRORS (${errors.length}):`);
    for (const e of errors) {
      console.log(`  ${e.municipality} (${e.domain}): ${e.error}`);
    }
  }
}

main().catch(console.error);
