import { readFile, readdir, writeFile } from "fs/promises";
import { join } from "path";
import { createInterface } from "readline";

const CONFIG_DIR = join(process.cwd(), "data", "discovery");

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log("=== Discovery Config Approval ===\n");

  const configFiles = (await readdir(CONFIG_DIR))
    .filter((f) => f.endsWith("_config.json"))
    .sort();

  if (configFiles.length === 0) {
    console.log("No discovery configs found. Run discover.js first.");
    rl.close();
    return;
  }

  for (const file of configFiles) {
    const filepath = join(CONFIG_DIR, file);
    const config = JSON.parse(await readFile(filepath, "utf-8"));

    console.log(`\n${"=".repeat(50)}`);
    console.log(`MUNICIPALITY: ${config.municipality}`);
    console.log(`STATUS: ${config.approved ? "APPROVED" : "PENDING"}`);
    console.log(`${"=".repeat(50)}`);
    console.log(`URL: ${config.listing_url}`);
    console.log(`Platform: ${config.platform_guess}`);
    console.log(`Listing type: ${config.listing_type}`);
    console.log(`Pagination: ${config.pagination?.has_pagination ? config.pagination.type : "none"}`);
    console.log(`Subpages required: ${config.requires_subpages?.required ? "YES - " + config.requires_subpages.reason : "no"}`);
    console.log(`Confidence: ${config.confidence}`);
    if (config.notes) console.log(`Notes: ${config.notes}`);

    if (config.approved) {
      console.log("\nAlready approved. Skipping.");
      continue;
    }

    const answer = await ask(rl, "\nApprove this config? (y/n/s=skip): ");

    if (answer.toLowerCase() === "y") {
      config.approved = true;
      config.approved_at = new Date().toISOString();
      await writeFile(filepath, JSON.stringify(config, null, 2), "utf-8");
      console.log("APPROVED.");
    } else if (answer.toLowerCase() === "n") {
      const reason = await ask(rl, "Rejection reason: ");
      config.approved = false;
      config.rejection_reason = reason;
      config.rejected_at = new Date().toISOString();
      await writeFile(filepath, JSON.stringify(config, null, 2), "utf-8");
      console.log("REJECTED.");
    } else {
      console.log("Skipped.");
    }
  }

  // Summary
  const allConfigs = [];
  for (const file of configFiles) {
    allConfigs.push(JSON.parse(await readFile(join(CONFIG_DIR, file), "utf-8")));
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log("APPROVAL SUMMARY");
  console.log(`Approved: ${allConfigs.filter((c) => c.approved).length}/${allConfigs.length}`);
  console.log(`Pending: ${allConfigs.filter((c) => !c.approved && !c.rejection_reason).length}`);
  console.log(`Rejected: ${allConfigs.filter((c) => c.rejection_reason).length}`);

  rl.close();
}

main().catch(console.error);
