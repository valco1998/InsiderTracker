/**
 * Read-only production reliability audit for Watchlist + Price Alerts.
 *
 * Run from server/:
 *   node scripts/watchlistReliabilityAudit.mjs
 *
 * Connects using MONGO_URI / MONGO_URL from .env (same as the running server).
 * Performs ONLY find/aggregate/countDocuments — no writes, no deletes.
 */
import "../config/legacyServerGuard.js"; // must stay the FIRST import: refuses InsiderTracker databases (legacy SkinTel code)
import "dotenv/config";
import mongoose from "mongoose";

import WatchRule from "../models/WatchRule.model.js";
import AlertLog from "../models/alertLog.models.js";
import AlertState from "../models/AlertState.js";

const MONGO_URL = (process.env.MONGO_URI || process.env.MONGO_URL || "").trim();
if (!MONGO_URL) throw new Error("MONGO_URI / MONGO_URL missing in .env");

await mongoose.connect(MONGO_URL, { serverSelectionTimeoutMS: 15000 });
console.log("Connected to:", mongoose.connection.name || "(default db)");

const DAY_MS = 24 * 60 * 60 * 1000;
const since24h = new Date(Date.now() - DAY_MS);

/* ════════════════════════════════════════════════════════════
   1. WatchRule collection — totals + duplicates
   ════════════════════════════════════════════════════════════ */
console.log("\n========== 1. WatchRule collection ==========");

const totalRules = await WatchRule.countDocuments({});
console.log(`Total WatchRule documents: ${totalRules}`);

const dupGroups = await WatchRule.aggregate([
  {
    $group: {
      _id: { userId: "$userId", baseName: "$baseName", wear: "$wear", appId: "$appId" },
      count: { $sum: 1 },
      ids: { $push: "$_id" },
      createdAts: { $push: "$createdAt" },
    },
  },
  { $match: { count: { $gt: 1 } } },
  { $sort: { count: -1 } },
]);

console.log(`Duplicate groups (userId+baseName+wear+appId, count>1): ${dupGroups.length}`);
let dupDocsTotal = 0;
for (const g of dupGroups) {
  dupDocsTotal += g.count;
  console.log(
    `  userId=${g._id.userId} baseName="${g._id.baseName}" wear="${g._id.wear}" appId=${g._id.appId} ` +
    `count=${g.count} ids=[${g.ids.join(", ")}] createdAts=[${g.createdAts.map(d => d?.toISOString()).join(", ")}]`
  );
}
console.log(`Total documents involved in duplicate groups: ${dupDocsTotal}`);

/* ════════════════════════════════════════════════════════════
   2. AlertLog — last 200 watchlist alerts (exclude auction-alert)
   ════════════════════════════════════════════════════════════ */
console.log("\n========== 2. AlertLog — last 200 watchlist alerts ==========");

const last200 = await AlertLog.find({ source: { $ne: "auction-alert" } })
  .sort({ triggeredAt: -1 })
  .limit(200)
  .lean();

console.log(`Fetched: ${last200.length} docs`);

let cMatched = 0, cCreated = 0, cSocketEmitted = 0, cPushSent = 0, cPushFailed = 0, cPushUnknown = 0;
for (const a of last200) {
  cCreated++; // existence of the AlertLog doc == created
  if (a.timing?.matchedAt) cMatched++;
  if (a.timing?.socketEmitAt) cSocketEmitted++;
  if (a.timing?.pushDoneAt) {
    if (a.timing.pushOutcome === "success") cPushSent++;
    else if (a.timing.pushOutcome === "fail") cPushFailed++;
    else cPushUnknown++;
  } else if (a.timing?.pushStartAt) {
    cPushUnknown++; // push started but never recorded an outcome
  }
}
console.log(`  matched (timing.matchedAt set):     ${cMatched}`);
console.log(`  created (AlertLog doc exists):      ${cCreated}`);
console.log(`  socket emitted (timing.socketEmitAt): ${cSocketEmitted}`);
console.log(`  push sent (pushOutcome=success):    ${cPushSent}`);
console.log(`  push failed (pushOutcome=fail):     ${cPushFailed}`);
console.log(`  push outcome unknown/missing:       ${cPushUnknown}`);

// Source breakdown
const sourceCounts = {};
for (const a of last200) sourceCounts[a.source || "(unset)"] = (sourceCounts[a.source || "(unset)"] || 0) + 1;
console.log("  source breakdown:", JSON.stringify(sourceCounts));

/* ════════════════════════════════════════════════════════════
   3. Last 24h conversion funnel (from AlertLog.timing)
   ════════════════════════════════════════════════════════════ */
console.log("\n========== 3. Last 24h conversion funnel ==========");

const last24h = await AlertLog.find({
  source: { $ne: "auction-alert" },
  triggeredAt: { $gte: since24h },
}).lean();

console.log(`AlertLog docs created in last 24h: ${last24h.length}`);

let f_matched = 0, f_created = 0, f_socket = 0, f_pushSuccess = 0, f_pushFail = 0;
const latencies = [];
for (const a of last24h) {
  f_created++;
  if (a.timing?.matchedAt) f_matched++;
  if (a.timing?.socketEmitAt) f_socket++;
  if (a.timing?.pushOutcome === "success") f_pushSuccess++;
  if (a.timing?.pushOutcome === "fail") f_pushFail++;
  if (typeof a.timing?.totalLatencyMs === "number") latencies.push(a.timing.totalLatencyMs);
}

function pct(n, d) { return d > 0 ? ((n / d) * 100).toFixed(1) + "%" : "n/a"; }

console.log(`  WATCH_RULE_MATCHED  : ${f_matched}`);
console.log(`  ALERT_CREATED       : ${f_created}  (${pct(f_created, f_matched)} of matched)`);
console.log(`  SOCKET_EMIT         : ${f_socket}  (${pct(f_socket, f_created)} of created)`);
console.log(`  PUSH_SEND_SUCCESS   : ${f_pushSuccess}  (${pct(f_pushSuccess, f_socket)} of socket-emitted)`);
console.log(`  PUSH_SEND_FAIL      : ${f_pushFail}`);

if (latencies.length) {
  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  const max = latencies[latencies.length - 1];
  console.log(`  totalLatencyMs (n=${latencies.length}): p50=${p50}ms p95=${p95}ms max=${max}ms`);
} else {
  console.log("  totalLatencyMs: no docs have this field populated");
}

/* ════════════════════════════════════════════════════════════
   4. Missed alerts: AlertState claimed but no matching AlertLog
   ════════════════════════════════════════════════════════════ */
console.log("\n========== 4. AlertState claims with no corresponding AlertLog ==========");

const recentStates = await AlertState.find({
  lastNotifiedAt: { $gte: since24h },
}).lean();

console.log(`AlertState docs with lastNotifiedAt in last 24h: ${recentStates.length}`);

let missing = 0;
for (const st of recentStates) {
  const exists = await AlertLog.exists({
    userId: st.userId,
    ruleId: st.ruleId,
    itemId: st.itemId,
    triggeredAt: { $gte: new Date(st.lastNotifiedAt.getTime() - 5 * 60 * 1000) },
  });
  if (!exists) {
    missing++;
    console.log(
      `  MISSING ALERTLOG: userId=${st.userId} ruleId=${st.ruleId} itemId=${st.itemId} ` +
      `lastNotifiedAt=${st.lastNotifiedAt.toISOString()} lastPrice=${st.lastPrice}`
    );
  }
}
console.log(`Total AlertState claims with no AlertLog within 5min window: ${missing}`);

/* ════════════════════════════════════════════════════════════
   5. Engine comparison — same item, multiple sources/rules
   ════════════════════════════════════════════════════════════ */
console.log("\n========== 5. Same item matched by multiple rules/sources ==========");

const multiRuleSameItem = await AlertLog.aggregate([
  { $match: { source: { $ne: "auction-alert" }, triggeredAt: { $gte: since24h } } },
  {
    $group: {
      _id: { userId: "$userId", itemId: "$itemId" },
      count: { $sum: 1 },
      ruleIds: { $addToSet: "$ruleId" },
      sources: { $addToSet: "$source" },
      docs: { $push: { id: "$_id", triggeredAt: "$triggeredAt", source: "$source", ruleId: "$ruleId" } },
    },
  },
  { $match: { count: { $gt: 1 } } },
  { $sort: { count: -1 } },
  { $limit: 25 },
]);

console.log(`Groups where same userId+itemId produced >1 AlertLog in last 24h: ${multiRuleSameItem.length}`);
for (const g of multiRuleSameItem) {
  console.log(
    `  userId=${g._id.userId} itemId=${g._id.itemId} count=${g.count} ` +
    `distinctRules=${g.ruleIds.length} sources=${JSON.stringify(g.sources)}`
  );
  for (const d of g.docs) {
    console.log(`    alertLogId=${d.id} ruleId=${d.ruleId} source=${d.source} triggeredAt=${d.triggeredAt?.toISOString()}`);
  }
}

await mongoose.disconnect();
console.log("\nDone.");
