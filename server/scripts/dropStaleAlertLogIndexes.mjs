/**
 * Drop stale/legacy unique indexes on the alertlogs collection.
 *
 * Background:
 *   The alertlogs collection carries two unique indexes that are NOT declared
 *   in the current schema (server/models/alertLog.models.js):
 *     - userId_1_ruleId_1_itemId_1
 *     - userId_1_ruleId_1_itemId_1_priceCoins_1
 *   These are leftovers from before dedup moved to AlertState. As long as they
 *   exist, AlertLog.create() throws E11000 for any (userId,ruleId,itemId)
 *   triple that has EVER had one prior AlertLog doc — permanently blocking
 *   future alerts for that triple regardless of AlertState cooldown.
 *
 * This script ONLY drops those two named indexes. It does not:
 *   - call syncIndexes()
 *   - touch any AlertLog/AlertState/WatchRule documents
 *   - drop any other index
 *
 * Usage (run from server/):
 *   node scripts/dropStaleAlertLogIndexes.mjs --dry-run   (default, no changes)
 *   node scripts/dropStaleAlertLogIndexes.mjs --apply     (actually drops)
 */
import "dotenv/config";
import mongoose from "mongoose";

const STALE_INDEX_NAMES = [
  "userId_1_ruleId_1_itemId_1",
  "userId_1_ruleId_1_itemId_1_priceCoins_1",
];

const apply = process.argv.includes("--apply");
const mode = apply ? "APPLY (will drop indexes)" : "DRY RUN (no changes will be made)";

async function main() {
  const uri = (process.env.MONGO_URI || process.env.MONGO_URL || "").trim();
  if (!uri) {
    console.error("❌ Missing MONGO_URI / MONGO_URL in environment");
    process.exit(1);
  }

  console.log(`Mode: ${mode}`);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  console.log(`✅ Connected to: ${mongoose.connection.name || "(default db)"}`);

  const col = mongoose.connection.collection("alertlogs");

  console.log("\n========== Indexes BEFORE ==========");
  const before = await col.indexes();
  for (const idx of before) {
    console.log(`  ${JSON.stringify(idx.key)}  unique=${!!idx.unique}  name=${idx.name}`);
  }

  const presentNames = before
    .map((i) => i.name)
    .filter((name) => STALE_INDEX_NAMES.includes(name));

  if (presentNames.length === 0) {
    console.log("\nℹ️ Neither stale index is present. Nothing to do — exiting safely.");
    await mongoose.disconnect();
    return;
  }

  console.log(`\nFound ${presentNames.length} stale index(es) to drop: ${presentNames.join(", ")}`);
  for (const name of STALE_INDEX_NAMES) {
    if (!presentNames.includes(name)) {
      console.log(`  - ${name}: not present, will skip`);
    }
  }

  if (!apply) {
    console.log("\nDRY RUN: no indexes were dropped. Re-run with --apply to drop the indexes listed above.");
    await mongoose.disconnect();
    return;
  }

  console.log("\n========== Dropping stale indexes ==========");
  for (const name of presentNames) {
    try {
      await col.dropIndex(name);
      console.log(`  ✅ Dropped ${name}`);
    } catch (err) {
      console.error(`  ❌ Failed to drop ${name}: ${err?.message || err}`);
    }
  }

  console.log("\n========== Indexes AFTER ==========");
  const after = await col.indexes();
  for (const idx of after) {
    console.log(`  ${JSON.stringify(idx.key)}  unique=${!!idx.unique}  name=${idx.name}`);
  }

  await mongoose.disconnect();
  console.log("\n✅ Done.");
}

main().catch((e) => {
  console.error("❌ Error:", e);
  process.exit(1);
});
