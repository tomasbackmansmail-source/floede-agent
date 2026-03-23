// Import Kommunkartan data for ONLY the municipalities missing KK data.
// Run: node --env-file=.env src/import-kk-missing.js

import { createClient } from "@supabase/supabase-js";

const BASE_URL = "https://kommunkartan.se";
const USER_AGENT = "FloedAgent/0.2 (byggsignal.se; dataimport)";
const BATCH_SIZE = 50;
const RATE_LIMIT_MS = 4000;
const PUBLISHED_FROM = "2025-12-19";
const PUBLISHED_TO = "2026-03-19";

const STAD_MUNICIPALITIES = new Set([
  "Stockholm", "Göteborg", "Malmö", "Lidingö", "Solna", "Sundbyberg",
  "Helsingborg", "Landskrona", "Lund", "Borås", "Trollhättan",
  "Kalmar", "Karlskrona", "Kristianstad", "Halmstad", "Växjö",
  "Linköping", "Norrköping", "Jönköping", "Västerås", "Örebro",
  "Uppsala", "Gävle", "Sundsvall", "Umeå", "Luleå", "Karlstad",
  "Eskilstuna", "Skövde", "Falun", "Nyköping",
]);

const SLUG_OVERRIDES = {
  "Falun": ["falu-kommun", "falun-kommun", "faluns-kommun"],
  "Göteborg": ["goteborgs-stad", "goteborg-stad", "goteborg-kommun"],
  "Helsingborg": ["helsingborgs-stad", "helsingborg-stad", "helsingborg-kommun"],
  "Malmö": ["malmo-stad", "malmos-stad", "malmo-kommun"],
  "Lund": ["lunds-kommun", "lund-kommun", "lund-stad"],
  "Uppsala": ["uppsalas-kommun", "uppsala-kommun", "uppsala-stad"],
  "Linköping": ["linkopings-kommun", "linkoping-kommun", "linkoping-stad"],
  "Västerås": ["vasteras-stad", "vasteras-kommun"],
  "Örebro": ["orebro-kommun", "orebros-kommun"],
  "Jönköping": ["jonkopings-kommun", "jonkoping-kommun"],
  "Norrköping": ["norrkopings-kommun", "norrkoping-kommun"],
};

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/å/g, "a").replace(/ä/g, "a").replace(/ö/g, "o")
    .replace(/é/g, "e").replace(/ü/g, "u")
    .replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

let consecutive429 = 0;

async function apiFetch(path, retries = 3) {
  const url = `${BASE_URL}${path}`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(20000),
      });
      if (resp.status === 429) {
        consecutive429++;
        if (consecutive429 >= 3) {
          console.log("  [429x3] Waiting 10 minutes...");
          await sleep(10 * 60 * 1000);
          consecutive429 = 0;
        } else {
          console.log(`  [429] Throttled, waiting 60s...`);
          await sleep(60000);
        }
        continue;
      }
      consecutive429 = 0;
      if (!resp.ok) {
        return { ok: false, status: resp.status, error: await resp.text().catch(() => "") };
      }
      return { ok: true, data: await resp.json() };
    } catch (err) {
      if (attempt < retries) { await sleep(5000); continue; }
      return { ok: false, status: 0, error: err.message };
    }
  }
  return { ok: false, status: 429, error: "Max retries exceeded" };
}

async function tryMunicipalitySlugs(name) {
  if (SLUG_OVERRIDES[name]) {
    for (const slug of SLUG_OVERRIDES[name]) {
      const result = await apiFetch(
        `/api/item-locations/?published_from_date=${PUBLISHED_FROM}&published_to_date=${PUBLISHED_TO}&municipality=${slug}`
      );
      await sleep(RATE_LIMIT_MS);
      if (result.ok && Array.isArray(result.data)) return { slug, items: result.data };
      if (result.ok && result.data?.results) return { slug, items: result.data.results };
      if (result.status === 429) return null;
    }
    return null;
  }

  const base = slugify(name);
  const isStad = STAD_MUNICIPALITIES.has(name);
  const candidates = isStad
    ? [`${base}-stad`, `${base}s-stad`, `${base}-kommun`, `${base}s-kommun`, base]
    : [`${base}-kommun`, `${base}s-kommun`, `${base}-stad`, `${base}s-stad`, base];

  for (const slug of candidates) {
    const result = await apiFetch(
      `/api/item-locations/?published_from_date=${PUBLISHED_FROM}&published_to_date=${PUBLISHED_TO}&municipality=${slug}`
    );
    await sleep(RATE_LIMIT_MS);
    if (result.ok && Array.isArray(result.data)) return { slug, items: result.data };
    if (result.ok && result.data?.results) return { slug, items: result.data.results };
    if (result.status === 429) return null;
  }
  return null;
}

function extractStatus(description) {
  if (!description) return null;
  const lower = description.toLowerCase();
  if (lower.includes("beviljat") || lower.includes("beviljas") || lower.includes("bifall")) return "beviljat";
  if (lower.includes("avslag") || lower.includes("avslagit")) return "avslag";
  if (lower.includes("startbesked")) return "startbesked";
  if (lower.includes("slutbesked")) return "slutbesked";
  if (lower.includes("ansökan") || lower.includes("ansökt")) return "ansökt";
  return null;
}

const VALID_PERMIT_TYPES = new Set(["bygglov", "marklov", "rivningslov", "förhandsbesked", "strandskyddsdispens", "anmälan"]);
const VALID_STATUSES = new Set(["ansökt", "beviljat", "avslag", "överklagat", "startbesked", "slutbesked"]);

function mapToPermitRow(detail, municipality) {
  const item = detail.item || detail;
  const sd = item.source_data || {};
  const properties = sd.properties || [];

  let address = detail.address || null;
  if (!address && sd.addresses && sd.addresses.length > 0) {
    const a = sd.addresses[0];
    if (typeof a === "string") address = a;
    else address = [a.street_name, a.street_number].filter(Boolean).join(" ") || null;
  }

  let propertyStr = null;
  if (properties.length > 0) {
    const p = properties[0];
    if (typeof p === "string") propertyStr = p;
    else if (p.block_name) propertyStr = `${p.block_name} ${p.block_number || ""}:${p.unit_number || ""}`.trim();
  }

  const desc = [item.title, item.description].filter(Boolean).join(". ");
  const dateStr = item.published_date ? item.published_date.split("T")[0] : sd.decision_date || null;

  let permitType = sd.type ? sd.type.toLowerCase().trim() : null;
  if (permitType && !VALID_PERMIT_TYPES.has(permitType)) {
    if (permitType.includes("bygg")) permitType = "bygglov";
    else if (permitType.includes("mark")) permitType = "marklov";
    else if (permitType.includes("riv")) permitType = "rivningslov";
    else if (permitType.includes("förhandsbesked") || permitType.includes("forhandsbesked")) permitType = "förhandsbesked";
    else if (permitType.includes("strand")) permitType = "strandskyddsdispens";
    else if (permitType.includes("anmäl") || permitType.includes("anmal")) permitType = "anmälan";
    else permitType = null;
  }

  const rawStatus = extractStatus(desc);
  const status = rawStatus && VALID_STATUSES.has(rawStatus) ? rawStatus : null;

  return {
    municipality: sd.municipality || municipality,
    case_number: sd.registry_id || sd.kungorelse_id || null,
    address, property: propertyStr, permit_type: permitType, status, date: dateStr,
    description: desc || null,
    source_url: sd.url || `${BASE_URL}/items/${item.id || detail.id}`,
    source: "kommunkartan",
    extraction_model: null, extraction_cost_usd: null, raw_html_hash: null,
  };
}

async function main() {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // Find municipalities WITHOUT kommunkartan data
  console.log("Finding municipalities without KK data...");
  let allKK = [];
  let offset = 0;
  while (true) {
    const { data } = await sb.from("permits_v2").select("municipality").eq("source", "kommunkartan").range(offset, offset + 999);
    if (!data || data.length === 0) break;
    allKK.push(...data);
    if (data.length < 1000) break;
    offset += 1000;
  }
  const hasKK = new Set(allKK.map(r => r.municipality));

  const ALL = [
    "Ale","Alingsås","Alvesta","Aneby","Arboga","Arjeplog","Arvidsjaur","Arvika","Askersund","Avesta",
    "Bengtsfors","Berg","Bjurholm","Bjuv","Boden","Bollebygd","Bollnäs","Borgholm","Borlänge","Borås",
    "Botkyrka","Boxholm","Bromölla","Bräcke","Burlöv","Båstad","Dals-Ed","Danderyd","Degerfors","Dorotea",
    "Eda","Ekerö","Eksjö","Emmaboda","Enköping","Eskilstuna","Eslöv","Essunga","Fagersta","Falkenberg",
    "Falköping","Falun","Färgelanda","Filipstad","Finspång","Flen","Forshaga","Gagnef","Gislaved","Gnesta",
    "Gnosjö","Gotland","Grums","Grästorp","Gullspång","Gällivare","Gävle","Göteborg","Götene","Habo",
    "Hagfors","Hallsberg","Hallstahammar","Halmstad","Hammarö","Haninge","Haparanda","Heby","Hedemora",
    "Helsingborg","Herrljunga","Hjo","Hofors","Huddinge","Hudiksvall","Hultsfred","Hylte","Härjedalen",
    "Härnösand","Härryda","Hässleholm","Höganäs","Högsby","Hällefors","Håbo","Höör","Hörby","Jokkmokk",
    "Järfälla","Jönköping","Kalix","Kalmar","Karlsborg","Karlshamn","Karlskoga","Karlskrona","Karlstad",
    "Katrineholm","Kil","Kinda","Kiruna","Klippan","Knivsta","Kramfors","Kristianstad","Kristinehamn",
    "Krokom","Kumla","Kungsbacka","Kungälv","Kungsör","Kävlinge","Köping","Laholm","Landskrona","Laxå",
    "Lekeberg","Leksand","Lerum","Lessebo","Lidingö","Lidköping","Lilla Edet","Lindesberg","Linköping",
    "Ljungby","Ljusdal","Ljusnarsberg","Lomma","Ludvika","Luleå","Lund","Lycksele","Lysekil","Malmö",
    "Malung-Sälen","Malå","Mariestad","Mark","Markaryd","Mellerud","Mjölby","Mora","Motala","Mullsjö",
    "Munkedal","Munkfors","Mölndal","Mönsterås","Mörbylånga","Nacka","Nora","Norberg","Nordanstig",
    "Nordmaling","Norrköping","Norrtälje","Norsjö","Nybro","Nykvarn","Nyköping","Nynäshamn","Nässjö",
    "Ockelbo","Olofström","Orsa","Orust","Osby","Oskarshamn","Ovanåker","Oxelösund","Pajala","Partille",
    "Perstorp","Piteå","Ragunda","Robertsfors","Ronneby","Rättvik","Sala","Salem","Sandviken","Sigtuna",
    "Simrishamn","Sjöbo","Skara","Skellefteå","Skinnskatteberg","Skurup","Skövde","Smedjebacken",
    "Sollefteå","Sollentuna","Solna","Sorsele","Sotenäs","Staffanstorp","Stenungsund","Stockholm",
    "Storfors","Storuman","Strängnäs","Strömstad","Strömsund","Sundbyberg","Sundsvall","Sunne",
    "Surahammar","Svalöv","Svedala","Svenljunga","Säffle","Säter","Sävsjö","Söderhamn","Söderköping",
    "Södertälje","Sölvesborg","Tanum","Tibro","Tidaholm","Tierp","Timrå","Tingsryd","Tjörn","Tomelilla",
    "Torsby","Torsås","Tranemo","Tranås","Trelleborg","Trollhättan","Trosa","Tyresö","Täby","Töreboda",
    "Uddevalla","Ulricehamn","Umeå","Upplands Väsby","Upplands-Bro","Uppvidinge","Uppsala","Vadstena",
    "Vaggeryd","Valdemarsvik","Vallentuna","Vansbro","Vara","Varberg","Vaxholm","Vellinge","Vetlanda",
    "Vilhelmina","Vindeln","Vingåker","Vimmerby","Vårgårda","Vänersborg","Vännäs","Värmdö","Värnamo",
    "Västerås","Västervik","Växjö","Ydre","Ystad","Åmål","Ånge","Åre","Årjäng","Åsele","Åstorp",
    "Åtvidaberg","Älmhult","Älvdalen","Älvkarleby","Älvsbyn","Ängelholm","Öckerö","Ödeshög",
    "Örkelljunga","Örnsköldsvik","Östersund","Österåker","Östhammar","Örebro","Överkalix","Övertorneå",
    "Östra Göinge",
  ];

  const missing = ALL.filter(m => !hasKK.has(m));
  console.log(`Missing KK data: ${missing.length} municipalities\n`);

  let totalImported = 0;
  let totalMunisWithData = 0;
  const notFound = [];
  const imported = [];

  for (let i = 0; i < missing.length; i++) {
    const muni = missing[i];

    // Batch pause every 40 to avoid 429
    if (i > 0 && i % 40 === 0) {
      console.log(`\n  === Batch pause at ${i}/${missing.length}. Waiting 5 min... ===\n`);
      await sleep(5 * 60 * 1000);
    }

    process.stdout.write(`[${i + 1}/${missing.length}] ${muni}... `);

    const result = await tryMunicipalitySlugs(muni);
    if (!result) {
      console.log("NOT FOUND");
      notFound.push(muni);
      continue;
    }

    const bygglovItems = result.items.filter(item => item.source_type_id === 7);
    if (bygglovItems.length === 0) {
      console.log(`slug=${result.slug}, 0 bygglov items`);
      continue;
    }

    console.log(`slug=${result.slug}, ${bygglovItems.length} bygglov items`);

    const locationIds = bygglovItems.map(item => item.location_id || item.id).filter(Boolean);
    const uniqueIds = [...new Set(locationIds)];
    const allDetails = [];

    for (let b = 0; b < uniqueIds.length; b += BATCH_SIZE) {
      const batch = uniqueIds.slice(b, b + BATCH_SIZE);
      const detailResult = await apiFetch(`/api/location-batch-details/?ids=${batch.join(",")}`);
      await sleep(RATE_LIMIT_MS);
      if (detailResult.ok) {
        const details = Array.isArray(detailResult.data)
          ? detailResult.data
          : detailResult.data?.results || Object.values(detailResult.data || {});
        allDetails.push(...details);
      }
    }

    if (allDetails.length === 0) { console.log("  No details fetched"); continue; }

    const rows = allDetails.map(d => mapToPermitRow(d, muni));
    const withCaseNum = rows.filter(r => r.case_number);
    const withoutCaseNum = rows.filter(r => !r.case_number);
    let muniInserted = 0;

    for (let b = 0; b < withCaseNum.length; b += 100) {
      const batch = withCaseNum.slice(b, b + 100);
      const { error } = await sb.from("permits_v2").upsert(batch, { onConflict: "municipality,case_number", ignoreDuplicates: false });
      if (!error) muniInserted += batch.length;
      else if (error.code !== "23505") console.log(`  DB error: ${error.message}`);
    }

    for (const row of withoutCaseNum) {
      const { error } = await sb.from("permits_v2").insert(row);
      if (!error) muniInserted++;
      else if (error.code !== "23505") console.log(`  DB error: ${error.message}`);
    }

    if (muniInserted > 0) {
      totalMunisWithData++;
      totalImported += muniInserted;
      imported.push({ municipality: muni, count: muniInserted });
      console.log(`  → Upserted ${muniInserted} permits`);
    }
  }

  // Report
  console.log(`\n${"=".repeat(60)}`);
  console.log("MISSING MUNICIPALITIES IMPORT REPORT");
  console.log(`${"=".repeat(60)}`);
  console.log(`Processed: ${missing.length}`);
  console.log(`With data imported: ${totalMunisWithData}`);
  console.log(`Total permits imported: ${totalImported}`);
  console.log(`Not found on KK: ${notFound.length}`);

  if (imported.length > 0) {
    console.log("\nImported:");
    for (const m of imported) console.log(`  ${m.municipality}: ${m.count} permits`);
  }
  if (notFound.length > 0) {
    console.log("\nNot found:");
    for (const m of notFound) console.log(`  ${m}`);
  }
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
