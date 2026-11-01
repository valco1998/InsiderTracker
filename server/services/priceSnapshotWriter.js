/**
 * Batched, deduplicated write service for PriceSnapshot.
 *
 * Every new_item / updated_item WS event calls enqueue(). Snapshots are held
 * in memory and flushed to MongoDB in a single insertMany every FLUSH_INTERVAL_MS.
 *
 * Dedup rules (both must pass for a snapshot to be written):
 *   1. The itemId has not been snapshotted within the last DEDUP_WINDOW_MS.
 *   2. OR the price has changed since the last snapshot for this itemId.
 *
 * This prevents write storms when Empire re-broadcasts the same listings
 * repeatedly via updated_item events.
 */

import PriceSnapshot from "../models/PriceSnapshot.model.js";

const FLUSH_INTERVAL_MS = 10_000;   // flush at most once per 10 seconds
const DEDUP_WINDOW_MS   = 15 * 60 * 1000; // ignore same-price re-listings within 15 min
const MAX_QUEUE_SIZE    = 2000;     // safety cap — flush early if queue grows unexpectedly

// In-memory dedup state: itemId → { priceCoins: Number, snapshotAt: Date }
const recentlySeen = new Map();

// Pending snapshots waiting for the next flush
let pendingQueue    = [];
let flushTimer      = null;
let flushing        = false;
let dedupSkipped    = 0; // reset on each flush — tracks skips since last write

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(flush, FLUSH_INTERVAL_MS);
}

async function flush() {
  flushTimer = null;
  if (flushing || !pendingQueue.length) return;

  flushing = true;
  const batch   = pendingQueue.splice(0, pendingQueue.length);
  const skipped = dedupSkipped;
  dedupSkipped  = 0;

  try {
    await PriceSnapshot.insertMany(batch, { ordered: false });
    console.log(`[PRICE_SNAPSHOT] flushed ${batch.length} snapshot(s) (dedup skipped: ${skipped})`);
  } catch (err) {
    // ordered:false — partial success is fine; duplicates on unique index are not an error here
    const written = batch.length - (err?.writeErrors?.length ?? 0);
    if (written > 0) {
      console.log(`[PRICE_SNAPSHOT] partial flush: ${written}/${batch.length} written (dedup skipped: ${skipped})`);
    } else {
      console.warn("[PRICE_SNAPSHOT] flush failed:", err?.message || err);
    }
  } finally {
    flushing = false;
    // Prune stale dedup entries every flush cycle to bound memory usage
    pruneDedup();
  }
}

function pruneDedup() {
  const cutoff = Date.now() - DEDUP_WINDOW_MS;
  for (const [id, entry] of recentlySeen.entries()) {
    if (entry.snapshotAt < cutoff) recentlySeen.delete(id);
  }
}

/**
 * Enqueue one or more normalized market cache items for snapshotting.
 * Safe to call on every WS event — dedup prevents redundant writes.
 *
 * @param {Array|Object} items - Normalized item(s) from marketCache.upsertIntoCache()
 * @param {string} source     - "ws:new_item" | "ws:updated_item"
 */
export function enqueue(items, source) {
  const list = Array.isArray(items) ? items : [items];

  for (const item of list) {
    const itemId = String(item?.itemId ?? item?.item_id ?? item?.id ?? "");
    if (!itemId) continue;

    const marketHashName = item?.marketHashName || item?.market_hash_name || item?.name || "";
    if (!marketHashName) continue;

    const priceCoins     = Number(item?.priceCoins)     || 0;
    const suggestedCoins = Number(item?.suggestedCoins) || 0;
    const discountPct    = Number(item?.discountPct)    || 0;
    if (priceCoins <= 0 || suggestedCoins <= 0) continue;

    // Dedup check
    const seen = recentlySeen.get(itemId);
    if (seen) {
      const withinWindow = Date.now() - seen.snapshotAt < DEDUP_WINDOW_MS;
      const samePrice    = Math.abs(seen.priceCoins - priceCoins) < 0.01;
      if (withinWindow && samePrice) { dedupSkipped++; continue; }
    }

    const floatValue = item?.paint_wear ?? item?.floatValue ?? null;
    const wear       = item?.wear_name  ?? item?.wear       ?? null;

    pendingQueue.push({
      marketHashName,
      wear,
      floatValue: floatValue != null ? Number(floatValue) : null,
      priceCoins,
      suggestedCoins,
      discountPct,
      itemId,
      source,
      observedAt: new Date(),
    });

    recentlySeen.set(itemId, { priceCoins, snapshotAt: Date.now() });
  }

  if (pendingQueue.length >= MAX_QUEUE_SIZE) {
    // Queue is very large — flush immediately rather than waiting for the timer
    flush().catch((e) => console.error("[PRICE_SNAPSHOT] emergency flush error:", e?.message));
    return;
  }

  scheduleFlush();
}

/** Flush immediately (e.g. on graceful shutdown). */
export async function flushNow() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await flush();
}
