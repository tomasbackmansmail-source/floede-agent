// NetPublicator JSONP adapter — fetches permits from NetPublicator bulletin boards.
// Municipalities embed these as iframes. Data comes from a JSONP API.
// No LLM needed — structured JSON with metadata fields.
//
// API endpoints (JSONP, requires jsoncallback param):
//   GET /bulletinboard/public/{boardId}/setup?jsoncallback=cb
//   GET /bulletinboard/public/{boardId}/find?jsoncallback=cb&target=published&direction=desc&index=0&length=100

import { createHash } from "crypto";

const TIMEOUT = 15000;
const BASE_URL = "https://www.netpublicator.com";

// Category names (nämnder) that indicate bygglov
const BYGG_CATEGORIES = /milj|samhällsbygg|bygg|plan|stadsbygg|mbn|msn/i;

// Notice types/titles that indicate bygglov
const BYGG_NOTICE_PATTERNS = /bygglov|rivningslov|marklov|förhandsbesked|strandskydd|grannhöran|lovansök|meddelande om.*lov|kungörelse.*lov|beslut.*lov|plan- och bygg/i;

/**
 * Decode HTML entities in strings from the API.
 */
function decodeEntities(str) {
  if (!str) return str;
  return str
    .replace(/&#228;/g, "ä").replace(/&#246;/g, "ö").replace(/&#229;/g, "å")
    .replace(/&#196;/g, "Ä").replace(/&#214;/g, "Ö").replace(/&#197;/g, "Å")
    .replace(/&#233;/g, "é").replace(/&#252;/g, "ü")
    .replace(/&#167;/g, "§").replace(/&#160;/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

/**
 * Extract board ID from a NetPublicator URL.
 */
function extractBoardId(url) {
  const match = url.match(/\/bulletinboard\/public\/([0-9a-f-]{36})/i);
  return match ? match[1] : null;
}

/**
 * Fetch JSONP endpoint and parse response.
 */
async function fetchJsonp(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "FloedAgent/0.1" },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!response.ok) throw new Error(`NetPublicator HTTP ${response.status}`);
  const raw = await response.text();
  const jsonStr = raw.replace(/^cb\(/, "").replace(/\);?\s*$/, "");
  return JSON.parse(jsonStr);
}

/**
 * Fetch board setup (categories, types, metadata config).
 */
async function fetchSetup(boardId) {
  const url = `${BASE_URL}/bulletinboard/public/${boardId}/setup?jsoncallback=cb`;
  return await fetchJsonp(url);
}

/**
 * Fetch published notices.
 */
async function fetchNotices(boardId, length = 200) {
  const url = `${BASE_URL}/bulletinboard/public/${boardId}/find?jsoncallback=cb&target=published&direction=desc&index=0&length=${length}`;
  return await fetchJsonp(url);
}

/**
 * Parse description field: "FASTIGHET (ADRESS) - beskrivning"
 */
function parseDescription(desc) {
  if (!desc) return { property: null, address: null, description: null };
  const decoded = decodeEntities(desc).replace(/<br\s*\/?>/gi, "").replace(/\r/g, "").trim();

  // Pattern: "FASTIGHET X:Y (ADRESS) - beskrivning"
  const match = decoded.match(/^([A-ZÅÄÖ][A-ZÅÄÖ\s-]+\d+(?::\d+)?)\s*(?:\(([^)]+)\))?\s*-\s*(.+)$/i);
  if (match) {
    return {
      property: match[1].trim(),
      address: match[2]?.trim() || null,
      description: match[3].trim(),
    };
  }

  // Pattern without property: just "beskrivning"
  return { property: null, address: null, description: decoded };
}

/**
 * Classify permit_type from text.
 */
function classifyPermitType(text) {
  if (!text) return null;
  const t = text.toLowerCase();
  if (t.includes("rivningslov") || (t.includes("rivning") && !t.includes("bygglov"))) return "rivningslov";
  if (t.includes("marklov")) return "marklov";
  if (t.includes("förhandsbesked")) return "förhandsbesked";
  if (t.includes("strandskyddsdispens") || t.includes("strandskydd")) return "strandskyddsdispens";
  if (t.includes("anmälan") || t.includes("bygganmälan")) return "anmälan";
  if (t.includes("bygglov") || t.includes("nybyggnad") || t.includes("tillbyggnad") || t.includes("ombyggnad") || t.includes("fasadändring")) return "bygglov";
  return null;
}

/**
 * Classify status from attachment title and notice text.
 */
function classifyStatus(text) {
  if (!text) return "beviljat";
  const t = text.toLowerCase();
  if (t.includes("grannhöran") || t.includes("underrättelse") || t.includes("lovansökning") || t.includes("remiss")) return "ansökt";
  if (t.includes("avslag")) return "avslag";
  if (t.includes("överklag")) return "överklagat";
  if (t.includes("startbesked")) return "startbesked";
  if (t.includes("slutbesked")) return "slutbesked";
  return "beviljat";
}

/**
 * Fetch permits from a NetPublicator bulletin board.
 * Returns { permits, contentHash } matching the adapter contract.
 */
export async function fetchNetPublicatorPermits(url, municipality) {
  const boardId = extractBoardId(url);
  if (!boardId) throw new Error(`Could not extract board ID from ${url}`);

  console.log(`  [NetPublicator] Board ${boardId}`);

  // Step 1: Get setup (categories + types)
  const setup = await fetchSetup(boardId);
  const categories = (setup.categories || []).map(c => ({
    ...c,
    name: decodeEntities(c.name),
  }));
  const byggCategories = categories.filter(c => BYGG_CATEGORIES.test(c.name));
  const byggCategoryIds = new Set(byggCategories.map(c => c.id));

  // Build type map — noticeType can be numeric (id) or GUID
  // setup.types has .id (GUID), .name, and .type (numeric)
  const typeNameByNumeric = {};
  const typeNameByGuid = {};
  for (const t of (setup.types || [])) {
    const name = decodeEntities(t.name);
    if (t.type != null) typeNameByNumeric[t.type] = name;
    if (t.id) typeNameByGuid[t.id] = name;
  }

  // Identify bygglov-related type IDs
  const byggTypeNumerics = new Set();
  for (const t of (setup.types || [])) {
    const name = decodeEntities(t.name);
    if (BYGG_NOTICE_PATTERNS.test(name)) {
      if (t.type != null) byggTypeNumerics.add(t.type);
    }
  }

  console.log(`  [NetPublicator] ${categories.length} categories, ${byggCategories.length} bygg-related: ${byggCategories.map(c => c.name).join(", ")}`);
  if (byggTypeNumerics.size > 0) {
    const byggTypeNames = [...byggTypeNumerics].map(n => typeNameByNumeric[n]).filter(Boolean);
    console.log(`  [NetPublicator] ${byggTypeNumerics.size} bygg types: ${byggTypeNames.join(", ")}`);
  }

  // Step 2: Fetch all published notices
  const data = await fetchNotices(boardId);
  const notices = data.notices || [];
  console.log(`  [NetPublicator] ${notices.length} published notices (of ${data.totalIndex} total)`);

  // Content hash
  const hashInput = notices.map(n => `${n.id}:${n.published}`).sort().join("|");
  const contentHash = createHash("sha256").update(hashInput).digest("hex").slice(0, 16);

  // Step 3: Filter to bygglov-related notices
  const permits = [];
  for (const notice of notices) {
    const meta = {};
    const allMetaValues = [];
    for (const m of (notice.metadata || [])) {
      const title = decodeEntities(m.title);
      const value = decodeEntities(m.value);
      meta[title] = value;
      if (value) allMetaValues.push(value);
    }

    const attachmentTitles = (notice.attachments || []).map(a => decodeEntities(a.title)).join(" ");
    // Collect text from ALL metadata fields (Beskrivning, Information, etc.)
    const allMetaText = allMetaValues.join(" ");
    const allText = [allMetaText, attachmentTitles, notice.title || "", notice.text || ""].join(" ");

    // Notice type name (numeric or GUID lookup)
    const typeName = typeNameByNumeric[notice.noticeType] || typeNameByGuid[notice.noticeType] || "";

    // Filter: bygg-category OR bygg-type OR keyword match in any text
    const isByggCategory = byggCategoryIds.has(notice.noticeCategoryId);
    const isByggType = byggTypeNumerics.has(notice.noticeType);
    const hasKeyword = BYGG_NOTICE_PATTERNS.test(allText);

    if (!isByggCategory && !isByggType && !hasKeyword) continue;

    // Use best available description field
    const description = meta["Beskrivning"] || meta["beskrivning"]
      || meta["Information"] || meta["information"] || "";

    const parsed = parseDescription(description);
    const permitType = classifyPermitType(allText + " " + typeName);

    // Skip notices without permit type unless type itself is bygglov-related
    if (!isByggType && !permitType && !hasKeyword) continue;

    const status = classifyStatus(allText + " " + typeName);

    // Extract case_number from text: "diarienummer: BYGG 2026-000040"
    const caseMatch = allText.match(/diarienummer:\s*([^\s.]+(?:\s+[\d-]+)?)/i);
    const caseNumber = caseMatch ? caseMatch[1].trim().replace(/\.$/, "") : null;

    const sourceUrl = notice.id
      ? `${BASE_URL}/bulletinboard/public/${boardId}/${notice.id}`
      : url;

    permits.push({
      municipality,
      case_number: caseNumber,
      address: parsed.address || parsed.property,
      property: parsed.address ? parsed.property : null,
      permit_type: permitType || (isByggType ? "bygglov" : null),
      status,
      date: notice.published ? notice.published.split(" ")[0] : null,
      description: parsed.description || null,
      applicant: null,
      source_url: sourceUrl,
    });
  }

  console.log(`  [NetPublicator] ${permits.length} permits parsed`);
  return { permits, contentHash };
}

/**
 * Detect if a URL is a NetPublicator bulletin board.
 */
export function isNetPublicatorUrl(url) {
  if (!url) return false;
  return /netpublicator\.com\/bulletinboard/i.test(url);
}
