import { safeFetchMarket } from "./safeFetchMarket.js";
import { batchUpsertIntoCache, getCacheSize } from "./marketCache.js";
import { emitMarketDeals } from "../socket/socket.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let isRunning = false;
let rangeIndex = 0;

const PRICE_RANGES = [
  { label: "0-30", minCoins: 0, maxCoins: 30, pages: 2 },
  { label: "30-100", minCoins: 30, maxCoins: 100, pages: 2 },
  { label: "100-300", minCoins: 100, maxCoins: 300, pages: 2 },
  { label: "300-1000", minCoins: 300, maxCoins: 1000, pages: 3 },

  { label: "1000-2000", minCoins: 1000, maxCoins: 2000, pages: 4 },
  { label: "2000-4000", minCoins: 2000, maxCoins: 4000, pages: 4 },
  { label: "4000-7000", minCoins: 4000, maxCoins: 7000, pages: 4 },
  { label: "7000-10000", minCoins: 7000, maxCoins: 10000, pages: 4 },

  { label: "10000+", minCoins: 10000, maxCoins: 1000000, pages: 4 },
];

function coinsToCents(coins) {
  return Math.round(Number(coins || 0) * 100);
}

function extractItems(resp) {
  if (Array.isArray(resp?.items)) return resp.items;
  if (Array.isArray(resp?.data)) return resp.data;
  if (Array.isArray(resp?.data?.items)) return resp.data.items;
  return [];
}

export async function runMarketSnapshotTask() {
  if (isRunning) return;

  isRunning = true;

  try {
    const range = PRICE_RANGES[rangeIndex];
    rangeIndex = (rangeIndex + 1) % PRICE_RANGES.length;

    console.log(`🟡 Worker: live scan range=${range.label}`);

    let totalFetched = 0;
    const newItems = [];

    for (let page = 1; page <= range.pages; page++) {
      const resp = await safeFetchMarket({
        page,
        perPage: 100,
        price_min: coinsToCents(range.minCoins),
        price_max: coinsToCents(range.maxCoins),
        minDiscountPct: 3,
        auction: "no",
        includeAuctions: true,
        buyNowOnly: false,
        sort: "desc",
        order: "market_value",
      });

      const items = extractItems(resp);

      batchUpsertIntoCache(items);
      newItems.push(...items);
      totalFetched += items.length;

      console.log(
        `✅ Worker range=${range.label} page=${page}/${range.pages} fetched=${items.length} cachedNow=${getCacheSize()}`
      );

      await sleep(1500);
    }

    if (newItems.length) {
      emitMarketDeals(newItems.slice(0, 100));
      console.log(`📡 Socket emitted market:deals count=${newItems.length}`);
    }

    console.log(`[Worker] DONE fetched=${totalFetched} cachedNow=${getCacheSize()}`);
  } catch (err) {
    console.error("[Worker Error]", err?.response?.data || err?.message || err);
  } finally {
    isRunning = false;
  }
}

export function startMarketWorker(intervalMs = 1000 * 30) {
  runMarketSnapshotTask();
  return setInterval(runMarketSnapshotTask, intervalMs);
}