/**
 * Investigate: 5 M9 Crimson Web alerts that fired together.
 *
 * Questions answered:
 *   1. Were these newly created AlertLog docs or old unread alerts?
 *   2. What are the itemIds for all 5 alerts?
 *   3. Did AlertState exist BEFORE firing (i.e. was dedupe expected to suppress these)?
 *   4. Did a SERVER_RESTART occur shortly before they fired?
 *   5. Were pushes delayed-delivery or freshly generated?
 *   6. Full per-alert timeline: matchedAt → createdAt → pushStartAt → pushDoneAt
 *
 * Read-only. Run from server/:
 *   node scripts/investigateCrimsonWebM9.mjs
 */
import "../config/legacyServerGuard.js"; // must stay the FIRST import: refuses InsiderTracker databases (legacy SkinTel code)
import "dotenv/config";
import mongoose from "mongoose";

import AlertLog          from "../models/alertLog.models.js";
import AlertState        from "../models/AlertState.js";
import NotificationEvent from "../models/NotificationEvent.model.js";

const MONGO_URL = (process.env.MONGO_URI || process.env.MONGO_URL || "").trim();
await mongoose.connect(MONGO_URL, { serverSelectionTimeoutMS: 15000 });
console.log("Connected to:", mongoose.connection.name || "(default db)");

const NAME_RE  = /M9 Bayonet.*Crimson Web|Crimson Web.*M9 Bayonet/i;
const since7d  = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

/* ════════════════════════════════════════════════════════════
   1 + 2. Find all M9 Crimson Web AlertLog entries (last 7 days)
   ════════════════════════════════════════════════════════════ */
console.log("\n========== AlertLog: M9 Crimson Web (last 7 days) ==========");

const logs = await AlertLog.find({
  triggeredAt: { $gte: since7d },
  $or: [
    { name:           NAME_RE },
    { marketHashName: NAME_RE },
  ],
}).sort({ triggeredAt: 1 }).lean();

console.log(`Total AlertLog matches: ${logs.length}`);

if (!logs.length) {
  console.log("No M9 Crimson Web alerts found — widening to all-time...");
  const allTime = await AlertLog.find({
    $or: [{ name: NAME_RE }, { marketHashName: NAME_RE }],
  }).sort({ triggeredAt: -1 }).limit(10).lean();
  console.log(`All-time matches (last 10): ${allTime.length}`);
  for (const l of allTime) {
    console.log(JSON.stringify({ _id: String(l._id), name: l.name, triggeredAt: l.triggeredAt, createdAt: l.createdAt }));
  }
  await mongoose.disconnect();
  process.exit(0);
}

// Collect unique itemIds and userIds from the matched alerts
const allItemIds = [...new Set(logs.map((l) => l.itemId).filter(Boolean))];
const allUserIds = [...new Set(logs.map((l) => String(l.userId)).filter(Boolean))];

console.log(`\nDistinct itemIds: ${JSON.stringify(allItemIds)}`);
console.log(`Distinct userIds: ${JSON.stringify(allUserIds)}`);

/* ════════════════════════════════════════════════════════════
   Detect the "burst": group alerts by proximity (≤30 s apart)
   then pick the largest burst as the 5-alert cluster.
   ════════════════════════════════════════════════════════════ */
console.log("\n========== Burst detection (alerts within 30 s of each other) ==========");

let burstLogs = logs;  // default: use all found

if (logs.length > 1) {
  // Sort by triggeredAt ascending, then slide a 30-second window
  const sorted = [...logs].sort((a, b) => new Date(a.triggeredAt) - new Date(b.triggeredAt));
  let bestWindow = [];
  for (let i = 0; i < sorted.length; i++) {
    const anchor = new Date(sorted[i].triggeredAt).getTime();
    const window30 = sorted.filter(
      (l) => Math.abs(new Date(l.triggeredAt).getTime() - anchor) <= 30_000
    );
    if (window30.length > bestWindow.length) bestWindow = window30;
  }
  if (bestWindow.length > 1) {
    console.log(`Identified burst of ${bestWindow.length} alerts within 30 s of each other`);
    burstLogs = bestWindow;
  } else {
    console.log("No tight burst found — analysing all matched alerts instead.");
  }
}

// ── Question 5: pushed at roughly the same time vs spread over minutes? ──
const trigTimes = burstLogs.map((l) => new Date(l.triggeredAt).getTime()).sort((a, b) => a - b);
const burstSpanMs = trigTimes.length > 1 ? trigTimes[trigTimes.length - 1] - trigTimes[0] : 0;
console.log(`Burst span: ${burstSpanMs} ms (${(burstSpanMs / 1000).toFixed(1)} s)`);
if (burstSpanMs === 0) {
  console.log("All triggered at exactly the same millisecond → likely a single emit / server flush, NOT organic separate matches.");
}

/* ════════════════════════════════════════════════════════════
   6. Per-alert timeline
   ════════════════════════════════════════════════════════════ */
console.log("\n========== Per-alert timeline ==========");

for (const l of burstLogs) {
  const t = l.timing ?? {};

  // Question 1: new vs old unread
  const docAge     = Date.now() - new Date(l.createdAt).getTime();
  const trigAge    = Date.now() - new Date(l.triggeredAt).getTime();
  const isNewDoc   = docAge < 5 * 60 * 1000;   // created within last 5 min → "new"

  // Gap between creation and triggeredAt (should be ~0 for live alerts; large = old doc)
  const createdVsTrigMs = Math.abs(
    new Date(l.createdAt).getTime() - new Date(l.triggeredAt).getTime()
  );

  // Timing chain
  const matchedAt    = t.matchedAt    ? new Date(t.matchedAt)    : null;
  const pushStartAt  = t.pushStartAt  ? new Date(t.pushStartAt)  : null;
  const pushDoneAt   = t.pushDoneAt   ? new Date(t.pushDoneAt)   : null;
  const createdAt    = new Date(l.createdAt);
  const triggeredAt  = new Date(l.triggeredAt);

  // Derived latencies
  const matchToCreate  = matchedAt  ? createdAt.getTime()   - matchedAt.getTime()   : null;
  const createToPushSt = pushStartAt ? pushStartAt.getTime() - createdAt.getTime()   : null;
  const pushDuration   = (pushStartAt && pushDoneAt) ? pushDoneAt.getTime() - pushStartAt.getTime() : null;

  console.log("\n──────────────────────────────────────────────");
  console.log(`alertId:      ${l._id}`);
  console.log(`name:         ${l.name}`);
  console.log(`itemId:       ${l.itemId}`);
  console.log(`priceCoins:   ${l.priceCoins}`);
  console.log(`wear:         ${l.wear || "—"}`);
  console.log(`source:       ${l.source}`);
  console.log(`status:       ${l.status}`);
  console.log(`isRead:       ${l.isRead}`);
  console.log(`userId:       ${l.userId}`);
  console.log(`ruleId:       ${l.ruleId}`);

  console.log(`\n  — DOC AGE / NEWNESS —`);
  console.log(`  createdAt:        ${createdAt.toISOString()}  (${Math.round(docAge / 1000)}s ago)`);
  console.log(`  triggeredAt:      ${triggeredAt.toISOString()}  (${Math.round(trigAge / 1000)}s ago)`);
  console.log(`  createdAt≈triggered gap: ${createdVsTrigMs} ms  ${createdVsTrigMs > 10_000 ? "⚠ LARGE — doc may predate this push" : "✓ normal"}`);
  console.log(`  Verdict (newness):  ${isNewDoc ? "NEWLY CREATED (fresh alert)" : "OLD DOC (existed before push)"}`);

  console.log(`\n  — TIMING CHAIN —`);
  console.log(`  ALERT_MATCHED:    ${matchedAt   ? matchedAt.toISOString()   : "—  (timing.matchedAt not set)"}`);
  console.log(`  ALERT_CREATED:    ${createdAt.toISOString()}`);
  console.log(`  PUSH_SEND_START:  ${pushStartAt ? pushStartAt.toISOString() : "—  (timing.pushStartAt not set)"}`);
  console.log(`  PUSH_SEND_DONE:   ${pushDoneAt  ? pushDoneAt.toISOString()  : "—  (timing.pushDoneAt not set)"}`);
  console.log(`  pushOutcome:      ${t.pushOutcome ?? "—"}`);
  console.log(`  totalLatencyMs:   ${t.totalLatencyMs ?? "—"}`);

  if (matchToCreate  !== null) console.log(`  match→create:     ${matchToCreate} ms`);
  if (createToPushSt !== null) console.log(`  create→pushStart: ${createToPushSt} ms  ${createToPushSt > 60_000 ? "⚠ DELAYED" : "✓"}`);
  if (pushDuration   !== null) console.log(`  push duration:    ${pushDuration} ms`);
}

/* ════════════════════════════════════════════════════════════
   3. AlertState existence check for each alert in the burst
      AlertState.createdAt < alertLog.createdAt  →  state existed BEFORE alert was created
      AlertState.createdAt ≈ alertLog.createdAt  →  state was created at the same time (normal first-match)
   ════════════════════════════════════════════════════════════ */
console.log("\n========== AlertState: pre-existence check ==========");

const burstRuleIds  = burstLogs.map((l) => l.ruleId);
const burstItemIds  = burstLogs.map((l) => l.itemId).filter(Boolean);

const states = await AlertState.find({
  $or: [
    { ruleId: { $in: burstRuleIds }, itemId: { $in: burstItemIds } },
  ],
}).lean();

// Build lookup: "ruleId|itemId" → state
const stateMap = {};
for (const s of states) {
  stateMap[`${s.ruleId}|${s.itemId}`] = s;
}

for (const l of burstLogs) {
  const key   = `${l.ruleId}|${l.itemId}`;
  const state = stateMap[key];
  const alertCreated = new Date(l.createdAt).getTime();

  if (!state) {
    console.log(`itemId=${l.itemId}  ruleId=${l.ruleId}  → NO AlertState found (state was deleted or never existed)`);
  } else {
    const stateCreated   = new Date(state.createdAt).getTime();
    const stateUpdated   = new Date(state.updatedAt).getTime();
    const preExisted     = stateCreated < alertCreated - 1000;  // >1s earlier
    const lastNotified   = state.lastNotifiedAt ? new Date(state.lastNotifiedAt) : null;
    const cooldownReset  = lastNotified ? alertCreated - lastNotified.getTime() : null;

    console.log(`itemId=${l.itemId}  ruleId=${l.ruleId}`);
    console.log(`  AlertState.createdAt:     ${state.createdAt}  ${preExisted ? "⚠ PRE-EXISTED before alert" : "✓ created with this alert"}`);
    console.log(`  AlertState.updatedAt:     ${state.updatedAt}`);
    console.log(`  AlertState.lastNotifiedAt:${lastNotified ? lastNotified.toISOString() : "null (never notified)"}`);
    if (cooldownReset !== null) {
      console.log(`  Time since last notify:   ${Math.round(cooldownReset / 1000)}s  ${cooldownReset < 60_000 ? "⚠ WITHIN 1MIN — should have been deduped" : "✓ outside cooldown"}`);
    }
  }
}

/* ════════════════════════════════════════════════════════════
   4. SERVER_RESTART check: any restart within 30 min before first burst alert?
   ════════════════════════════════════════════════════════════ */
console.log("\n========== SERVER_RESTART check (30 min before burst) ==========");

if (burstLogs.length) {
  const firstTrig   = new Date(Math.min(...burstLogs.map((l) => new Date(l.triggeredAt).getTime())));
  const windowStart = new Date(firstTrig.getTime() - 30 * 60 * 1000);
  const windowEnd   = new Date(firstTrig.getTime() + 2 * 60 * 1000);   // small tail

  console.log(`Looking for SERVER_RESTART between ${windowStart.toISOString()} and ${windowEnd.toISOString()}`);

  const restarts = await NotificationEvent.find({
    type:      "SERVER_RESTART",
    createdAt: { $gte: windowStart, $lte: windowEnd },
  }).sort({ createdAt: 1 }).lean();

  if (!restarts.length) {
    console.log("No SERVER_RESTART events found in that window.");
  } else {
    for (const r of restarts) {
      const gapMs = firstTrig.getTime() - new Date(r.createdAt).getTime();
      console.log(`SERVER_RESTART at ${r.createdAt}  →  ${Math.round(gapMs / 1000)}s before first burst alert`);
      console.log(`  meta: ${JSON.stringify(r.meta)}`);
    }
  }

  // Also check WS_WATCHDOG_RESTART (can cause a flush of queued items)
  const wsRestarts = await NotificationEvent.find({
    type:      { $in: ["WS_DISCONNECT", "WS_RECONNECT", "WS_WATCHDOG_RESTART"] },
    createdAt: { $gte: windowStart, $lte: windowEnd },
  }).sort({ createdAt: 1 }).lean();

  if (wsRestarts.length) {
    console.log(`\nWS events in that window:`);
    for (const e of wsRestarts) {
      const gapMs = firstTrig.getTime() - new Date(e.createdAt).getTime();
      console.log(`  ${e.type} at ${e.createdAt}  (${Math.round(gapMs / 1000)}s before burst)  meta=${JSON.stringify(e.meta)}`);
    }
  } else {
    console.log("No WS_DISCONNECT / WS_RECONNECT / WS_WATCHDOG_RESTART events in that window.");
  }
}

/* ════════════════════════════════════════════════════════════
   5. NotificationEvent push chain for burst alertIds
   ════════════════════════════════════════════════════════════ */
console.log("\n========== NotificationEvent push chain for burst alerts ==========");

const burstAlertIds = burstLogs.map((l) => l._id);

const pushEvents = await NotificationEvent.find({
  alertId: { $in: burstAlertIds },
}).sort({ createdAt: 1 }).lean();

if (!pushEvents.length) {
  // Fall back to itemId match in the burst window
  console.log("No NotificationEvent rows by alertId — trying itemId + time window...");
  const burstStart = new Date(Math.min(...burstLogs.map((l) => new Date(l.triggeredAt).getTime())) - 5 * 60 * 1000);
  const burstEnd   = new Date(Math.max(...burstLogs.map((l) => new Date(l.triggeredAt).getTime())) + 5 * 60 * 1000);

  const fallbackEvents = await NotificationEvent.find({
    itemId:    { $in: burstItemIds },
    createdAt: { $gte: burstStart, $lte: burstEnd },
  }).sort({ createdAt: 1 }).lean();

  console.log(`  Found ${fallbackEvents.length} events by itemId in ±5 min window`);
  for (const e of fallbackEvents) {
    console.log(`  ${e.createdAt}  type=${e.type}  itemId=${e.itemId}  alertId=${e.alertId}  latency=${e.latencyMs}ms  meta=${JSON.stringify(e.meta)}`);
  }
} else {
  for (const e of pushEvents) {
    console.log(`${e.createdAt}  type=${e.type}  alertId=${e.alertId}  itemId=${e.itemId}  latency=${e.latencyMs ?? "—"}ms  meta=${JSON.stringify(e.meta)}`);
  }
}

await mongoose.disconnect();
console.log("\nDone.");
