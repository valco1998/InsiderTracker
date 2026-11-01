import admin from "firebase-admin";
import mongoose from "mongoose";
import DeviceToken from "../models/DeviceToken.model.js";
import { inc } from "./alertStats.js";
import { recordEvent, recordAlertPushDone } from "./notificationMetrics.js";

let messaging = null;

export function isFcmReady() { return messaging !== null; }

// ── Token cache ───────────────────────────────────────────────────────────────
// Avoids a MongoDB round-trip on every alert. TTL is short enough that a newly
// registered device gets its token picked up within 30 s.
const _tokenCache = new Map();          // userId (string) → { tokens: string[], at: number }
const _invalidatedAt = new Map();       // userId (string) → timestamp of last invalidation
const TOKEN_CACHE_TTL_MS = 30_000;

function _evictTokenCache(userId) {
  const key = String(userId);
  _tokenCache.delete(key);
  _invalidatedAt.set(key, Date.now());
}

export function invalidateTokenCache(userId) {
  _evictTokenCache(String(userId));
}

async function _getTokensForUser(userId) {
  const key = String(userId);
  const cached = _tokenCache.get(key);
  if (cached && Date.now() - cached.at < TOKEN_CACHE_TTL_MS) {
    console.log(`[TOKEN_LOOKUP_RESULT] userId=${key} source=cache count=${cached.tokens.length}`);
    return cached.tokens;
  }

  // Record the time *before* the DB read so we can detect a registration/
  // invalidation that races ahead of this read and completes first — if that
  // happens, this read's result is potentially stale and must not be cached.
  const queryStartedAt = Date.now();
  const query = { userId, active: true };
  const rows = await DeviceToken.find(query).select("token").lean();
  const tokens = rows.map((r) => r.token);

  // Diagnostic: when the active-token query comes back empty, run an
  // unfiltered lookup for the same userId so we can see exactly what's
  // in the DB (active flag + type) vs. what /api/push/debug reports.
  if (tokens.length === 0) {
    try {
      const allDocs = await DeviceToken.find({ userId }).select("_id token active userId").lean();
      console.log(
        `[TOKEN_LOOKUP_RESULT] userId=${key} (typeof=${typeof userId}) ` +
        `query=${JSON.stringify({ userId: key, active: true })} matched=0 — ` +
        `unfiltered lookup found ${allDocs.length} doc(s) for this userId`
      );
      allDocs.forEach((d) => {
        console.log(
          `[TOKEN_LOOKUP_DOC] userId=${key} docId=${d._id} ` +
          `tokenTail=...${d.token.slice(-8)} active=${JSON.stringify(d.active)} ` +
          `(typeof active=${typeof d.active}) docUserId=${d.userId} (typeof docUserId=${typeof d.userId})`
        );
      });
    } catch (err) {
      console.error(`[TOKEN_LOOKUP_RESULT] userId=${key} diagnostic query failed: ${err.message}`);
    }
  }

  const invalidatedAt = _invalidatedAt.get(key) || 0;
  if (invalidatedAt >= queryStartedAt) {
    // A registration/cleanup invalidated the cache while this read was in
    // flight — this result may already be stale (e.g. it predates a token
    // that was just registered). Skip caching so the next call re-queries.
    console.log(`[TOKEN_LOOKUP_RESULT] userId=${key} source=db count=${tokens.length} cached=false (raced with invalidation)`);
    return tokens;
  }

  _tokenCache.set(key, { tokens, at: Date.now() });
  console.log(`[TOKEN_LOOKUP_RESULT] userId=${key} source=db count=${tokens.length} cached=true`);
  return tokens;
}

// ── Push dedup ────────────────────────────────────────────────────────────────
// Prevents double-delivery caused by the race window between the live WS handler
// and the 15-second fallback scanner both processing the same item concurrently.
// Key: `userId:alertId`.  Expires after 120 s.
const _sentKeys = new Map();            // dedupKey → expiresAt
const DEDUP_TTL_MS = 120_000;

function _isDuplicate(dedupKey) {
  const exp = _sentKeys.get(dedupKey);
  if (!exp) return false;
  if (Date.now() > exp) { _sentKeys.delete(dedupKey); return false; }
  return true;
}

function _markSent(dedupKey) {
  _sentKeys.set(dedupKey, Date.now() + DEDUP_TTL_MS);
  // Periodic GC — keep the map from growing unboundedly
  if (_sentKeys.size > 5000) {
    const now = Date.now();
    for (const [k, exp] of _sentKeys) { if (now > exp) _sentKeys.delete(k); }
  }
}

// ── Per-user push burst / aggregation ─────────────────────────────────────────
// When a user has many matching rules fire at once (or many items match one rule),
// sending 30+ individual notifications causes browsers/OS to suppress or collapse
// them silently. Instead: allow up to BURST_LIMIT individual pushes, then queue
// any overflow and flush as ONE summary notification after AGG_FLUSH_MS.
const BURST_LIMIT     = 5;         // individual pushes allowed per window
const BURST_WINDOW_MS = 10_000;    // sliding window duration
const AGG_FLUSH_MS    = 8_000;     // how long to accumulate before sending summary

// userId → { count, since, timer, backlog: [{title,body,data}] }
const _burst = new Map();

function _burstState(userId) {
  const now = Date.now();
  let s = _burst.get(userId);
  if (!s || (now - s.since) > BURST_WINDOW_MS) {
    if (s?.timer) clearTimeout(s.timer);
    s = { count: 0, since: now, timer: null, backlog: [] };
    _burst.set(userId, s);
  }
  return s;
}

async function _flushAgg(userId) {
  const s = _burst.get(userId);
  _burst.delete(userId);
  if (!s?.backlog?.length) return;

  const n = s.backlog.length;
  inc("pushAggregated", n);
  console.log(`[PUSH_AGGREGATED] userId=${userId} count=${n} — flushing as 1 summary push`);

  let tokens;
  try { tokens = await _getTokensForUser(userId); }
  catch (err) { console.warn(`[PUSH_AGGREGATED] userId=${userId} token lookup failed: ${err.message}`); return; }

  if (!tokens.length) {
    console.log(`[PUSH_AGGREGATED] userId=${userId} — no active tokens at flush time, summary dropped`);
    return;
  }

  const aggId = `agg_${Date.now()}`;
  await _sendToTokens(
    tokens,
    {
      title: `${n} New Alert${n > 1 ? "s" : ""} — SkinTel`,
      body:  `${n} new matching deal${n > 1 ? "s" : ""} found — tap to view`,
      data:  { type: "price_alert", alertId: aggId, url: "/alerts", aggregated: "true", count: String(n) },
    },
    { userId, alertId: aggId, source: "aggregated" }
  );
}

// ── Private key normalization ─────────────────────────────────────────────────
function normalizePrivateKey(raw) {
  if (!raw) return null;
  let key = String(raw).trim();
  if ((key.startsWith('"') && key.endsWith('"')) ||
      (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1).trim();
  }
  key = key.replace(/\\n/g, "\n").replace(/\r/g, "");
  return key.trim() || null;
}

// ── Initialization ────────────────────────────────────────────────────────────
export function initFirebaseAdmin() {
  const projectId   = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const rawKey      = process.env.FIREBASE_PRIVATE_KEY;

  console.log("[FCM Admin] Checking environment variables:");
  console.log("  FIREBASE_PROJECT_ID:   ", projectId   ? `✓ set (${projectId})`              : "✗ MISSING");
  console.log("  FIREBASE_CLIENT_EMAIL: ", clientEmail ? `✓ set (${clientEmail})`             : "✗ MISSING");
  console.log("  FIREBASE_PRIVATE_KEY:  ", rawKey      ? `✓ set (${rawKey.length} raw chars)` : "✗ MISSING");

  if (!projectId || !clientEmail || !rawKey) {
    console.error(
      "\n╔══════════════════════════════════════════════════════════════╗\n" +
      "║  ❌  FIREBASE ADMIN NOT CONFIGURED — PUSH DISABLED           ║\n" +
      "║  Set FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL /           ║\n" +
      "║  FIREBASE_PRIVATE_KEY in your Render environment variables.  ║\n" +
      "╚══════════════════════════════════════════════════════════════╝\n"
    );
    return;
  }

  const privateKey = normalizePrivateKey(rawKey);
  const hasBegin   = privateKey?.includes("-----BEGIN PRIVATE KEY-----") ?? false;
  const hasEnd     = privateKey?.includes("-----END PRIVATE KEY-----")   ?? false;

  console.log("[FCM Admin] Private key after normalization:");
  console.log("  length       :", privateKey?.length ?? 0);
  console.log("  BEGIN marker :", hasBegin ? "✓ present" : "✗ MISSING — key is malformed");
  console.log("  END marker   :", hasEnd   ? "✓ present" : "✗ MISSING — key is malformed");

  if (!privateKey || !hasBegin || !hasEnd) {
    console.error("❌ Firebase Admin init failed: private key is malformed after normalization.");
    return;
  }

  try {
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({ projectId, privateKey, clientEmail }),
      });
    }
    messaging = admin.messaging();
    console.log("✅ Firebase Admin SDK initialized — push notifications enabled");
  } catch (err) {
    console.error("❌ Firebase Admin init failed:", err.message);
    if (err.message?.includes("DECODER") || err.message?.includes("private key")) {
      console.error(
        "  Hint: PEM encoding issue. Ensure FIREBASE_PRIVATE_KEY uses \\n line separators."
      );
    }
  }
}

// ── Build the FCM message object ──────────────────────────────────────────────
function buildMessage(tokens, { title, body, data = {} }) {
  const safeData = Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, v == null ? "" : String(v)])
  );

  const isAuction = data.type === "auction_alert";
  const clickUrl  = data.url || "/alerts";

  // Only use the item image when it is a valid absolute URL (Steam/Empire CDN).
  // Relative paths and empty strings fall back to the site logo.
  const itemImage = (safeData.image && /^https?:\/\//.test(safeData.image))
    ? safeData.image
    : null;

  // Standard SkinTel notification template — same actions for every alert
  // type (price, item, auction) so the layout is consistent everywhere.
  const actions = [
    { action: "open_auction", title: "Open Auction" },
    { action: "view_alerts",  title: "View Alerts"  },
  ];

  const webpushNotification = {
    title,
    body,
    icon:               "/telIcon.png",
    badge:              "/telIcon.png",
    tag:                data.alertId || data.type || "skintel",
    renotify:           true,
    requireInteraction: isAuction,
    vibrate:            [200, 100, 200],
    timestamp:          Date.now(),
    silent:             false,
    data:               safeData,
    actions,
  };

  // image shows as a large preview below the notification body on Chrome
  // desktop (Windows) and Android Chrome; omit when unavailable.
  if (itemImage) webpushNotification.image = itemImage;

  return {
    tokens,
    notification: { title, body },
    data: safeData,

    // ── Web Push (Chrome/Firefox desktop + mobile) ──────────────────────────
    webpush: {
      headers: {
        Urgency: "high",
        TTL:     "86400",
      },
      notification: webpushNotification,
      fcmOptions: { link: clickUrl },
    },
  };
}

// ── Source classifier ─────────────────────────────────────────────────────────
// Real alerts come from the alert engine or live WS scan.
// Test/aggregated sends use different source values.
function _isRealAlert(source) {
  return source === "price_alert" || source === "auction_alert" ||
         source === "engine"       || source === "ws";
}

// ── Stale token cleanup (fire-and-forget) ─────────────────────────────────────
const STALE_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

// source is threaded through so log tags can distinguish real alert cleanup
// from test/aggregated cleanup — makes grep on Render logs unambiguous.
function _cleanupStaleTokens(tokens, perToken, userId, source) {
  const staleItems = perToken
    .map((r, i) => ({ token: tokens[i], error: r.error }))
    .filter(({ error }) => error && STALE_CODES.has(error.split(":")[0]));

  if (!staleItems.length) return;

  const stale = staleItems.map((s) => s.token);

  const realAlert = _isRealAlert(source);
  const removeTag = realAlert ? "REAL_ALERT_STALE_TOKEN_REMOVED" : "TOKEN_INVALID_REMOVED";
  const evictTag  = realAlert ? "REAL_ALERT_CACHE_EVICTED"       : "TOKEN_INVALID_REMOVED";

  inc("tokenInvalidRemoved", stale.length);
  staleItems.forEach(({ token, error }) => {
    console.log(`[${removeTag}] userId=${userId} source=${source} tokenTail=...${token.slice(-20)} fcmError="${error}"`);
  });

  recordEvent("TOKEN_INVALID_REMOVED", {
    userId: mongoose.Types.ObjectId.isValid(userId) ? userId : null,
    source,
    meta: { count: stale.length },
  });

  const failureReason = staleItems[0]?.error?.split(":")[0] ?? "registration-token-not-registered";
  DeviceToken.updateMany(
    { token: { $in: stale } },
    { $set: { active: false, lastPushSuccess: false, failureReason, lastFailureAt: new Date() } }
  )
    .then(() => {
      console.log(`[TOKEN_DEACTIVATED] userId=${userId} reason=${failureReason} source=${source} count=${stale.length}`);
      if (userId && userId !== "undefined") {
        _evictTokenCache(String(userId));
        console.log(`[${evictTag}] userId=${userId} source=${source} cache evicted — ${stale.length} stale token(s) deactivated in DB`);
      } else {
        console.warn(`[TOKEN_INVALID_REMOVED] userId=MISSING — DB updated but cache NOT evicted (caller must pass userId)`);
      }
    })
    .catch((err) => console.error("[FCM] stale token cleanup DB error:", err.message));
}

// ── Token stats update (fire-and-forget) ──────────────────────────────────────
// Updates lastPushAt, lastPushSuccess, failCount after every send attempt.
// Tokens that accumulate MAX_FAIL_COUNT consecutive non-stale failures are
// deactivated via an aggregation pipeline update so the threshold check is
// atomic with the increment (stage 1 increments failCount, stage 2 checks it).
const MAX_FAIL_COUNT = 15;
function _updateTokenStats(tokens, perToken, userId) {
  const now = new Date();
  const ops = tokens.map((t, i) => {
    const ok = perToken[i]?.success ?? false;
    if (ok) {
      return DeviceToken.updateOne(
        { token: t },
        { $set: { lastPushAt: now, lastPushSuccess: true, failCount: 0 } }
      );
    }
    // Aggregation pipeline: stage 1 increments failCount, stage 2 reads
    // the post-increment value and deactivates if >= MAX_FAIL_COUNT.
    // failureReason/lastFailureAt are also stamped here (previously only the
    // stale-token path set them), so /push/debug can show why a fail-count
    // deactivation happened instead of leaving it unexplained.
    return DeviceToken.updateOne({ token: t }, [
      { $set: { lastPushAt: now, lastPushSuccess: false, failCount: { $add: ["$failCount", 1] } } },
      { $set: {
          active:        { $cond: [{ $gte: ["$failCount", MAX_FAIL_COUNT] }, false, "$active"] },
          failureReason: { $cond: [{ $gte: ["$failCount", MAX_FAIL_COUNT] }, "max-fail-count-exceeded", "$failureReason"] },
          lastFailureAt: { $cond: [{ $gte: ["$failCount", MAX_FAIL_COUNT] }, now, "$lastFailureAt"] },
      } },
    ]);
  });
  Promise.allSettled(ops).then(results => {
    const failed = results.filter(r => r.status === "rejected");
    if (failed.length) {
      console.error("[FCM] token stats update failed for", failed.length, "token(s):", failed[0]?.reason?.message);
    }
  });
}

// ── Core send helper ─────────────────────────────────────────────────────────
async function _sendToTokens(tokens, payload, { userId, alertId, source = "" } = {}) {
  const t0  = Date.now();
  const tag = source ? `[FCM|${source}]` : "[FCM]";

  const response = await messaging.sendEachForMulticast(buildMessage(tokens, payload));

  const perToken = response.responses.map((r, i) => ({
    tokenTail: `...${tokens[i].slice(-20)}`,
    success:   r.success,
    messageId: r.messageId ?? null,
    error:     r.error ? `${r.error.code}: ${r.error.message}` : null,
  }));

  const latencyMs = Date.now() - t0;
  const msgIds    = perToken.filter(t => t.success).map(t => t.messageId).join(", ");
  const errs      = perToken.filter(t => !t.success).map(t => `${t.tokenTail}:${t.error}`).join(" | ");

  // Reliability dashboard — alertId may be a synthetic id (e.g. "agg_...") for
  // aggregated pushes; only pass it through to NotificationEvent/AlertLog when
  // it's a real ObjectId, otherwise leave it null so the write doesn't fail validation.
  const metricsUserId  = mongoose.Types.ObjectId.isValid(userId)  ? userId  : null;
  const metricsAlertId = mongoose.Types.ObjectId.isValid(alertId) ? alertId : null;

  if (response.successCount > 0) {
    inc("pushSent", response.successCount);
    console.log(
      `[PUSH_SEND_SUCCESS] ${tag} userId=${userId} alertId=${alertId ?? "–"} ` +
      `sent=${response.successCount}/${tokens.length} latency=${latencyMs}ms messageIds=[${msgIds}]`
    );
    recordEvent("PUSH_SEND_SUCCESS", {
      userId: metricsUserId, alertId: metricsAlertId, source,
      latencyMs,
      meta: { successCount: response.successCount, tokenCount: tokens.length },
    });
  }
  if (response.failureCount > 0) {
    inc("pushFailed", response.failureCount);
    console.error(
      `[PUSH_SEND_FAILED] ${tag} userId=${userId} alertId=${alertId ?? "–"} ` +
      `failed=${response.failureCount}/${tokens.length} errors=[${errs}]`
    );
    recordEvent("PUSH_SEND_FAIL", {
      userId: metricsUserId, alertId: metricsAlertId, source,
      latencyMs,
      meta: { failureCount: response.failureCount, tokenCount: tokens.length, errors: errs },
    });
  }
  console.log(`[PUSH_LATENCY_MS] ${tag} userId=${userId} alertId=${alertId ?? "–"} latency=${latencyMs}ms`);

  // Reliability dashboard — stamp this alert's pushDoneAt + outcome (fire-and-forget)
  if (metricsAlertId) {
    const outcome = response.successCount > 0 ? "success" : "fail";
    recordAlertPushDone(metricsAlertId, outcome);
  }

  // Dedicated summary line for real alerts — makes grep on Render logs unambiguous
  if (_isRealAlert(source)) {
    const staleCount = perToken.filter(t => !t.success && t.error && STALE_CODES.has(t.error.split(":")[0])).length;
    console.log(
      `[REAL_ALERT_PUSH_RESULT] userId=${userId} alertId=${alertId ?? "–"} source=${source} ` +
      `success=${response.successCount} failure=${response.failureCount} total=${tokens.length} ` +
      `stale=${staleCount} latency=${latencyMs}ms`
    );
  }

  // Fire-and-forget: update per-token stats + deactivate stale tokens
  _updateTokenStats(tokens, perToken, userId);
  _cleanupStaleTokens(tokens, perToken, userId, source);

  return {
    successCount: response.successCount,
    failureCount: response.failureCount,
    tokenCount:   tokens.length,
    perToken,
    latencyMs,
  };
}

// ── sendPushToTokens — explicit token list (used by /push/test) ────────────────
// context.userId is required for correct stale-token cache eviction.
// Without it, _cleanupStaleTokens cannot evict the right in-memory cache entry,
// leaving the deactivated token cached for up to 30 s after it is marked inactive.
export async function sendPushToTokens(tokens, payload, { userId, source = "push.test" } = {}) {
  if (!messaging) {
    console.error("[FCM] sendPushToTokens — Firebase Admin not initialized");
    return null;
  }
  if (!tokens.length) return { successCount: 0, failureCount: 0, tokenCount: 0, perToken: [] };

  console.log(`[FCM] sendPushToTokens — ${tokens.length} token(s) userId=${userId ?? "–"} title="${payload.title}"`);
  tokens.forEach((t, i) => console.log(`[FCM]   token[${i}]: ${t}`));

  try {
    return await _sendToTokens(tokens, payload, { userId, source });
  } catch (err) {
    console.error("[FCM] sendPushToTokens error:", err.message);
    return null;
  }
}

// ── sendPushToUser — look up tokens by userId, with cache + dedup + aggregation ─
/**
 * @param {string|ObjectId} userId
 * @param {{ title: string, body: string, data?: Record<string,string> }} payload
 * @returns {Promise<{ successCount, failureCount, tokenCount, perToken, latencyMs } | null>}
 */
export async function sendPushToUser(userId, payload) {
  const { title, body, data = {} } = payload;
  const uidStr  = String(userId);
  const alertId = data.alertId || null;
  const source  = data.type   || "push";

  if (!messaging) {
    console.error(`[PUSH_SEND_FAILED] userId=${uidStr} alertId=${alertId ?? "–"} — Firebase Admin not initialized`);
    return null;
  }

  if (!mongoose.Types.ObjectId.isValid(uidStr)) {
    console.error(`[PUSH_SEND_FAILED] userId="${uidStr}" is not a valid ObjectId`);
    return null;
  }

  // ── Dedup check ───────────────────────────────────────────────────────────
  if (alertId) {
    const dedupKey = `${uidStr}:${alertId}`;
    if (_isDuplicate(dedupKey)) {
      console.log(`[PUSH_DUPLICATE_SKIPPED] userId=${uidStr} alertId=${alertId}`);
      return { successCount: 0, failureCount: 0, tokenCount: 0, perToken: [], skipped: true };
    }
    _markSent(dedupKey);
  }

  // ── Token lookup (cached) ─────────────────────────────────────────────────
  let tokens;
  try {
    tokens = await _getTokensForUser(uidStr);
  } catch (err) {
    console.error(`[PUSH_SEND_FAILED] userId=${uidStr} — token lookup error: ${err.message}`);
    return null;
  }

  if (!tokens.length) {
    inc("pushSkippedNoTokens");
    const noTokenTag = _isRealAlert(source) ? "REAL_ALERT_TOKENS_LOADED" : "PUSH_TOKEN_FOUND";
    console.log(`[${noTokenTag}] userId=${uidStr} source=${source} — 0 active tokens, push skipped`);
    return { successCount: 0, failureCount: 0, tokenCount: 0, perToken: [] };
  }

  // Log token load — real alerts get their own tag for easy grep
  if (_isRealAlert(source)) {
    console.log(`[REAL_ALERT_TOKENS_LOADED] userId=${uidStr} alertId=${alertId ?? "–"} source=${source} count=${tokens.length}`);
  } else {
    console.log(`[PUSH_TOKEN_FOUND] userId=${uidStr} alertId=${alertId ?? "–"} source=${source} tokens=${tokens.length}`);
  }

  // ── Burst / aggregation check ─────────────────────────────────────────────
  // If this user has already received BURST_LIMIT pushes in the current window,
  // queue this payload and flush as a single summary notification later.
  const s = _burstState(uidStr);
  s.count++;
  if (s.count > BURST_LIMIT) {
    s.backlog.push({ title, body, data });
    if (!s.timer) {
      s.timer = setTimeout(() => _flushAgg(uidStr), AGG_FLUSH_MS);
    }
    console.log(
      `[PUSH_AGGREGATED] userId=${uidStr} alertId=${alertId ?? "–"} ` +
      `queued (${s.count} in window, ${s.backlog.length} in backlog)`
    );
    inc("pushAggregated");
    return { successCount: 0, failureCount: 0, tokenCount: tokens.length, perToken: [], aggregated: true };
  }

  // Real alerts get their own START tag — test/aggregated use the generic one
  if (_isRealAlert(source)) {
    console.log(`[REAL_ALERT_PUSH_START] userId=${uidStr} alertId=${alertId ?? "–"} source=${source} tokens=${tokens.length}`);
  } else {
    console.log(`[PUSH_SEND_START] userId=${uidStr} alertId=${alertId ?? "–"} source=${source} tokens=${tokens.length}`);
  }

  // ── Send with retry for transient exceptions ─────────────────────────────
  // Per-token failures (not-registered, invalid-argument) are handled by
  // _cleanupStaleTokens — do NOT retry those. Only retry on thrown exceptions
  // (network timeout, Firebase 5xx, TCP reset) where sendEachForMulticast
  // itself threw rather than returning a response with failureCount > 0.
  const RETRY_DELAYS_MS = [1_000, 2_000];
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await _sendToTokens(tokens, { title, body, data }, { userId: uidStr, alertId, source });
    } catch (err) {
      if (attempt < RETRY_DELAYS_MS.length) {
        console.warn(
          `[PUSH_SEND_RETRY] userId=${uidStr} alertId=${alertId ?? "–"} ` +
          `attempt=${attempt + 1}/${RETRY_DELAYS_MS.length + 1} error=${err.message} ` +
          `— retrying in ${RETRY_DELAYS_MS[attempt]}ms`
        );
        await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
      } else {
        console.error(
          `[PUSH_SEND_FAILED] userId=${uidStr} alertId=${alertId ?? "–"} ` +
          `all ${RETRY_DELAYS_MS.length + 1} attempts failed: ${err.message}`
        );
        return null;
      }
    }
  }
}

// ── getTokenDebugInfo — exported for the debug endpoint ───────────────────────
export async function getTokenDebugInfo(userId) {
  const rows = await DeviceToken.find({ userId })
    .select("_id token active platform browser lastSeenAt lastPushAt lastPushSuccess failCount failureReason lastFailureAt createdAt updatedAt userId")
    .sort({ updatedAt: -1 })
    .lean();

  console.log(
    `[TOKEN_DEBUG_QUERY] userId=${String(userId)} (typeof=${typeof userId}) ` +
    `query=${JSON.stringify({ userId: String(userId) })} matched=${rows.length}`
  );
  rows.forEach((t) => {
    console.log(
      `[TOKEN_DEBUG_DOC] userId=${String(userId)} docId=${t._id} ` +
      `tokenTail=...${t.token.slice(-8)} active=${JSON.stringify(t.active)} ` +
      `(typeof active=${typeof t.active}) docUserId=${t.userId} (typeof docUserId=${typeof t.userId})`
    );
  });

  return rows.map((t) => ({
    tail:            `...${t.token.slice(-16)}`,
    active:          t.active,
    platform:        t.platform || "unknown",
    browser:         t.browser  || "unknown",
    lastSeenAt:      t.lastSeenAt  ?? null,
    lastPushAt:      t.lastPushAt  ?? null,
    lastPushSuccess: t.lastPushSuccess ?? null,
    failCount:       t.failCount  ?? 0,
    failureReason:   t.failureReason ?? null,
    lastFailureAt:   t.lastFailureAt ?? null,
    createdAt:       t.createdAt,
    updatedAt:       t.updatedAt,
  }));
}
