/**
 * Deep investigation: for the 48 AlertState claims (WatchRule-sourced, last 24h)
 * that have NO AlertLog at all for user+item, gather every piece of evidence
 * recoverable from MongoDB:
 *
 *  - Exact lastNotifiedAt timestamp clustering (to spot batch-restart correlation)
 *  - WatchRule.lastNotifiedAt vs AlertState.lastNotifiedAt (WatchRule.lastNotifiedAt
 *    is only set AFTER AlertLog.create() succeeds, at alertEngine.js:386-387 —
 *    if it's stale/unset, that independently confirms AlertLog.create did not run)
 *  - NotificationEvent: SERVER_RESTART / WS_WATCHDOG_RESTART / WS_DISCONNECT /
 *    WS_RECONNECT in last 24h (timestamps)
 *  - NotificationEvent: ALERT_DUPLICATE_SKIPPED matching any of the 48 (userId,
 *    ruleId, itemId) triples — would mean it hit the 11000 branch, not the
 *    generic "Alert create error" branch
 *
 * Read-only. Run from server/: node scripts/alertCreateFailureInvestigation.mjs
 */
import "../config/legacyServerGuard.js"; // must stay the FIRST import: refuses InsiderTracker databases (legacy SkinTel code)
import "dotenv/config";
import mongoose from "mongoose";

import WatchRule from "../models/WatchRule.model.js";
import AlertLog from "../models/alertLog.models.js";
import AlertState from "../models/AlertState.js";
import NotificationEvent from "../models/NotificationEvent.model.js";

const MONGO_URL = (process.env.MONGO_URI || process.env.MONGO_URL || "").trim();
await mongoose.connect(MONGO_URL, { serverSelectionTimeoutMS: 15000 });
console.log("Connected to:", mongoose.connection.name || "(default db)");

const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

/* ════════════════════════════════════════════════════════════
   1. Rebuild the 48 "WatchRule, no AlertLog at all" list
   ════════════════════════════════════════════════════════════ */
const recentStates = await AlertState.find({ lastNotifiedAt: { $gte: since24h } }).lean();

const missing48 = [];
for (const st of recentStates) {
  const exists5min = await AlertLog.exists({
    userId: st.userId, ruleId: st.ruleId, itemId: st.itemId,
    triggeredAt: { $gte: new Date(st.lastNotifiedAt.getTime() - 5 * 60 * 1000) },
  });
  if (exists5min) continue;

  const isWatch = await WatchRule.exists({ _id: st.ruleId });
  if (!isWatch) continue;

  const anyLogForUserItem = await AlertLog.exists({
    userId: st.userId, itemId: st.itemId, triggeredAt: { $gte: since24h },
  });
  if (anyLogForUserItem) continue;

  missing48.push(st);
}
console.log(`\nRebuilt list: ${missing48.length} WatchRule AlertState claims with NO AlertLog at all in 24h`);

/* ════════════════════════════════════════════════════════════
   2. Timestamp clustering of lastNotifiedAt
   ════════════════════════════════════════════════════════════ */
console.log("\n========== Clustering by lastNotifiedAt (rounded to second) ==========");
const byTimestamp = {};
for (const st of missing48) {
  const key = st.lastNotifiedAt.toISOString().slice(0, 19); // second resolution
  (byTimestamp[key] ||= []).push(st);
}
const clusterKeys = Object.keys(byTimestamp).sort();
for (const k of clusterKeys) {
  console.log(`  ${k}  -> ${byTimestamp[k].length} claim(s)`);
}

/* ════════════════════════════════════════════════════════════
   3. WatchRule.lastNotifiedAt cross-check
   ════════════════════════════════════════════════════════════ */
console.log("\n========== WatchRule.lastNotifiedAt vs AlertState.lastNotifiedAt ==========");
let ruleLastNotifiedMatches = 0, ruleLastNotifiedStaleOrMissing = 0;
const detailRows = [];
for (const st of missing48) {
  const rule = await WatchRule.findById(st.ruleId).select("lastNotifiedAt userId baseName wear marketHashName").lean();
  const ruleLNA = rule?.lastNotifiedAt ? new Date(rule.lastNotifiedAt) : null;
  const stateLNA = new Date(st.lastNotifiedAt);
  const matches = ruleLNA && Math.abs(ruleLNA.getTime() - stateLNA.getTime()) < 2000;
  if (matches) ruleLastNotifiedMatches++;
  else ruleLastNotifiedStaleOrMissing++;

  detailRows.push({
    userId: String(st.userId),
    ruleId: String(st.ruleId),
    itemId: st.itemId,
    itemName: rule?.marketHashName || rule?.baseName || "(unknown)",
    stateLastNotifiedAt: stateLNA.toISOString(),
    ruleLastNotifiedAt: ruleLNA ? ruleLNA.toISOString() : "(null/unset)",
    ruleLNAMatchesState: matches,
  });
}
console.log(`  WatchRule.lastNotifiedAt MATCHES AlertState.lastNotifiedAt (within 2s): ${ruleLastNotifiedMatches}`);
console.log(`  WatchRule.lastNotifiedAt STALE or NULL (AlertLog.create likely never ran): ${ruleLastNotifiedStaleOrMissing}`);

console.log("\n  Full detail (all rows):");
for (const r of detailRows) {
  console.log(`  ${JSON.stringify(r)}`);
}

/* ════════════════════════════════════════════════════════════
   4. NotificationEvent: restart / socket events in 24h
   ════════════════════════════════════════════════════════════ */
console.log("\n========== NotificationEvent: SERVER_RESTART / WS_WATCHDOG_RESTART / WS_DISCONNECT / WS_RECONNECT (24h) ==========");
const events = await NotificationEvent.find({
  type: { $in: ["SERVER_RESTART", "WS_WATCHDOG_RESTART", "WS_DISCONNECT", "WS_RECONNECT"] },
  createdAt: { $gte: since24h },
}).sort({ createdAt: 1 }).lean();

console.log(`  Total: ${events.length}`);
for (const e of events) {
  console.log(`  ${e.createdAt.toISOString()}  ${e.type}  meta=${JSON.stringify(e.meta || {})}`);
}

/* ════════════════════════════════════════════════════════════
   5. NotificationEvent: ALERT_DUPLICATE_SKIPPED matching any of the 48
   ════════════════════════════════════════════════════════════ */
console.log("\n========== NotificationEvent: ALERT_DUPLICATE_SKIPPED matching the 48 triples ==========");
let dupMatchCount = 0;
for (const st of missing48) {
  const match = await NotificationEvent.findOne({
    type: "ALERT_DUPLICATE_SKIPPED",
    userId: st.userId,
    ruleId: st.ruleId,
    itemId: st.itemId,
    createdAt: { $gte: since24h },
  }).lean();
  if (match) {
    dupMatchCount++;
    console.log(`  MATCH: userId=${st.userId} ruleId=${st.ruleId} itemId=${st.itemId} at ${match.createdAt.toISOString()}`);
  }
}
console.log(`  Total ALERT_DUPLICATE_SKIPPED matches among the 48: ${dupMatchCount}`);

/* ════════════════════════════════════════════════════════════
   6. PUSH_SEND_START events matching the 48 (would mean AlertLog.create DID succeed)
   ════════════════════════════════════════════════════════════ */
console.log("\n========== NotificationEvent: PUSH_SEND_START matching the 48 triples ==========");
let pushStartMatchCount = 0;
for (const st of missing48) {
  const match = await NotificationEvent.findOne({
    type: "PUSH_SEND_START",
    userId: st.userId,
    ruleId: st.ruleId,
    itemId: st.itemId,
    createdAt: { $gte: since24h },
  }).lean();
  if (match) {
    pushStartMatchCount++;
    console.log(`  MATCH: userId=${st.userId} ruleId=${st.ruleId} itemId=${st.itemId} at ${match.createdAt.toISOString()}`);
  }
}
console.log(`  Total PUSH_SEND_START matches among the 48: ${pushStartMatchCount}`);

/* ════════════════════════════════════════════════════════════
   7. All NotificationEvent rows (any type) within +/- 5s of each cluster timestamp
   ════════════════════════════════════════════════════════════ */
console.log("\n========== All NotificationEvent rows within +/-5s of each cluster ==========");
for (const k of clusterKeys) {
  const center = new Date(k + "Z");
  const windowStart = new Date(center.getTime() - 5000);
  const windowEnd = new Date(center.getTime() + 5000);
  const rows = await NotificationEvent.find({
    createdAt: { $gte: windowStart, $lte: windowEnd },
  }).sort({ createdAt: 1 }).lean();
  console.log(`  Cluster ${k} (${byTimestamp[k].length} claims) — ${rows.length} NotificationEvent rows in +/-5s window:`);
  for (const r of rows) {
    console.log(`    ${r.createdAt.toISOString()} ${r.type} userId=${r.userId} ruleId=${r.ruleId} itemId=${r.itemId}`);
  }
}

await mongoose.disconnect();
console.log("\nDone.");
