import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeTier,
  buildGroupKey,
  createPriceGroup,
  accumulatePriceDoc,
  finalizePriceGroup,
} from "./skinMetricsAggregator.js";

// ── computeTier ───────────────────────────────────────────────────────────────

test("computeTier: sold_history branch fires once soldCount30d >= 5, regardless of listing volume", () => {
  assert.deepEqual(computeTier(0, 15), { tier: "active", source: "sold_history" }); // 15/30 = 0.5/day
  assert.deepEqual(computeTier(0, 5),  { tier: "thin",   source: "sold_history" }); // 5/30 ≈ 0.167/day
  assert.deepEqual(computeTier(999, 5), { tier: "thin",  source: "sold_history" }); // sold data wins over listing volume
});

test("computeTier: falls back to listing_proxy when soldCount30d is null/insufficient", () => {
  assert.deepEqual(computeTier(0, null), { tier: "no_data", source: "none" });
  assert.deepEqual(computeTier(0, 0),    { tier: "no_data", source: "none" });
  assert.deepEqual(computeTier(4, 4),    { tier: "no_data", source: "none" }); // both below MIN_DATA_POINTS(5)
  assert.deepEqual(computeTier(21, 0),   { tier: "active",  source: "listing_proxy" }); // 21/7 = 3/day
  assert.deepEqual(computeTier(5, 0),    { tier: "thin",    source: "listing_proxy" }); // 5/7 ≈ 0.71/day (≥5 clears MIN_DATA_POINTS)
  assert.deepEqual(computeTier(4, null), { tier: "no_data", source: "none" }); // listingCount7d < MIN_DATA_POINTS(5)
  assert.deepEqual(computeTier(1, 0),    { tier: "no_data", source: "none" }); // below MIN_DATA_POINTS(5) entirely
});

test("computeTier: listing_proxy 'rare' tier is unreachable given MIN_DATA_POINTS=5 (pre-existing behavior, not changed here)", () => {
  // avgPerDay >= 0.3 requires listingCount7d >= 2.1, but the no_data gate already
  // requires listingCount7d >= MIN_DATA_POINTS(5) to reach this branch at all —
  // so the minimum possible avgPerDay here is 5/7 ≈ 0.71, always above the 0.3
  // "rare" cutoff. This pins that existing (unrelated to this change) behavior.
  assert.deepEqual(computeTier(5, 0), { tier: "thin", source: "listing_proxy" });
});

// ── buildGroupKey ─────────────────────────────────────────────────────────────

test("buildGroupKey normalizes null/undefined wear to the same empty-string key", () => {
  assert.equal(buildGroupKey("AK-47 | Redline", null), "AK-47 | Redline|||");
  assert.equal(buildGroupKey("AK-47 | Redline", undefined), "AK-47 | Redline|||");
  assert.equal(buildGroupKey("AK-47 | Redline", "Field-Tested"), "AK-47 | Redline|||Field-Tested");
});

// ── accumulatePriceDoc / finalizePriceGroup ──────────────────────────────────
// These two replace the old $group+$push stage — every case below mirrors a
// specific native-accumulator behavior the old pipeline relied on.

test("finalizePriceGroup matches native $avg/$min/$max/$sum over an all-valid group", () => {
  const g = createPriceGroup("AK-47 | Redline", "Field-Tested");
  for (const doc of [
    { priceCoins: 10, discountPct: 5,  floatValue: 0.20 },
    { priceCoins: 20, discountPct: 15, floatValue: 0.22 },
    { priceCoins: 15, discountPct: 10, floatValue: 0.18 },
  ]) accumulatePriceDoc(g, doc);

  const out = finalizePriceGroup(g);
  assert.equal(out.count, 3);
  assert.equal(out.avgPrice, 15);
  assert.equal(out.minPrice, 10);
  assert.equal(out.maxPrice, 20);
  assert.equal(out.avgDiscount, 10);
  assert.deepEqual(out._id, { marketHashName: "AK-47 | Redline", wear: "Field-Tested" });
  assert.deepEqual([...out.prices].sort((a, b) => a - b), [10, 15, 20]);
});

test("finalizePriceGroup: docCount counts every matched doc even if price/discount are invalid (matches $sum:1 over the whole $match, not just valid rows)", () => {
  const g = createPriceGroup("Sticker | Foo", null);
  accumulatePriceDoc(g, { priceCoins: 10, discountPct: 5, floatValue: null });
  accumulatePriceDoc(g, { priceCoins: null, discountPct: undefined, floatValue: null }); // invalid price/discount
  accumulatePriceDoc(g, { priceCoins: NaN, discountPct: "bad", floatValue: null });

  const out = finalizePriceGroup(g);
  assert.equal(out.count, 3); // every doc counted, matching $sum:1 semantics
  assert.equal(out.avgPrice, 10); // only the one valid price counted, like native $avg ignoring non-numeric
  assert.equal(out.minPrice, 10);
  assert.equal(out.maxPrice, 10);
  assert.equal(out.avgDiscount, 5);
});

test("finalizePriceGroup returns null price/discount stats when a group has zero valid values (matches native $avg/$min/$max over an empty set)", () => {
  const g = createPriceGroup("Weird | Item", null);
  accumulatePriceDoc(g, { priceCoins: null, discountPct: null, floatValue: null });

  const out = finalizePriceGroup(g);
  assert.equal(out.count, 1);
  assert.equal(out.avgPrice, null);
  assert.equal(out.minPrice, null);
  assert.equal(out.maxPrice, null);
  assert.equal(out.avgDiscount, null);
});

test("finalizePriceGroup: floatValues array preserves nulls as-is (downstream filter, unchanged, is responsible for excluding them)", () => {
  const g = createPriceGroup("AWP | Asiimov", "Field-Tested");
  accumulatePriceDoc(g, { priceCoins: 100, discountPct: 0, floatValue: 0.30 });
  accumulatePriceDoc(g, { priceCoins: 110, discountPct: 0, floatValue: null });
  accumulatePriceDoc(g, { priceCoins: 105, discountPct: 0, floatValue: 0.25 });

  const out = finalizePriceGroup(g);
  assert.deepEqual(out.floatValues, [0.30, null, 0.25]);

  // Reproduces the exact downstream filtering logic in runSkinMetricsAggregation()
  const floats = out.floatValues.filter((f) => f != null && Number.isFinite(f));
  assert.deepEqual(floats, [0.30, 0.25]);
});

// ── End-to-end: scanPriceSnapshots7d's Map-based grouping reproduces the same
// per-key partitioning a Mongo $group on {marketHashName, wear} would produce ──

test("accumulatePriceDoc groups by the exact same key across repeated docs for the same skin+wear", () => {
  const groupMap = new Map();
  const docs = [
    { marketHashName: "M4A4 | Howl", wear: "Factory New", priceCoins: 1000, discountPct: 0, floatValue: 0.01 },
    { marketHashName: "M4A4 | Howl", wear: "Factory New", priceCoins: 1100, discountPct: 5, floatValue: 0.02 },
    { marketHashName: "M4A4 | Howl", wear: "Minimal Wear", priceCoins: 500, discountPct: 0, floatValue: 0.10 },
  ];
  for (const doc of docs) {
    const key = buildGroupKey(doc.marketHashName, doc.wear);
    let g = groupMap.get(key);
    if (!g) { g = createPriceGroup(doc.marketHashName, doc.wear); groupMap.set(key, g); }
    accumulatePriceDoc(g, doc);
  }

  assert.equal(groupMap.size, 2);
  const fn = finalizePriceGroup(groupMap.get("M4A4 | Howl|||Factory New"));
  assert.equal(fn.count, 2);
  assert.equal(fn.avgPrice, 1050);
  const mw = finalizePriceGroup(groupMap.get("M4A4 | Howl|||Minimal Wear"));
  assert.equal(mw.count, 1);
  assert.equal(mw.avgPrice, 500);
});
