/**
 * One-time migration: drop the old friendships collection so the new
 * fromId/toId/status schema and unique index take effect cleanly.
 *
 * Run once:  node --env-file=.env server/scripts/migrateFriendships.js
 */
import "../config/legacyServerGuard.js"; // must stay the FIRST import: refuses InsiderTracker databases (legacy SkinTel code)
import "dotenv/config";
import mongoose from "mongoose";

async function main() {
  const uri = (process.env.MONGO_URI || process.env.MONGO_URL || "").trim();
  if (!uri) {
    console.error("❌ MONGO_URI / MONGO_URL missing in .env");
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log("✅ Connected to MongoDB");

  const db = mongoose.connection.db;
  const collections = await db.listCollections({ name: "friendships" }).toArray();

  if (collections.length === 0) {
    console.log("ℹ️ 'friendships' collection does not exist — nothing to migrate.");
  } else {
    await db.dropCollection("friendships");
    console.log("✅ Dropped 'friendships' collection (old schema cleared).");
    console.log("   The new schema (fromId/toId/status) will be created on next server start.");
  }

  await mongoose.disconnect();
  console.log("✅ Done");
}

main().catch(e => {
  console.error("❌ Migration failed:", e);
  process.exit(1);
});
