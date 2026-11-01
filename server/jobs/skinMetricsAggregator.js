import PriceSnapshot from "../models/PriceSnapshot.model.js";
import SkinMetrics   from "../models/SkinMetrics.model.js";
import SoldHistory   from "../models/SoldHistory.model.js";

const INTERVAL_MS     = 60 * 60 * 1000;
const WINDOW_7D_MS    =  7 * 24 * 60 * 60 * 1000;
const WINDOW_30D_MS   = 30 * 24 * 60 * 60 * 1000;
const WINDOW_90D_MS   = 90 * 24 * 60 * 60 * 1000;
const MIN_DATA_POINTS = 5;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns { tier, source } — source records which branch produced the tier,
 * so consumers (dealScore.js) can tell confirmed sales apart from the listing
 * frequency proxy instead of presenting both under the same static wording. */
export function computeTier(listingCount7d, soldCount30d) {
  // Priority 1: sold data (ground truth) when sufficient
  if (soldCount30d != null && soldCount30d >= MIN_DATA_POINTS) {
    const soldPerDay = soldCount30d / 30;
    const tier = soldPerDay >= 0.5 ? "active"  // ≥15 sales in 30d
      : soldPerDay >= 0.1 ? "thin"             //  3–14 in 30d
      : "rare";
    return { tier, source: "sold_history" };
  }
  // Priority 2: listing frequency (proxy)
  if (listingCount7d < MIN_DATA_POINTS) return { tier: "no_data", source: "none" };
  const avgPerDay = listingCount7d / 7;
  const tier = avgPerDay >= 3   ? "active"
    : avgPerDay >= 0.3 ? "thin"
    : "rare";
  return { tier, source: "listing_proxy" };
}

export function median(sortedArr) {
  if (!sortedArr.length) return null;
  const mid = Math.floor(sortedArr.length / 2);
  return sortedArr.length % 2 === 0
    ? (sortedArr[mid - 1] + sortedArr[mid]) / 2
    : sortedArr[mid];
}

function round2(n) {
  return n != null ? Math.round(n * 100) / 100 : null;
}

// Splits prices (sorted asc by soldAt) into two halves and returns % change
// old→new. Positive = rising. Null when fewer than 6 records.
function computeTrend(prices) {
  if (!prices || prices.length < 6) return null;
  const mid    = Math.floor(prices.length / 2);
  const oldAvg = prices.slice(0, mid).reduce((s, v) => s + v, 0) / mid;
  const newAvg = prices.slice(mid).reduce((s, v) => s + v, 0) / (prices.length - mid);
  if (oldAvg === 0) return null;
  return round2(((newAvg - oldAvg) / oldAvg) * 100);
}

// ── Pipeline 1 helpers (cursor-based — see scanPriceSnapshots7d) ─────────────
//
// A $group+$push over the full 7-day PriceSnapshot window used to exceed
// MongoDB Atlas M0's in-memory aggregation limit once the window grew large
// enough (QueryExceededMemoryLimitNoDiskUseAllowed; allowDiskUse is rejected
// on M0). These helpers reproduce the exact same per-group values — median()
// and the float-null-filtering below are unchanged, just fed by a narrow
// cursor scan instead of a $group, so arrays are held in Node's memory
// (unbounded by Mongo's per-group ceiling) instead of the aggregation engine's.

/** Same join-key format soldMap uses below — keep in sync with that shape. */
export function buildGroupKey(marketHashName, wear) {
  return `${marketHashName}|||${wear ?? ""}`;
}

export function createPriceGroup(marketHashName, wear) {
  return {
    marketHashName,
    wear,
    docCount:      0,
    prices:        [],
    discountSum:   0,
    discountCount: 0,
    floatValues:   [],
  };
}

/** Mirrors the null/non-numeric handling the native $avg/$min/$max accumulators
 * had: only finite prices/discounts count toward those stats (matching Mongo's
 * "ignore non-numeric" behavior). floatValue is pushed as-is, including null —
 * the existing downstream filter (f != null && Number.isFinite(f)) is unchanged. */
export function accumulatePriceDoc(group, doc) {
  group.docCount++;

  const price = doc.priceCoins;
  if (typeof price === "number" && Number.isFinite(price)) {
    group.prices.push(price);
  }

  const discount = doc.discountPct;
  if (typeof discount === "number" && Number.isFinite(discount)) {
    group.discountSum += discount;
    group.discountCount++;
  }

  group.floatValues.push(doc.floatValue);
}

/** Produces the same shape the old $group stage returned ({_id, count, avgPrice,
 * minPrice, maxPrice, avgDiscount, prices, floatValues}), so the rest of
 * runSkinMetricsAggregation() — median computation, float filtering, ops
 * building — is completely unchanged below. */
export function finalizePriceGroup(group) {
  const sortedPrices = [...group.prices].sort((a, b) => a - b);
  const priceCount   = sortedPrices.length;
  const avgPrice = priceCount
    ? group.prices.reduce((s, p) => s + p, 0) / priceCount
    : null;

  return {
    _id:         { marketHashName: group.marketHashName, wear: group.wear },
    count:       group.docCount,
    avgPrice,
    minPrice:    priceCount ? sortedPrices[0] : null,
    maxPrice:    priceCount ? sortedPrices[priceCount - 1] : null,
    avgDiscount: group.discountCount ? group.discountSum / group.discountCount : null,
    prices:      group.prices,
    floatValues: group.floatValues,
  };
}

/** Narrow-projection, lean cursor scan over the 7-day PriceSnapshot window —
 * replaces the old $group+$push aggregation with identical output. */
export async function scanPriceSnapshots7d(since7d) {
  const cursor = PriceSnapshot.find(
    { observedAt: { $gte: since7d } },
    { marketHashName: 1, wear: 1, priceCoins: 1, discountPct: 1, floatValue: 1, _id: 0 }
  ).lean().cursor();

  const groupMap = new Map();
  for await (const doc of cursor) {
    const wear = doc.wear ?? null;
    const key  = buildGroupKey(doc.marketHashName, wear);

    let group = groupMap.get(key);
    if (!group) {
      group = createPriceGroup(doc.marketHashName, wear);
      groupMap.set(key, group);
    }
    accumulatePriceDoc(group, doc);
  }

  return Array.from(groupMap.values(), finalizePriceGroup);
}

// ── Main job ──────────────────────────────────────────────────────────────────

export async function runSkinMetricsAggregation() {
  const start  = Date.now();
  const since7d  = new Date(start - WINDOW_7D_MS);
  const since30d = new Date(start - WINDOW_30D_MS);
  const since90d = new Date(start - WINDOW_90D_MS);

  console.log("[SKIN_METRICS] aggregation started");

  let updatedCount     = 0;
  let totalScanned     = 0;
  let totalSoldScanned = 0;

  try {
    // ── Pipeline 1: 7-day listing observations — cursor scan ─────────────────
    // See scanPriceSnapshots7d() above: a $group+$push here used to exceed
    // MongoDB Atlas M0's in-memory limit once the 7-day window grew large
    // enough. This produces identical per-group output without the ceiling.
    const groups = await scanPriceSnapshots7d(since7d);
    totalScanned = groups.reduce((s, g) => s + g.count, 0);

    // ── Pipeline 2: sold stats — single scan covering both 30d and 90d windows ─
    // Replaces two separate collection scans. $cond computes 30d sub-aggregates
    // inline from the wider 90d match, eliminating the redundant 90d-only scan.
    // $sort before $group: ensures $first/$last reflect oldest/newest sale and
    // prices30d is in ascending soldAt order for computeTrend old→new comparison.
    // $$REMOVE in $push filters the array to 30d entries while preserving order.
    const soldGroups = await SoldHistory.aggregate(
      [
        { $match: { soldAt: { $gte: since90d } } },
        { $sort:  { marketHashName: 1, wear: 1, soldAt: 1 } },
        {
          $group: {
            _id:            { marketHashName: "$marketHashName", wear: "$wear" },
            count90d:       { $sum: 1 },
            earliestSoldAt: { $first: "$soldAt" },
            lastSoldAt:     { $last: "$soldAt" },
            lastSoldPrice:  { $last: "$totalValueCoins" },
            count30d: {
              $sum: { $cond: [{ $gte: ["$soldAt", since30d] }, 1, 0] },
            },
            avgPrice30d: {
              $avg: { $cond: [{ $gte: ["$soldAt", since30d] }, "$totalValueCoins", null] },
            },
            minPrice30d: {
              $min: { $cond: [{ $gte: ["$soldAt", since30d] }, "$totalValueCoins", null] },
            },
            maxPrice30d: {
              $max: { $cond: [{ $gte: ["$soldAt", since30d] }, "$totalValueCoins", null] },
            },
            // Pre-sorted asc; $$REMOVE drops >30d entries while keeping order intact
            prices30d: {
              $push: {
                $cond: [{ $gte: ["$soldAt", since30d] }, "$totalValueCoins", "$$REMOVE"],
              },
            },
          },
        },
      ],
      { allowDiskUse: true }
    );
    totalSoldScanned = soldGroups.reduce((s, g) => s + g.count90d, 0);

    // ── Build lookup map ──────────────────────────────────────────────────────
    // Both 30d and 90d data come from the single merged pipeline.
    const soldMap = new Map();
    for (const g of soldGroups) {
      const key           = `${g._id.marketHashName}|||${g._id.wear ?? ""}`;
      const has30d        = g.count30d > 0;
      const sortedPrices  = has30d ? [...g.prices30d].sort((a, b) => a - b) : [];
      soldMap.set(key, {
        count30d:       g.count30d,
        count90d:       g.count90d,
        avgPrice:       has30d ? round2(g.avgPrice30d)            : null,
        medianPrice:    has30d ? round2(median(sortedPrices))      : null,
        minPrice:       has30d ? round2(g.minPrice30d)             : null,
        maxPrice:       has30d ? round2(g.maxPrice30d)             : null,
        earliestSoldAt: g.earliestSoldAt,
        lastSoldAt:     g.lastSoldAt,
        lastSoldPrice:  round2(g.lastSoldPrice),
        trend:          computeTrend(g.prices30d), // prices30d is asc by soldAt; returns null if <6
      });
    }

    // ── Build bulkWrite ops ───────────────────────────────────────────────────
    const ops = [];
    const processedKeys = new Set();

    // Primary set: skins with listing data in the 7d window
    for (const g of groups) {
      const key = `${g._id.marketHashName}|||${g._id.wear ?? ""}`;
      processedKeys.add(key);

      const sold     = soldMap.get(key) ?? null;
      const count90d = sold?.count90d ?? 0;
      const { tier, source: tierSource } = computeTier(g.count, sold?.count30d ?? null);

      const sortedPrices = [...g.prices].sort((a, b) => a - b);
      const medianPrice  = median(sortedPrices);

      const floats   = g.floatValues.filter((f) => f != null && Number.isFinite(f));
      const avgFloat = floats.length ? floats.reduce((s, f) => s + f, 0) / floats.length : null;
      const minFloat = floats.length ? floats.reduce((m, f) => f < m ? f : m, floats[0]) : null;
      const maxFloat = floats.length ? floats.reduce((m, f) => f > m ? f : m, floats[0]) : null;

      ops.push({
        updateOne: {
          filter: { marketHashName: g._id.marketHashName, wear: g._id.wear },
          update: {
            $set: {
              tier,
              tierSource,
              avgPrice7d:        round2(g.avgPrice),
              medianPrice7d:     round2(medianPrice),
              minPrice7d:        round2(g.minPrice),
              maxPrice7d:        round2(g.maxPrice),
              avgDiscount7d:     round2(g.avgDiscount),
              listingCount7d:    g.count,
              avgFloat7d:        avgFloat != null ? round2(avgFloat) : null,
              minFloat7d:        minFloat != null ? round2(minFloat) : null,
              maxFloat7d:        maxFloat != null ? round2(maxFloat) : null,
              lastUpdatedAt:     new Date(),
              // Sold stats — always written; null when no confirmed sales exist in
              // the rolling window (naturally zeroes out when nothing sold recently)
              soldCount30d:      sold?.count30d      ?? 0,
              soldCount90d:      count90d,
              medianSoldPrice:   sold?.medianPrice   ?? null,
              avgSoldPrice:      sold?.avgPrice      ?? null,
              soldPriceMin30d:   sold?.minPrice      ?? null,
              soldPriceMax30d:   sold?.maxPrice      ?? null,
              lastSoldPrice:     sold?.lastSoldPrice   ?? null,
              lastSoldAt:        sold?.lastSoldAt      ?? null,
              soldPriceTrend:    sold?.trend           ?? null,
              soldDataUpdatedAt: sold ? new Date()     : null,
              soldEarliestAt:    sold?.earliestSoldAt  ?? null,
            },
            $setOnInsert: {
              activeListingsNow: 0,
              dataStartedAt:     new Date(),
            },
          },
          upsert: true,
        },
      });
    }

    // Secondary set: skins with sold data but no listing activity in 7d window
    // (rare items that haven't appeared as live listings recently)
    for (const [key, sold] of soldMap.entries()) {
      if (processedKeys.has(key)) continue;

      const [marketHashName, wearPart] = key.split("|||");
      const wear     = wearPart || null;
      const count90d = sold.count90d ?? 0;
      const { tier, source: tierSource } = computeTier(0, sold.count30d);

      ops.push({
        updateOne: {
          filter: { marketHashName, wear },
          update: {
            $set: {
              tier,
              tierSource,
              listingCount7d:    0,
              lastUpdatedAt:     new Date(),
              soldCount30d:      sold.count30d,
              soldCount90d:      count90d,
              medianSoldPrice:   sold.medianPrice,
              avgSoldPrice:      sold.avgPrice,
              soldPriceMin30d:   sold.minPrice,
              soldPriceMax30d:   sold.maxPrice,
              lastSoldPrice:     sold.lastSoldPrice,
              lastSoldAt:        sold.lastSoldAt,
              soldPriceTrend:    sold.trend,
              soldDataUpdatedAt: new Date(),
              soldEarliestAt:    sold.earliestSoldAt ?? null,
            },
            $setOnInsert: {
              activeListingsNow: 0,
              dataStartedAt:     new Date(),
            },
          },
          upsert: true,
        },
      });
    }

    if (ops.length) {
      await SkinMetrics.bulkWrite(ops, { ordered: false });
      updatedCount = ops.length;
    }

    const elapsedMs = Date.now() - start;
    console.log(
      `[SKIN_METRICS] aggregated ${updatedCount} skin(s), ` +
      `scanned ${totalScanned} listing snapshot(s), ` +
      `${totalSoldScanned} sold record(s) in ${elapsedMs}ms`
    );
  } catch (err) {
    console.error("[SKIN_METRICS] aggregation error:", err?.message || err);
  }
}

export function startSkinMetricsAggregator() {
  runSkinMetricsAggregation().catch((e) =>
    console.error("[SKIN_METRICS] initial run error:", e?.message)
  );

  const interval = setInterval(() => {
    runSkinMetricsAggregation().catch((e) =>
      console.error("[SKIN_METRICS] scheduled run error:", e?.message)
    );
  }, INTERVAL_MS);

  interval.unref();
  console.log("⏱️  [SKIN_METRICS] aggregator scheduled (every 1 hour)");
}
