/**
 * Daily procurement scraping — all 26 Stockholms län municipalities.
 *
 * Portals:
 *   KommersAnnons eLite: Nacka, Värmdö, Danderyd, Botkyrka, Nykvarn,
 *                        Upplands Väsby, Upplands-Bro
 *   KommersAnnons Stockholm: Stockholm stad
 *   e-Avrop: Norrtälje, Lidingö, Täby, Ekerö, Haninge, Huddinge,
 *            Järfälla, Nynäshamn, Salem, Sigtuna, Sollentuna, Solna,
 *            Sundbyberg, Södertälje, Tyresö, Vallentuna, Vaxholm, Österåker
 *
 * All 26/26 Stockholms län kommuner covered.
 *
 * Usage:
 *   node --env-file=.env src/daily-procurements.js
 */

import { createClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const USER_AGENT = "Byggsignal/1.0 (byggsignal.se; offentlig upphandlingsdata)";

// ─── Construction-relevance filter ────────────────────────────
// CPV codes starting with 45 = construction works.
// If no CPV code, fall back to title keyword matching.

function isByggRelevant(item) {
  const cpv = item.category || "";

  // If CPV codes present, check for construction codes (45xxxxx)
  if (cpv && /\d{8}/.test(cpv)) {
    const codes = cpv.match(/\d{8}/g) || [];
    return codes.some((c) => c.startsWith("45"));
  }

  // No CPV code — filter by title keywords
  const title = `${item.title} ${item.description || ""}`.toLowerCase();

  // Exclude non-construction
  const EXCLUDE = /\b(?:konsult|arkitekt|rådgivning|utredning|besiktning|it-|städ|transport|livsmedel|möbler)\b/i;
  if (EXCLUDE.test(title)) return false;

  // Include construction keywords
  const INCLUDE = /\b(?:entreprenad|bygg|renovering|ombyggnad|rivning|mark|anläggning|vvs|elinstallation|elarbete|ventilation|måleri|tak|fasad|golv|plåt|betong|stål|schakt|dränering|brandskydd|stambyte|hiss|isolering|puts|snickeri|tätskikt|va-arbete|ledningsarbete)\b/i;
  return INCLUDE.test(title);
}

// ─── Sources: all 26 Stockholms län kommuner ──────────────────

const SOURCES = [
  // KommersAnnons eLite (7 kommuner)
  { municipality: "Nacka", parser: "elite",
    url: "https://www.kommersannons.se/eLite/Notice/EmbeddedNoticeList.aspx?NoticeStatus=1&ProcuringEntityId=285",
    baseUrl: "https://www.kommersannons.se/eLite/Notice/" },
  { municipality: "Värmdö", parser: "elite",
    url: "https://www.kommersannons.se/eLite/Notice/EmbeddedNoticeList.aspx?NoticeStatus=1&ProcuringEntityId=317",
    baseUrl: "https://www.kommersannons.se/eLite/Notice/" },
  { municipality: "Danderyd", parser: "elite",
    url: "https://www.kommersannons.se/eLite/Notice/EmbeddedNoticeList.aspx?NoticeStatus=1&ProcuringEntityId=445",
    baseUrl: "https://www.kommersannons.se/eLite/Notice/" },
  { municipality: "Botkyrka", parser: "elite",
    url: "https://www.kommersannons.se/eLite/Notice/EmbeddedNoticeList.aspx?NoticeStatus=1&ProcuringEntityId=353",
    baseUrl: "https://www.kommersannons.se/eLite/Notice/" },
  { municipality: "Nykvarn", parser: "elite",
    url: "https://www.kommersannons.se/eLite/Notice/EmbeddedNoticeList.aspx?NoticeStatus=1&ProcuringEntityId=334",
    baseUrl: "https://www.kommersannons.se/eLite/Notice/" },
  { municipality: "Upplands Väsby", parser: "elite",
    url: "https://www.kommersannons.se/eLite/Notice/EmbeddedNoticeList.aspx?NoticeStatus=1&ProcuringEntityId=272",
    baseUrl: "https://www.kommersannons.se/eLite/Notice/" },
  { municipality: "Upplands-Bro", parser: "elite",
    url: "https://www.kommersannons.se/eLite/Notice/EmbeddedNoticeList.aspx?NoticeStatus=1&ProcuringEntityId=294",
    baseUrl: "https://www.kommersannons.se/eLite/Notice/" },

  // KommersAnnons Stockholm (separate template)
  { municipality: "Stockholm", parser: "stockholm",
    url: "https://www.kommersannons.se/stockholm/Notice/NoticeList.aspx?NoticeStatus=1",
    baseUrl: "https://www.kommersannons.se/stockholm/Notice/" },

  // e-Avrop (18 kommuner)
  { municipality: "Norrtälje", parser: "eavrop",
    url: "https://www.e-avrop.com/norrtalje/e-upphandling/Default.aspx" },
  { municipality: "Lidingö", parser: "eavrop",
    url: "https://www.e-avrop.com/Lidingostad/e-Upphandling/Default.aspx" },
  { municipality: "Täby", parser: "eavrop",
    url: "https://www.e-avrop.com/taby/e-Upphandling/Default.aspx" },
  { municipality: "Ekerö", parser: "eavrop",
    url: "https://www.e-avrop.com/ekero/e-Upphandling/Default.aspx" },
  { municipality: "Haninge", parser: "eavrop",
    url: "https://www.e-avrop.com/haninge/e-Upphandling/Default.aspx" },
  { municipality: "Huddinge", parser: "eavrop",
    url: "https://www.e-avrop.com/huddinge/e-Upphandling/Default.aspx" },
  { municipality: "Järfälla", parser: "eavrop",
    url: "https://www.e-avrop.com/jarfallakommun/e-Upphandling/Default.aspx" },
  { municipality: "Nynäshamn", parser: "eavrop",
    url: "https://www.e-avrop.com/nynashamn/e-Upphandling/Default.aspx" },
  { municipality: "Salem", parser: "eavrop",
    url: "https://www.e-avrop.com/salem/e-Upphandling/Default.aspx" },
  { municipality: "Sigtuna", parser: "eavrop",
    url: "https://www.e-avrop.com/sigtuna/e-Upphandling/Default.aspx" },
  { municipality: "Sollentuna", parser: "eavrop",
    url: "https://www.e-avrop.com/sollentuna/e-Upphandling/Default.aspx" },
  { municipality: "Solna", parser: "eavrop",
    url: "https://www.e-avrop.com/solna/e-Upphandling/Default.aspx" },
  { municipality: "Sundbyberg", parser: "eavrop",
    url: "https://www.e-avrop.com/sundbybergkommun/e-Upphandling/Default.aspx" },
  { municipality: "Södertälje", parser: "eavrop",
    url: "https://www.e-avrop.com/sodertalje/e-Upphandling/Default.aspx" },
  { municipality: "Tyresö", parser: "eavrop",
    url: "https://www.e-avrop.com/tyreso/e-Upphandling/Default.aspx" },
  { municipality: "Vallentuna", parser: "eavrop",
    url: "https://www.e-avrop.com/vallentuna/e-Upphandling/Default.aspx" },
  { municipality: "Vaxholm", parser: "eavrop",
    url: "https://www.e-avrop.com/vaxholm/e-Upphandling/Default.aspx" },
  { municipality: "Österåker", parser: "eavrop",
    url: "https://www.e-avrop.com/osteraker/e-Upphandling/Default.aspx" },
];

// ─── Helpers ──────────────────────────────────────────────────

function extractDate(text, regex) {
  const m = text.match(regex);
  return m ? m[1] : null;
}

function extractLocation(text) {
  const m = text.match(/utförandeort\s+(.+?)\.?\s*$/i);
  return m ? m[1].trim().replace(/\.$/, "") : null;
}

// ─── Parsers ──────────────────────────────────────────────────

function parseElite(html, source) {
  const $ = cheerio.load(html);
  const items = [];

  $(".Notice").each((_, el) => {
    const title = $(el).find(".NoticeTitle h3").text().trim();
    const dateText = $(el).find(".NoticeDate").text().trim();
    const description = $(el).find(".NoticeDescription").text().trim();
    const link = $(el).find(".NoticeContent a").attr("href");

    const deadline = extractDate(dateText, /sista\s+(?:anbudsdag|dag\s+för\s+ansökan)\s+(?:är\s+)?(\d{4}-\d{2}-\d{2})/i);
    const published = extractDate(dateText, /visas\s+mellan\s+(\d{4}-\d{2}-\d{2})/i);
    const location = extractLocation(dateText);

    items.push({
      municipality: source.municipality,
      title,
      description: description || null,
      deadline: deadline || null,
      published_date: published || null,
      location: location || null,
      estimated_value_sek: null,
      category: null,
      source_url: link ? source.baseUrl + link : source.url,
      source: "kommersannons",
    });
  });

  return items;
}

function parseStockholm(html, source) {
  const $ = cheerio.load(html);
  const items = [];

  $("div.container div.row.mt-4").each((_, el) => {
    const col8 = $(el).find(".col-md-8");
    if (!col8.length) return;

    const h4 = col8.find("p.h4");
    if (!h4.length) return;

    const procLink = h4.find('a[href*="ProcurementId"]');
    if (!procLink.length) return;

    const refCode = procLink.find("span").text().trim();
    const fullText = h4.clone().children("a, small, div").remove().end().text().trim();
    const titlePart = fullText.replace(/^-\s*/, "").trim();
    const title = titlePart || refCode;

    const dateText = col8.children("small").first().text().trim();
    const descriptionDiv = col8.children("div").first().text().trim();
    const link = procLink.attr("href");

    const deadline = extractDate(dateText, /sista\s+(?:anbudsdag(?:en)?|dag\s+för\s+ansökan)\s+(?:är\s+)?(\d{4}-\d{2}-\d{2})/i);
    const published = extractDate(dateText, /visas\s+mellan\s+(\d{4}-\d{2}-\d{2})/i);
    const location = extractLocation(dateText);

    items.push({
      municipality: source.municipality,
      title,
      description: descriptionDiv || null,
      deadline: deadline || null,
      published_date: published || null,
      location: location || null,
      estimated_value_sek: null,
      category: null,
      source_url: link ? source.baseUrl + link : source.url,
      source: "kommersannons",
    });
  });

  return items;
}

async function fetchEavrop(source) {
  // Step 1: GET to capture __VIEWSTATE etc
  const initResp = await fetch(source.url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(15000),
  });
  const initHtml = await initResp.text();
  const init$ = cheerio.load(initHtml);

  const viewState = init$("#__VIEWSTATE").val();
  const eventValidation = init$("#__EVENTVALIDATION").val();
  const viewStateGen = init$("#__VIEWSTATEGENERATOR").val();

  // Step 2: POST with RadioButtonListScope=tender
  const params = new URLSearchParams();
  params.append("__EVENTTARGET", "ctl00$navigationContent$NoticeLists$RadioButtonListScope$2");
  params.append("__EVENTARGUMENT", "");
  params.append("__VIEWSTATE", viewState);
  params.append("__VIEWSTATEGENERATOR", viewStateGen);
  params.append("__EVENTVALIDATION", eventValidation);
  params.append("ctl00$navigationContent$NoticeLists$RadioButtonListScope", "tender");

  const resp = await fetch(source.url, {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
    signal: AbortSignal.timeout(15000),
  });

  return resp.text();
}

function parseEavrop(html, source) {
  const $ = cheerio.load(html);
  const items = [];
  const baseUrl = "https://www.e-avrop.com";

  $("#mainContent_tenderGridView tr.rowline").each((_, el) => {
    const tds = $(el).find("td");
    if (tds.length < 4) return;

    const titleLink = $(tds[0]).find("a");
    const title = titleLink.text().trim();
    const link = titleLink.attr("href");
    const published = $(tds[1]).text().trim() || null;
    const category = $(tds[2]).text().replace(/\s+/g, " ").trim() || null;
    const deadlineText = $(tds[3]).text().trim();

    const deadlineMatch = deadlineText.match(/(\d{4}-\d{2}-\d{2})/);
    const deadline = deadlineMatch ? deadlineMatch[1] : null;

    items.push({
      municipality: source.municipality,
      title,
      description: category,
      deadline: deadline || null,
      published_date: published || null,
      location: "Stockholms län",
      estimated_value_sek: null,
      category,
      source_url: link ? baseUrl + link : source.url,
      source: "eavrop",
    });
  });

  return items;
}

// ─── Database operations ──────────────────────────────────────

async function ensureClosedColumn() {
  // Add closed column if it doesn't exist
  const { error } = await supabase.rpc("exec_sql", {
    query: "ALTER TABLE procurements ADD COLUMN IF NOT EXISTS closed boolean DEFAULT false;",
  });
  if (error) {
    // RPC might not exist — just check if table works
    console.log("  (closed column: RPC unavailable, assuming column exists or run migration manually)");
  }
}

async function markClosedProcurements() {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("procurements")
    .update({ closed: true })
    .lt("deadline", today)
    .eq("closed", false)
    .select("id");

  if (error) {
    // closed column might not exist yet
    if (error.message.includes("closed")) {
      console.log("  closed column not found — skipping mark-closed step");
      return 0;
    }
    console.error("  Mark-closed error:", error.message);
    return 0;
  }
  return (data || []).length;
}

async function upsertProcurements(items) {
  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  for (const item of items) {
    // Dedup check: municipality + title + deadline
    const query = supabase
      .from("procurements")
      .select("id", { count: "exact", head: true })
      .eq("municipality", item.municipality)
      .eq("title", item.title);

    if (item.deadline) {
      query.eq("deadline", item.deadline);
    } else {
      query.is("deadline", null);
    }

    const { count, error: checkErr } = await query;
    if (checkErr) {
      console.error(`  Dedup check error: ${checkErr.message}`);
      errors++;
      continue;
    }

    if (count > 0) {
      skipped++;
      continue;
    }

    // Remove category before insert (not a DB column)
    const { category, ...row } = item;

    const { error: insertErr } = await supabase.from("procurements").insert(row);
    if (insertErr) {
      if (insertErr.code === "23505") {
        skipped++;
      } else {
        console.error(`  Insert error (${item.municipality}): ${insertErr.message}`);
        errors++;
      }
    } else {
      inserted++;
    }
  }

  return { inserted, skipped, errors };
}

// ─── Main ─────────────────────────────────────────────────────

async function run() {
  console.log("=== Daily Procurements — Stockholms län ===");
  console.log(`  ${new Date().toISOString()}`);
  console.log(`  Sources: ${SOURCES.length} kommuner\n`);

  await ensureClosedColumn();

  const report = { elite: 0, stockholm: 0, eavrop: 0 };
  const portalCounts = { kommersannons: 0, eavrop: 0 };
  let allByggRelevant = [];
  let totalScraped = 0;
  let failedSources = [];

  for (const source of SOURCES) {
    process.stdout.write(`  ${source.municipality.padEnd(18)} [${source.parser}] `);

    let html;
    try {
      if (source.parser === "eavrop") {
        html = await fetchEavrop(source);
      } else {
        const resp = await fetch(source.url, {
          headers: { "User-Agent": USER_AGENT },
          signal: AbortSignal.timeout(15000),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        html = await resp.text();
      }
    } catch (err) {
      console.log(`FETCH FAILED: ${err.message}`);
      failedSources.push({ municipality: source.municipality, error: err.message });
      continue;
    }

    const parsers = { elite: parseElite, stockholm: parseStockholm, eavrop: parseEavrop };
    const allItems = parsers[source.parser](html, source);
    totalScraped += allItems.length;
    report[source.parser] += allItems.length;

    const byggRelevant = allItems.filter(isByggRelevant);
    allByggRelevant.push(...byggRelevant);

    const portal = source.parser === "eavrop" ? "eavrop" : "kommersannons";
    if (allItems.length > 0) portalCounts[portal]++;

    console.log(`${allItems.length} found, ${byggRelevant.length} bygg-relevant`);

    // Rate limit
    await new Promise((r) => setTimeout(r, 500));
  }

  // Upsert bygg-relevant items
  console.log(`\n  Upserting ${allByggRelevant.length} bygg-relevant procurements...`);
  const db = await upsertProcurements(allByggRelevant);

  // Mark closed
  const closed = await markClosedProcurements();

  // Summary
  console.log("\n========================================");
  console.log("         SAMMANFATTNING");
  console.log("========================================\n");
  console.log(`  Kommuner scrapad:    ${SOURCES.length - failedSources.length}/${SOURCES.length}`);
  console.log(`  Totalt hittade:      ${totalScraped}`);
  console.log(`  Bygg-relevanta:      ${allByggRelevant.length}`);
  console.log(`  Nya insatta i DB:    ${db.inserted}`);
  console.log(`  Duplikater skippade: ${db.skipped}`);
  console.log(`  Fel:                 ${db.errors}`);
  console.log(`  Markerade stängda:   ${closed}`);
  console.log();
  console.log(`  Portaler:`);
  console.log(`    KommersAnnons eLite:    ${report.elite} upphandlingar (7 kommuner)`);
  console.log(`    KommersAnnons Sthlm:    ${report.stockholm} upphandlingar (1 kommun)`);
  console.log(`    e-Avrop:                ${report.eavrop} upphandlingar (18 kommuner)`);

  if (failedSources.length > 0) {
    console.log(`\n  Misslyckade (${failedSources.length}):`);
    failedSources.forEach((f) => console.log(`    - ${f.municipality}: ${f.error}`));
  }

  console.log();
  return { inserted: db.inserted, skipped: db.skipped, errors: db.errors, closed, total: allByggRelevant.length };
}

// Export for use in daily-run.js
export { run as runProcurements };

// Run directly
if (process.argv[1] && process.argv[1].includes("daily-procurements")) {
  run()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Fatal:", err);
      process.exit(1);
    });
}
