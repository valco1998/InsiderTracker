import WatchRule from "../models/WatchRule.model.js";
import AlertLog from "../models/alertLog.models.js";
import AlertState from "../models/AlertState.js";
import { emitPriceAlert } from "../socket/socket.js";
import { safeFetchMarket } from "../services/safeFetchMarket.js";
import { searchInCache, getCacheSize, getCacheAgeMs, batchUpsertIntoCache, normalizeItem } from "../services/marketCache.js";
import { sendPushToUser, isFcmReady } from "../services/fcm.js";
import { inc } from "../services/alertStats.js";
import { recordEvent, recordAlertTiming } from "../services/notificationMetrics.js";
import { buildAlertPushPayload } from "../utils/pushNotificationFormat.js";
import { matchesWatchRule, getCanonicalItemId } from "../services/watchMatcher.js";

/* =========================
   HELPERS
========================= */

function getItemName(item = {}, rule = {}) {
  return (
    item.market_hash_name ||
    item.marketHashName ||
    item.market_name ||
    item.name ||
    rule.marketHashName ||
    rule.baseName ||
    ""
  );
}

function getItemWear(item = {}) {
  return (
    item.wear_name ||
    item.wearName ||
    item.wearLabel ||
    item.exterior ||
    String(getItemName(item)).match(/\(([^)]+)\)\s*$/)?.[1] ||
    ""
  );
}

function normalizePriceCoins(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;

  // Empire sometimes sends cents-like values.
  // If huge, convert to coins.
  if (n > 100000) return n / 100;

  return n;
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
      item.market_value ??
      0
  );
}

function getDiscountPct(item = {}) {
  const direct = Number(
    item.discountPct ??
      item.underPct ??
      item.discount ??
      item.discount_percent ??
      item.discountPercentage ??
      0
  );

  if (Number.isFinite(direct) && direct > 0) return direct;

  const price = getPriceCoins(item);
  const suggested = getSuggestedCoins(item);

  if (price > 0 && suggested > 0 && price < suggested) {
    return Math.round(((suggested - price) / suggested) * 100);
  }

  return 0;
}

function resolveImage(item = {}) {
  if (item.image) return item.image;
  if (item.image_url) return item.image_url;
  if (item.iconUrl) return item.iconUrl;
  if (item.icon_url) {
    if (String(item.icon_url).startsWith("http")) return item.icon_url;
    return `https://community.cloudflare.steamstatic.com/economy/image/${item.icon_url}/360fx360f`;
  }

  return item.icon || item.img || "";
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

  // Must guard before Number(): Number(null) === 0, which is isFinite.
  // Returning 0 for a missing float is wrong — only return a number if
  // the API actually provided one.
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/* =========================
   MATCH LOGIC
========================= */

const ALERT_DEBUG = process.env.ALERT_DEBUG === "true";

function isDebugItem(item) {
  const n = String(
    item?.market_hash_name || item?.marketHashName || item?.market_name || item?.name || ""
  ).toLowerCase();
  return ALERT_DEBUG;
}

/* =========================
   CREATE ALERT
========================= */

async function createAlertForItem(rule, item, source = "engine") {
  if (!rule?.userId) return null;

  // Canonical shared matcher (Phase 4B.2) — replaces the local
  // matchesRuleDetailed()/matchesRule()/normalizeText()/removeWearFromName()
  // implementation. See server/services/watchMatcher.js for match semantics
  // (variant, wear, one-direction name containment, targetPrice<=0 handling).
  // Debug logging lost matchesRuleDetailed's granular per-reason breakdown in
  // this migration — ALERT_DEBUG is off by default in production, and the
  // detailed reasons list isn't reproduced by the shared boolean-returning
  // matcher; a match/no-match line with the compared names is kept instead.
  const matched = matchesWatchRule(item, rule);

  if (isDebugItem(item)) {
    console.log(
      `[AlertDebug] item="${getItemName(item)}" vs rule="${rule.baseName || rule.marketHashName}" (wear=${rule.wear ?? "ANY"}, variant=${rule.variant ?? "ANY"}):`,
      matched ? "✅ MATCH" : "❌ NO MATCH"
    );
  }

  if (!matched) return null;

  const itemId = getCanonicalItemId(item);
  if (!itemId) return null;

  const detectedAt  = Date.now();
  const cooldownMin = Number(rule.cooldownMin || 5);
  const priceCoins  = getPriceCoins(item);
  const cutoff      = new Date(Date.now() - cooldownMin * 60 * 1000);

  inc("rulesMatched");
  console.log(`[ALERT_RULE_MATCHED] source=${source} userId=${rule.userId} itemId=${itemId} item="${getItemName(item, rule)}" count=1`);

  if (isDebugItem(item)) {
    console.log(
      `[M9 DEBUG] filter passed → userId=${rule.userId} itemId=${itemId}` +
      ` priceCoins=${priceCoins} targetPrice=${rule.targetPrice ?? "none"}` +
      ` minDiscountPct=${rule.minDiscountPct ?? "none"}%` +
      ` cooldownMin=${cooldownMin}min cutoff=${cutoff.toISOString()}`
    );
  }

  // ── Cooldown + price-improvement claim via AlertState ──────────────────────
  // Replaces AlertLog unique-index dedup. First check whether this itemId has
  // an existing cooldown-state doc:
  //   - no doc / never notified           -> first-ever alert, proceed
  //   - cooldown still active              -> skip (ALERT_SKIPPED_COOLDOWN)
  //   - cooldown expired, price not meaningfully lower than lastPrice
  //                                          -> skip (ALERT_SKIPPED_NO_PRICE_IMPROVEMENT),
  //                                             do NOT reset lastNotifiedAt/lastPrice
  //   - cooldown expired, price meaningfully lower
  //                                          -> proceed (ALERT_RETRIGGER_PRICE_IMPROVED)
  // "Meaningfully lower" = drop >= min(1% of lastPrice, 5 coins).
  const existingState = await AlertState.findOne({
    userId: rule.userId,
    ruleId: rule._id,
    itemId,
  }).lean();

  let retrigger = false;

  if (existingState?.lastNotifiedAt) {
    const cooldownActive = existingState.lastNotifiedAt >= cutoff;

    if (cooldownActive) {
      await AlertState.updateOne({ _id: existingState._id }, { $set: { lastSeenAt: new Date() } })
        .catch((err) => console.error(`[alertEngine] AlertState lastSeenAt update error: ${err.message}`));
      inc("alertsSkippedCooldown");
      console.log(`[ALERT_SKIPPED_COOLDOWN] source=${source} userId=${rule.userId} itemId=${itemId}`);
      if (isDebugItem(item)) {
        console.log(`[M9 DEBUG] SKIPPED cooldown active — userId=${rule.userId} itemId=${itemId} cooldownMin=${cooldownMin}min (lastNotifiedAt=${existingState.lastNotifiedAt.toISOString()} cutoff=${cutoff.toISOString()})`);
      }
      return null;
    }

    if (existingState.lastPrice != null) {
      const threshold = Math.min(existingState.lastPrice * 0.01, 5);
      const delta = existingState.lastPrice - priceCoins;

      if (delta < threshold) {
        await AlertState.updateOne({ _id: existingState._id }, { $set: { lastSeenAt: new Date() } })
          .catch((err) => console.error(`[alertEngine] AlertState lastSeenAt update error: ${err.message}`));
        inc("alertsSkippedNoPriceImprovement");
        console.log(`[ALERT_SKIPPED_NO_PRICE_IMPROVEMENT] source=${source} userId=${rule.userId} ruleId=${rule._id} itemId=${itemId} lastPrice=${existingState.lastPrice} currentPrice=${priceCoins} delta=${delta} threshold=${threshold} cooldownMin=${cooldownMin}`);
        if (isDebugItem(item)) {
          console.log(`[M9 DEBUG] SKIPPED no price improvement — userId=${rule.userId} itemId=${itemId} lastPrice=${existingState.lastPrice} currentPrice=${priceCoins} delta=${delta} threshold=${threshold}`);
        }
        return null;
      }

      retrigger = true;
      inc("alertsRetriggeredPriceImproved");
      console.log(`[ALERT_RETRIGGER_PRICE_IMPROVED] source=${source} userId=${rule.userId} ruleId=${rule._id} itemId=${itemId} lastPrice=${existingState.lastPrice} currentPrice=${priceCoins} delta=${delta} threshold=${threshold} cooldownMin=${cooldownMin}`);
    }
  }

  // ── Atomic claim ─────────────────────────────────────────────────────────
  // AlertState's unique index on {userId, ruleId, itemId} provides race
  // protection: if two concurrent scans both pass the checks above, only one
  // wins this upsert (the loser gets 11000 and is treated as a cooldown skip).
  try {
    await AlertState.findOneAndUpdate(
      {
        userId:  rule.userId,
        ruleId:  rule._id,
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
        $setOnInsert: { userId: rule.userId, ruleId: rule._id, itemId },
      },
      { upsert: true }
    );
  } catch (err) {
    if (err?.code === 11000) {
      inc("alertsSkippedCooldown");
      console.log(`[ALERT_SKIPPED_COOLDOWN] source=${source} userId=${rule.userId} itemId=${itemId}`);
      if (isDebugItem(item)) {
        console.log(`[M9 DEBUG] SKIPPED cooldown active — userId=${rule.userId} itemId=${itemId} cooldownMin=${cooldownMin}min (AlertState 11000 — another scan won the race)`);
      }
      return null;
    }
    console.error("❌ AlertState claim error:", err?.message || err);
    return null;
  }

  if (isDebugItem(item)) {
    console.log(`[M9 DEBUG] AlertState claimed ✓ — userId=${rule.userId} itemId=${itemId} proceeding to persist`);
  }

  // ── Persist AlertLog ──────────────────────────────────────────────────────
  try {
    const alertDoc = await AlertLog.create({
      userId: rule.userId,
      ruleId: rule._id,
      itemId,
      name: getItemName(item, rule),
      marketHashName: getItemName(item, rule),
      image: resolveImage(item),
      priceCoins,
      suggestedCoins: getSuggestedCoins(item),
      discountPct: getDiscountPct(item),
      wear: getItemWear(item) || rule.wear || "",
      floatValue: getFloatValue(item),
      source,
      isRead: false,
      triggeredAt: new Date(),
      timing: { matchedAt: new Date(detectedAt) },
    });

    inc("alertsCreated");
    const logMs = () => `+${Date.now() - detectedAt}ms`;
    console.log(`[ALERT_CREATED] source=${source} alertId=${alertDoc._id} userId=${rule.userId} itemId=${itemId} item="${alertDoc.name}" ${logMs()}`);
    if (isDebugItem(item)) {
      console.log(`[M9 DEBUG] AlertLog created alertId=${alertDoc._id} price=${alertDoc.priceCoins} discount=${alertDoc.discountPct}%`);
    }

    emitPriceAlert({
      id: String(alertDoc._id),
      userId: String(rule.userId),
      ruleId: String(rule._id),
      itemId,
      name: alertDoc.name,
      image: alertDoc.image,
      priceCoins: alertDoc.priceCoins,
      suggestedCoins: alertDoc.suggestedCoins,
      discountPct: alertDoc.discountPct,
      baseName: rule.baseName,
      wear: alertDoc.wear,
      floatValue: alertDoc.floatValue ?? null,
      marketHashName: alertDoc.marketHashName,
      triggeredAt: alertDoc.triggeredAt,
      isRead: false,
      source,
    });
    console.log(`[SOCKET_EMIT] source=${source} alertId=${alertDoc._id} userId=${rule.userId} ${logMs()}`);
    if (isDebugItem(item)) {
      console.log(`[M9 DEBUG] socket emitted → room=user:${rule.userId}`);
    }
    recordAlertTiming(alertDoc._id, "socketEmitAt");

    WatchRule.updateOne({ _id: rule._id }, { $set: { lastNotifiedAt: new Date() } })
      .catch((err) => console.error(`[alertEngine] WatchRule.updateOne error: ${err.message}`));

    if (!isFcmReady()) {
      console.error(`[PUSH_FAIL] source=${source} alertId=${alertDoc._id} userId=${rule.userId} — Firebase Admin not initialized`);
    } else {
      console.log(`[PUSH_SEND_START] source=${source} alertId=${alertDoc._id} userId=${rule.userId} ${logMs()}`);
      recordAlertTiming(alertDoc._id, "pushStartAt");
      recordEvent("PUSH_SEND_START", { userId: rule.userId, alertId: alertDoc._id, ruleId: rule._id, itemId, source });
      const { title, body, data } = buildAlertPushPayload({
        type:           source === "auction-alert" ? "auction_alert" : "price_alert",
        alertId:        alertDoc._id,
        itemId,
        name:           alertDoc.name,
        image:          alertDoc.image,
        priceCoins:     alertDoc.priceCoins,
        suggestedCoins: alertDoc.suggestedCoins,
        profitPct:      alertDoc.discountPct,
      });
      sendPushToUser(String(rule.userId), { title, body, data }).then((result) => {
        if (!result) {
          console.error(`[PUSH_FAIL] source=${source} alertId=${alertDoc._id} userId=${rule.userId} — null`);
        } else if (result.skipped) {
          console.log(`[PUSH_DUPLICATE_SKIPPED] source=${source} alertId=${alertDoc._id} userId=${rule.userId}`);
        } else if (result.aggregated) {
          // Burst protection queued this alert into the per-user backlog (see
          // services/fcm.js sendPushToUser's aggregation gate) — sendEachForMulticast
          // was never called for it, so tokenCount>0 with an empty perToken here is
          // expected, not a failure. It will go out shortly as one summary push via
          // _flushAgg(). Do NOT log this as PUSH_FAIL — that previously produced
          // false-alarm "sent=0/1 errors=[]" lines for working-as-designed aggregation.
          console.log(`[PUSH_AGGREGATED_QUEUED] source=${source} alertId=${alertDoc._id} userId=${rule.userId} tokenCount=${result.tokenCount} — queued for summary flush, not a failure`);
        } else if (result.successCount > 0) {
          const ids = result.perToken?.filter(t => t.success).map(t => t.messageId).join(", ");
          console.log(`[PUSH_SEND_OK] source=${source} alertId=${alertDoc._id} userId=${rule.userId} sent=${result.successCount}/${result.tokenCount} messageIds=[${ids}]`);
          if (isDebugItem(item)) {
            console.log(`[M9 DEBUG] FCM push sent=${result.successCount}/${result.tokenCount} to userId=${rule.userId}`);
          }
        } else {
          const errs = result.perToken?.filter(t => !t.success).map(t => t.error).join("; ");
          console.error(`[PUSH_FAIL] source=${source} alertId=${alertDoc._id} userId=${rule.userId} sent=0/${result.tokenCount} errors=[${errs}]`);
        }
      }).catch((err) => {
        console.error(`[PUSH_FAIL] source=${source} alertId=${alertDoc._id} exception=${err.message}`);
      });
    }

    return alertDoc;
  } catch (err) {
    if (err?.code === 11000) {
      inc("alertsSkippedDedupe");
      console.warn(`[ALERT_DUPLICATE_SKIPPED] source=${source} userId=${rule.userId} ruleId=${rule._id} itemId=${itemId}`);
      recordEvent("ALERT_DUPLICATE_SKIPPED", { userId: rule.userId, ruleId: rule._id, itemId, source });
      return null;
    }
    console.error("❌ Alert create error:", err?.message || err);
    return null;
  }
}

/* =========================
   CONCURRENCY-BOUNDED BATCH RUNNER
   Runs async task functions in controlled batches so that at most CONCURRENCY
   operations are in-flight at the same time. This prevents the MongoDB
   connection pool (~100 connections) from being saturated if many item-rule
   pairs match simultaneously during a busy market period.

   Tasks are thunks (() => Promise) so they don't start until their slot opens.
========================= */

const SCAN_CONCURRENCY = 25;

async function runBatched(thunks, concurrency = SCAN_CONCURRENCY) {
  const results = [];
  for (let i = 0; i < thunks.length; i += concurrency) {
    const batch = await Promise.allSettled(
      thunks.slice(i, i + concurrency).map(fn => fn())
    );
    results.push(...batch);
  }
  return results;
}

/* =========================
   RULE CACHE
   Avoids a MongoDB round-trip on every incoming WS item.
   Rules are refreshed every 15 s — new rules appear within one cycle.
========================= */

let _ruleCache = [];
let _ruleCacheAt = 0;
const RULE_CACHE_TTL_MS = 15_000;

async function getActiveRules() {
  if (_ruleCache.length && Date.now() - _ruleCacheAt < RULE_CACHE_TTL_MS) {
    return _ruleCache;
  }
  _ruleCache = await WatchRule.find({}).lean();
  _ruleCacheAt = Date.now();
  return _ruleCache;
}

export function invalidateRuleCache() {
  _ruleCacheAt = 0;
}

/* =========================
   PER-TERM LIVE-CHECK THROTTLE
   marketCache only contains whatever Empire's WS/worker happened to push —
   a rule's exact term can be legitimately absent even while the cache is
   globally "warm". This throttle bounds how often we escalate to a live
   Empire call for a term that keeps coming up empty in the cache, without
   reintroducing a live call per rule per tick (the bandwidth problem the
   global warm/cold check was originally built to avoid).
========================= */

const _liveCheckAt = new Map(); // search term (lowercased) -> last live-fetch timestamp
const LIVE_CHECK_THROTTLE_MS = 5 * 60 * 1000;

/* =========================
   ENGINE LOOP
========================= */

function extractItems(market) {
  if (Array.isArray(market?.items)) return market.items;
  if (Array.isArray(market?.data)) return market.data;
  if (Array.isArray(market)) return market;
  return [];
}

export async function scanWatchRules() {
  // Force-refresh the rule cache on each scheduled scan so new/deleted rules
  // are always picked up. The in-memory cache is only for the high-frequency WS path.
  invalidateRuleCache();
  const rules = await getActiveRules();

  console.log("🟦 alertEngine fallback rules:", rules.length);

  // Group rules by search term — one API call per unique term.
  const bySearch = new Map();
  for (const rule of rules) {
    if (!rule.userId) continue;
    const search = buildRuleSearch(rule);
    if (!search) continue;
    const key = search.toLowerCase();
    if (!bySearch.has(key)) bySearch.set(key, { search, rules: [] });
    bySearch.get(key).rules.push(rule);
  }

  // Cache is "warm" only if it has items AND was updated within the last 5 minutes.
  // If the Empire WS has been silent for >5 min the cache is stale — new items
  // are appearing on Empire but not entering our cache. Fall back to the API so
  // the engine catches those items directly instead of scanning dead data.
  const CACHE_STALE_MS = 5 * 60 * 1000;
  const cacheAgeMs = getCacheAgeMs();
  const cacheWarm  = getCacheSize() > 0 && cacheAgeMs < CACHE_STALE_MS;

  if (getCacheSize() > 0 && !cacheWarm) {
    console.warn(
      `🟦 alertEngine fallback: cache has ${getCacheSize()} items but last update was ` +
      `${Math.round(cacheAgeMs / 1000)}s ago (>${CACHE_STALE_MS / 1000}s threshold) — ` +
      `treating as COLD, falling back to Empire API to catch missed items`
    );
  } else {
    console.log(
      cacheWarm
        ? `🟦 alertEngine fallback using in-memory cache (${getCacheSize()} items, age=${Math.round(cacheAgeMs / 1000)}s)`
        : "🟦 alertEngine fallback cache cold — falling back to Empire API"
    );
  }

  for (const { search, rules: groupRules } of bySearch.values()) {
    let items = [];
    let source = "cache";
    const termKey = search.toLowerCase();

    if (cacheWarm) {
      // Fast path: search in-memory cache — no HTTP, no rate-limit risk.
      items = searchInCache(search);
    }

    // The cache only contains whatever the WS stream / periodic worker happened
    // to push — a specific rule's term can be legitimately absent even while the
    // cache is globally warm (e.g. a low-liquidity item/wear with no recent WS
    // activity). Global "cache is warm" is not proof this term has been checked.
    // Escalate to a live Empire call when: the cache is globally cold/stale
    // (existing WS-outage recovery, unthrottled — same as before), OR this
    // specific term found nothing in a warm cache and hasn't been live-checked
    // recently (throttled per-term so we don't hit Empire once per rule per tick).
    const needsLiveCheck =
      !cacheWarm ||
      (items.length === 0 &&
        (Date.now() - (_liveCheckAt.get(termKey) || 0)) >= LIVE_CHECK_THROTTLE_MS);

    if (needsLiveCheck) {
      if (cacheWarm) _liveCheckAt.set(termKey, Date.now());
      source = cacheWarm ? "live-throttled" : "api";
      try {
        const market = await safeFetchMarket({
          appId: 730,
          page: 1,
          perPage: 100,
          search,
          includeAuctions: true,
          buyNowOnly: false,
        });
        items = extractItems(market);
        if (items.length) {
          batchUpsertIntoCache(items); // still populates the shared cache, unchanged
          // Match against the same canonical normalized shape every other item
          // source uses (cache-warm search results, live-WS items) instead of
          // raw Empire REST objects — batchUpsertIntoCache() normalizes
          // internally but only returns an insert count, so re-derive the
          // normalized shape here via the same normalizeItem() it uses.
          items = items.map(normalizeItem);
        }
      } catch (err) {
        console.log("❌ batch error:", search, err?.message || err);
        await new Promise((r) => setTimeout(r, 150));
        continue;
      }
      // Rate-limit guard only applies to HTTP calls.
      await new Promise((r) => setTimeout(r, 150));
    }

    console.log(
      `🔎 Rule fallback batch: "${search}" source=${source} items=${items.length} rules=${groupRules.length}`
    );

    // M9 debug: show every M9 item found for rules that watch M9
    if (groupRules.some(r => buildRuleSearch(r).toLowerCase().includes("m9"))) {
      const m9s = items.filter(it => getItemName(it).toLowerCase().includes("m9 bayonet"));
      if (m9s.length) {
        m9s.forEach(it => console.log(
          `[M9 DEBUG] found in batch: "${getItemName(it)}" itemId=${getCanonicalItemId(it)}` +
          ` priceCoins=${getPriceCoins(it)} suggestedCoins=${getSuggestedCoins(it)}` +
          ` discountPct=${getDiscountPct(it)}% wear="${getItemWear(it)}"`
        ));
      } else {
        console.log(`[M9 DEBUG] no M9 items returned for search="${search}" (${items.length} total items in batch)`);
      }
    }

    await runBatched(
      groupRules.flatMap(rule =>
        items.map(item => () => createAlertForItem(rule, item, "engine"))
      )
    );
  }
}

export const startAlertEngine = ({ intervalMs = 30000 } = {}) => {
  let stopped = false;

  const schedule = async () => {
    if (stopped) return;
    try {
      await scanWatchRules();
    } catch (err) {
      console.log("❌ engine error:", err?.message || err);
    }
    if (!stopped) setTimeout(schedule, intervalMs);
  };

  schedule();

  console.log("🟧 alertEngine fallback running every", intervalMs, "ms");

  return () => { stopped = true; };
};