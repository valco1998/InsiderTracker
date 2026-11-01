import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDealScore } from "./dealScore.js";

const ITEM = { priceCoins: 100, discountPct: 10 };

function metricsWith(tier, tierSource, overrides = {}) {
  return {
    tier,
    tierSource,
    soldCount30d:   20,
    soldCount90d:   40,
    soldEarliestAt: new Date(Date.now() - 60 * 86_400_000),
    lastSoldAt:     new Date(),
    listingCount7d: 30,
    ...overrides,
  };
}

// ── Liquidity wording: sold_history vs listing_proxy ─────────────────────────

test("liquidity detail is qualitative and confirmed-sourced when tierSource is sold_history", () => {
  const result = computeDealScore(ITEM, metricsWith("active", "sold_history"));
  assert.equal(result.factors.liquidity.detail, "Active market — confirmed from sales history");
  assert.equal(result.factors.liquidity.source, "sold_history");
  assert.doesNotMatch(result.factors.liquidity.detail, /\d/); // no transaction counts in the wording
});

test("liquidity detail is qualitative and estimate-flagged when tierSource is listing_proxy", () => {
  const result = computeDealScore(ITEM, metricsWith("active", "listing_proxy"));
  assert.equal(result.factors.liquidity.detail, "Active market — estimated from listing activity (7d)");
  assert.equal(result.factors.liquidity.source, "listing_proxy");
});

test("liquidity wording covers thin and rare tiers for both sources", () => {
  const cases = [
    ["thin", "sold_history",  "Thin market — confirmed from sales history"],
    ["thin", "listing_proxy", "Thin market — estimated from listing activity (7d)"],
    ["rare", "sold_history",  "Rare item — confirmed from sales history"],
    ["rare", "listing_proxy", "Rare item — estimated from listing activity (7d)"],
  ];
  for (const [tier, tierSource, expected] of cases) {
    const result = computeDealScore(ITEM, metricsWith(tier, tierSource));
    assert.equal(result.factors.liquidity.detail, expected);
  }
});

// ── The actual score/weight must be identical regardless of source ───────────
// This is the core guarantee from the plan: tierSource only changes display
// text, never the number DealScore actually computes.

test("liquidity score is identical for sold_history and listing_proxy given the same tier", () => {
  const soldResult    = computeDealScore(ITEM, metricsWith("active", "sold_history"));
  const proxyResult    = computeDealScore(ITEM, metricsWith("active", "listing_proxy"));
  assert.equal(soldResult.factors.liquidity.score, proxyResult.factors.liquidity.score);
  assert.equal(soldResult.factors.liquidity.weight, proxyResult.factors.liquidity.weight);
  assert.equal(soldResult.score, proxyResult.score);
});

// ── Backward compatibility during the aggregator backfill window ─────────────

test("missing tierSource on a stale/not-yet-backfilled document falls back to null detail, not a crash", () => {
  const metrics = metricsWith("active", undefined);
  delete metrics.tierSource;
  const result = computeDealScore(ITEM, metrics);
  assert.equal(result.factors.liquidity.detail, null);
  assert.equal(result.factors.liquidity.source, "none");
  // Score is still computed from tier alone — liquidity isn't dropped just because tierSource is missing
  assert.equal(result.factors.liquidity.score, 80);
});

test("no_data tier produces no liquidity factor at all (unchanged pre-existing behavior)", () => {
  const result = computeDealScore(ITEM, metricsWith("no_data", "none"));
  assert.equal(result.factors.liquidity, null);
});
