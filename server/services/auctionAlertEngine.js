// server/services/auctionAlertEngine.js
// Runs after every auction_update WS event AND on-demand via /run-once.
// Zero HTTP calls to Empire API — cache-only architecture.

import AuctionAlertRule from "../models/AuctionAlertRule.model.js";
import AlertLog          from "../models/alertLog.models.js";
import AlertState        from "../models/AlertState.js";
import { emitPriceAlert, getIO } from "../socket/socket.js";
import { sendPushToUser, isFcmReady } from "./fcm.js";
import { inc } from "./alertStats.js";
import { recordEvent, recordAlertTiming } from "./notificationMetrics.js";
import { buildAlertPushPayload } from "../utils/pushNotificationFormat.js";

/* ─── Rule cache (5 s TTL to avoid per-event DB hit) ──────────── */

let _rulesCache    = [];
let _rulesCachedAt = 0;

async function getEnabledRules() {
  if (_rulesCache.length && Date.now() - _rulesCachedAt < 5_000) {
    return _rulesCache;
  }
  _rulesCache    = await AuctionAlertRule.find({ enabled: true }).lean();
  _rulesCachedAt = Date.now();
  console.log(`[AuctionAlert] rules cache refreshed — ${_rulesCache.length} enabled rule(s)`);
  return _rulesCache;
}

export function invalidateAuctionRulesCache() {
  _rulesCachedAt = 0;
}

/* ─── Match logic ──────────────────────────────────────────────── */

function lc(s) { return String(s || "").toLowerCase().trim(); }

// Returns { matched: boolean, reason: string } for detailed diagnostics.
// Actionable price = what the user must bid/pay on Empire now (auctionCache.js
// price contract: next valid bid, or the starting price when there are no
// bids). Estimated prices are never used for profit claims → 0 (no match).
function actionablePrice(item) {
  if (item?.priceIsEstimate) return 0;
  return Number(item?.priceCoins || 0);
}

function matchItem(item, rule) {
  const currentBid  = actionablePrice(item);
  const suggested   = Number(item?.suggestedCoins || 0);

  if (item?.priceIsEstimate) return { matched: false, reason: `price unverified (${item?.priceSource || "unknown"}) — no profit claim` };
  if (currentBid <= 0) return { matched: false, reason: `bid=${currentBid} (≤ 0)` };
  if (suggested  <= 0) return { matched: false, reason: `suggested=${suggested} (≤ 0, no market ref)` };

  const profitCoins = suggested - currentBid;
  const profitPct   = (profitCoins / suggested) * 100;

  if (profitCoins <= 0)
    return { matched: false, reason: `profitCoins=${profitCoins.toFixed(2)} (≤ 0)` };

  const minProfit = Number(rule.minProfitCoins || 0);
  if (profitCoins < minProfit)
    return { matched: false, reason: `profit ${profitCoins.toFixed(2)} < threshold ${minProfit}` };

  if (rule.minProfitPct != null) {
    const minPct = Number(rule.minProfitPct);
    if (profitPct < minPct)
      return { matched: false, reason: `profitPct ${profitPct.toFixed(1)}% < ${minPct}%` };
  }

  if (rule.maxBidPrice != null) {
    const maxBid = Number(rule.maxBidPrice);
    if (currentBid > maxBid)
      return { matched: false, reason: `bid ${currentBid} > maxBid ${maxBid}` };
  }

  if (rule.category && rule.category !== "all") {
    const cat = lc(item?.categoryKey || item?.category || item?.type || "");
    if (!cat.includes(lc(rule.category)))
      return { matched: false, reason: `category "${cat}" ≠ "${rule.category}"` };
  }

  if (rule.search?.trim()) {
    if (!lc(item?.name || "").includes(lc(rule.search)))
      return { matched: false, reason: `name "${item?.name}" ∌ "${rule.search}"` };
  }

  if (rule.wear?.trim()) {
    if (lc(item?.wear_name || "") !== lc(rule.wear))
      return { matched: false, reason: `wear "${item?.wear_name}" ≠ "${rule.wear}"` };
  }

  return { matched: true, reason: `profit=${profitCoins.toFixed(2)} (${profitPct.toFixed(1)}%)` };
}

/* ─── Main entry point ─────────────────────────────────────────── */

export async function processAuctionAlerts(items) {
  const list = Array.isArray(items) ? items : [items];

  // Include items with unknown endsAt (assume active) + items ending in future.
  const active = list.filter((it) => {
    const endsAt = it?.auction?.ends_at;
    if (!endsAt) return true;                              // unknown → include
    return Number(endsAt) * 1000 > Date.now();            // future  → include
  });

  console.log(`[AuctionAlert] processAuctionAlerts called — ${list.length} total, ${active.length} active`);

  if (!active.length) return { processed: 0, matched: 0, fired: 0 };

  const rules = await getEnabledRules();
  if (!rules.length) {
    console.log("[AuctionAlert] no enabled rules — skipping");
    return { processed: active.length, matched: 0, fired: 0 };
  }

  let totalMatched = 0;
  let fired        = 0;

  for (const item of active) {
    const itemId = String(item?.itemId ?? item?.id ?? "");
    if (!itemId) continue;

    const currentBid  = actionablePrice(item);   // next bid to place (see actionablePrice)
    const suggested   = Number(item?.suggestedCoins || 0);
    const profitCoins = suggested - currentBid;
    const profitPct   = suggested > 0 ? (profitCoins / suggested) * 100 : 0;

    for (const rule of rules) {
      const ruleId = String(rule._id);
      const userId = String(rule.userId);

      const { matched, reason } = matchItem(item, rule);

      console.log(
        `[AuctionAlert] item="${item?.name || itemId}" ` +
        `bid=${currentBid.toFixed(2)} sugg=${suggested.toFixed(2)} profit=${profitCoins.toFixed(2)} ` +
        `rule=${ruleId} minProfit=${rule.minProfitCoins} → ${matched ? "✅ MATCH" : `❌ ${reason}`}`
      );

      if (!matched) continue;
      totalMatched++;
      inc("rulesMatched");

      const detectedAt = Date.now();
      console.log(`[ALERT_RULE_MATCHED] source=auction-alert userId=${userId} itemId=${itemId} item="${item?.name}" bid=${currentBid.toFixed(2)} profit=${profitCoins.toFixed(2)} count=1`);

      // ── Atomic cooldown claim via AlertState ──────────────────────────────
      // Single round-trip: checks cooldown AND claims the slot atomically —
      // same pattern as processMatchedItem() in alerts.controller.js. This
      // replaces the old findOne → isCooldownActive → create → findOneAndUpdate
      // sequence, which had a TOCTOU gap: two concurrent events (e.g. new_item
      // and auction_update firing for the same item back-to-back) could both
      // read "no active cooldown" and both proceed to AlertLog.create(). The
      // only thing stopping a duplicate AlertLog in that race today is the
      // (separate, undocumented) unique index on alertlogs — this claim makes
      // that index unnecessary for correctness here, same as the watchlist path.
      const cooldownMin = Number(rule.cooldownMin || 10);
      const cutoff      = new Date(Date.now() - cooldownMin * 60 * 1000);

      try {
        await AlertState.findOneAndUpdate(
          {
            userId, ruleId, itemId,
            $or: [
              { lastNotifiedAt: null },
              { lastNotifiedAt: { $lt: cutoff } },
            ],
          },
          {
            $set:         { lastNotifiedAt: new Date(), lastSeenAt: new Date(), lastPrice: currentBid },
            $setOnInsert: { userId, ruleId, itemId },
          },
          { upsert: true }
        );
      } catch (err) {
        if (err?.code === 11000) {
          inc("alertsSkippedCooldown");
          console.log(`[ALERT_SKIPPED_COOLDOWN] source=auction-alert userId=${userId} itemId=${itemId} rule=${ruleId}`);
          continue;
        }
        console.error(`[AuctionAlert] AlertState claim error: ${err?.message || err}`);
        continue;
      }

      // ── Persist ───────────────────────────────────────────────────────────
      let alertDoc;
      try {
        alertDoc = await AlertLog.create({
          userId,
          ruleId,
          itemId,
          name:           item?.name || "Unknown auction item",
          marketHashName: item?.market_hash_name || item?.name || "",
          image:          item?.image || "",
          priceCoins:     currentBid,
          suggestedCoins: suggested,
          discountPct:    Math.round(profitPct * 10) / 10,
          wear:           item?.wear_name || "",
          floatValue:     item?.paint_wear ?? null,
          auctionEndsAt:  item?.auction?.ends_at ?? null,
          source:         "auction-alert",
          isRead:         false,
          triggeredAt:    new Date(),
          timing:         { matchedAt: new Date(detectedAt) },
        });
        inc("alertsCreated");
        console.log(`[ALERT_CREATED] source=auction-alert alertId=${alertDoc._id} userId=${userId} itemId=${itemId} +${Date.now()-detectedAt}ms`);
      } catch (err) {
        if (err?.code === 11000) {
          inc("alertsSkippedDedupe");
          console.warn(`[ALERT_DUPLICATE_SKIPPED] source=auction-alert userId=${userId} ruleId=${ruleId} itemId=${itemId}`);
          recordEvent("ALERT_DUPLICATE_SKIPPED", { userId, ruleId, itemId, source: "auction-alert" });
          continue;
        }
        console.error("❌ [AuctionAlert] AlertLog.create failed:", err?.message);
        continue;
      }

      const logMs = () => `+${Date.now() - detectedAt}ms`;

      // Real-time popup via existing price_alert socket pipeline
      emitPriceAlert({
        id:             String(alertDoc._id),
        userId,
        ruleId,
        itemId,
        name:           alertDoc.name,
        image:          alertDoc.image,
        priceCoins:     alertDoc.priceCoins,
        suggestedCoins: alertDoc.suggestedCoins,
        discountPct:    alertDoc.discountPct,
        profitCoins:    Math.round(profitCoins * 100) / 100,
        profitPct:      Math.round(profitPct * 10) / 10,
        currentBidCoins: item?.currentBidCoins ?? null,
        isAuction:      true,
        auctionEndsAt:  item?.auction?.ends_at ?? null,
        wear:           alertDoc.wear,
        source:         "auction-alert",
        triggeredAt:    alertDoc.triggeredAt,
        isRead:         false,
      });
      console.log(`[SOCKET_EMIT] source=auction-alert alertId=${alertDoc._id} userId=${userId} ${logMs()}`);
      recordAlertTiming(alertDoc._id, "socketEmitAt");

      fired++;

      // ── FCM push (fire-and-forget) ──────────────────────────────────────────
      if (!isFcmReady()) {
        console.error(`[PUSH_FAIL] source=auction-alert alertId=${alertDoc._id} userId=${userId} — Firebase Admin not initialized`);
      } else {
        console.log(`[PUSH_SEND_START] source=auction-alert alertId=${alertDoc._id} userId=${userId} ${logMs()}`);
        recordAlertTiming(alertDoc._id, "pushStartAt");
        recordEvent("PUSH_SEND_START", { userId, alertId: alertDoc._id, ruleId, itemId, source: "auction-alert" });
        const { title, body, data } = buildAlertPushPayload({
          type:           "auction_alert",
          alertId:        alertDoc._id,
          itemId,
          name:           alertDoc.name,
          image:          alertDoc.image,
          priceCoins:     currentBid,
          suggestedCoins: suggested,
          profitCoins,
          profitPct,
        });

        sendPushToUser(userId, { title, body, data }).then((result) => {
          if (!result) {
            console.error(`[PUSH_FAIL] source=auction-alert alertId=${alertDoc._id} userId=${userId} — null result`);
            return;
          }
          if (result.skipped) {
            console.log(`[PUSH_DUPLICATE_SKIPPED] source=auction-alert alertId=${alertDoc._id} userId=${userId}`);
          } else if (result.successCount > 0) {
            const ids = result.perToken?.filter(t => t.success).map(t => t.messageId).join(", ");
            console.log(`[PUSH_SEND_OK] source=auction-alert alertId=${alertDoc._id} userId=${userId} sent=${result.successCount}/${result.tokenCount} messageIds=[${ids}]`);
          } else {
            const errs = result.perToken?.filter(t => !t.success).map(t => t.error).join("; ");
            console.error(`[PUSH_FAIL] source=auction-alert alertId=${alertDoc._id} userId=${userId} sent=0/${result.tokenCount} errors=[${errs}]`);
          }
        }).catch((err) => {
          console.error(`[PUSH_FAIL] source=auction-alert alertId=${alertDoc._id} exception=${err.message}`);
        });
      }
    }
  }

  console.log(
    `✅ [AuctionAlert] done — processed=${active.length} matched=${totalMatched} fired=${fired}`
  );

  return { processed: active.length, matched: totalMatched, fired };
}

/* ─── Expiry sweep ─────────────────────────────────────── */

// Runs every 30 s from server.js.
// Finds live auction alerts whose auction end time has passed, marks them
// expired, and notifies connected clients so the UI updates instantly.
export async function sweepExpiredAuctionAlerts() {
  const nowSec = Math.floor(Date.now() / 1000);

  const expired = await AlertLog.find({
    source:       "auction-alert",
    status:       "live",
    auctionEndsAt: { $ne: null, $lt: nowSec },
  }).select("_id userId").lean();

  if (!expired.length) return { expired: 0 };

  const ids = expired.map((d) => d._id);
  const now = new Date();

  await AlertLog.updateMany(
    { _id: { $in: ids } },
    { $set: { status: "expired", expiredAt: now } }
  );

  // Group alertIds by userId so each user gets a single targeted emit.
  const byUser = new Map();
  for (const doc of expired) {
    const uid = String(doc.userId);
    if (!byUser.has(uid)) byUser.set(uid, []);
    byUser.get(uid).push(String(doc._id));
  }

  try {
    const io = getIO();
    for (const [userId, alertIds] of byUser) {
      io.to(`user:${userId}`).emit("alert_expired", { alertIds });
    }
  } catch {
    // IO not yet ready (early startup) — clients will see correct state on
    // next page load since GET /api/alerts filters status:"live" only.
  }

  console.log(`[AuctionAlert] sweep — ${ids.length} alert(s) marked expired (auction end passed)`);
  return { expired: ids.length };
}
