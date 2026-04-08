// MeetingPlus REST API adapter — fetches permits from MeetingPlus digital bulletin boards.
// These municipalities use a Formpipe product with a public REST API.
// No LLM needed — data is parsed deterministically from structured JSON.
//
// API endpoints:
//   GET /api/dbb/v1.0/announcement-types?pageNumber=1&pageSize=1000&manageableOnly=false
//   GET /api/dbb/v1.0/announcements/published?announcementTypeId=XXX&pageNumber=1&pageSize=100
//   GET /api/dbb/v1.0/announcements/{id}

import { createHash } from "crypto";

const TIMEOUT = 15000;
const USER_AGENT = "FloedAgent/0.1 (byggsignal.se; datainsamling fran offentliga anslagstavlor)";

// Keywords to match announcement types against (case-insensitive)
const PBL_KEYWORDS = [
  "plan- och bygglagen",
  "bygglov",
  "bygganmälan",
  "förhandsbesked",
  "rivningslov",
  "marklov",
  "strandskyddsdispens",
  "lovbeslut",
  "lovansökning",
  "kungörelse lov",
];

/**
 * Extract the base URL from a MeetingPlus URL.
 * "https://forum.norrtalje.se/digital-bulletin-board" → "https://forum.norrtalje.se"
 */
function extractBaseUrl(url) {
  const match = url.match(/^(https?:\/\/[^/]+)/);
  return match ? match[1] : url.replace(/\/digital-bulletin-board.*$/, "").replace(/\/+$/, "");
}

/**
 * HTTP GET with retry.
 */
async function apiGet(url, maxRetries = 2) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      console.log(`  [MeetingPlus] Retry ${attempt}/${maxRetries} for ${url.slice(0, 80)}...`);
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }

    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, "Accept": "application/json" },
      signal: AbortSignal.timeout(TIMEOUT),
    });

    if (response.status === 502 || response.status === 503) continue;
    if (!response.ok) throw new Error(`MeetingPlus HTTP ${response.status} for ${url.slice(0, 80)}`);

    return await response.json();
  }
  throw new Error(`MeetingPlus HTTP error after ${maxRetries + 1} attempts`);
}

/**
 * Fetch all announcement types from the API.
 */
async function fetchAnnouncementTypes(baseUrl) {
  const url = `${baseUrl}/api/dbb/v1.0/announcement-types?pageNumber=1&pageSize=1000&manageableOnly=false`;
  const data = await apiGet(url);
  return Array.isArray(data) ? data : (data.Items || data.items || []);
}

/**
 * Filter announcement types to PBL/bygglov-related ones.
 */
function filterPblTypes(types) {
  return types.filter(t => {
    const name = (t.Name || t.name || "").toLowerCase();
    return PBL_KEYWORDS.some(kw => name.includes(kw.toLowerCase()));
  });
}

/**
 * Fetch published announcements for a specific type.
 */
async function fetchPublished(baseUrl, typeId) {
  const url = `${baseUrl}/api/dbb/v1.0/announcements/published?announcementTypeId=${typeId}&pageNumber=1&pageSize=500&manageableOnly=false`;
  const data = await apiGet(url);
  return Array.isArray(data) ? data : (data.Items || data.items || []);
}

/**
 * Fetch announcement detail (contains Description with diarienummer).
 */
async function fetchDetail(baseUrl, announcementId) {
  const url = `${baseUrl}/api/dbb/v1.0/announcements/${announcementId}`;
  return await apiGet(url);
}

/**
 * Parse a MeetingPlus announcement into a permit record.
 */
function parseAnnouncement(announcement, detail, municipality, typeName) {
  const title = announcement.Title || announcement.title || "";
  const description = detail?.Description || detail?.description || "";
  const startDate = announcement.StartDate || announcement.startDate || null;

  // Parse case_number from Description: "Diarienummer: BoM 2026-000840" or "Diarienr: B 2026-000133"
  const caseMatch = description.match(/[Dd]iarienr(?:ummer)?:\s*([^\n,]+)/);
  const caseNumber = caseMatch ? caseMatch[1].trim() : null;

  // Parse property from title/description: "inom Fastighetsbeteckning" or "inom fastigheten X"
  // Also handle short titles that ARE the property (e.g. "POSTILJONEN 6", "DANDERYD 2:2")
  const propertyMatch = title.match(/inom(?:\s+fastigheten)?\s+([A-ZÅÄÖ][a-zåäöé-]+(?:[\s-]+\d+:\d+)?(?:\s+m\.?\s*fl\.?)?)/i)
    || description.match(/fastigheten\s+([A-ZÅÄÖ][a-zåäöé-]+(?:[\s-]+\d+:\d+)?(?:\s+m\.?\s*fl\.?)?)/i);
  let property = propertyMatch ? propertyMatch[1].trim() : null;

  // If title is a short property designation (e.g. "POSTILJONEN 6", "SJUKHUSET 3")
  if (!property && /^[A-ZÅÄÖ][A-ZÅÄÖ\s-]+\d/.test(title.trim())) {
    property = title.trim();
  }

  // Parse address from description: "(gatuadress)" in parentheses after property
  const addressMatch = description.match(/\(([^)]+vägen[^)]*|[^)]+gatan[^)]*|[^)]+gränd[^)]*|[^)]+torget[^)]*|[^)]+platsen[^)]*|[^)]+stigen[^)]*|[^)]+allén[^)]*|[^)]+backen[^)]*)\)/i)
    || title.match(/\(([^)]+vägen[^)]*|[^)]+gatan[^)]*|[^)]+gränd[^)]*|[^)]+stigen[^)]*)\)/i);
  const address = addressMatch ? addressMatch[1].trim() : property;

  // Classify permit_type from title/description + DocumentTitle
  const docTitle = detail?.DocumentTitle || "";
  const allText = [title, description, docTitle].join(" ");
  const permitType = classifyPermitType(allText);

  // Status from type name, DocumentTitle, and description
  const status = classifyStatus(typeName + " " + docTitle);

  return {
    municipality,
    case_number: caseNumber,
    address,
    property: property !== address ? property : null,
    permit_type: permitType,
    status,
    date: startDate,
    description: cleanDescription(title),
    applicant: extractApplicant(description),
    source_url: null,
  };
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
 * Classify status from announcement type name.
 */
function classifyStatus(typeName) {
  const t = (typeName || "").toLowerCase();
  if (t.includes("beviljade") || t.includes("beslut")) return "beviljat";
  if (t.includes("inför") || t.includes("ansökan")) return "ansökt";
  return "beviljat";
}

/**
 * Clean the title into a description.
 * Remove "Kungörelse: " prefix.
 */
function cleanDescription(title) {
  return title
    .replace(/^[Kk]ung[öo]relse:\s*/i, "")
    .replace(/^[Aa]nslag:\s*/i, "")
    .trim() || null;
}

/**
 * Extract applicant (organization only) from description.
 */
function extractApplicant(text) {
  if (!text) return null;
  // Look for organization markers
  const orgMatch = text.match(/(?:sökande|byggherre):\s*([^\n]+)/i);
  if (!orgMatch) return null;
  const name = orgMatch[1].trim();
  const orgMarkers = /\b(AB|HB|KB|BRF|Brf|kommun|region|stiftelse|förening|fastigheter|bostäder|exploatering)\b/i;
  if (orgMarkers.test(name)) return name;
  return null; // Likely a private person — GDPR
}

/**
 * Fetch permits from a MeetingPlus digital bulletin board.
 * Returns { permits, contentHash } matching the Ciceron adapter contract.
 */
export async function fetchMeetingPlusPermits(url, municipality) {
  const baseUrl = extractBaseUrl(url);
  console.log(`  [MeetingPlus] ${baseUrl} (REST API)`);

  // Step 1: Get announcement types
  const allTypes = await fetchAnnouncementTypes(baseUrl);
  console.log(`  [MeetingPlus] ${allTypes.length} announcement types`);

  // Step 2: Filter to PBL-related types
  const pblTypes = filterPblTypes(allTypes);
  if (pblTypes.length === 0) {
    console.log(`  [MeetingPlus] No PBL-related announcement types found`);
    return { permits: [], contentHash: null };
  }
  console.log(`  [MeetingPlus] ${pblTypes.length} PBL types: ${pblTypes.map(t => t.Name || t.name).join(", ")}`);

  // Step 3: Fetch published announcements for each PBL type
  const allAnnouncements = [];
  for (const type of pblTypes) {
    const typeId = type.Id || type.id;
    const typeName = type.Name || type.name;
    const published = await fetchPublished(baseUrl, typeId);
    for (const ann of published) {
      allAnnouncements.push({ ...ann, _typeName: typeName, _typeId: typeId });
    }
    console.log(`  [MeetingPlus] "${typeName}": ${published.length} published`);
    await new Promise(r => setTimeout(r, 200));
  }

  if (allAnnouncements.length === 0) {
    console.log(`  [MeetingPlus] No published announcements`);
    return { permits: [], contentHash: null };
  }

  // Content hash based on list of announcement IDs + dates
  const hashInput = allAnnouncements
    .map(a => `${a.Id || a.id}:${a.StartDate || a.startDate}`)
    .sort()
    .join("|");
  const contentHash = createHash("sha256").update(hashInput).digest("hex").slice(0, 16);

  // Step 4: Fetch details for each announcement (for diarienummer)
  const permits = [];
  for (const ann of allAnnouncements) {
    const annId = ann.Id || ann.id;
    let detail = null;
    try {
      detail = await fetchDetail(baseUrl, annId);
    } catch (err) {
      console.log(`  [MeetingPlus] Detail fetch failed for ${annId}: ${err.message}`);
    }

    const permit = parseAnnouncement(ann, detail, municipality, ann._typeName);
    // Accept permits with a classified type, or if the type name itself indicates PBL
    if (permit.permit_type || permit.case_number) {
      permits.push(permit);
    }
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`  [MeetingPlus] ${permits.length} permits parsed (of ${allAnnouncements.length} announcements)`);

  return { permits, contentHash };
}

/**
 * Detect if a URL is a MeetingPlus digital bulletin board.
 */
export function isMeetingPlusUrl(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  return lower.includes("/digital-bulletin-board")
    || lower.includes("meetingsplus.")
    || /forum\.[a-zåäö-]+\.se/i.test(lower)
    || lower.includes(".ondemand.formpipe.com");
}

/**
 * Detect MeetingPlus from HTML content (for discovery platform detection).
 */
export function isMeetingPlusHtml(html) {
  if (!html) return false;
  const lower = html.toLowerCase();
  return lower.includes("meetingsplus")
    || lower.includes("meetings plus")
    || lower.includes("digital-bulletin-board")
    || lower.includes("/api/dbb/");
}
