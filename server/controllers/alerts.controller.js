import AlertLog from "../models/alertLog.models.js";
import AlertState from "../models/AlertState.js";
import WatchRule from "../models/WatchRule.model.js";
import { safeFetchMarket } from "../services/safeFetchMarket.js";
import { emitPriceAlert } from "../socket/socket.js";
import { sendPushToUser, isFcmReady } from "../services/fcm.js";
import { inc, recordLatency, shouldSample, getAlertStats } from "../services/alertStats.js";
import { recordEvent, recordAlertTiming } from "../services/notificationMetrics.js";
import { buildAlertPushPayload } from "../utils/pushNotificationFormat.js";
import {
  matchesWatchRule,
  explainWatchRuleMatch,
  extractWear,
  getCanonicalItemId,
} from "../services/watchMatcher.js";

/* =========================
   HELPERS
========================= */

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizePriceCoins(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;

  // CSGOEmpire לפעמים מחזיר cents / value גדול.
  // אם זה גדול מאוד, נמיר ל-coins.
  if (n > 100000) return n / 100;

  return n;
}

export function extractWearFromName(name = "") {
  const match = String(name).match(
    /\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)\s*$/i
  );

  return match ? match[1].trim() : "";
}

function getItemName(item = {}) {
  return (
    item.market_hash_name ||
    item.marketHashName ||
    item.market_name ||
    item.name ||
    ""
  );
}

function getItemId(item = {}) {
  return String(
    item.itemId ||
    item.id ||
    item.assetid ||
    item.assetId ||
    item.item_id ||
    item.market_nameid ||
    item.marketNameId ||
    ""
  );
}

function getItemWear(item = {}) {
  return (
    item.wear_name ||
    item.wearName ||
    item.wearLabel ||
    item.exterior ||
    extractWearFromName(getItemName(item)) ||
    ""
  );
}

// priceCoins / suggestedCoins are already coins (normalizeItem in
// marketCache.js / empire.controllers.js) — never apply the magnitude-based
// ÷100 heuristic to them. It stays only for the legacy raw-field fallbacks.
function normalizedCoins(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function getPriceCoins(item = {}) {
  if (item.priceCoins != null) return normalizedCoins(item.priceCoins);
  return normalizePriceCoins(
    item.priceCoinsValue ??
    item.purchase_price ??
    item.market_value ??
    item.price ??
    item.auction_highest_bid ??
    0
  );
}

export function getSuggestedCoins(item = {}) {
  if (item.suggestedCoins != null) return normalizedCoins(item.suggestedCoins);
  return normalizePriceCoins(
    item.suggested_price ??
    item.suggestedPrice ??
    item.marketPrice ??
    item.suggested_market_value ??
    0
  );
}

function getDiscountPct(item = {}) {
  const direct = toNumber(
    item.discountPct ??
    item.underPct ??
    item.discount ??
    item.discount_percent ??
    item.discountPercentage ??
    0,
    0
  );

  if (direct > 0) return direct;

  const priceCoins = getPriceCoins(item);
  const suggestedCoins = getSuggestedCoins(item);

  if (priceCoins > 0 && suggestedCoins > 0 && priceCoins < suggestedCoins) {
    return Math.round(((suggestedCoins - priceCoins) / suggestedCoins) * 100);
  }

  return 0;
}

function resolveImage(item = {}) {
  if (item.image) return item.image;
  if (item.image_url) return item.image_url;

  if (item.icon_url) {
    if (String(item.icon_url).startsWith("http")) return item.icon_url;

    return `https://community.cloudflare.steamstatic.com/economy/image/${item.icon_url}/360fx360f`;
  }

  if (item.iconUrl) return item.iconUrl;
  if (item.icon) return item.icon;
  if (item.img) return item.img;

  return "";
}

function buildRuleSearch(rule = {}) {
  return String(
    rule.marketHashName ||
    rule.baseName ||
    rule.query ||
    rule.knifeName ||
    rule.skinName ||
    ""
  ).trim();
}

function getFloatValue(item = {}) {
  const value =
    item.floatValue ??
    item.float ??
    item.paintWear ??
    item.paint_wear ??
    null;

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/* =========================
   ALERT STATE / COOLDOWN
========================= */

async function getAlertState({ userId, ruleId, itemId }) {
  return AlertState.findOne({
    userId,
    ruleId,
    itemId,
  }).lean();
}

function isCooldownActive(state, cooldownMin = 5) {
  if (!state?.lastNotifiedAt) return false;

  const cooldownMs = toNumber(cooldownMin, 5) * 60 * 1000;
  const last = new Date(state.lastNotifiedAt).getTime();

  if (!Number.isFinite(last)) return false;

  return Date.now() - last < cooldownMs;
}

async function markAlertNotified({ userId, ruleId, itemId, priceCoins }) {
  await AlertState.findOneAndUpdate(
    {
      userId,
      ruleId,
      itemId,
    },
    {
      $set: {
        lastSeenAt: new Date(),
        lastPrice: priceCoins,
        lastNotifiedAt: new Date(),
      },
      $setOnInsert: {
        userId,
        ruleId,
        itemId,
      },
    },
    {
      upsert: true,
      new: true,
    }
  );
}

/* =========================
   CREATE / EMIT ALERT
========================= */

async function createAlert({ userId, rule, item, source = "system", detectedAt = Date.now() }) {
  const itemId = getItemId(item);
  if (!itemId) return null;

  try {
    return await AlertLog.create({
      userId,
      ruleId: rule._id,
      itemId,
      name:
        getItemName(item) ||
        rule.marketHashName ||
        rule.baseName ||
        "Unknown item",
      marketHashName:
        getItemName(item) ||
        rule.marketHashName ||
        rule.baseName ||
        "Unknown item",
      image: resolveImage(item),
      priceCoins: getPriceCoins(item),
      suggestedCoins: getSuggestedCoins(item),
      discountPct: getDiscountPct(item),
      wear: getItemWear(item) || rule.wear || "",
      floatValue: getFloatValue(item),
      source,
      isRead: false,
      triggeredAt: new Date(),
      timing: { matchedAt: new Date(detectedAt) },
    });
  } catch (err) {
    if (err?.code === 11000) return null;

    // Non-duplicate AlertLog.create() failure — persist full diagnostics so
    // the cause is visible in NotificationEvent without Render log access.
    recordEvent("ALERT_CREATE_FAILED", {
      userId,
      ruleId: rule?._id,
      itemId,
      source,
      meta: {
        itemName: getItemName(item),
        priceCoins: getPriceCoins(item),
        ruleBaseName: rule?.baseName,
        ruleWear: rule?.wear,
        errName: err?.name,
        errMessage: err?.message,
        errCode: err?.code,
        errStack: String(err?.stack || "").split("\n").slice(0, 3).join("\n"),
      },
    });

    console.error(
      `[ALERT_CREATE_FAILED] userId=${String(userId)} ruleId=${rule?._id} itemId=${itemId} ` +
      `name="${getItemName(item)}" price=${getPriceCoins(item)} ruleBaseName="${rule?.baseName}" ruleWear="${rule?.wear}" ` +
      `err.name=${err?.name} err.code=${err?.code} err.message=${err?.message}`
    );

    // Distinct from "return null" (true 11000 duplicate) so the caller can
    // classify this correctly instead of logging ALERT_DUPLICATE_SKIPPED.
    return undefined;
  }
}

function emitAlert(userId, alert) {
  if (!alert || !userId) {
    console.warn("[emitAlert] skipped — missing userId or alert doc");
    return;
  }
  const uidStr = String(userId);
  const payload = alert.toObject?.() ?? alert;
  emitPriceAlert({
    ...payload,
    id:     String(alert._id || alert.id || ""),
    _id:    String(alert._id || alert.id || ""),
    userId: uidStr,
  });
  console.log(`[emitAlert] ✅ emitted price_alert → room=user:${uidStr} item="${alert.name}"`);
}

/* =========================
   MARKET FETCH HELPERS
========================= */

function extractItemsFromMarket(market) {
  if (Array.isArray(market?.items)) return market.items;
  if (Array.isArray(market?.data)) return market.data;
  if (Array.isArray(market)) return market;

  return [];
}

function isEmpireBlockedError(err) {
  return err?.code === "EMPIRE_BLOCKED";
}

async function fetchItemsForRule(rule, { appId = 730, perPage = 100 } = {}) {
  const search = buildRuleSearch(rule);
  if (!search) return [];

  const market = await safeFetchMarket({
    appId,
    page: 1,
    perPage,
    search,
    includeAuctions: true,
    buyNowOnly: false,
  });

  return extractItemsFromMarket(market);
}

/* =========================
   SHARED ITEM PROCESSOR
========================= */

async function processMatchedItem({
  userId,
  rule,
  item,
  itemId,
  source = "system",
  detectedAt = Date.now(),       // when the rule match was confirmed
  marketDetectedAt = detectedAt, // when Empire WS event arrived
}) {
  // ── Atomic cooldown claim via AlertState ──────────────────────────────────
  // Single round-trip: checks cooldown AND claims the slot atomically.
  // AlertState's unique index on {userId, ruleId, itemId} provides race
  // protection — a concurrent scan that loses the upsert race gets 11000,
  // which is treated as "cooldown still active".
  const cooldownMin = Number(rule.cooldownMin || 5);
  const priceCoins  = getPriceCoins(item);
  const cutoff      = new Date(Date.now() - cooldownMin * 60 * 1000);
  const _isM9ws     = getItemName(item).toLowerCase().includes("m9 bayonet") ||
                      getItemName(item).toLowerCase().includes("crimson web");

  if (_isM9ws) {
    console.log(
      `[M9 DEBUG] WS processMatchedItem — userId=${String(userId)} itemId=${itemId}` +
      ` priceCoins=${priceCoins} targetPrice=${rule.targetPrice ?? "none"}` +
      ` cooldownMin=${cooldownMin}min cutoff=${cutoff.toISOString()}`
    );
  }

  // ── Price-improvement gate (mirrors jobs/alertEngine.js's retrigger check) ──
  // Once cooldown has already expired, the atomic claim below would happily
  // re-fire on the exact same (or a worse) price every cooldown window. Only
  // re-alert here if the price has meaningfully improved since the last
  // notification — same threshold formula already proven in the fallback
  // engine: min(1% of the last notified price, 5 coins). This does not touch
  // the cooldown-still-active case at all — that's still decided entirely by
  // the atomic claim's own $or/11000 handling below, unchanged.
  const existingState = await getAlertState({ userId, ruleId: rule._id, itemId });
  if (existingState?.lastNotifiedAt && new Date(existingState.lastNotifiedAt) < cutoff && existingState.lastPrice != null) {
    const threshold = Math.min(existingState.lastPrice * 0.01, 5);
    const delta = existingState.lastPrice - priceCoins;
    if (delta < threshold) {
      inc("alertsSkippedNoPriceImprovement");
      console.log(
        `[ALERT_SKIPPED_NO_PRICE_IMPROVEMENT] source=${source} userId=${String(userId)} ruleId=${rule._id} ` +
        `itemId=${itemId} lastPrice=${existingState.lastPrice} currentPrice=${priceCoins} delta=${delta} threshold=${threshold}`
      );
      return null;
    }
  }

  try {
    await AlertState.findOneAndUpdate(
      {
        userId,
        ruleId: rule._id,
        itemId,
        $or: [
          { lastNotifiedAt: null },
          { lastNotifiedAt: { $lt: cutoff } },
        ],
      },
      {
        $set: {
          lastNotifiedAt: new Date(),
          lastSeenAt:     new Date(),
          lastPrice:      priceCoins,
        },
        $setOnInsert: { userId, ruleId: rule._id, itemId },
      },
      { upsert: true }
    );
  } catch (err) {
    if (err?.code === 11000) {
      inc("alertsSkippedCooldown");
      console.log(`[ALERT_SKIPPED_COOLDOWN] userId=${String(userId)} itemId=${itemId} rule=${rule._id}`);
      if (_isM9ws) {
        console.log(`[M9 DEBUG] SKIPPED cooldown active (WS path) — userId=${String(userId)} itemId=${itemId} cooldownMin=${cooldownMin}min`);
      }
      return null;
    }
    inc("alertStateClaimError");
    console.error(
      `[ALERT_STATE_CLAIM_ERROR] source=${source} userId=${String(userId)} ruleId=${rule._id} itemId=${itemId} ` +
      `err.name=${err?.name} err.code=${err?.code} err.message=${err?.message}`
    );
    return null;
  }

  if (_isM9ws) {
    console.log(`[M9 DEBUG] AlertState claimed ✓ (WS path) — userId=${String(userId)} itemId=${itemId}`);
  }

  // ── Persist ───────────────────────────────────────────────────────────────
  const created = await createAlert({ userId, rule, item, source, detectedAt });

  // createAlert() returns `undefined` for a non-duplicate failure — diagnostics
  // already persisted via ALERT_CREATE_FAILED inside createAlert(). Don't
  // mislabel it as a duplicate skip.
  if (created === undefined) return null;

  if (!created) {
    inc("alertsSkippedDedupe");
    console.warn(`[ALERT_DUPLICATE_SKIPPED] userId=${String(userId)} ruleId=${rule._id} itemId=${itemId}`);
    recordEvent("ALERT_DUPLICATE_SKIPPED", { userId, ruleId: rule._id, itemId, source });
    return null;
  }
  inc("alertsCreated");

  if (_isM9ws) {
    console.log(`[M9 DEBUG] AlertLog created (WS path) alertId=${String(created._id)} price=${getPriceCoins(item)}`);
  }

  const uidStr      = String(userId);
  const alertId     = String(created._id);
  const createdAt   = Date.now();
  const matchToCreatedMs    = createdAt - detectedAt;
  const detectionToCreatedMs = createdAt - marketDetectedAt;

  recordLatency("matchToCreated", matchToCreatedMs);
  console.log(`[ALERT_LOG_CREATED] alertId=${alertId} userId=${uidStr} itemId=${itemId} item="${created.name}" match→created=${matchToCreatedMs}ms detection→created=${detectionToCreatedMs}ms`);

  // ── Socket emit — IMMEDIATELY after persist, zero async between ──────────
  console.log(`[SOCKET_EMIT_START] alertId=${alertId} userId=${uidStr}`);
  emitPriceAlert({
    ...(created.toObject?.() ?? created),
    id:               alertId,
    _id:              alertId,
    userId:           uidStr,
    _detectedAt:      marketDetectedAt,  // client uses this for true end-to-end latency
    _matchedAt:       detectedAt,
  });
  const socketAt           = Date.now();
  const detectionToSocketMs = socketAt - marketDetectedAt;
  const matchToSocketMs     = socketAt - detectedAt;
  recordLatency("detectionToSocket", detectionToSocketMs);
  console.log(`[SOCKET_EMIT_OK] alertId=${alertId} userId=${uidStr} DETECTION_TO_SOCKET_MS=${detectionToSocketMs} MATCH_TO_SOCKET_MS=${matchToSocketMs}`);
  recordAlertTiming(created._id, "socketEmitAt");

  // ── FCM push — fire-and-forget, NEVER awaited ─────────────────────────────
  if (!isFcmReady()) {
    console.error(`[PUSH_FAIL] alertId=${alertId} userId=${uidStr} — Firebase Admin not initialized`);
  } else {
    const pushStartAt           = Date.now();
    const createdToPushStartMs  = pushStartAt - createdAt;
    const detectionToPushStartMs = pushStartAt - marketDetectedAt;
    recordLatency("createdToPushStart", createdToPushStartMs);
    console.log(`[PUSH_SEND_START] alertId=${alertId} userId=${uidStr} created→push_start=${createdToPushStartMs}ms detection→push_start=${detectionToPushStartMs}ms`);
    recordAlertTiming(created._id, "pushStartAt");
    recordEvent("PUSH_SEND_START", { userId, alertId: created._id, ruleId: rule._id, itemId, source });

    const { title, body, data } = buildAlertPushPayload({
      type:           "price_alert",
      alertId,
      itemId,
      name:           created.marketHashName || created.name,
      image:          resolveImage(item),
      priceCoins:     created.priceCoins,
      suggestedCoins: created.suggestedCoins,
      profitPct:      created.discountPct,
    });

    sendPushToUser(uidStr, { title, body, data }).then((result) => {
      const detectionToPushMs = Date.now() - marketDetectedAt;
      if (result?.successCount > 0) {
        recordLatency("detectionToPush", detectionToPushMs);
        const ids = result.perToken?.filter(t => t.success).map(t => t.messageId).join(", ");
        console.log(`[PUSH_SEND_OK] alertId=${alertId} userId=${uidStr} sent=${result.successCount}/${result.tokenCount} messageIds=[${ids}] DETECTION_TO_PUSH_MS=${detectionToPushMs}`);
      } else if (result?.skipped) {
        console.log(`[PUSH_DUPLICATE_SKIPPED] alertId=${alertId} userId=${uidStr}`);
      } else if (result?.aggregated) {
        // Burst protection queued this alert into the per-user backlog (see
        // services/fcm.js sendPushToUser's aggregation gate) — sendEachForMulticast
        // was never called for it, so tokenCount>0 with an empty perToken here is
        // expected, not a failure. It will go out shortly as one summary push via
        // _flushAgg(). Do NOT log this as PUSH_FAIL — mirrors the same fix already
        // applied to jobs/alertEngine.js's push-result handler.
        console.log(`[PUSH_AGGREGATED_QUEUED] alertId=${alertId} userId=${uidStr} tokenCount=${result.tokenCount} — queued for summary flush, not a failure`);
      } else if (result) {
        const errs = result.perToken?.filter(t => !t.success).map(t => t.error).join("; ");
        console.error(`[PUSH_FAIL] alertId=${alertId} userId=${uidStr} sent=0/${result.tokenCount} errors=[${errs}]`);
      } else {
        console.error(`[PUSH_FAIL] alertId=${alertId} userId=${uidStr} — null result`);
      }
    }).catch((err) => {
      console.error(`[PUSH_FAIL] alertId=${alertId} exception=${err.message}`);
    });
  }

  return created;
}

/* =========================
   RULE-BASED SCAN
========================= */

async function scanRulesDirectly({
  rules = [],
  source = "engine",
  appId = 730,
  perPage = 100,
}) {
  const alerts = [];
  let scanned = 0;
  let matched = 0;

  // Group rules by search term so each unique term only hits the API once,
  // then fan out the results to every rule that shares that term.
  const bySearch = new Map();
  for (const rule of rules) {
    if (!rule.userId) continue;
    const search = buildRuleSearch(rule);
    if (!search) continue;
    const key = search.toLowerCase();
    if (!bySearch.has(key)) bySearch.set(key, { search, rules: [] });
    bySearch.get(key).rules.push(rule);
  }

  for (const { search, rules: groupRules } of bySearch.values()) {
    let items = [];

    try {
      const market = await safeFetchMarket({
        appId,
        page: 1,
        perPage,
        search,
        includeAuctions: true,
        buyNowOnly: false,
      });
      items = extractItemsFromMarket(market);
    } catch (err) {
      if (isEmpireBlockedError(err)) {
        console.warn("⚠️ Empire blocked while scanning:", search);
        continue;
      }
      console.error("❌ Batch scan failed:", search, err?.message || err);
      continue;
    }

    scanned += items.length;

    console.log("🔎 Batch scan:", {
      search,
      rules: groupRules.length,
      items: items.length,
    });

    for (const rule of groupRules) {
      for (const item of items) {
        const itemId = getCanonicalItemId(item);
        if (!itemId) continue;
        if (!matchesWatchRule(item, rule)) continue;

        matched += 1;

        const created = await processMatchedItem({
          userId: rule.userId,
          rule,
          item,
          itemId,
          source,
        });

        if (created) {
          alerts.push(created);
        }
      }
    }

    await new Promise((r) => setTimeout(r, 150));
  }

  return { scanned, matched, alerts };
}

/* =========================
   USER RUN
========================= */

export async function runAlertsOnce(options = {}) {
  const {
    userId,
    source = "manual",
    appId = 730,
    perPage = 100,
  } = options;

  if (!userId) throw new Error("userId is required");

  const rules = await WatchRule.find({ userId }).lean();

  if (!rules.length) {
    return {
      ok: true,
      scanned: 0,
      matched: 0,
      created: 0,
      alerts: [],
      message: "No watch rules found",
    };
  }

  const result = await scanRulesDirectly({
    rules,
    source,
    appId,
    perPage,
  });

  return {
    ok: true,
    scanned: result.scanned,
    matched: result.matched,
    created: result.alerts.length,
    alerts: result.alerts,
  };
}

/* =========================
   ALL USERS ENGINE
========================= */

export async function scanAllWatchRules(options = {}) {
  const {
    source = "engine",
    appId = 730,
    perPage = 100,
  } = options;

  const rules = await WatchRule.find({}).lean();

  if (!rules.length) {
    return {
      ok: true,
      scanned: 0,
      matched: 0,
      created: 0,
      alerts: [],
      message: "No watch rules found",
    };
  }

  const result = await scanRulesDirectly({
    rules,
    source,
    appId,
    perPage,
  });

  return {
    ok: true,
    scanned: result.scanned,
    matched: result.matched,
    created: result.alerts.length,
    alerts: result.alerts,
  };
}

/* =========================
   REALTIME WS ITEM SCAN
========================= */

let rulesCache = [];
let rulesCacheAt = 0;

async function getRulesCached() {
  const now = Date.now();

  // cache ל-5 שניות
  if (rulesCache.length && now - rulesCacheAt < 5000) {
    return rulesCache;
  }

  rulesCache = await WatchRule.find({}).lean();
  rulesCacheAt = now;

  if (rulesCache.length) {
    // Rules without userId are skipped by the match loop — count them here,
    // once per refresh, instead of per listing.
    const missingUserId = rulesCache.filter((r) => !r.userId).length;
    if (missingUserId) inc("liveRulesMissingUserId", missingUserId);
    console.log("🧠 rules cache refreshed:", rulesCache.length, `missingUserId=${missingUserId}`);
  }
  return rulesCache;
}

/* ── Live-path observability (Phase 5B) ─────────────────────────────────────
   Counters are always on; per-rule rejection logs only for rule IDs listed in
   WATCHLIST_DEBUG_RULE_IDS (comma-separated, empty/unset = off). */

const DEBUG_RULE_IDS = new Set(
  String(process.env.WATCHLIST_DEBUG_RULE_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

// Only post-name rejections are counted — "variant"/"name" are the normal,
// high-volume non-match case and stay uncounted and unlogged.
const REJECT_COUNTER = {
  wear:          "liveRejectWear",
  wear_unknown:  "liveRejectWearUnknown",
  target_price:  "liveRejectTargetPrice",
  min_discount:  "liveRejectMinDiscount",
};

function logDebugRejection({ rule, item, itemId, itemName, priceCoins, reason }) {
  console.log(
    `[WATCH_LIVE_REJECT] ruleId=${rule._id} userId=${String(rule.userId)} itemId=${itemId} item="${itemName}" ` +
    `reason=${reason} variant=${rule.variant ?? "ANY"} itemWear=${extractWear(item) ?? "unknown"} ruleWear=${rule.wear || "ANY"} ` +
    `price=${item?.priceCoins} target=${rule.targetPrice ?? "none"} discount=${item?.discountPct} ` +
    `minDiscount=${rule.minDiscountPct ?? "none"} normalizedPrice=${priceCoins}`
  );
}

// Once-per-minute summary of live-path drop counters — emitted only when at
// least one of them changed since the previous tick.
const SUMMARY_KEYS = [
  "liveEventsUnrecognized", "liveItemsNoId", "liveItemsPreGateDropped",
  "liveNoRulesLoaded", "liveRejectWear", "liveRejectWearUnknown",
  "liveRejectTargetPrice", "liveRejectMinDiscount", "liveProcessRejected",
  "liveAlertCheckFailed", "alertStateClaimError", "rulesMatched", "alertsCreated",
];
const SUMMARY_INTERVAL_MS = 60_000;
let lastSummary = null;

export function emitLiveSummaryIfChanged() {
  const stats = getAlertStats();
  const current = Object.fromEntries(SUMMARY_KEYS.map((k) => [k, stats[k] || 0]));
  const prev = lastSummary;
  lastSummary = current;
  if (!prev) return null;

  // Counters can be reset via resetAlertStats(); a lower value then means
  // "everything since the reset", never a negative delta.
  const delta = {};
  let changed = false;
  for (const k of SUMMARY_KEYS) {
    const d = current[k] >= prev[k] ? current[k] - prev[k] : current[k];
    delta[k] = d;
    if (d) changed = true;
  }
  if (!changed) return null;

  const line = `[WATCH_LIVE_SUMMARY] windowMs=${SUMMARY_INTERVAL_MS} ` +
    SUMMARY_KEYS.map((k) => `${k}=${delta[k]}`).join(" ");
  console.log(line);
  return line;
}

setInterval(emitLiveSummaryIfChanged, SUMMARY_INTERVAL_MS).unref?.();

export function invalidateLiveRuleCache() {
  rulesCacheAt = 0;
}

export default async function processLiveItemForAlerts(
  item,
  { source = "empire-ws", marketDetectedAt = Date.now() } = {}
) {
  // Canonical shared matcher/ID extraction — this is the live-WS entry
  // point. scanRulesDirectly() below (the separate manual "scan now"/admin
  // path) now also uses the same canonical matcher (Phase 4B.4); all three
  // Watchlist matching paths are consistent as of this file's current state.
  const itemId     = getCanonicalItemId(item);
  const itemName   = getItemName(item);
  const priceCoins = getPriceCoins(item);

  if (!itemId || !itemName?.trim() || !priceCoins || priceCoins <= 0) {
    inc("liveItemsPreGateDropped");
    if (shouldSample("live_pregate")) {
      const reason = !itemId ? "no_id" : !itemName?.trim() ? "no_name" : "no_price";
      console.warn(
        `[WATCH_LIVE_PREGATE_DROP] source=${source} itemId=${itemId || "none"} hasName=${!!itemName?.trim()} ` +
        `priceCoins=${priceCoins} reason=${reason} (sampled, 1/min)`
      );
    }
    return [];
  }

  const isM9 = itemName.toLowerCase().includes("m9 bayonet") || itemName.toLowerCase().includes("crimson web");
  if (isM9) {
    console.log(
      `[M9 DEBUG] WS live item arrived — name="${itemName}" itemId=${itemId}` +
      ` priceCoins=${priceCoins} suggestedCoins=${getSuggestedCoins(item)} discountPct=${getDiscountPct(item)}%`
    );
  }

  const rules = await getRulesCached();
  if (!rules.length) {
    inc("liveNoRulesLoaded");
    if (shouldSample("live_no_rules")) {
      console.warn(`[WATCH_LIVE_NO_RULES] source=${source} — rule cache empty, live listings not matched (sampled, 1/min)`);
    }
    return [];
  }

  // ── Sync match pass — CPU only, zero I/O ──────────────────────────────────
  // Run all rule checks synchronously first so we can fire async work in
  // parallel rather than sequentially awaiting each matched rule.
  // explainWatchRuleMatch() is the same decision as matchesWatchRule()
  // (which is a boolean wrapper around it) — it only adds the reason.
  const matchedRules = [];
  for (const rule of rules) {
    if (!rule.userId) continue;
    const reason = explainWatchRuleMatch(item, rule);
    if (reason === null) {
      matchedRules.push(rule);
      continue;
    }
    const counter = REJECT_COUNTER[reason];
    if (!counter) continue;
    inc(counter);
    if (DEBUG_RULE_IDS.size && DEBUG_RULE_IDS.has(String(rule._id))) {
      logDebugRejection({ rule, item, itemId, itemName, priceCoins, reason });
    }
  }

  if (isM9) {
    if (matchedRules.length) {
      console.log(`[M9 DEBUG] ${matchedRules.length} rule(s) matched — item="${itemName}" priceCoins=${priceCoins}`);
    } else {
      console.log(`[M9 DEBUG] no rules matched — item="${itemName}" priceCoins=${priceCoins} (${rules.length} rules checked)`);
    }
  }

  if (!matchedRules.length) return [];

  const detectedAt         = Date.now();
  const detectionToMatchMs = detectedAt - marketDetectedAt;
  inc("rulesMatched", matchedRules.length);
  recordLatency("detectionToMatch", detectionToMatchMs);
  console.log(
    `[ALERT_RULE_MATCHED] source=${source} itemId=${itemId} item="${itemName}" price=${priceCoins} ` +
    `count=${matchedRules.length} DETECTION_TO_MATCH_MS=${detectionToMatchMs}`
  );

  const results = await Promise.allSettled(
    matchedRules.map((rule) =>
      processMatchedItem({
        userId:          rule.userId,
        rule,
        item,
        itemId,
        source,
        detectedAt,
        marketDetectedAt,
      })
    )
  );

  // A rejected processMatchedItem() (e.g. getAlertState Mongo error, emit
  // throw) was previously dropped without any trace. Surface it with full
  // context — observability only, the returned `created` list is unchanged.
  results.forEach((r, i) => {
    if (r.status !== "rejected") return;
    const rule = matchedRules[i];
    inc("liveProcessRejected");
    console.error(
      `[WATCH_LIVE_PROCESS_REJECTED] source=${source} userId=${String(rule?.userId)} ruleId=${rule?._id} ` +
      `itemId=${itemId} item="${itemName}" err.name=${r.reason?.name} err.code=${r.reason?.code} ` +
      `err.message=${r.reason?.message ?? r.reason}`
    );
  });

  const created = results
    .filter((r) => r.status === "fulfilled" && r.value != null)
    .map((r) => r.value);

  const totalMs = Date.now() - marketDetectedAt;
  if (created.length) {
    console.log(`[TOTAL_LATENCY_MS] source=${source} itemId=${itemId} alerts=${created.length} MARKET_TO_SOCKET_MS=${totalMs}`);
  }

  return created;
}

/* =========================
   ROUTE HANDLER
========================= */

export async function scanAlerts(req, res) {
  try {
    const userId = req.user?._id || req.user?.id;

    const result = await runAlertsOnce({
      ...(req.query || {}),
      ...(req.body || {}),
      userId,
      io: req.app.get("io"),
      source: "scan",
    });

    res.json(result);
  } catch (e) {
    console.error("scanAlerts error:", e);

    res.status(500).json({
      ok: false,
      error: e.message || "Failed to scan alerts",
    });
  }
}