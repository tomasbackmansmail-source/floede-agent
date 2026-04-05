// Ciceron JSON-RPC adapter — fetches permits from Ciceron anslagstavla SPA.
// These municipalities use AngularJS apps with hashbang routing (#!/billboard/)
// that serve structured data via a JSON-RPC endpoint at /json.
// No LLM needed — data is parsed deterministically.

import { createHash } from "crypto";

const CICERON_TIMEOUT = 15000;

// diary_name values that indicate stadsbyggnad/bygglov
const BYGG_DIARIES = new Set([
  "STBYGG", "STADSBYGG", "BYGG", "BYGGLOV", "SBN", "MBN",
  "SAMBYGG",
]);

// Keywords in title that indicate bygglov-related cases
const BYGG_KEYWORDS = /bygglov|rivningslov|marklov|förhandsbesked|strandskydd|bygganmälan|nybyggnad|tillbyggnad|ombyggnad|fasadändring|rivning/i;

/**
 * Extract base URL from a Ciceron billboard URL.
 * "https://anslagstavla.helsingborg.se/#!/billboard/" → "https://anslagstavla.helsingborg.se"
 */
function extractBaseUrl(url) {
  const match = url.match(/^(https?:\/\/[^/]+)/);
  return match ? match[1] : url.replace(/\/[#!].*$/, "").replace(/\/+$/, "");
}

/**
 * JSON-RPC call to Ciceron endpoint.
 */
async function rpc(baseUrl, method, params, sessionId) {
  const body = { jsonrpc: "2.0", method, params: params || {} };
  if (sessionId) body.session_id = sessionId;

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      console.log(`  [Ciceron] Retry ${attempt}/2 for ${method}...`);
      await new Promise(r => setTimeout(r, 2000 * attempt));
    }

    const response = await fetch(`${baseUrl}/json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CICERON_TIMEOUT),
    });

    if (response.status === 502 || response.status === 503) continue;
    if (!response.ok) throw new Error(`Ciceron HTTP ${response.status}`);

    const data = await response.json();
    if (data.error) throw new Error(`Ciceron RPC error: ${data.error.message}`);
    return data;
  }
  throw new Error(`Ciceron HTTP 502/503 after 3 attempts`);
}

/**
 * Parse a Ciceron title into address/property and description.
 * Typical formats:
 *   "Unionen 16 - Bygglov för permanent ändrad användning..."
 *   "Svedberg 5:14 - Bygglov för nybyggnad av teknikbod"
 *   "Yttrande över bygglov fastigheten Stäven 26"
 */
function parseTitle(title) {
  const cleaned = title.replace(/\n/g, " ").trim();

  // Pattern 1: "Property - Description"
  const dashMatch = cleaned.match(/^(.+?)\s*-\s*(.+)$/);
  if (dashMatch) {
    return { address: dashMatch[1].trim(), description: dashMatch[2].trim() };
  }

  // Pattern 2: "Yttrande över bygglov fastigheten X"
  const fastighetMatch = cleaned.match(/fastigheten\s+(.+)/i);
  if (fastighetMatch) {
    return { address: fastighetMatch[1].trim(), description: cleaned };
  }

  return { address: null, description: cleaned };
}

/**
 * Classify permit_type from description text.
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
 * Fetch permits from a Ciceron anslagstavla via JSON-RPC.
 * Returns { permits, contentHash } in the same format as extractPermits().
 */
export async function fetchCiceronPermits(url, municipality) {
  const baseUrl = extractBaseUrl(url);
  console.log(`  [Ciceron] ${baseUrl} (JSON-RPC)`);

  // Step 1: Get session
  const testResp = await rpc(baseUrl, "CiceronsokServer:Test");
  const sessionId = testResp.session_id;

  // Step 2: Search for all posted cases
  const searchResp = await rpc(baseUrl, "CiceronsokServer:Search", {
    search_id: "floede",
    doctype: 2,
    text: "",
    param: JSON.stringify({ is_post: true }),
  }, sessionId);

  const hits = JSON.parse(searchResp.result.result).hits || 0;
  console.log(`  [Ciceron] ${hits} total cases on billboard`);

  if (hits === 0) return { permits: [], contentHash: null };

  // Step 3: Read all items (cap at 500)
  const limit = Math.min(hits, 500);
  const itemsResp = await rpc(baseUrl, "CiceronsokServer:ReadItems", {
    search_id: "floede",
    offset: 0,
    limit,
  }, sessionId);

  const items = itemsResp.result.results || [];

  // Content hash based on the raw items JSON
  const contentHash = createHash("sha256")
    .update(JSON.stringify(items))
    .digest("hex")
    .slice(0, 16);

  // Filter to bygglov-related items and parse
  const permits = [];
  for (const item of items) {
    const isByggDiary = BYGG_DIARIES.has(item.diary_name);
    const hasKeyword = BYGG_KEYWORDS.test(item.title);

    // Must have keyword match in title (diary alone is too broad)
    if (!hasKeyword && !isByggDiary) continue;

    const { address, description } = parseTitle(item.title);
    const permitType = classifyPermitType(item.title);

    // Skip items from bygg-diary that don't classify as a permit type
    if (isByggDiary && !hasKeyword && !permitType) continue;

    permits.push({
      municipality,
      case_number: item.diarie || null,
      address,
      property: null,
      permit_type: permitType,
      status: "beviljat",
      date: null,
      description,
      applicant: null,
      source_url: `${baseUrl}/#!/billboard/`,
    });
  }

  console.log(`  [Ciceron] ${permits.length} bygglov-related (of ${items.length} fetched)`);

  return { permits, contentHash };
}

/**
 * Detect if a URL is a Ciceron anslagstavla.
 */
export function isCiceronUrl(url) {
  if (!url) return false;
  return url.includes("#!/billboard") || url.includes("ciceron");
}
