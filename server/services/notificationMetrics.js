/**
 * Notification reliability metrics — historical dashboard data.
 *
 * Two storage mechanisms:
 *  - AlertLog.timing  — per-alert lifecycle timestamps (MATCH -> CREATED ->
 *    SOCKET_EMIT -> PUSH_START -> PUSH_DONE), set incrementally as the alert
 *    moves through the pipeline.
 *  - NotificationEvent — generic event log for everything else (push outcomes
 *    at the send level, token churn, WS health, restarts, dedupe skips).
 *
 * EVERY write in this module is fire-and-forget and swallows its own errors.
 * Metrics must never slow down or break alert/push delivery.
 */

import AlertLog from "../models/alertLog.models.js";
import NotificationEvent from "../models/NotificationEvent.model.js";
import DeviceToken from "../models/DeviceToken.model.js";
import User from "../models/User.model.js";

/* ── Write helpers (fire-and-forget) ─────────────────────────────────────── */

/**
 * Record a standalone infrastructure/pipeline event.
 * @param {string} type - one of NotificationEvent's `type` enum values
 * @param {object} [payload] - userId, alertId, ruleId, itemId, source, latencyMs, meta
 */
export function recordEvent(type, payload = {}) {
  NotificationEvent.create({ type, ...payload }).catch(() => {});
}

/**
 * Stamp a single timing field on an AlertLog's `timing` subdocument.
 * @param {string|ObjectId} alertId
 * @param {"socketEmitAt"|"pushStartAt"} stage
 * @param {Date} [ts]
 */
export function recordAlertTiming(alertId, stage, ts = new Date()) {
  if (!alertId) return;
  AlertLog.updateOne({ _id: alertId }, { $set: { [`timing.${stage}`]: ts } }).catch(() => {});
}

/**
 * Stamp the final push outcome (success or fail) and compute end-to-end latency
 * from `timing.matchedAt` if present.
 * @param {string|ObjectId} alertId
 * @param {"success"|"fail"} outcome
 * @param {Date} [ts]
 */
export function recordAlertPushDone(alertId, outcome, ts = new Date()) {
  if (!alertId) return;
  AlertLog.findById(alertId).select("timing").lean()
    .then((doc) => {
      const update = {
        "timing.pushDoneAt": ts,
        "timing.pushOutcome": outcome,
      };
      const matchedAt = doc?.timing?.matchedAt;
      if (matchedAt) {
        update["timing.totalLatencyMs"] = ts.getTime() - new Date(matchedAt).getTime();
      }
      return AlertLog.updateOne({ _id: alertId }, { $set: update });
    })
    .catch(() => {});
}

/* ── Stats helpers ────────────────────────────────────────────────────────── */

function _stats(samples) {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  return {
    count: n,
    avg: Math.round(sorted.reduce((s, v) => s + v, 0) / n),
    p50: sorted[Math.floor((n - 1) * 0.50)],
    p95: sorted[Math.floor((n - 1) * 0.95)],
    max: sorted[n - 1],
  };
}

const PERIODS = {
  "1h":  3600 * 1000,
  "24h": 24 * 3600 * 1000,
  "7d":  7 * 24 * 3600 * 1000,
};

/* ── Health score ─────────────────────────────────────────────────────────── */

function _scoreFromRate(rate) {
  if (rate >= 99) return 100;
  if (rate <= 50) return 0;
  return ((rate - 50) / 49) * 100;
}

function _scoreFromLatency(avgMs) {
  if (avgMs == null) return 100;
  if (avgMs <= 3000) return 100;
  if (avgMs >= 15000) return 0;
  return 100 - ((avgMs - 3000) / 12000) * 100;
}

function _scoreFromWs(reconnects, watchdogRestarts) {
  return Math.max(0, 100 - (reconnects + watchdogRestarts) * 10);
}

function _scoreFromTokens(tokensRemoved, activeTokens) {
  const ratio = tokensRemoved / Math.max(activeTokens, 1);
  return Math.max(0, 100 - ratio * 100);
}

function computeHealthScore({ pushSuccess, pushFailed, latency, wsHealth, tokensRemoved, activeTokens }) {
  const total = pushSuccess + pushFailed;
  const successRate = total > 0 ? (pushSuccess / total) * 100 : 100;

  const score =
    0.50 * _scoreFromRate(successRate) +
    0.20 * _scoreFromLatency(latency.endToEnd?.avg ?? null) +
    0.15 * _scoreFromWs(wsHealth.reconnects, wsHealth.watchdogRestarts) +
    0.15 * _scoreFromTokens(tokensRemoved, activeTokens);

  const rounded = Math.round(score);
  let band;
  if (rounded >= 95) band = "Excellent";
  else if (rounded >= 85) band = "Good";
  else if (rounded >= 70) band = "Warning";
  else band = "Critical";

  return { score: rounded, band, successRate: Math.round(successRate * 10) / 10 };
}

/* ── Per-period aggregation ───────────────────────────────────────────────── */

async function getStageLatencies(start) {
  const docs = await AlertLog.find({
    "timing.matchedAt": { $gte: start },
  }).select("triggeredAt timing").lean();

  const stages = {
    matchToCreated:    [],
    createdToSocket:   [],
    socketToPushStart: [],
    pushStartToDone:   [],
    endToEnd:          [],
  };

  for (const d of docs) {
    const t = d.timing || {};
    const matchedAt   = t.matchedAt    ? new Date(t.matchedAt).getTime()    : null;
    const createdAt   = d.triggeredAt  ? new Date(d.triggeredAt).getTime()  : null;
    const socketAt    = t.socketEmitAt ? new Date(t.socketEmitAt).getTime() : null;
    const pushStartAt = t.pushStartAt  ? new Date(t.pushStartAt).getTime()  : null;
    const pushDoneAt  = t.pushDoneAt   ? new Date(t.pushDoneAt).getTime()   : null;

    if (matchedAt != null && createdAt != null) stages.matchToCreated.push(createdAt - matchedAt);
    if (createdAt != null && socketAt != null)  stages.createdToSocket.push(socketAt - createdAt);
    if (socketAt != null && pushStartAt != null) stages.socketToPushStart.push(pushStartAt - socketAt);
    if (pushStartAt != null && pushDoneAt != null) stages.pushStartToDone.push(pushDoneAt - pushStartAt);
    if (typeof t.totalLatencyMs === "number") stages.endToEnd.push(t.totalLatencyMs);
  }

  return {
    matchToCreated:    _stats(stages.matchToCreated),
    createdToSocket:   _stats(stages.createdToSocket),
    socketToPushStart: _stats(stages.socketToPushStart),
    pushStartToDone:   _stats(stages.pushStartToDone),
    endToEnd:          _stats(stages.endToEnd),
  };
}

async function getPeriodMetrics(periodKey, activeTokens) {
  const periodMs = PERIODS[periodKey];
  const start = new Date(Date.now() - periodMs);

  const [
    alertsCreated,
    socketEmits,
    duplicateSkipped,
    pushStartEvents,
    pushOutcomeAgg,
    tokensRemoved,
    tokensRegistered,
    wsDisconnects,
    wsReconnects,
    wsWatchdogRestarts,
    serverRestarts,
    latency,
    topUsersAgg,
  ] = await Promise.all([
    AlertLog.countDocuments({ triggeredAt: { $gte: start } }),
    AlertLog.countDocuments({ "timing.socketEmitAt": { $gte: start } }),
    NotificationEvent.countDocuments({ type: "ALERT_DUPLICATE_SKIPPED", createdAt: { $gte: start } }),
    NotificationEvent.countDocuments({ type: "PUSH_SEND_START", createdAt: { $gte: start } }),
    NotificationEvent.aggregate([
      { $match: { type: { $in: ["PUSH_SEND_SUCCESS", "PUSH_SEND_FAIL"] }, createdAt: { $gte: start } } },
      { $group: {
          _id: "$type",
          successTokens: { $sum: { $ifNull: ["$meta.successCount", 0] } },
          failTokens:    { $sum: { $ifNull: ["$meta.failureCount", 0] } },
        } },
    ]),
    NotificationEvent.countDocuments({ type: "TOKEN_INVALID_REMOVED", createdAt: { $gte: start } }),
    NotificationEvent.countDocuments({ type: "TOKEN_REGISTERED", createdAt: { $gte: start } }),
    NotificationEvent.countDocuments({ type: "WS_DISCONNECT", createdAt: { $gte: start } }),
    NotificationEvent.countDocuments({ type: "WS_RECONNECT", createdAt: { $gte: start } }),
    NotificationEvent.countDocuments({ type: "WS_WATCHDOG_RESTART", createdAt: { $gte: start } }),
    NotificationEvent.countDocuments({ type: "SERVER_RESTART", createdAt: { $gte: start } }),
    getStageLatencies(start),
    AlertLog.aggregate([
      { $match: { "timing.pushOutcome": "success", "timing.pushDoneAt": { $gte: start } } },
      { $group: { _id: "$userId", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
  ]);

  let pushSuccess = 0;
  let pushFailed = 0;
  for (const row of pushOutcomeAgg) {
    if (row._id === "PUSH_SEND_SUCCESS") pushSuccess += row.successTokens;
    if (row._id === "PUSH_SEND_FAIL")    pushFailed  += row.failTokens;
  }

  const userIds = topUsersAgg.map((r) => r._id).filter(Boolean);
  const users = userIds.length
    ? await User.find({ _id: { $in: userIds } }).select("username email").lean()
    : [];
  const userMap = new Map(users.map((u) => [String(u._id), u]));
  const notificationsPerUser = topUsersAgg.map((r) => ({
    userId: String(r._id),
    username: userMap.get(String(r._id))?.username || userMap.get(String(r._id))?.email || String(r._id),
    count: r.count,
  }));

  const wsHealth = {
    disconnects: wsDisconnects,
    reconnects: wsReconnects,
    watchdogRestarts: wsWatchdogRestarts,
  };

  const health = computeHealthScore({ pushSuccess, pushFailed, latency, wsHealth, tokensRemoved, activeTokens });

  return {
    period: periodKey,
    rangeStart: start.toISOString(),
    rangeEnd: new Date().toISOString(),

    alertsMatched: alertsCreated + duplicateSkipped,
    alertsCreated,
    socketEmits,
    pushAttempts: pushStartEvents,
    pushSuccess,
    pushFailed,
    duplicateSkipped,
    tokensRemoved,
    tokensRegistered,
    activeTokens,

    notificationsPerUser,
    latency,
    wsHealth,
    serverRestarts,

    successRate: health.successRate,
    failureRate: Math.round((100 - health.successRate) * 10) / 10,
    healthScore: health.score,
    healthBand: health.band,
  };
}

/**
 * Build the full dashboard payload across all periods.
 * @returns {Promise<{ "1h": object, "24h": object, "7d": object }>}
 */
export async function getDashboard() {
  const activeTokens = await DeviceToken.countDocuments({ active: true });

  const [h1, h24, d7] = await Promise.all([
    getPeriodMetrics("1h", activeTokens),
    getPeriodMetrics("24h", activeTokens),
    getPeriodMetrics("7d", activeTokens),
  ]);

  return { "1h": h1, "24h": h24, "7d": d7 };
}

/**
 * Return the lifecycle timing for a single alert plus computed deltas.
 */
export async function getAlertTimeline(alertId) {
  const doc = await AlertLog.findById(alertId).select("triggeredAt timing userId itemId name").lean();
  if (!doc) return null;

  const t = doc.timing || {};
  const ts = (v) => (v ? new Date(v).getTime() : null);
  const matchedAt   = ts(t.matchedAt);
  const createdAt   = ts(doc.triggeredAt);
  const socketAt    = ts(t.socketEmitAt);
  const pushStartAt = ts(t.pushStartAt);
  const pushDoneAt  = ts(t.pushDoneAt);

  return {
    alertId: String(doc._id),
    userId: String(doc.userId),
    itemId: doc.itemId,
    name: doc.name,
    timing: t,
    deltasMs: {
      matchToCreated:    matchedAt != null && createdAt != null ? createdAt - matchedAt : null,
      createdToSocket:   createdAt != null && socketAt != null ? socketAt - createdAt : null,
      socketToPushStart: socketAt != null && pushStartAt != null ? pushStartAt - socketAt : null,
      pushStartToDone:   pushStartAt != null && pushDoneAt != null ? pushDoneAt - pushStartAt : null,
      endToEnd: t.totalLatencyMs ?? null,
    },
  };
}

/**
 * Return recent raw events, optionally filtered by type.
 */
export async function getRecentEvents({ type, limit = 50 } = {}) {
  const filter = type ? { type } : {};
  return NotificationEvent.find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.min(Math.max(Number(limit) || 50, 1), 200))
    .lean();
}
