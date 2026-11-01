import { io as socketClient } from "socket.io-client";
import axios from "axios";
import { upsertIntoCache, removeFromCache } from "./marketCache.js";
import { upsertAuction, removeAuction } from "./auctionCache.js";
import { emitMarketDeals, emitAuctionUpdate, getIO } from "../socket/socket.js";
import processLiveItemForAlerts from "../controllers/alerts.controller.js";
import { processAuctionAlerts } from "./auctionAlertEngine.js";
import AlertLog from "../models/alertLog.models.js";
import { inc, shouldSample } from "./alertStats.js";
import { recordEvent } from "./notificationMetrics.js";
import { enqueue as enqueueSnapshot }     from "./priceSnapshotWriter.js";
import { enqueue as enqueueSoldHistory } from "./soldHistoryFetcher.js";

const domain = process.env.EMPIRE_DOMAIN || "csgoempire.com";
const socketEndpoint = `wss://trade.${domain}/trade`;

let socket = null;
let userData = null;
let userDataRefreshedAt = 0;

// ── Observability + health watchdog state ──────────────────────────────────────
let _lastEventAt     = 0;    // ms timestamp of most recent WS event (any type)
let _lastEventName   = null; // name of that event
let _socketStartedAt = 0;    // ms timestamp when startEmpireMarketSocket() last ran
let _connectErrCount = 0;    // consecutive connect_error count — reset on success
let _reconnecting    = false; // prevents concurrent hard-restart attempts
let _hasDisconnectedOnce = false; // set on first disconnect — distinguishes initial connect from a reconnect

// Throttled broadcast — accumulate items over 2s, dedup by itemId, emit once.
const FLUSH_INTERVAL_MS = 2000;
let pendingBatch = new Map(); // itemId → item (latest wins)
let flushTimer = null;

function scheduleMarketDealsEmit(items) {
  for (const item of items) {
    const id = String(item.itemId ?? item.item_id ?? item.id ?? "");
    if (id) pendingBatch.set(id, item);
  }

  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      const batch = Array.from(pendingBatch.values());
      pendingBatch.clear();
      flushTimer = null;
      if (batch.length) emitMarketDeals(batch.slice(0, 100));
    }, FLUSH_INTERVAL_MS);
  }
}

// Same batching strategy for auctions:update — previously this was emitted
// unbatched, once per upstream auction_update WS message, to every
// connected client. This ONLY defers the client-facing UI broadcast; auction
// profit-alert matching (processAuctionAlerts) always runs immediately and
// independently of this batch, so alert detection speed is unaffected.
const AUCTION_FLUSH_INTERVAL_MS = 2000;
let pendingAuctionBatch = new Map();
let auctionFlushTimer = null;

function scheduleAuctionUpdateEmit(items) {
  for (const item of items) {
    const id = String(item.itemId ?? item.id ?? "");
    if (id) pendingAuctionBatch.set(id, item);
  }

  if (!auctionFlushTimer) {
    auctionFlushTimer = setTimeout(() => {
      const batch = Array.from(pendingAuctionBatch.values());
      pendingAuctionBatch.clear();
      auctionFlushTimer = null;
      if (batch.length) emitAuctionUpdate(batch);
    }, AUCTION_FLUSH_INTERVAL_MS);
  }
}

// Hard-restart the socket with freshly fetched credentials.
// Called after MAX_CONNECT_ERRORS consecutive handshake failures so that an
// expired socket_token does not lock us into an infinite retry loop.
const MAX_CONNECT_ERRORS = 3;

async function _restartWithFreshToken(reason) {
  if (_reconnecting) return;
  _reconnecting = true;
  _connectErrCount = 0;
  console.warn(`[Empire WS] hard restart with fresh token — reason: ${reason}`);

  // stopEmpireMarketSocket() removes all listeners + closes the socket cleanly
  stopEmpireMarketSocket();

  // Brief pause so any in-flight reconnect attempts from socket.io settle
  await new Promise((r) => setTimeout(r, 5_000));

  try {
    await startEmpireMarketSocket();
    console.log("[Empire WS] restart successful");
  } catch (err) {
    console.error("[Empire WS] restart failed:", err?.message || err);
  } finally {
    _reconnecting = false;
  }
}

async function refreshUserData(force = false) {
  if (!force && userData && userDataRefreshedAt > Date.now() - 15_000) {
    return userData;
  }

  const apiKey = process.env.EMPIRE_API_KEY;
  if (!apiKey) throw new Error("Missing EMPIRE_API_KEY in .env");

  const res = await axios.get(`https://${domain}/api/v2/metadata/socket`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "User-Agent": "SKINTEL/1.0",
    },
    timeout: 15_000,
  });

  userData = res.data;
  userDataRefreshedAt = Date.now();

  return userData;
}

function extractItems(data) {
  if (!data) return [];

  if (Array.isArray(data)) return data;
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data?.data?.items)) return data.data.items;

  if (data.item) return [data.item];

  if (
    data.id ||
    data.itemId ||
    data.item_id ||
    data.market_name ||
    data.market_hash_name ||
    data.marketHashName ||
    data.name
  ) {
    return [data];
  }

  return [];
}

function isAuctionItem(raw) {
  return (
    raw?.auction_ends_at != null ||
    raw?.auction?.ends_at != null
  );
}

// Top-level key NAMES only — never values — so diagnostics can't leak raw
// Empire payload contents.
function payloadKeys(data) {
  if (!data || typeof data !== "object") return typeof data;
  return Object.keys(data).slice(0, 10).join(",");
}

async function handleMarketItems(event, data) {
  const items = extractItems(data);
  if (!items.length) {
    inc("liveEventsUnrecognized");
    if (shouldSample(`ws_unrecognized:${event}`)) {
      console.warn(`[WATCH_LIVE_UNRECOGNIZED_EVENT] event=${event} keys=[${payloadKeys(data)}] (sampled, 1/min)`);
    }
    return;
  }

  _lastEventAt   = Date.now();
  _lastEventName = event;

  const marketDetectedAt = Date.now();
  inc("itemsScanned", items.length);
  console.log(`[MARKET_DETECTED] event=${event} items=${items.length}`);
  console.log(`[AUCTION_ITEMS_SCANNED] event=${event} count=${items.length}`);

  // ── Phase 1: cache synchronously (upsertIntoCache is synchronous) ─────────
  const toProcess  = [];
  const cachedItems = [];

  for (const rawItem of items) {
    try {
      const item = upsertIntoCache(rawItem);
      if (!item) {
        inc("liveItemsNoId");
        if (shouldSample(`ws_no_id:${event}`)) {
          console.warn(`[WATCH_LIVE_ITEM_NO_ID] event=${event} keys=[${payloadKeys(rawItem)}] (sampled, 1/min)`);
        }
        continue;
      }

      cachedItems.push(item);
      inc("itemsCached");

      const auctionItem = isAuctionItem(rawItem) ? upsertAuction(rawItem) : null;
      toProcess.push({ item, auctionItem });
    } catch (err) {
      console.warn("⚠️ WS cache failed:", err?.message || err);
    }
  }

  if (cachedItems.length) {
    scheduleMarketDealsEmit(cachedItems);
    try {
      enqueueSnapshot(cachedItems, `ws:${event}`);
    } catch (err) {
      console.warn("⚠️ [PRICE_SNAPSHOT] enqueue failed (non-fatal):", err?.message || err);
    }
    // Phase 0.5 — sold history only on new listings, not price updates
    if (event === "new_item") {
      for (const item of cachedItems) {
        try {
          enqueueSoldHistory(String(item.itemId ?? ""), item.marketHashName ?? "");
        } catch (err) {
          console.warn("⚠️ [SOLD_HISTORY] enqueue failed (non-fatal):", err?.message || err);
        }
      }
    }
  }

  const auctionItems = toProcess
    .filter(({ auctionItem }) => auctionItem)
    .map(({ auctionItem }) => auctionItem);
  if (auctionItems.length) scheduleAuctionUpdateEmit(auctionItems);

  // ── Phase 2: alert matching — all items in parallel ───────────────────────
  // Previously items were processed sequentially with await, meaning item 20
  // couldn't start until item 19 finished Firebase (~300ms). Now all items
  // start simultaneously; the matching item's socket fires in <50ms.
  const alertResults = await Promise.allSettled(
    toProcess.map(async ({ item, auctionItem }) => {
      // Auction profit-alert engine (separate rule type) — fire-and-forget
      if (auctionItem) {
        processAuctionAlerts([auctionItem]).catch((err) =>
          console.error("⚠️ [AuctionAlert] new_item engine error:", err?.message || err)
        );
      }

      try {
        const alerts = await processLiveItemForAlerts(item, {
          source:           `empire-ws:${event}`,
          marketDetectedAt,
        });
        return Array.isArray(alerts) ? alerts.length : 0;
      } catch (err) {
        inc("liveAlertCheckFailed");
        console.warn(
          `[WATCH_LIVE_ALERT_CHECK_FAILED] event=${event} itemId=${item?.itemId ?? ""} ` +
          `item="${item?.marketHashName ?? item?.name ?? ""}" err.name=${err?.name} err.message=${err?.message || err}`
        );
        return 0;
      }
    })
  );

  const alerted = alertResults
    .filter(r => r.status === "fulfilled")
    .reduce((sum, r) => sum + r.value, 0);

  const elapsedMs = Date.now() - marketDetectedAt;
  console.log(
    `✅ [Empire WS] ${event}: items=${items.length} cached=${cachedItems.length} alerts=${alerted} elapsed=${elapsedMs}ms`
  );
}

// Auction-only handler — routes to auctionCache, notifies clients, and
// runs profit-alert matching on the updated items.
async function handleAuctionUpdate(data) {
  const items = extractItems(data);
  if (!items.length) return;

  _lastEventAt   = Date.now();
  _lastEventName = "auction_update";

  const updated = [];
  for (const rawItem of items) {
    try {
      const item = upsertAuction(rawItem);
      if (item) updated.push(item);
    } catch (err) {
      console.log("⚠️ [AuctionCache] upsert failed:", err?.message || err);
    }
  }

  if (updated.length) {
    // Client UI broadcast is batched (2s window); alert matching below runs
    // on `updated` immediately in this same call, so batching this never
    // delays alert detection.
    scheduleAuctionUpdateEmit(updated);

    // Diagnostic log per item so we can verify suggestedCoins is populated
    for (const item of updated) {
      const profitCoins = (item.suggestedCoins || 0) - (item.priceCoins || 0);
      console.log("[Auction WS Alert Check]", {
        event:       "auction_update",
        item:        item.name  || item.itemId,
        itemId:      item.itemId,
        bid:         item.priceCoins,
        suggested:   item.suggestedCoins,
        profitCoins: Number(profitCoins.toFixed(2)),
      });
    }

    // Run profit-alert matching — awaited so errors surface in logs
    try {
      await processAuctionAlerts(updated);
    } catch (err) {
      console.error("⚠️ [AuctionAlert] auction_update engine error:", err?.message || err);
    }
  }

  console.log(
    `🔨 [Empire WS] auction_update: received=${items.length}, cached=${updated.length}`
  );
}

// Empire's documented deleted_item payload is an array of numeric item ids,
// e.g. [91997374, 92044606]. The legacy single-object form ({ id } /
// { item_id } / { itemId } / { assetid }) is still accepted. Returns unique,
// non-empty id strings; anything malformed is skipped.
const DELETED_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function toDeletedId(entry) {
  if (typeof entry === "number") {
    return Number.isSafeInteger(entry) && entry > 0 ? String(entry) : null;
  }
  if (typeof entry === "string") {
    const s = entry.trim();
    return DELETED_ID_RE.test(s) ? s : null;
  }
  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    return toDeletedId(entry.id ?? entry.item_id ?? entry.itemId ?? entry.assetid);
  }
  return null;
}

export function extractDeletedItemIds(data) {
  const entries = Array.isArray(data) ? data : [data];
  const ids = new Set();
  for (const entry of entries) {
    const id = toDeletedId(entry);
    if (id) ids.add(id);
  }
  return [...ids];
}

export async function handleDeletedItem(data) {
  const ids = extractDeletedItemIds(data);

  if (!ids.length) {
    console.log("🗑️ [Empire WS] deleted_item: (no id)");
    return;
  }

  // 1) Caches first — synchronous, never depends on MongoDB.
  const removedAuctionIds = [];
  for (const id of ids) {
    removeFromCache(id);
    if (removeAuction(id)) removedAuctionIds.push(id);
  }

  // 2) Auctions page: only clients in auctions:live, only for listings that
  //    were actually in the auction cache. Sent before any DB work so a slow
  //    or unavailable MongoDB never delays it.
  try {
    const io = getIO();
    for (const id of removedAuctionIds) io.to("auctions:live").emit("item_deleted", { itemId: id });
  } catch {}

  // 3) Alerts: find the affected live alerts (indexed read on itemId), then
  //    soft-delete exactly those — no write when nothing matches. GET /alerts
  //    returns status:"live" only; expireStaleAlerts() in server.js hard-deletes
  //    status:"deleted" records 24h after expiredAt, like expired alerts.
  //    Owners are notified only after the update succeeds, so a DB failure
  //    notifies nobody.
  let notified = 0;
  let marked = 0;
  try {
    const affected = await AlertLog.find({ itemId: { $in: ids }, status: "live" })
      .select("_id userId itemId")
      .lean();

    if (affected.length) {
      const result = await AlertLog.updateMany(
        { _id: { $in: affected.map((a) => a._id) }, status: "live" },
        { $set: { status: "deleted", expiredAt: new Date() } }
      );
      marked = result.modifiedCount ?? 0;

      // One item_deleted per (user, item) pair, only to that user's room —
      // same { itemId } payload Alerts.jsx already handles.
      const pairs = new Map();
      for (const a of affected) {
        const userId = String(a.userId || "");
        const itemId = String(a.itemId || "");
        if (userId && itemId) pairs.set(`${userId}|${itemId}`, { userId, itemId });
      }
      try {
        const io = getIO();
        for (const { userId, itemId } of pairs.values()) {
          io.to(`user:${userId}`).emit("item_deleted", { itemId });
          notified += 1;
        }
      } catch {}
    }
  } catch (err) {
    console.error("⚠️ [Empire WS] failed to mark alerts deleted for deleted items:", err?.message);
  }

  const shown = ids.slice(0, 10).join(",");
  console.log(
    `🗑️ [Empire WS] deleted_item: ids=${ids.length} [${shown}${ids.length > 10 ? ",…" : ""}] ` +
    `auctionEmits=${removedAuctionIds.length} alertsMarked=${marked} userEmits=${notified}`
  );
}

export async function startEmpireMarketSocket() {
  if (socket) return socket;

  try {
    console.log("🛰️ Connecting to Empire trade websocket...");

    const meta = await refreshUserData(true);

    socket = socketClient(socketEndpoint, {
      transports: ["websocket"],
      path: "/s/",
      secure: true,
      rejectUnauthorized: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
      timeout: 20_000,
      query: {
        uid: meta.user.id,
        token: meta.socket_token,
      },
      extraHeaders: {
        "User-Agent": `${meta.user.id} API Bot`,
      },
    });

    _socketStartedAt = Date.now();

    socket.on("connect", () => {
      _connectErrCount = 0; // successful handshake — reset consecutive error counter
      console.log("🟢 Connected to Empire trade websocket");
      if (_hasDisconnectedOnce) {
        recordEvent("WS_RECONNECT", {});
        _hasDisconnectedOnce = false;
      }
    });

    socket.on("init", async (data) => {
      try {
        if (data?.authenticated) {
          console.log(`✅ Empire WS authenticated as ${data.name || "user"}`);

          socket.emit("filters", {
            price_min: 0,
            price_max: 999999999,
          });

          console.log("📡 Empire WS filters sent");

          return;
        }

        const freshMeta = await refreshUserData(true);

        socket.emit("identify", {
          uid: freshMeta.user.id,
          model: freshMeta.user,
          authorizationToken: freshMeta.socket_token,
          signature:
            freshMeta.socket_signature ||
            freshMeta.token_signature ||
            freshMeta.signature,
        });
      } catch (err) {
        console.log("🔴 Empire WS init failed:", err?.message || err);
      }
    });

    socket.on("new_item", (data) => {
      handleMarketItems("new_item", data).catch((err) =>
        console.error(`[WATCH_LIVE_HANDLER_ERROR] event=new_item err.name=${err?.name} err.message=${err?.message || err}`)
      );
    });
    socket.on("updated_item", (data) => {
      handleMarketItems("updated_item", data).catch((err) =>
        console.error(`[WATCH_LIVE_HANDLER_ERROR] event=updated_item err.name=${err?.name} err.message=${err?.message || err}`)
      );
    });
    socket.on("auction_update", handleAuctionUpdate);

    socket.on("deleted_item", (data) => {
      handleDeletedItem(data).catch((err) =>
        console.error("⚠️ [Empire WS] deleted_item handler error:", err?.message || err)
      );
    });

    socket.on("trade_status", (data) => {
      console.log(
        "📦 [Empire WS] trade_status:",
        JSON.stringify(data).slice(0, 250)
      );
    });

    socket.on("timesync", () => {});

    socket.on("disconnect", (reason) => {
      console.log("🟡 Empire WS disconnected:", reason);
      _hasDisconnectedOnce = true;
      recordEvent("WS_DISCONNECT", { meta: { reason } });
    });

    socket.on("connect_error", async (err) => {
      _connectErrCount++;
      console.log(`🔴 Empire WS connect_error (${_connectErrCount}/${MAX_CONNECT_ERRORS}):`, err?.message || err);

      // Always refresh the cached metadata so the next getToken() call in _restartWithFreshToken
      // fetches a valid token. Does NOT update the live socket's query (impossible after creation).
      try { await refreshUserData(true); } catch {}

      // After MAX_CONNECT_ERRORS consecutive failures the socket_token is almost certainly
      // expired. socket.io's built-in reconnection keeps using the same stale token forever.
      // Trigger a hard restart: close the current socket, create a new one with fresh credentials.
      if (_connectErrCount >= MAX_CONNECT_ERRORS && !_reconnecting) {
        _restartWithFreshToken(`${_connectErrCount} consecutive connect_errors: ${err?.message || err}`);
      }
    });

    socket.on("error", (err) => {
      console.log("🔴 Empire WS error:", err?.message || err);
    });

    return socket;
  } catch (err) {
    console.log("❌ Error while initializing Empire WS:", err?.message || err);
    socket = null;
    return null;
  }
}

export function stopEmpireMarketSocket() {
  if (!socket) return;

  socket.removeAllListeners();
  socket.close();
  socket = null;

  console.log("🛑 Empire trade websocket stopped");
}

/** Returns live connectivity + health data for the watchdog and debug endpoints. */
export function getEmpireMarketSocketStatus() {
  return {
    hasSocket:       !!socket,
    connected:       !!socket?.connected,
    reconnecting:    _reconnecting,
    socketStartedAt: _socketStartedAt || null,
    lastEventAt:     _lastEventAt     || null,
    lastEventName:   _lastEventName,
    connectErrCount: _connectErrCount,
  };
}