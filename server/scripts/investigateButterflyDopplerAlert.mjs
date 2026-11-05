/**
 * One-off investigation: why didn't
 *   "★ StatTrak™ Butterfly Knife | Doppler (Factory New) - Phase 2" @ 6885.53
 * trigger a Chrome push, even though it appeared in the UI?
 *
 * Read-only. Run from server/:
 *   node scripts/investigateButterflyDopplerAlert.mjs
 */
import "../config/legacyServerGuard.js"; // must stay the FIRST import: refuses InsiderTracker databases (legacy SkinTel code)
import "dotenv/config";
import mongoose from "mongoose";

import WatchRule from "../models/WatchRule.model.js";
import AlertLog from "../models/alertLog.models.js";
import AlertState from "../models/AlertState.js";
import NotificationEvent from "../models/NotificationEvent.model.js";
import DeviceToken from "../models/DeviceToken.model.js";

const MONGO_URL = (process.env.MONGO_URI || process.env.MONGO_URL || "").trim();
await mongoose.connect(MONGO_URL, { serverSelectionTimeoutMS: 15000 });
console.log("Connected to:", mongoose.connection.name || "(default db)");

const NAME_RE = /Butterfly Knife.*Doppler/i;
const since48h = new Date(Date.now() - 48 * 60 * 60 * 1000);

/* ════════════════════════════════════════════════════════════
   1. Matching WatchRules
   ════════════════════════════════════════════════════════════ */
console.log("\n========== WatchRule matches ==========");
const rules = await WatchRule.find({
  $or: [
    { baseName: NAME_RE },
    { marketHashName: NAME_RE },
    { skin: NAME_RE },
  ],
}).lean();

for (const r of rules) {
  console.log(JSON.stringify({
    _id: String(r._id),
    userId: String(r.userId),
    baseName: r.baseName,
    marketHashName: r.marketHashName,
    wear: r.wear,
    weapon: r.weapon,
    skin: r.skin,
    targetPrice: r.targetPrice,
    minDiscountPct: r.minDiscountPct,
    cooldownMin: r.cooldownMin,
    lastNotifiedAt: r.lastNotifiedAt,
    lastMatchedItemKey: r.lastMatchedItemKey,
    updatedAt: r.updatedAt,
  }));
}
console.log(`Total rules matched: ${rules.length}`);

/* ════════════════════════════════════════════════════════════
   2. AlertLog entries (last 48h)
   ════════════════════════════════════════════════════════════ */
console.log("\n========== AlertLog matches (last 48h) ==========");
const logs = await AlertLog.find({
  triggeredAt: { $gte: since48h },
  $or: [
    { name: NAME_RE },
    { marketHashName: NAME_RE },
  ],
}).sort({ triggeredAt: -1 }).lean();

for (const l of logs) {
  console.log(JSON.stringify({
    _id: String(l._id),
    userId: String(l.userId),
    ruleId: String(l.ruleId),
    itemId: l.itemId,
    name: l.name,
    priceCoins: l.priceCoins,
    wear: l.wear,
    source: l.source,
    status: l.status,
    triggeredAt: l.triggeredAt,
    timing: l.timing,
  }));
}
console.log(`Total AlertLog matches: ${logs.length}`);

/* ════════════════════════════════════════════════════════════
   3. AlertState entries (by name field, and by ruleId from step 1)
   ════════════════════════════════════════════════════════════ */
console.log("\n========== AlertState matches ==========");
const ruleIds = rules.map((r) => r._id);
const states = await AlertState.find({
  $or: [
    { name: NAME_RE },
    ...(ruleIds.length ? [{ ruleId: { $in: ruleIds } }] : []),
  ],
}).sort({ updatedAt: -1 }).lean();

for (const s of states) {
  console.log(JSON.stringify({
    _id: String(s._id),
    userId: String(s.userId),
    ruleId: String(s.ruleId),
    itemId: s.itemId,
    name: s.name,
    lastPrice: s.lastPrice,
    lastSeenAt: s.lastSeenAt,
    lastNotifiedAt: s.lastNotifiedAt,
    updatedAt: s.updatedAt,
  }));
}
console.log(`Total AlertState matches: ${states.length}`);

/* ════════════════════════════════════════════════════════════
   4. NotificationEvent rows for the itemIds/users found above (last 48h)
   ════════════════════════════════════════════════════════════ */
console.log("\n========== NotificationEvent rows (last 48h) for found itemIds/users ==========");
const itemIds = [...new Set([...logs.map((l) => l.itemId), ...states.map((s) => s.itemId)].filter(Boolean))];
const userIds = [...new Set([...logs.map((l) => String(l.userId)), ...states.map((s) => String(s.userId)), ...rules.map((r) => String(r.userId))].filter(Boolean))];

console.log(`itemIds: ${JSON.stringify(itemIds)}`);
console.log(`userIds: ${JSON.stringify(userIds)}`);

const events = await NotificationEvent.find({
  createdAt: { $gte: since48h },
  $or: [
    ...(itemIds.length ? [{ itemId: { $in: itemIds } }] : []),
    ...(userIds.length ? [{ userId: { $in: userIds.map((u) => new mongoose.Types.ObjectId(u)) } }] : []),
  ],
}).sort({ createdAt: 1 }).lean();

for (const e of events) {
  console.log(JSON.stringify({
    createdAt: e.createdAt,
    type: e.type,
    userId: e.userId ? String(e.userId) : null,
    alertId: e.alertId ? String(e.alertId) : null,
    ruleId: e.ruleId ? String(e.ruleId) : null,
    itemId: e.itemId,
    latencyMs: e.latencyMs,
    meta: e.meta,
  }));
}
console.log(`Total NotificationEvent rows: ${events.length}`);

/* ════════════════════════════════════════════════════════════
   5. DeviceToken status for the users found above
   ════════════════════════════════════════════════════════════ */
console.log("\n========== DeviceToken status for users found ==========");
for (const uid of userIds) {
  const tokens = await DeviceToken.find({ userId: uid }).lean();
  console.log(`userId=${uid}  tokenCount=${tokens.length}`);
  for (const t of tokens) {
    console.log(JSON.stringify({
      tokenPrefix: (t.token || "").slice(0, 16) + "...",
      active: t.active,
      platform: t.platform,
      browser: t.browser,
      lastSeenAt: t.lastSeenAt,
      lastPushAt: t.lastPushAt,
      lastPushSuccess: t.lastPushSuccess,
      failCount: t.failCount,
    }));
  }
}

await mongoose.disconnect();
console.log("\nDone.");
