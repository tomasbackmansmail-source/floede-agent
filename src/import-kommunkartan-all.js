// Import bygglov data from Kommunkartan.se API for ALL 290 municipalities.
// Compares against existing permits_v2 data (source=floede).
// No LLM needed — data is structured JSON.
// Run: node src/import-kommunkartan-all.js

import { createClient } from "@supabase/supabase-js";

const BASE_URL = "https://kommunkartan.se";
const USER_AGENT = "FloedAgent/0.2 (byggsignal.se; dataimport)";
const BATCH_SIZE = 50;
const RATE_LIMIT_MS = 4000; // ~0.25 req/s to avoid 429s
const PUBLISHED_FROM = "2025-12-19";
const PUBLISHED_TO = "2026-03-19";

// All 290 Swedish municipalities (display name → used for slugify + DB)
const ALL_MUNICIPALITIES = [
  "Ale", "Alingsås", "Alvesta", "Aneby", "Arboga", "Arjeplog", "Arvidsjaur",
  "Arvika", "Askersund", "Avesta", "Bengtsfors", "Berg", "Bjurholm", "Bjuv",
  "Boden", "Bollebygd", "Bollnäs", "Borgholm", "Borlänge", "Borås",
  "Botkyrka", "Boxholm", "Bromölla", "Bräcke", "Burlöv", "Båstad",
  "Dals-Ed", "Danderyd", "Degerfors", "Dorotea",
  "Eda", "Ekerö", "Eksjö", "Emmaboda", "Enköping", "Eskilstuna",
  "Eslöv", "Essunga", "Fagersta", "Falkenberg", "Falköping", "Falun", "Färgelanda",
  "Filipstad", "Finspång", "Flen", "Forshaga", "Gagnef", "Gislaved",
  "Gnesta", "Gnosjö", "Gotland", "Grums", "Grästorp",
  "Gullspång", "Gällivare", "Gävle", "Göteborg", "Götene", "Habo", "Hagfors", "Hallsberg",
  "Hallstahammar", "Halmstad", "Hammarö", "Haninge", "Haparanda", "Heby",
  "Hedemora", "Helsingborg", "Herrljunga", "Hjo", "Hofors", "Huddinge",
  "Hudiksvall", "Hultsfred", "Hylte", "Härjedalen", "Härnösand",
  "Härryda", "Hässleholm", "Höganäs", "Högsby", "Hällefors",
  "Håbo", "Höör", "Hörby", "Jokkmokk", "Järfälla", "Jönköping",
  "Kalix", "Kalmar", "Karlsborg", "Karlshamn", "Karlskoga", "Karlskrona",
  "Karlstad", "Katrineholm", "Kil", "Kinda", "Kiruna", "Klippan",
  "Knivsta", "Kramfors", "Kristianstad", "Kristinehamn", "Krokom",
  "Kumla", "Kungsbacka", "Kungälv", "Kungsör", "Kävlinge", "Köping",
  "Laholm", "Landskrona", "Laxå", "Lekeberg", "Leksand", "Lerum",
  "Lessebo", "Lidingö", "Lidköping", "Lilla Edet", "Lindesberg",
  "Linköping", "Ljungby", "Ljusdal", "Ljusnarsberg", "Lomma", "Ludvika",
  "Luleå", "Lund", "Lycksele", "Lysekil", "Malmö", "Malung-Sälen",
  "Malå", "Mariestad", "Mark", "Markaryd", "Mellerud", "Mjölby",
  "Mora", "Motala", "Mullsjö", "Munkedal", "Munkfors", "Mölndal",
  "Mönsterås", "Mörbylånga", "Nacka", "Nora", "Norberg", "Nordanstig",
  "Nordmaling", "Norrköping", "Norrtälje", "Norsjö", "Nybro", "Nykvarn",
  "Nyköping", "Nynäshamn", "Nässjö", "Ockelbo", "Olofström", "Orsa",
  "Orust", "Osby", "Oskarshamn", "Ovanåker", "Oxelösund", "Pajala",
  "Partille", "Perstorp", "Piteå", "Ragunda", "Robertsfors", "Ronneby",
  "Rättvik", "Sala", "Salem", "Sandviken", "Sigtuna", "Simrishamn",
  "Sjöbo", "Skara", "Skellefteå", "Skinnskatteberg", "Skurup", "Skövde",
  "Smedjebacken", "Sollefteå", "Sollentuna", "Solna", "Sorsele", "Sotenäs",
  "Staffanstorp", "Stenungsund", "Stockholm", "Storfors", "Storuman",
  "Strängnäs", "Strömstad", "Strömsund", "Sundbyberg", "Sundsvall", "Sunne",
  "Surahammar", "Svalöv", "Svedala", "Svenljunga", "Säffle", "Säter", "Sävsjö",
  "Söderhamn", "Söderköping", "Södertälje", "Sölvesborg",
  "Tanum", "Tibro", "Tidaholm", "Tierp", "Timrå", "Tingsryd",
  "Tjörn", "Tomelilla", "Torsby", "Torsås", "Tranemo", "Tranås",
  "Trelleborg", "Trollhättan", "Trosa", "Tyresö", "Täby", "Töreboda",
  "Uddevalla", "Ulricehamn", "Umeå", "Upplands Väsby", "Upplands-Bro",
  "Uppvidinge", "Uppsala", "Vadstena", "Vaggeryd", "Valdemarsvik", "Vallentuna",
  "Vansbro", "Vara", "Varberg", "Vaxholm", "Vellinge", "Vetlanda",
  "Vilhelmina", "Vindeln", "Vingåker", "Vimmerby", "Vårgårda",
  "Vänersborg", "Vännäs", "Värmdö", "Värnamo", "Västerås", "Västervik",
  "Växjö", "Ydre", "Ystad", "Åmål", "Ånge", "Åre", "Årjäng", "Åsele", "Åstorp", "Åtvidaberg",
  "Älmhult", "Älvdalen", "Älvkarleby", "Älvsbyn", "Ängelholm",
  "Öckerö", "Ödeshög", "Örkelljunga", "Örnsköldsvik", "Östersund",
  "Österåker", "Östhammar", "Örebro", "Överkalix", "Övertorneå",
  "Östra Göinge",
];

// Cities that use "-stad" instead of "-kommun"
const STAD_MUNICIPALITIES = new Set([
  "Stockholm", "Göteborg", "Malmö", "Lidingö", "Solna", "Sundbyberg",
  "Helsingborg", "Landskrona", "Lund", "Borås", "Trollhättan",
  "Kalmar", "Karlskrona", "Kristianstad", "Halmstad", "Växjö",
  "Linköping", "Norrköping", "Jönköping", "Västerås", "Örebro",
  "Uppsala", "Gävle", "Sundsvall", "Umeå", "Luleå", "Karlstad",
  "Eskilstuna", "Skövde", "Falun", "Nyköping",
]);

// Known slug overrides for municipalities where auto-slugification doesn't work
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
    .replace(/å/g, "a")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/é/g, "e")
    .replace(/ü/g, "u")
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

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
          const waitSecs = 60;
          console.log(`  [429] Throttled, waiting ${waitSecs}s...`);
          await sleep(waitSecs * 1000);
        }
        continue;
      }
      consecutive429 = 0;
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        return { ok: false, status: resp.status, error: text };
      }
      const data = await resp.json();
      return { ok: true, data };
    } catch (err) {
      if (attempt < retries) {
        await sleep(5000);
        continue;
      }
      return { ok: false, status: 0, error: err.message };
    }
  }
  return { ok: false, status: 429, error: "Max retries exceeded" };
}

async function tryMunicipalitySlugs(name) {
  // Use override slugs if available
  if (SLUG_OVERRIDES[name]) {
    const candidates = SLUG_OVERRIDES[name];
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

  const base = slugify(name);
  const isStad = STAD_MUNICIPALITIES.has(name);

  // Try most likely slug first
  const candidates = isStad
    ? [`${base}-stad`, `${base}s-stad`, `${base}-kommun`, `${base}s-kommun`, base]
    : [`${base}-kommun`, `${base}s-kommun`, `${base}-stad`, `${base}s-stad`, base];

  for (const slug of candidates) {
    const result = await apiFetch(
      `/api/item-locations/?published_from_date=${PUBLISHED_FROM}&published_to_date=${PUBLISHED_TO}&municipality=${slug}`
    );
    await sleep(RATE_LIMIT_MS);

    if (result.ok && Array.isArray(result.data)) {
      return { slug, items: result.data };
    }
    if (result.ok && result.data?.results) {
      return { slug, items: result.data.results };
    }
    if (result.status === 429) return null;
    // 404 or "Could not find" → try next slug
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
    else if (p.block_name) {
      propertyStr = `${p.block_name} ${p.block_number || ""}:${p.unit_number || ""}`.trim();
    }
  }

  const desc = [item.title, item.description].filter(Boolean).join(". ");
  const dateStr = item.published_date
    ? item.published_date.split("T")[0]
    : sd.decision_date || null;

  // Sanitize permit_type to match CHECK constraint
  let permitType = sd.type ? sd.type.toLowerCase().trim() : null;
  if (permitType && !VALID_PERMIT_TYPES.has(permitType)) {
    // Try common mappings
    if (permitType.includes("bygg")) permitType = "bygglov";
    else if (permitType.includes("mark")) permitType = "marklov";
    else if (permitType.includes("riv")) permitType = "rivningslov";
    else if (permitType.includes("förhandsbesked") || permitType.includes("forhandsbesked")) permitType = "förhandsbesked";
    else if (permitType.includes("strand")) permitType = "strandskyddsdispens";
    else if (permitType.includes("anmäl") || permitType.includes("anmal")) permitType = "anmälan";
    else permitType = null; // Unknown type — set null to avoid CHECK violation
  }

  // Sanitize status
  const rawStatus = extractStatus(desc);
  const status = rawStatus && VALID_STATUSES.has(rawStatus) ? rawStatus : null;

  return {
    municipality: sd.municipality || municipality,
    case_number: sd.registry_id || sd.kungorelse_id || null,
    address,
    property: propertyStr,
    permit_type: permitType,
    status,
    date: dateStr,
    description: desc || null,
    source_url: sd.url || `${BASE_URL}/items/${item.id || detail.id}`,
    source: "kommunkartan",
    extraction_model: null,
    extraction_cost_usd: null,
    raw_html_hash: null,
  };
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.");
    process.exit(1);
  }

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // STEP 0: Add columns if missing
  console.log("STEP 0: Ensuring columns exist...");
  const { error: rpcErr1 } = await sb.rpc("exec_sql", {
    query: "ALTER TABLE permits_v2 ADD COLUMN IF NOT EXISTS source text DEFAULT 'floede';"
  }).maybeSingle();
  if (rpcErr1) {
    // Try direct approach — column may already exist
    const { error: testErr } = await sb.from("permits_v2").select("source").limit(1);
    if (testErr) {
      console.log("Warning: 'source' column might not exist. Trying to continue anyway.");
    } else {
      console.log("  'source' column: exists");
    }
  } else {
    console.log("  'source' column: ensured");
  }

  const { error: rpcErr2 } = await sb.rpc("exec_sql", {
    query: "ALTER TABLE permits_v2 ADD COLUMN IF NOT EXISTS property text;"
  }).maybeSingle();
  if (rpcErr2) {
    const { error: testErr2 } = await sb.from("permits_v2").select("property").limit(1);
    if (testErr2) {
      console.log("Warning: 'property' column might not exist. Trying to continue anyway.");
    } else {
      console.log("  'property' column: exists");
    }
  } else {
    console.log("  'property' column: ensured");
  }

  // Verify columns
  const { error: srcErr } = await sb.from("permits_v2").select("source").limit(1);
  const { error: propErr } = await sb.from("permits_v2").select("property").limit(1);
  const hasSourceCol = !srcErr;
  const hasPropertyCol = !propErr;
  console.log(`  Column check — source: ${hasSourceCol}, property: ${hasPropertyCol}`);
  if (!hasSourceCol) {
    console.error("FATAL: 'source' column does not exist. Please run ALTER TABLE manually in Supabase SQL Editor:");
    console.error("  ALTER TABLE permits_v2 ADD COLUMN IF NOT EXISTS source text DEFAULT 'floede';");
    console.error("  ALTER TABLE permits_v2 ADD COLUMN IF NOT EXISTS property text;");
    process.exit(1);
  }

  // Check which municipalities already have kommunkartan data (for resume)
  const { data: existingKK } = await sb
    .from("permits_v2")
    .select("municipality")
    .eq("source", "kommunkartan");
  const alreadyImported = new Set();
  for (const p of existingKK || []) {
    alreadyImported.add(p.municipality);
  }
  console.log(`Already imported from Kommunkartan: ${alreadyImported.size} municipalities`);

  console.log(`\nSTEP 1-4: Importing from Kommunkartan for ${ALL_MUNICIPALITIES.length} municipalities`);
  console.log(`Date range: ${PUBLISHED_FROM} → ${PUBLISHED_TO}\n`);

  let totalImported = 0;
  let totalMunisWithData = 0;
  let totalByglov = 0;
  const notFound = [];
  const imported = [];
  const errors = [];
  const slugMap = {}; // name → slug
  let skipped = 0;
  let processedCount = 0;
  const BATCH_PAUSE_EVERY = 40;
  const BATCH_PAUSE_MS = 5 * 60 * 1000; // 5 min pause every N municipalities

  for (let i = 0; i < ALL_MUNICIPALITIES.length; i++) {
    const muni = ALL_MUNICIPALITIES[i];

    // Resume: skip already-imported municipalities
    if (alreadyImported.has(muni)) {
      skipped++;
      continue;
    }

    // Batch pause to avoid sustained 429s
    processedCount++;
    if (processedCount > 1 && processedCount % BATCH_PAUSE_EVERY === 0) {
      console.log(`\n  === Batch pause (${processedCount} processed). Waiting 5 min to cool API... ===\n`);
      await sleep(BATCH_PAUSE_MS);
    }

    process.stdout.write(`[${i + 1}/${ALL_MUNICIPALITIES.length}] ${muni}... `);

    const result = await tryMunicipalitySlugs(muni);

    if (!result) {
      console.log("NOT FOUND");
      notFound.push(muni);
      continue;
    }

    slugMap[muni] = result.slug;

    // Filter to source_type_id 7 (bygglov)
    const bygglovItems = result.items.filter(item => item.source_type_id === 7);
    totalByglov += bygglovItems.length;

    if (bygglovItems.length === 0) {
      console.log(`slug=${result.slug}, 0 bygglov items`);
      continue;
    }

    console.log(`slug=${result.slug}, ${bygglovItems.length} bygglov items`);

    // Fetch details in batches
    const locationIds = bygglovItems.map(item => item.location_id || item.id).filter(Boolean);
    const uniqueIds = [...new Set(locationIds)];
    const allDetails = [];

    for (let b = 0; b < uniqueIds.length; b += BATCH_SIZE) {
      const batch = uniqueIds.slice(b, b + BATCH_SIZE);
      const detailResult = await apiFetch(
        `/api/location-batch-details/?ids=${batch.join(",")}`
      );
      await sleep(RATE_LIMIT_MS);

      if (detailResult.ok) {
        const details = Array.isArray(detailResult.data)
          ? detailResult.data
          : detailResult.data?.results || Object.values(detailResult.data || {});
        allDetails.push(...details);
      } else {
        console.log(`  Batch detail error: ${detailResult.error}`);
      }
    }

    if (allDetails.length === 0) {
      console.log(`  No details fetched`);
      continue;
    }

    // Map to permit rows and upsert
    let muniInserted = 0;
    const rows = allDetails.map(d => mapToPermitRow(d, muni));

    // Remove property col if not available
    if (!hasPropertyCol) {
      for (const row of rows) delete row.property;
    }

    // Batch upsert: split into with-case-number (upsert) and without (insert)
    const withCaseNum = rows.filter(r => r.case_number);
    const withoutCaseNum = rows.filter(r => !r.case_number);

    // Upsert rows with case_number in batches of 100
    for (let b = 0; b < withCaseNum.length; b += 100) {
      const batch = withCaseNum.slice(b, b + 100);
      const { error, count } = await sb
        .from("permits_v2")
        .upsert(batch, { onConflict: "municipality,case_number", ignoreDuplicates: false });
      if (error) {
        if (error.code !== "23505") {
          errors.push(`${muni}: ${error.message}`);
        }
      } else {
        muniInserted += batch.length;
      }
    }

    // Insert rows without case_number
    for (const row of withoutCaseNum) {
      const { error } = await sb.from("permits_v2").insert(row);
      if (error && error.code !== "23505") {
        errors.push(`${muni} (no case#): ${error.message}`);
      } else if (!error) {
        muniInserted++;
      }
    }

    if (muniInserted > 0) {
      totalMunisWithData++;
      totalImported += muniInserted;
      imported.push({ municipality: muni, count: muniInserted });
      console.log(`  → Upserted ${muniInserted} permits`);
    }
  }

  // STEP 6: Comparison
  console.log(`\n${"=".repeat(70)}`);
  console.log("STEP 6: COMPARISON");
  console.log(`${"=".repeat(70)}\n`);

  // Query 1: Overview by source
  console.log("--- Overview by source ---");
  const { data: sourceOverview, error: sErr } = await sb.rpc("exec_sql", {
    query: `SELECT source, COUNT(*) as permits, COUNT(DISTINCT municipality) as kommuner FROM permits_v2 GROUP BY source;`
  });
  if (sErr) {
    // Fallback: manual count
    console.log("(RPC not available, using manual counts)");
    const { count: floedeCnt } = await sb.from("permits_v2").select("*", { count: "exact", head: true }).eq("source", "floede");
    const { count: kkCnt } = await sb.from("permits_v2").select("*", { count: "exact", head: true }).eq("source", "kommunkartan");
    const { count: nullCnt } = await sb.from("permits_v2").select("*", { count: "exact", head: true }).is("source", null);
    console.log(`  floede: ${floedeCnt || 0} permits`);
    console.log(`  kommunkartan: ${kkCnt || 0} permits`);
    if (nullCnt) console.log(`  null/unknown: ${nullCnt} permits`);
  } else {
    for (const row of sourceOverview || []) {
      console.log(`  ${row.source || "null"}: ${row.permits} permits, ${row.kommuner} kommuner`);
    }
  }

  // Query 2: Per municipality comparison (top 50)
  console.log("\n--- Per municipality: top 50 by Kommunkartan count ---");
  // We'll do this via fetching all and computing locally
  const { data: allPermits } = await sb
    .from("permits_v2")
    .select("municipality, source");

  if (allPermits) {
    const muniStats = {};
    for (const p of allPermits) {
      const m = p.municipality;
      if (!muniStats[m]) muniStats[m] = { floede: 0, kommunkartan: 0, other: 0 };
      if (p.source === "kommunkartan") muniStats[m].kommunkartan++;
      else if (p.source === "floede" || !p.source) muniStats[m].floede++;
      else muniStats[m].other++;
    }

    const sorted = Object.entries(muniStats)
      .sort((a, b) => b[1].kommunkartan - a[1].kommunkartan)
      .slice(0, 50);

    console.log(`${"Municipality".padEnd(30)} ${"Flöde".padStart(8)} ${"KK".padStart(8)}`);
    console.log("-".repeat(48));
    for (const [m, s] of sorted) {
      console.log(`${m.padEnd(30)} ${String(s.floede).padStart(8)} ${String(s.kommunkartan).padStart(8)}`);
    }

    // Kommuner where KK has data but we have 0
    const kkOnlyMunis = Object.entries(muniStats)
      .filter(([, s]) => s.kommunkartan > 0 && s.floede === 0)
      .sort((a, b) => b[1].kommunkartan - a[1].kommunkartan);

    console.log(`\n--- Kommuner: Kommunkartan has data, Flöde has 0 (${kkOnlyMunis.length}) ---`);
    for (const [m, s] of kkOnlyMunis) {
      console.log(`  ${m}: ${s.kommunkartan} permits`);
    }

    // Kommuner where we have data but KK has 0
    const floOnlyMunis = Object.entries(muniStats)
      .filter(([, s]) => s.floede > 0 && s.kommunkartan === 0)
      .sort((a, b) => b[1].floede - a[1].floede);

    console.log(`\n--- Kommuner: Flöde has data, Kommunkartan has 0 (${floOnlyMunis.length}) ---`);
    for (const [m, s] of floOnlyMunis) {
      console.log(`  ${m}: ${s.floede} permits`);
    }
  }

  // Final report
  console.log(`\n${"=".repeat(70)}`);
  console.log("IMPORT REPORT");
  console.log(`${"=".repeat(70)}`);
  console.log(`Municipalities processed: ${ALL_MUNICIPALITIES.length}`);
  console.log(`Skipped (already imported): ${skipped}`);
  console.log(`Municipalities with data imported: ${totalMunisWithData}`);
  console.log(`Total permits upserted: ${totalImported}`);
  console.log(`Total bygglov items found: ${totalByglov}`);
  console.log(`Not found on Kommunkartan: ${notFound.length}`);

  if (notFound.length > 0) {
    console.log(`\nNot found on Kommunkartan:`);
    for (const m of notFound) console.log(`  ${m}`);
  }

  if (errors.length > 0) {
    console.log(`\nDB errors (${errors.length}):`);
    for (const e of errors.slice(0, 20)) console.log(`  ${e}`);
    if (errors.length > 20) console.log(`  ...and ${errors.length - 20} more`);
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1); });
