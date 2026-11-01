// Phase 1 — REST vs WebSocket price consistency.
// The REST normalizer (controllers/empire.controllers.js) must put the same
// Empire field into priceCoins as the WS normalizer (services/marketCache.js):
// purchase_price. Fixtures marked "verbatim" are Empire's documented examples
// (https://docs.csgoempire.com/reference/get-listed-items.md and
//  https://docs.csgoempire.com/reference/websocket-events.md, updated_item).
// Pure functions + the in-memory market cache only — no network, no DB.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

const { normalizeItem: normalizeRest } = await import("./empire.controllers.js");
const {
  normalizeItem: normalizeWs,
  upsertIntoCache,
  batchUpsertIntoCache,
  getAllFromCache,
  resetMarketCache,
} = await import("../services/marketCache.js");
const { matchesWatchRule } = await import("../services/watchMatcher.js");

// Verbatim (price fields) — get-listed-items example: auction listing, no bids.
const LISTED_NO_BIDS = {
  above_recommended_price: -6,
  auction_ends_at: 1738082771,
  auction_highest_bid: null,
  auction_highest_bidder: null,
  auction_number_of_bids: 0,
  id: 288772289,
  is_commodity: false,
  market_name: "Charm | Backsplash",
  market_value: 26,
  price_is_unreliable: false,
  purchase_price: 26,
  suggested_price: 28,
  wear: null,
  wear_name: null,
};

// Verbatim (price fields) — WS updated_item example: auction with one bid.
const AUCTION_WITH_BID = {
  auction_ends_at: 1738068984,
  auction_highest_bid: 72967,
  auction_highest_bidder: 4323412,
  auction_number_of_bids: 1,
  market_name: "Souvenir MP9 | Hot Rod (Factory New)",
  market_value: 72967,
  price_is_unreliable: false,
  suggested_price: 77345,
  wear: 0.398,
  id: 13299,
  above_recommended_price: -5,
  purchase_price: 73697,
  wear_name: "Factory New",
};

// Synthetic buy-now listing (no auction fields), equal fields — Empire has no
// documented pure buy-now example; equality is an assumption, not a fact.
const BUY_NOW = {
  id: 91000001,
  market_name: "AK-47 | Redline (Field-Tested)",
  wear_name: "Field-Tested",
  market_value: 1234,
  purchase_price: 1234,
  suggested_price: 1400,
  auction_ends_at: null,
};

const clone = (o) => JSON.parse(JSON.stringify(o));

beforeEach(() => resetMarketCache());

// ── REST normalizer prefers purchase_price ──────────────────────────────────
test("REST: auction with bid (verbatim) → priceCoins from purchase_price, market_value kept separately", () => {
  const it = normalizeRest(AUCTION_WITH_BID);
  assert.equal(it.priceCoins, 736.97);
  assert.equal(it.priceCents, 73697);
  assert.equal(it.price, 736.97);
  assert.equal(it.marketValueCoins, 729.67);
  assert.equal(it.suggestedCoins, 773.45);
  assert.equal(it.discountPct, 4.72);
});

test("REST: listed item without bids (verbatim) → purchase_price (equal to market_value)", () => {
  const it = normalizeRest(LISTED_NO_BIDS);
  assert.equal(it.priceCoins, 0.26);
  assert.equal(it.marketValueCoins, 0.26);
  assert.equal(it.suggestedCoins, 0.28);
  assert.equal(it.discountPct, 7.14);
});

test("REST: buy-now listing → purchase_price", () => {
  const it = normalizeRest(BUY_NOW);
  assert.equal(it.priceCoins, 12.34);
  assert.equal(it.marketValueCoins, 12.34);
});

test("REST: purchase_price wins even if market_value differs on a buy-now listing", () => {
  const it = normalizeRest({ ...BUY_NOW, market_value: 1200, purchase_price: 1234 });
  assert.equal(it.priceCoins, 12.34);
  assert.equal(it.marketValueCoins, 12);
});

// ── Missing purchase_price: previous behavior preserved ─────────────────────
test("REST: no purchase_price → previous order price → market_value → suggested_price", () => {
  assert.equal(normalizeRest({ market_value: 500, suggested_price: 600 }).priceCoins, 5);
  assert.equal(normalizeRest({ price: 700, market_value: 500 }).priceCoins, 7);
  assert.equal(normalizeRest({ suggested_price: 900 }).priceCoins, 9);
  assert.equal(normalizeRest({}).priceCoins, 0);
  assert.equal(normalizeRest({ market_value: 500 }).marketValueCoins, 5);
  assert.equal(normalizeRest({ price: 700 }).marketValueCoins, null);
});

test("REST: purchase_price null/undefined falls back exactly as before", () => {
  assert.equal(normalizeRest({ purchase_price: null, market_value: 500 }).priceCoins, 5);
  assert.equal(normalizeRest({ purchase_price: undefined, market_value: 500 }).priceCoins, 5);
});

test("REST: purchase_price 0 is taken as-is (?? semantics, same as the WS normalizer)", () => {
  assert.equal(normalizeRest({ purchase_price: 0, market_value: 500 }).priceCoins, 0);
  assert.equal(normalizeWs({ purchase_price: 0, market_value: 500 }).priceCoins, 0);
});

// ── REST and WS agree on the same raw listing ───────────────────────────────
for (const [label, raw] of [["auction with bid", AUCTION_WITH_BID], ["listed, no bids", LISTED_NO_BIDS], ["buy-now", BUY_NOW]]) {
  test(`REST/WS consistency (${label}): priceCoins, suggestedCoins and discountPct identical`, () => {
    const rest = normalizeRest(clone(raw));
    const ws = normalizeWs(clone(raw));
    assert.equal(rest.priceCoins, ws.priceCoins);
    assert.equal(rest.suggestedCoins, ws.suggestedCoins);
    assert.equal(rest.discountPct, ws.discountPct);
  });

  test(`REST/WS consistency (${label}): the fallback engine's REST→cache shape matches WS`, () => {
    // alertEngine.js maps fetchMarket items through marketCache.normalizeItem
    const viaRest = normalizeWs(normalizeRest(clone(raw)));
    const ws = normalizeWs(clone(raw));
    assert.equal(viaRest.priceCoins, ws.priceCoins);
    assert.equal(viaRest.discountPct, ws.discountPct);
  });
}

// ── Cache: a REST refresh cannot replace the WS price with a different field ─
const cachedPrice = (id) => getAllFromCache().find((x) => String(x.itemId) === String(id))?.priceCoins;

test("cache: WS then REST refresh (market worker path) keeps the purchase_price-based price", () => {
  upsertIntoCache(clone(AUCTION_WITH_BID));
  assert.equal(cachedPrice(13299), 736.97);
  batchUpsertIntoCache([normalizeRest(clone(AUCTION_WITH_BID))]);
  assert.equal(cachedPrice(13299), 736.97);
});

test("cache: REST then WS gives the same price in either order", () => {
  batchUpsertIntoCache([normalizeRest(clone(AUCTION_WITH_BID))]);
  assert.equal(cachedPrice(13299), 736.97);
  upsertIntoCache(clone(AUCTION_WITH_BID));
  assert.equal(cachedPrice(13299), 736.97);
});

test("cache: REST refresh keeps marketValueCoins available on the cached item", () => {
  upsertIntoCache(clone(AUCTION_WITH_BID));
  batchUpsertIntoCache([normalizeRest(clone(AUCTION_WITH_BID))]);
  const cached = getAllFromCache().find((x) => String(x.itemId) === "13299");
  assert.equal(cached.marketValueCoins, 729.67);
});

// ── Same target-price decision by either ingestion path ─────────────────────
test("matcher: target between market_value and purchase_price gives the same decision via REST and WS", () => {
  const rule = { _id: "r", userId: "u", baseName: "MP9 | Hot Rod", marketHashName: "MP9 | Hot Rod (Factory New)", wear: "Factory New", variant: "SOUVENIR" };
  for (const targetPrice of [729.67, 730, 736.96, 736.97, 737]) {
    const viaRest = normalizeWs(normalizeRest(clone(AUCTION_WITH_BID)));
    const viaWs = normalizeWs(clone(AUCTION_WITH_BID));
    assert.equal(
      matchesWatchRule(viaRest, { ...rule, targetPrice }),
      matchesWatchRule(viaWs, { ...rule, targetPrice }),
      `targetPrice=${targetPrice}`
    );
  }
  assert.equal(matchesWatchRule(normalizeWs(normalizeRest(clone(AUCTION_WITH_BID))), { ...rule, targetPrice: 730 }), false);
  assert.equal(matchesWatchRule(normalizeWs(normalizeRest(clone(AUCTION_WITH_BID))), { ...rule, targetPrice: 736.97 }), true);
});
