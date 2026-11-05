/**
 * Post-deploy investigation of ALERT_DUPLICATE_SKIPPED / ALERT_CREATE_FAILED.
 *
 * Goals:
 *  1. Confirm ALERT_CREATE_FAILED instrumentation is live (any docs at all,
 *     and any since the most recent SERVER_RESTART).
 *  2. List every ALERT_CREATE_FAILED doc with full meta.
 *  3. For every ALERT_DUPLICATE_SKIPPED since the most recent SERVER_RESTART:
 *       - source (engine / ws / empire-ws / etc.)
 *       - whether an AlertLog actually exists for that (userId,ruleId,itemId)
 *         around that time (true duplicate) or not
 *       - AlertState.lastNotifiedAt for that triple vs the event time
 *  4. Dump actual MongoDB indexes on the alertlogs collection — to check for
 *     a stale/legacy unique index not present in the current schema (the only
 *     way AlertLog.create() can throw 11000 given the schema has no unique
 *     index declared).
 *
 * Read-only. Run from server/: node scripts/alertDuplicateSkippedPostDeploy.mjs
 */
import "../config/legacyServerGuard.js"; // must stay the FIRST import: refuses InsiderTracker databases (legacy SkinTel code)
import "dotenv/config";
import mongoose from "mongoose";

import AlertLog from "../models/alertLog.models.js";
import AlertState from "../models/AlertState.js";
import NotificationEvent from "../models/NotificationEvent.model.js";

const MONGO_URL = (process.env.MONGO_URI || process.env.MONGO_URL || "").trim();
await mongoose.connect(MONGO_URL, { serverSelectionTimeoutMS: 15000 });
console.log("Connected to:", mongoose.connection.name || "(default db)");

/* ════════════════════════════════════════════════════════════
   0. Real MongoDB indexes on alertlogs — look for stale unique index
   ════════════════════════════════════════════════════════════ */
console.log("\n========== AlertLog collection — actual MongoDB indexes ==========");
const alertLogIndexes = await AlertLog.collection.indexes();
for (const idx of alertLogIndexes) {
  console.log(`  ${JSON.stringify(idx.key)}  unique=${!!idx.unique}  name=${idx.name}`);
}

/* ════════════════════════════════════════════════════════════
   1. Most recent SERVER_RESTART — proxy for "deploy time"
   ════════════════════════════════════════════════════════════ */
console.log("\n========== Most recent SERVER_RESTART events ==========");
const restarts = await NotificationEvent.find({ type: "SERVER_RESTART" })
  .sort({ createdAt: -1 }).limit(5).lean();
for (const r of restarts) console.log(`  ${r.createdAt.toISOString()}`);

const deployCutoff = restarts[0]?.createdAt || new Date(Date.now() - 2 * 60 * 60 * 1000);
console.log(`\nUsing cutoff (most recent restart): ${deployCutoff.toISOString()}`);

/* ════════════════════════════════════════════════════════════
   2. ALERT_CREATE_FAILED — any docs at all, and since cutoff
   ════════════════════════════════════════════════════════════ */
console.log("\n========== ALERT_CREATE_FAILED (all time) ==========");
const createFailedAll = await NotificationEvent.find({ type: "ALERT_CREATE_FAILED" })
  .sort({ createdAt: -1 }).lean();
console.log(`Total ALERT_CREATE_FAILED docs ever: ${createFailedAll.length}`);
for (const e of createFailedAll) {
  console.log(`  ${e.createdAt.toISOString()} source=${e.source} userId=${e.userId} ruleId=${e.ruleId} itemId=${e.itemId}`);
  console.log(`    meta: ${JSON.stringify(e.meta)}`);
}

console.log(`\nALERT_CREATE_FAILED since deploy cutoff (${deployCutoff.toISOString()}): ` +
  createFailedAll.filter(e => e.createdAt >= deployCutoff).length);

/* ════════════════════════════════════════════════════════════
   3. ALERT_DUPLICATE_SKIPPED since cutoff — classify each
   ════════════════════════════════════════════════════════════ */
console.log("\n========== ALERT_DUPLICATE_SKIPPED since deploy cutoff ==========");
const dupSkipped = await NotificationEvent.find({
  type: "ALERT_DUPLICATE_SKIPPED",
  createdAt: { $gte: deployCutoff },
}).sort({ createdAt: 1 }).lean();

console.log(`Total: ${dupSkipped.length}`);

const bySource = {};
for (const e of dupSkipped) bySource[e.source || "(none)"] = (bySource[e.source || "(none)"] || 0) + 1;
console.log("By source:", JSON.stringify(bySource));

let withAlertLog = 0, withoutAlertLog = 0;
const details = [];
for (const e of dupSkipped) {
  // Look for AlertLog within +/- 60s of the event for this exact triple
  const windowStart = new Date(e.createdAt.getTime() - 60 * 1000);
  const windowEnd   = new Date(e.createdAt.getTime() + 60 * 1000);
  const log = await AlertLog.findOne({
    userId: e.userId, ruleId: e.ruleId, itemId: e.itemId,
    triggeredAt: { $gte: windowStart, $lte: windowEnd },
  }).lean();

  const state = await AlertState.findOne({ userId: e.userId, ruleId: e.ruleId, itemId: e.itemId }).lean();

  if (log) withAlertLog++; else withoutAlertLog++;

  details.push({
    createdAt: e.createdAt.toISOString(),
    source: e.source,
    userId: String(e.userId),
    ruleId: String(e.ruleId),
    itemId: e.itemId,
    alertLogExistsNearby: !!log,
    alertLogId: log ? String(log._id) : null,
    alertLogTriggeredAt: log ? log.triggeredAt.toISOString() : null,
    alertStateLastNotifiedAt: state?.lastNotifiedAt ? state.lastNotifiedAt.toISOString() : null,
  });
}

console.log(`\nWith a matching AlertLog within +/-60s (TRUE duplicate, expected): ${withAlertLog}`);
console.log(`WITHOUT any matching AlertLog within +/-60s (UNEXPECTED — needs explanation): ${withoutAlertLog}`);

console.log("\nFull detail:");
for (const d of details) console.log(`  ${JSON.stringify(d)}`);

/* ════════════════════════════════════════════════════════════
   4. PUSH_SEND_SUCCESS / ALERT_CREATED-equivalent corroboration since cutoff
   ════════════════════════════════════════════════════════════ */
console.log("\n========== PUSH_SEND_SUCCESS since cutoff (sanity check pipeline works) ==========");
const pushSuccess = await NotificationEvent.countDocuments({
  type: "PUSH_SEND_SUCCESS", createdAt: { $gte: deployCutoff },
});
console.log(`PUSH_SEND_SUCCESS count since cutoff: ${pushSuccess}`);

const alertLogsSinceCutoff = await AlertLog.countDocuments({ triggeredAt: { $gte: deployCutoff } });
console.log(`AlertLog docs created since cutoff: ${alertLogsSinceCutoff}`);

await mongoose.disconnect();
console.log("\nDone.");
