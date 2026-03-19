// Fix 404 URLs in approved discovery_configs.
// Tests listing_url with HTTP, tries common anslagstavla path variants,
// follows redirects, validates content, and updates the config in Supabase.
// Zero API cost — only HTTP requests.
// Run: node src/fix-404-configs.js

import { createClient } from "@supabase/supabase-js";

const USER_AGENT = "FloedAgent/0.1 (byggsignal.se; URL-verifiering)";

const ANSLAGSTAVLA_PATHS = [
  "/kommun-och-politik/anslagstavla",
  "/kommun--politik/anslagstavla",
  "/kommunpolitik/anslagstavla",
  "/kommun-och-politik/overklaga-beslut/anslagstavla",
  "/kommun-och-politik/politik-och-demokrati/anslagstavla",
  "/anslagstavla",
  "/kommun-och-politik/beslut-insyn-och-rattssakerhet/anslagstavla",
];

const CONTENT_KEYWORDS = [
  "bygglov",
  "kungörelse",
  "plan- och bygglagen",
  "ansökan",
  "beviljat",
  "startbesked",
];

function extractDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function domainVariants(domain) {
  const variants = new Set();
  variants.add(domain);
  if (domain.startsWith("www.")) {
    variants.add(domain.slice(4));
  } else {
    variants.add(`www.${domain}`);
  }
  return [...variants];
}

async function httpGet(url, timeout = 15000) {
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(timeout),
      redirect: "follow",
    });
    const text = resp.ok ? await resp.text() : null;
    return { status: resp.status, url: resp.url, text, ok: resp.ok };
  } catch (err) {
    return { status: 0, url, text: null, ok: false, error: err.message };
  }
}

function hasRelevantContent(html) {
  const lower = html.toLowerCase();
  return CONTENT_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.");
    process.exit(1);
  }

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // Load all approved configs
  const { data: rows, error } = await sb
    .from("discovery_configs")
    .select("municipality, config")
    .eq("approved", true);

  if (error) {
    console.error(`Failed to load configs: ${error.message}`);
    process.exit(1);
  }

  console.log(`Loaded ${rows.length} approved configs.\n`);

  // Step 1: Test each listing_url
  const broken = [];
  const alreadyOk = [];

  console.log("=== Testing current listing URLs ===\n");

  for (const row of rows) {
    const url = row.config.listing_url;
    if (!url) {
      broken.push(row);
      continue;
    }

    const result = await httpGet(url);

    if (result.ok) {
      alreadyOk.push(row);
    } else {
      console.log(`  404: ${row.municipality} → ${url} (HTTP ${result.status})`);
      broken.push(row);
    }

    // Light rate limit
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`\nWorking: ${alreadyOk.length}, Broken: ${broken.length}\n`);

  if (broken.length === 0) {
    console.log("No broken URLs found. Nothing to fix.");
    process.exit(0);
  }

  // Step 2: Try variants for each broken config
  console.log("=== Trying URL variants for broken configs ===\n");

  const fixed = [];
  const stillBroken = [];

  for (const row of broken) {
    const currentUrl = row.config.listing_url || "";
    const domain = extractDomain(currentUrl);

    if (!domain) {
      console.log(`  SKIP ${row.municipality}: no valid URL in config`);
      stillBroken.push(row);
      continue;
    }

    const domains = domainVariants(domain);
    let foundUrl = null;

    // First: test if domain itself redirects (follow redirect and use that domain)
    for (const d of domains) {
      const probe = await httpGet(`https://${d}/`, 10000);
      if (probe.ok) {
        const resolvedDomain = extractDomain(probe.url);
        if (resolvedDomain && resolvedDomain !== d) {
          domains.push(resolvedDomain);
        }
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    // Deduplicate domains
    const uniqueDomains = [...new Set(domains)];

    // Try each path variant on each domain
    for (const d of uniqueDomains) {
      if (foundUrl) break;
      for (const path of ANSLAGSTAVLA_PATHS) {
        const candidateUrl = `https://${d}${path}`;
        const result = await httpGet(candidateUrl);

        if (result.ok && result.text) {
          if (hasRelevantContent(result.text)) {
            // Use the final URL after redirects
            foundUrl = result.url;
            break;
          }
        }

        await new Promise((r) => setTimeout(r, 200));
      }
    }

    if (foundUrl) {
      console.log(`  FIXED ${row.municipality}: ${foundUrl}`);
      fixed.push({ ...row, newUrl: foundUrl });

      // Update in Supabase
      const updatedConfig = { ...row.config, listing_url: foundUrl };
      const { error: updateErr } = await sb
        .from("discovery_configs")
        .update({
          config: updatedConfig,
          updated_at: new Date().toISOString(),
        })
        .eq("municipality", row.municipality);

      if (updateErr) {
        console.log(`    DB UPDATE ERROR: ${updateErr.message}`);
      }
    } else {
      console.log(`  STILL BROKEN ${row.municipality} (${currentUrl})`);
      stillBroken.push(row);
    }
  }

  // Report
  console.log(`\n=== REPORT ===`);
  console.log(`Total approved configs: ${rows.length}`);
  console.log(`Already working: ${alreadyOk.length}`);
  console.log(`Fixed (new URL found): ${fixed.length}`);
  console.log(`Still broken: ${stillBroken.length}`);

  if (fixed.length > 0) {
    console.log(`\nFixed municipalities:`);
    for (const f of fixed) {
      console.log(`  ${f.municipality}: ${f.newUrl}`);
    }
  }

  if (stillBroken.length > 0) {
    console.log(`\nStill broken (need manual investigation):`);
    for (const b of stillBroken) {
      console.log(`  ${b.municipality}: ${b.config.listing_url || "NO URL"}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
