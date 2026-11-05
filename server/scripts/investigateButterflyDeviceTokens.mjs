/**
 * Focused follow-up: DeviceToken timeline for userId 6a047e62dc12a49ecabec17c
 * around the Butterfly Knife | Doppler push at 2026-06-15T15:51:04.054Z
 * (alertId 6a301f67f0fc64606896cf69).
 *
 * Read-only. Run from server/:
 *   node scripts/investigateButterflyDeviceTokens.mjs
 */
import "../config/legacyServerGuard.js"; // must stay the FIRST import: refuses InsiderTracker databases (legacy SkinTel code)
import "dotenv/config";
import mongoose from "mongoose";
import DeviceToken from "../models/DeviceToken.model.js";
import NotificationEvent from "../models/NotificationEvent.model.js";

const MONGO_URL = (process.env.MONGO_URI || process.env.MONGO_URL || "").trim();
await mongoose.connect(MONGO_URL, { serverSelectionTimeoutMS: 15000 });
console.log("Connected to:", mongoose.connection.name || "(default db)");

const userId = "6a047e62dc12a49ecabec17c";

const tokens = await DeviceToken.find({ userId }).sort({ updatedAt: 1 }).lean();
console.log(`Total DeviceToken docs for user: ${tokens.length}\n`);

for (const t of tokens) {
  console.log(JSON.stringify({
    _id: String(t._id),
    tokenLen: (t.token || "").length,
    tokenHead: (t.token || "").slice(0, 24),
    tokenTail: (t.token || "").slice(-12),
    active: t.active,
    platform: t.platform,
    browser: t.browser,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    lastSeenAt: t.lastSeenAt,
    lastPushAt: t.lastPushAt,
    lastPushSuccess: t.lastPushSuccess,
    failCount: t.failCount,
  }));
}

console.log("\n========== NotificationEvent: TOKEN_* events for this user around 15:50-15:52 ==========");
const start = new Date("2026-06-15T15:49:00.000Z");
const end   = new Date("2026-06-15T15:53:00.000Z");
const events = await NotificationEvent.find({
  userId,
  createdAt: { $gte: start, $lte: end },
}).sort({ createdAt: 1 }).lean();
for (const e of events) {
  console.log(JSON.stringify({
    createdAt: e.createdAt,
    type: e.type,
    alertId: e.alertId ? String(e.alertId) : null,
    itemId: e.itemId,
    meta: e.meta,
  }));
}

await mongoose.disconnect();
console.log("\nDone.");
