// Import bygglov data from Kommunkartan.se API for municipalities with 0 permits.
// No LLM needed — data is structured JSON.
// Run: node src/import-kommunkartan.js

import { createClient } from "@supabase/supabase-js";

const BASE_URL = "https://kommunkartan.se";
const USER_AGENT = "FloedAgent/0.1 (byggsignal.se; dataimport)";
const BATCH_SIZE = 50;
const RATE_LIMIT_MS = 1000; // ~1 req/s to stay under throttle

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/å/g, "a")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/é/g, "e")
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function apiFetch(path, retries = 3) {
  const url = `${BASE_URL}${path}`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, "Accept": "application/json" },
        signal: AbortSignal.timeout(15000),
      });
      if (resp.status === 429) {
        const waitSecs = Math.min(attempt * 30 + 30, 120);
        console.log(`  [429] Throttled, waiting ${waitSecs}s...`);
        await sleep(waitSecs * 1000);
        continue;
      }
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
  const base = slugify(name);
  const candidates = [
    `${base}-kommun`,
    `${base}-stad`,
    `${base}s-kommun`,
    base,
  ];

  for (const slug of candidates) {
    const result = await apiFetch(
      `/api/item-locations/?published_from_date=2026-02-01&published_to_date=2026-03-19&municipality=${slug}`
    );
    await sleep(RATE_LIMIT_MS);

    if (result.ok && Array.isArray(result.data)) {
      return { slug, items: result.data };
    }
    if (result.ok && result.data?.results) {
      return { slug, items: result.data.results };
    }
    // If rate limited after retries, stop trying more slugs
    if (result.status === 429) return null;
    // If 404 or "Could not find", try next slug
  }
  return null;
}

function extractStatus(description) {
  if (!description) return null;
  const lower = description.toLowerCase();
  if (lower.includes("beviljat") || lower.includes("bifall")) return "beviljat";
  if (lower.includes("avslag") || lower.includes("avslagit")) return "avslag";
  if (lower.includes("ansökan") || lower.includes("ansökt")) return "ansökt";
  if (lower.includes("startbesked")) return "startbesked";
  if (lower.includes("slutbesked")) return "slutbesked";
  return null;
}

function mapToPermitRow(detail, municipality, { hasSourceCol, hasPropertyCol }) {
  const item = detail.item || detail;
  const sd = item.source_data || {};
  const properties = sd.properties || [];

  // Address comes from location level or source_data
  let address = detail.address || null;
  if (!address && sd.addresses && sd.addresses.length > 0) {
    const a = sd.addresses[0];
    if (typeof a === "string") address = a;
    else address = [a.street_name, a.street_number].filter(Boolean).join(" ") || null;
  }

  // Property from source_data.properties (objects with block_name etc.)
  let propertyStr = null;
  if (properties.length > 0) {
    const p = properties[0];
    if (typeof p === "string") propertyStr = p;
    else if (p.block_name) {
      propertyStr = `${p.block_name} ${p.block_number || ""}:${p.unit_number || ""}`.trim();
    }
  }

  const desc = [item.title, item.description].filter(Boolean).join(" — ");
  const dateStr = item.published_date
    ? item.published_date.split("T")[0]
    : (sd.decision_date || null);

  const row = {
    municipality: sd.municipality || municipality,
    case_number: sd.registry_id || sd.kungorelse_id || null,
    address,
    permit_type: sd.type ? sd.type.toLowerCase() : null,
    status: extractStatus(desc),
    date: dateStr,
    description: desc || null,
    source_url: sd.url || `${BASE_URL}/items/${item.id || detail.id}`,
    extraction_model: null,
    extraction_cost_usd: null,
    raw_html_hash: null,
  };

  if (hasSourceCol) row.source = "kommunkartan";
  if (hasPropertyCol) row.property = propertyStr;

  return row;
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.");
    process.exit(1);
  }

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // Test if 'source' column exists by trying a small query
  let hasSourceCol = false;
  let hasPropertyCol = false;

  const { error: testErr } = await sb
    .from("permits_v2")
    .select("source")
    .limit(1);
  hasSourceCol = !testErr;
  console.log(`Column 'source': ${hasSourceCol ? "exists" : "missing — will skip"}`);

  const { error: testErr2 } = await sb
    .from("permits_v2")
    .select("property")
    .limit(1);
  hasPropertyCol = !testErr2;
  console.log(`Column 'property': ${hasPropertyCol ? "exists" : "missing — will skip"}`);

  // Find municipalities with 0 permits
  console.log("\nFinding zero-permit municipalities...");
  const { data: configs } = await sb
    .from("discovery_configs")
    .select("municipality")
    .eq("approved", true);

  const { data: permitMunis } = await sb
    .from("permits_v2")
    .select("municipality");

  const withPermits = new Set();
  for (const p of permitMunis || []) {
    withPermits.add(p.municipality.toLowerCase());
  }

  const zeroPermitMunis = configs
    .filter(c => !withPermits.has(c.municipality.toLowerCase()))
    .map(c => c.municipality);

  console.log(`Zero-permit municipalities: ${zeroPermitMunis.length}`);

  let totalImported = 0;
  let totalMunisWithData = 0;
  const notFound = [];
  const imported = [];

  for (let i = 0; i < zeroPermitMunis.length; i++) {
    const muni = zeroPermitMunis[i];
    process.stdout.write(`[${i + 1}/${zeroPermitMunis.length}] ${muni}... `);

    const result = await tryMunicipalitySlugs(muni);

    if (!result) {
      console.log("NOT FOUND on Kommunkartan");
      notFound.push(muni);
      continue;
    }

    // Filter to source_type_id 7 (bygglov)
    const bygglovItems = result.items.filter(item => item.source_type_id === 7);

    if (bygglovItems.length === 0) {
      console.log(`slug=${result.slug}, 0 bygglov items`);
      continue;
    }

    console.log(`slug=${result.slug}, ${bygglovItems.length} bygglov items`);

    // Fetch details in batches
    const locationIds = bygglovItems.map(item => item.location_id).filter(Boolean);
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
      }
    }

    if (allDetails.length === 0) {
      console.log(`  No details fetched`);
      continue;
    }

    // Map to permit rows and insert
    let muniInserted = 0;
    for (const detail of allDetails) {
      const row = mapToPermitRow(detail, muni, { hasSourceCol, hasPropertyCol });

      if (row.case_number) {
        const { error } = await sb
          .from("permits_v2")
          .upsert(row, { onConflict: "municipality,case_number", ignoreDuplicates: true });

        if (error) {
          if (error.code !== "23505") {
            console.log(`  DB error: ${error.message}`);
          }
        } else {
          muniInserted++;
        }
      } else {
        const { error } = await sb.from("permits_v2").insert(row);
        if (error) {
          if (error.code !== "23505") {
            console.log(`  DB error: ${error.message}`);
          }
        } else {
          muniInserted++;
        }
      }
    }

    if (muniInserted > 0) {
      totalMunisWithData++;
      totalImported += muniInserted;
      imported.push({ municipality: muni, count: muniInserted });
      console.log(`  → Inserted ${muniInserted} permits`);
    }
  }

  // Report
  console.log(`\n${"=".repeat(60)}`);
  console.log("KOMMUNKARTAN IMPORT REPORT");
  console.log(`${"=".repeat(60)}`);
  console.log(`\nMunicipalities processed: ${zeroPermitMunis.length}`);
  console.log(`Municipalities with data imported: ${totalMunisWithData}`);
  console.log(`Total permits imported: ${totalImported}`);
  console.log(`Not found on Kommunkartan: ${notFound.length}`);

  if (imported.length > 0) {
    console.log(`\nImported:`);
    for (const m of imported) {
      console.log(`  ${m.municipality}: ${m.count} permits`);
    }
  }

  if (notFound.length > 0) {
    console.log(`\nNot found:`);
    for (const m of notFound) {
      console.log(`  ${m}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1); });
