import DeviceToken from "../models/DeviceToken.model.js";
import AlertLog from "../models/alertLog.models.js";
import { isFcmReady, sendPushToTokens, sendPushToUser, getTokenDebugInfo, invalidateTokenCache } from "../services/fcm.js";
import { recordEvent } from "../services/notificationMetrics.js";

// ── Per-user register rate limit ──────────────────────────────────────────────
// Lightweight in-memory guard, same pattern as the dedup/cache maps already used
// in services/fcm.js and services/empireRateGuard.js. Bounds how fast an
// authenticated user can hit this endpoint. Legitimate clients (useFcmKeepAlive,
// usePushNotifications) refresh at most a handful of times per hour across all
// of a user's devices, so this has wide headroom above real usage — it exists to
// stop an authenticated user from being able to spam-create unbounded DeviceToken
// rows with throwaway token values, not to police normal refresh traffic.
const REGISTER_RATE_WINDOW_MS = 10 * 60 * 1000; // 10 min
const REGISTER_RATE_MAX       = 30;             // 30 calls / 10 min / user
const _registerRateState = new Map(); // userId -> { count, windowStart }

function _isRegisterRateLimited(userId) {
  const key = String(userId);
  const nowMs = Date.now();
  const state = _registerRateState.get(key);
  if (!state || nowMs - state.windowStart >= REGISTER_RATE_WINDOW_MS) {
    _registerRateState.set(key, { count: 1, windowStart: nowMs });
    return false;
  }
  state.count += 1;
  return state.count > REGISTER_RATE_MAX;
}

// Periodic GC — drop expired windows so this map doesn't grow with every
// distinct user who has ever registered a token over the process lifetime.
setInterval(() => {
  const nowMs = Date.now();
  for (const [key, state] of _registerRateState) {
    if (nowMs - state.windowStart >= REGISTER_RATE_WINDOW_MS) _registerRateState.delete(key);
  }
}, REGISTER_RATE_WINDOW_MS).unref();

// ── Active-token cap (per user) ───────────────────────────────────────────────
// Bounds how many DeviceToken rows a single user can keep active at once. Set
// generously above any real multi-device usage (phone + PWA + multiple desktop
// browsers + a brief overlap window during token rotation) so it never rejects
// a legitimate registration. When a genuinely NEW/reactivated token would push
// the user over the cap, the least-recently-seen active token(s) are deactivated
// to make room instead of rejecting the new one. Refreshing an already-active
// token never touches this path (see wasActiveForThisUser below).
const ACTIVE_TOKEN_CAP_PER_USER = 20;

async function _enforceActiveTokenCap(userId, incomingToken) {
  const activeTokens = await DeviceToken.find({ userId, active: true, token: { $ne: incomingToken } })
    .select("_id lastSeenAt")
    .sort({ lastSeenAt: 1 }) // oldest-seen first
    .lean();

  const overBy = activeTokens.length + 1 - ACTIVE_TOKEN_CAP_PER_USER; // +1 for the token about to become active
  if (overBy <= 0) return;

  const evictIds = activeTokens.slice(0, overBy).map((t) => t._id);
  await DeviceToken.updateMany(
    { _id: { $in: evictIds } },
    { $set: { active: false, failureReason: "active-token-cap-evicted", lastFailureAt: new Date() } }
  );
  invalidateTokenCache(userId);
  console.warn(
    `[TOKEN_CAP_EVICTED] userId=${userId} evicted=${evictIds.length} ` +
    `cap=${ACTIVE_TOKEN_CAP_PER_USER} — oldest-seen active token(s) deactivated to make room for a new registration`
  );
}

/**
 * POST /api/push/register
 * Body: { token: string, platform?: string, browser?: string }
 *
 * Saves (or reactivates) an FCM device token for the authenticated user.
 * Always updates lastSeenAt so the 90-day TTL resets on every open.
 */
export async function registerToken(req, res) {
  try {
    const { token, platform, browser } = req.body ?? {};

    if (!token || typeof token !== "string" || token.trim().length < 10) {
      return res.status(400).json({ ok: false, error: "Valid FCM token is required." });
    }

    const uidHex = req.user._id.toString();

    if (_isRegisterRateLimited(uidHex)) {
      console.warn(`[TOKEN_REGISTER_RATE_LIMITED] userId=${uidHex}`);
      return res.status(429).json({ ok: false, error: "Too many registration attempts. Please try again shortly." });
    }

    const now      = new Date();
    const tokTail  = "..." + token.trim().slice(-20);

    const existing = await DeviceToken.findOne({ token: token.trim() })
      .select("_id active userId")
      .lean();

    // Deactivate the token for its previous owner before reassigning it.
    // Without this, the previous user's token stays active under the new owner's
    // userId and they silently receive no pushes with no error surfaced.
    const prevOwnerId = existing?.userId?.toString();
    if (prevOwnerId && prevOwnerId !== uidHex) {
      await DeviceToken.updateOne(
        { _id: existing._id },
        { active: false, failureReason: "reassigned-to-new-owner", lastFailureAt: now }
      );
      invalidateTokenCache(prevOwnerId);
      console.warn(
        `[TOKEN_OWNER_CHANGED] tokenTail=${tokTail} ` +
        `prevUserId=${prevOwnerId} newUserId=${uidHex} — ` +
        `deactivated previous owner's token before reassigning`
      );
    }

    // Only touch the cap for a token that will newly become active under this
    // user — a refresh of a token that's already active for them doesn't
    // change their active-token count, so it must never be evicted or counted
    // against itself here.
    const wasActiveForThisUser = !!existing && prevOwnerId === uidHex && existing.active === true;
    if (!wasActiveForThisUser) {
      await _enforceActiveTokenCap(uidHex, token.trim());
    }

    const doc = await DeviceToken.findOneAndUpdate(
      { token: token.trim() },
      {
        userId:     req.user._id,
        token:      token.trim(),
        active:     true,
        lastSeenAt: now,
        // Only overwrite platform/browser when provided so existing metadata is preserved
        ...(platform ? { platform: String(platform).slice(0, 32) } : {}),
        ...(browser  ? { browser:  String(browser).slice(0, 64)  } : {}),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Evict cache so the next push immediately uses the refreshed token
    invalidateTokenCache(uidHex);

    if (!existing) {
      console.log(
        `[TOKEN_REGISTERED] userId=${uidHex} platform=${doc.platform || "web"} ` +
        `browser=${doc.browser || ""} tokenTail=${tokTail} docId=${doc._id}`
      );
    } else {
      console.log(
        `[TOKEN_UPDATED] userId=${uidHex} platform=${doc.platform || "web"} ` +
        `browser=${doc.browser || ""} tokenTail=${tokTail} docId=${doc._id} ` +
        `wasActive=${existing.active} reactivated=${existing.active === false}`
      );
    }

    recordEvent("TOKEN_REGISTERED", {
      userId: req.user._id,
      meta: { platform: doc.platform || "web", browser: doc.browser || "" },
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("[push] registerToken error:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

/**
 * POST /api/push/test
 * Sends a test push to every active FCM token for the logged-in user.
 */
export async function testPush(req, res) {
  try {
    if (!isFcmReady()) {
      console.error("[push/test] ❌ Firebase Admin not initialized — check env vars");
      return res.status(503).json({
        ok:    false,
        error: "Firebase Admin SDK is not initialized on the server. Check FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY env vars.",
      });
    }

    const userId    = req.user._id;
    const userIdHex = userId.toString();
    const rows      = await DeviceToken.find({ userId, active: true }).select("token").lean();

    console.log(`[push/test] userId=${userIdHex}  active token(s): ${rows.length}`);
    rows.forEach((r, i) => {
      console.log(`[push/test]   token[${i}] tail : ...${r.token.slice(-20)}`);
    });

    if (!rows.length) {
      // Diagnostic: run an unfiltered query to distinguish between
      //   A) userId mismatch  → 0 total docs for this userId
      //   B) token deactivated → docs exist but active=false (stale cleanup after a failed push)
      try {
        const allRows = await DeviceToken
          .find({ userId })
          .select("_id token active failCount lastSeenAt lastPushAt lastPushSuccess createdAt updatedAt")
          .sort({ updatedAt: -1 })
          .lean();

        console.log(
          `[push/test] DIAGNOSTIC userId=${userIdHex} — ` +
          `active=0, total (active+inactive)=${allRows.length}`
        );
        if (allRows.length === 0) {
          console.warn(
            `[push/test] DIAGNOSTIC userId=${userIdHex} — ` +
            `NO tokens at all for this userId. Possible userId mismatch between registration and test requests.`
          );
        }
        allRows.forEach((t, i) => {
          console.log(
            `[push/test] DIAGNOSTIC   [${i}] tail=...${t.token.slice(-20)} ` +
            `active=${t.active} failCount=${t.failCount ?? 0} ` +
            `lastSeenAt=${t.lastSeenAt?.toISOString() ?? "never"} ` +
            `lastPushAt=${t.lastPushAt?.toISOString() ?? "never"} ` +
            `lastPushSuccess=${t.lastPushSuccess ?? "null"} ` +
            `createdAt=${t.createdAt?.toISOString()} updatedAt=${t.updatedAt?.toISOString()}`
          );
        });
      } catch (diagErr) {
        console.error(`[push/test] DIAGNOSTIC query failed: ${diagErr.message}`);
      }

      return res.status(400).json({
        ok:         false,
        error:      "No active FCM tokens found for your account. Open the app in the browser you want to receive notifications on, then click ENABLE PUSH.",
        tokenCount: 0,
      });
    }

    const tokenStrings = rows.map((r) => r.token);

    const result = await sendPushToTokens(
      tokenStrings,
      {
        title: "SkinTel — Push is working",
        body:  "You'll receive real-time alerts for auction snipes and price drops.",
        data:  { type: "test", url: "/alerts" },
      },
      { userId: String(userId), source: "push.test" }
    );

    if (!result) {
      return res.status(500).json({
        ok:    false,
        error: "Firebase Admin sendEachForMulticast() threw unexpectedly — see server logs.",
      });
    }

    const allFailed  = result.successCount === 0 && result.tokenCount > 0;
    const firstError = result.perToken?.find((t) => !t.success)?.error ?? null;

    console.log(`[push/test] done — successCount=${result.successCount}  failureCount=${result.failureCount}  tokenCount=${result.tokenCount}`);

    return res.status(allFailed ? 500 : 200).json({
      ok:           !allFailed,
      tokenCount:   result.tokenCount,
      successCount: result.successCount,
      failureCount: result.failureCount,
      messageIds:   result.perToken?.filter((t) => t.success).map((t) => t.messageId),
      perToken:     result.perToken,
      ...(allFailed ? { error: firstError ?? "All FCM sends failed — check token validity in Firebase console" } : {}),
    });
  } catch (err) {
    console.error("[push/test] error:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

/**
 * GET /api/push/tokens
 * Returns all FCM tokens for the authenticated user with metadata.
 */
export async function listTokens(req, res) {
  try {
    const tokens = await DeviceToken.find({ userId: req.user._id, active: true })
      .select("token platform browser lastSeenAt lastPushAt lastPushSuccess failCount createdAt updatedAt")
      .sort({ updatedAt: -1 })
      .lean();

    return res.json({
      ok:     true,
      count:  tokens.length,
      tokens: tokens.map((t) => ({
        tail:            `...${t.token.slice(-20)}`,
        platform:        t.platform || "web",
        browser:         t.browser  || "",
        lastSeenAt:      t.lastSeenAt  ?? null,
        lastPushAt:      t.lastPushAt  ?? null,
        lastPushSuccess: t.lastPushSuccess ?? null,
        failCount:       t.failCount  ?? 0,
        savedAt:         (t.updatedAt || t.createdAt)?.toISOString?.() ?? null,
      })),
    });
  } catch (err) {
    console.error("[push/tokens] error:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

/**
 * GET /api/push/health
 * Returns whether the authenticated user has at least one active FCM token.
 * Called by useFcmKeepAlive to detect silent token invalidation without
 * needing a full debug payload.
 */
export async function tokenHealth(req, res) {
  try {
    const count = await DeviceToken.countDocuments({ userId: req.user._id, active: true });
    return res.json({ ok: true, hasActiveToken: count > 0, count });
  } catch (err) {
    console.error("[push/health] error:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

/**
 * DELETE /api/push/register
 * Marks all of the authenticated user's device tokens as inactive.
 */
export async function unregisterTokens(req, res) {
  try {
    const result = await DeviceToken.updateMany(
      { userId: req.user._id, active: true },
      { $set: { active: false } }
    );
    invalidateTokenCache(String(req.user._id));
    console.log(
      `[TOKEN_DEACTIVATED] userId=${req.user._id} reason=unregister count=${result.modifiedCount ?? result.nModified ?? 0}`
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error("[push] unregisterTokens error:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// ── Device delivery receipts (diagnostics only) ──────────────────────────────
// firebase-messaging-sw.js posts one of these when a real alert push reaches
// the service worker, so NotificationEvent can show PUSH_SEND_SUCCESS →
// DEVICE_RECEIVED per alertId. The SW cannot read the JWT, so this endpoint is
// unauthenticated and deliberately narrow:
//   • body ≤ 1 KB, only the whitelisted keys below, strict formats
//   • tokenTail ≤ 20 chars — a full FCM token is rejected, never stored
//   • userId is taken from the AlertLog the alertId points to — never from the
//     client — and only alerts triggered in the last 48 h are accepted
//   • global rate limit + per-(alert, device) dedup + per-alert cap
//   • the ONLY write is a NotificationEvent; DeviceToken/User/AlertLog untouched
//   • every well-formed request gets the same empty 204 (no existence oracle)
const RECEIPT_MAX_BYTES        = 1024;
const RECEIPT_MAX_AGE_MS       = 48 * 3600 * 1000;
const RECEIPT_RATE_WINDOW_MS   = 60 * 1000;
const RECEIPT_RATE_MAX         = 300;              // receipts / minute, whole server
const RECEIPT_DEDUP_TTL_MS     = 10 * 60 * 1000;
const RECEIPT_MAX_PER_ALERT    = ACTIVE_TOKEN_CAP_PER_USER;
const RECEIPT_KEYS             = new Set(["alertId", "tokenTail", "platform", "browser", "receivedAt"]);
const RECEIPT_PLATFORMS        = new Set(["web", "android", "ios"]);

let _receiptRate = { count: 0, windowStart: 0 };
const _receiptSeen     = new Map(); // `${alertId}|${tokenTail}|${platform}|${browser}` -> expiresAt
const _receiptPerAlert = new Map(); // alertId -> { count, expiresAt }

function _validReceipt(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  for (const k of Object.keys(body)) if (!RECEIPT_KEYS.has(k)) return null;
  const { alertId, tokenTail = null, platform = null, browser = null, receivedAt = null } = body;
  if (typeof alertId !== "string" || !/^[a-f0-9]{24}$/.test(alertId)) return null;
  if (tokenTail !== null && (typeof tokenTail !== "string" || !/^[A-Za-z0-9_:-]{1,20}$/.test(tokenTail))) return null;
  if (platform !== null && !RECEIPT_PLATFORMS.has(platform)) return null;
  if (browser !== null && (typeof browser !== "string" || !/^[A-Za-z]{1,16}$/.test(browser))) return null;
  if (receivedAt !== null && (!Number.isFinite(receivedAt) || Math.abs(Date.now() - receivedAt) > RECEIPT_MAX_AGE_MS)) return null;
  return { alertId, tokenTail, platform, browser, receivedAt };
}

function _receiptRateLimited(nowMs) {
  if (nowMs - _receiptRate.windowStart >= RECEIPT_RATE_WINDOW_MS) _receiptRate = { count: 0, windowStart: nowMs };
  _receiptRate.count += 1;
  return _receiptRate.count > RECEIPT_RATE_MAX;
}

// Returns true when this receipt should be dropped (duplicate or alert cap reached).
function _receiptSuppressed(r, nowMs) {
  if (_receiptSeen.size > 5000) for (const [k, exp] of _receiptSeen) if (nowMs > exp) _receiptSeen.delete(k);
  if (_receiptPerAlert.size > 5000) for (const [k, v] of _receiptPerAlert) if (nowMs > v.expiresAt) _receiptPerAlert.delete(k);

  const key = `${r.alertId}|${r.tokenTail}|${r.platform}|${r.browser}`;
  const exp = _receiptSeen.get(key);
  if (exp && nowMs <= exp) return true;

  let perAlert = _receiptPerAlert.get(r.alertId);
  if (!perAlert || nowMs > perAlert.expiresAt) perAlert = { count: 0, expiresAt: nowMs + RECEIPT_DEDUP_TTL_MS };
  if (perAlert.count >= RECEIPT_MAX_PER_ALERT) return true;

  perAlert.count += 1;
  _receiptPerAlert.set(r.alertId, perAlert);
  _receiptSeen.set(key, nowMs + RECEIPT_DEDUP_TTL_MS);
  return false;
}

// Test-only: clear in-memory rate-limit / dedup state between cases.
export function _resetDeviceReceiptState() {
  _receiptRate = { count: 0, windowStart: 0 };
  _receiptSeen.clear();
  _receiptPerAlert.clear();
}

/**
 * POST /api/push/device-received   (unauthenticated — see model above)
 * Body: { alertId, tokenTail?, platform?, browser?, receivedAt? }
 * 204 for any well-formed receipt (recorded or not), 400 malformed,
 * 413 oversized, 429 rate limited. Never returns data.
 */
export async function deviceReceived(req, res) {
  if (Number(req.headers["content-length"] || 0) > RECEIPT_MAX_BYTES) return res.status(413).end();

  const r = _validReceipt(req.body);
  if (!r) return res.status(400).end();

  const nowMs = Date.now();
  if (_receiptRateLimited(nowMs)) {
    console.warn(`[DEVICE_RECEIVED_RATE_LIMITED] alertId=${r.alertId}`);
    return res.status(429).end();
  }
  if (_receiptSuppressed(r, nowMs)) return res.status(204).end();

  try {
    const alert = await AlertLog.findById(r.alertId).select("userId triggeredAt").lean();
    if (!alert?.userId || !alert.triggeredAt || nowMs - new Date(alert.triggeredAt).getTime() > RECEIPT_MAX_AGE_MS) {
      return res.status(204).end();
    }
    const tokenTail = r.tokenTail ? `...${r.tokenTail}` : null;
    recordEvent("DEVICE_RECEIVED", {
      userId:  alert.userId,
      alertId: r.alertId,
      source:  "sw",
      latencyMs: r.receivedAt ? Math.max(0, r.receivedAt - new Date(alert.triggeredAt).getTime()) : null,
      meta: {
        tokenTail,
        platform:   r.platform,
        browser:    r.browser,
        receivedAt: r.receivedAt ? new Date(r.receivedAt).toISOString() : null,
      },
    });
    console.log(
      `[DEVICE_RECEIVED] userId=${alert.userId} alertId=${r.alertId} tokenTail=${tokenTail ?? "–"} ` +
      `platform=${r.platform ?? "–"} browser=${r.browser ?? "–"}`
    );
  } catch (err) {
    console.warn(`[DEVICE_RECEIVED] alertId=${r.alertId} lookup failed: ${err.message}`);
  }
  return res.status(204).end();
}

/**
 * GET /api/push/debug
 * Returns full push diagnostics for the authenticated user's OWN account only:
 * - all of their tokens (active + inactive) with metadata
 * - FCM readiness
 *
 * Used to diagnose "why am I not getting notifications?" without needing
 * server log access. Deliberately does not include server-wide/global stats
 * (total alerts, total push volume, etc.) — those aren't this user's data and
 * shouldn't be exposed to an ordinary authenticated user via this endpoint.
 */
export async function debugPush(req, res) {
  try {
    const userId = req.user._id;
    const tokenInfo = await getTokenDebugInfo(userId);

    const activeTokens   = tokenInfo.filter((t) => t.active);
    const inactiveTokens = tokenInfo.filter((t) => !t.active);

    const lastSuccessfulPush = tokenInfo
      .filter((t) => t.lastPushAt && t.lastPushSuccess)
      .sort((a, b) => new Date(b.lastPushAt) - new Date(a.lastPushAt))[0]?.lastPushAt ?? null;

    const mostRecentFailedToken = tokenInfo
      .filter((t) => t.lastPushAt && t.lastPushSuccess === false)
      .sort((a, b) => new Date(b.lastPushAt) - new Date(a.lastPushAt))[0] ?? null;
    const lastFailedPush = mostRecentFailedToken?.lastPushAt ?? null;

    const fcmReady   = isFcmReady();
    const hasToken    = activeTokens.length > 0;
    // Best-effort summary for the affected user: "valid" means at least one
    // active token and FCM is up; "invalid" means tokens exist but all were
    // deactivated (stale/reassigned/fail-count); "unknown" means no tokens
    // were ever registered at all (nothing to diagnose server-side).
    const tokenStatus = hasToken
      ? "valid"
      : tokenInfo.length > 0
        ? "invalid"
        : "unknown";
    const lastPushAttempt = [lastSuccessfulPush, lastFailedPush]
      .filter(Boolean)
      .sort((a, b) => new Date(b) - new Date(a))[0] ?? null;

    return res.json({
      ok:   true,
      userId: String(userId),
      fcmReady,
      activeTokenCount:   activeTokens.length,
      inactiveTokenCount: inactiveTokens.length,
      hasToken,
      tokenStatus,
      pushEnabled: fcmReady && hasToken,
      lastSuccessfulPush,
      lastFailedPush,
      lastPushAttempt,
      lastPushError: mostRecentFailedToken?.failureReason ?? null,
      tokens: tokenInfo,
    });
  } catch (err) {
    console.error("[push/debug] error:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
