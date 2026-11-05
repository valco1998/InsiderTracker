import "../config/legacyServerGuard.js"; // must stay the FIRST import: refuses InsiderTracker databases (legacy SkinTel code)
import "dotenv/config";
import mongoose from "mongoose";

async function main() {
  const uri = process.env.MONGO_URL || process.env.MONGO_URL;
  if (!uri) {
    console.error("❌ Missing MONGO_URI / MONGODB_URI in .env");
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log("✅ Connected");

  const col = mongoose.connection.collection("users");

  const indexes = await col.indexes();
  console.log("Indexes:", indexes.map((i) => i.name));

  const has = indexes.some((i) => i.name === "userName_1");
  if (!has) {
    console.log("ℹ️ userName_1 not found, nothing to drop.");
    await mongoose.disconnect();
    return;
  }

  await col.dropIndex("userName_1");
  console.log("✅ Dropped userName_1");

  await mongoose.disconnect();
  console.log("✅ Done");
}

main().catch((e) => {
  console.error("❌ Error:", e);
  process.exit(1);
});