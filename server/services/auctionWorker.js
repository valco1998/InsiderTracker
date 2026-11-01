// server/services/auctionWorker.js
// REST-based auction seeder — periodically fetches live auctions from Empire
// with auction=yes and populates the in-memory auctionCache.
// Acts as the initial seed and fallback for the WebSocket-based bid updates.

import { safeFetchMarket } from "./safeFetchMarket.js";
import { upsertAuction, getAuctionCacheSize } from "./auctionCache.js";
import { emitAuctionUpdate } from "../socket/socket.js";

let isRunning  = false;
let _diagDone  = false; // fires once on first run, then suppressed

function extractItems(resp) {
  if (Array.isArray(resp?.items))       return resp.items;
  if (Array.isArray(resp?.data))        return resp.data;
  if (Array.isArray(resp?.data?.items)) return resp.data.items;
  return [];
}

export async function runAuctionSnapshotTask() {
  if (isRunning) return;
  isRunning = true;

  try {
    console.log("🔨 [AuctionWorker] Fetching live auctions from Empire REST (auction=yes)...");

    const allFetched = [];
    for (let page = 1; page <= 3; page++) {
      try {
        const resp = await safeFetchMarket({
          page,
          perPage: 100,
          auction: "yes",
          sort:    "desc",
          order:   "market_value",
        });
        const pageItems = extractItems(resp);
        allFetched.push(...pageItems);
        if (pageItems.length < 100) break;
      } catch (err) {
        if (err?.code === "EMPIRE_BLOCKED") {
          console.warn(`[AuctionWorker] rate-blocked at page ${page} — seeding ${allFetched.length} items collected so far`);
          break;
        }
        throw err;
      }
    }

    const items = allFetched;

    if (!_diagDone) {
      _diagDone = true;
      console.log(`[AuctionWorker DIAG] fetched ${items.length} items across up to 3 pages`);
      const sample = items.slice(0, 3);
      if (sample.length === 0) {
        console.log("[AuctionWorker DIAG] ⚠ ZERO items — Empire may not support auction=yes or no auctions are live");
      } else {
        sample.forEach((item, i) => {
          console.log(`[AuctionWorker DIAG] item[${i}]`, JSON.stringify({
            name:            item.name ?? item.market_name ?? null,
            id:              item.id   ?? item.itemId      ?? null,
            auction_ends_at: item.auction_ends_at    ?? item.auction?.ends_at    ?? null,
            auction_bid:     item.auction_highest_bid ?? item.auction?.highest_bid ?? null,
          }));
        });
      }
    }

    const upserted = [];

    for (const raw of items) {
      try {
        // All items from auction=yes are auctions — bypass isAuctionItem() check.
        const item = upsertAuction(raw);
        if (item) upserted.push(item);
      } catch (err) {
        console.warn("[AuctionWorker] upsert failed:", err?.message || err);
      }
    }

    if (upserted.length) {
      emitAuctionUpdate(upserted);
    }

    console.log(
      `✅ [AuctionWorker] fetched=${items.length} cached=${upserted.length} cacheTotal=${getAuctionCacheSize()}`
    );
  } catch (err) {
    console.error(
      "[AuctionWorker] Error:",
      err?.response?.data || err?.message || err
    );
  } finally {
    isRunning = false;
  }
}

export function startAuctionWorker(intervalMs = 1000 * 60 * 5) {
  runAuctionSnapshotTask();
  return setInterval(runAuctionSnapshotTask, intervalMs);
}
