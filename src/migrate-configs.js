// Migrates all discovery configs from local JSON files to Supabase discovery_configs table.
// Run: node src/migrate-configs.js

import { createClient } from "@supabase/supabase-js";
import { readFile, readdir } from "fs/promises";
import { join } from "path";

const CONFIG_DIR = join(process.cwd(), "data", "discovery");

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.");
    process.exit(1);
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  const files = (await readdir(CONFIG_DIR)).filter((f) => f.endsWith("_config.json"));
  console.log(`Found ${files.length} config files\n`);

  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  for (const file of files) {
    const raw = JSON.parse(await readFile(join(CONFIG_DIR, file), "utf-8"));
    const municipality = raw.municipality;
    if (!municipality) {
      console.log(`  SKIP ${file}: no municipality field`);
      skipped++;
      continue;
    }

    const row = {
      municipality,
      config: raw,
      approved: raw.approved || false,
      confidence: raw.confidence || null,
    };

    const { error } = await supabase
      .from("discovery_configs")
      .upsert(row, { onConflict: "municipality" });

    if (error) {
      console.log(`  ERROR ${municipality}: ${error.message}`);
      errors++;
    } else {
      console.log(`  OK ${municipality} (approved=${row.approved}, confidence=${row.confidence})`);
      inserted++;
    }
  }

  console.log(`\nDone: ${inserted} inserted/updated, ${skipped} skipped, ${errors} errors`);

  // Verify
  const { data } = await supabase.from("discovery_configs").select("municipality, approved");
  const approved = data.filter((r) => r.approved).length;
  console.log(`\nVerification: ${data.length} total rows, ${approved} approved`);
}

main().catch(console.error);
