// Phase 2 — auction price contract (all Empire amounts in coincents, 100 = 1 coin).
// priceCoins = ACTIONABLE price on Empire now:
//   highest bid H known → next valid bid = max(H + 1, round½↑(H × 1.01))
//     (Place Bid docs: "exactly 1% above the previous bid, if any. The minimum
//      increment is 1 coincent … rounding … half away from zero")
//   no bids → starting price (purchase_price / REST priceCents)
//   bids but H unknown → purchase_price from the same event only
//   otherwise → estimate (priceIsEstimate) — never used for profit alerts.
// Fixtures use Empire's documented price fields; auction_ends_at is moved into
// the future so the cache does not expire them. In-memory only — no network/DB.
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

const { upsertAuction, removeAuction, queryAuctions, nextBidCents } = await import("./auctionCache.js");
const { normalizeItem: normalizeRest } = await import("../controllers/empire.controllers.js");

const FUTURE = Math.floor(Date.now() / 1000) + 3600;
let seq = 1;
const nextId = () => 93_000_000 + seq++;

// get-listed-items example: auction listing, no bids (verbatim price fields)
const noBids = (id) => ({
  id, market_name: "Charm | Backsplash", auction_ends_at: FUTURE,
  auction_highest_bid: null, auction_highest_bidder: null, auction_number_of_bids: 0,
  market_value: 26, purchase_price: 26, suggested_price: 28, above_recommended_price: -6,
});
// websocket-events updated_item example: auction with one bid (verbatim price fields)
const withBid = (id) => ({
  id, market_name: "Souvenir MP9 | Hot Rod (Factory New)", wear_name: "Factory New", auction_ends_at: FUTURE,
  auction_highest_bid: 72967, auction_highest_bidder: 4323412, auction_number_of_bids: 1,
  market_value: 72967, purchase_price: 73697, suggested_price: 77345, above_recommended_price: -5,
});
// auction_update: documented partial payload (bid fields only)
const bidUpdate = (id, bid, bids) => ({
  id, above_recommended_price: -5, auction_highest_bid: bid, auction_highest_bidder: 1,
  auction_number_of_bids: bids, auction_ends_at: FUTURE,
});

// ── Next-bid rule ────────────────────────────────────────────────────────────
test("nextBidCents follows Empire's documented rule and examples", () => {
  assert.equal(nextBidCents(72967), 73697);   // == purchase_price in the documented WS example
  assert.equal(nextBidCents(64), 65);         // Place Bid example value, 1% < 1 coincent → +1
  assert.equal(nextBidCents(1), 2);           // minimum increment 1 coincent
  assert.equal(nextBidCents(50), 51);         // 50.5 → half away from zero
  assert.equal(nextBidCents(150), 152);       // 151.5 → 152
  assert.equal(nextBidCents(10000), 10100);   // exact 1%
  for (let h = 1; h <= 200000; h += 7) {
    assert.equal(nextBidCents(h), Math.max(h + 1, Math.round(h * 1.01)), `h=${h}`);
  }
});

// ── New auctions ────────────────────────────────────────────────────────────
test("new auction without bids: actionable price = starting price (purchase_price)", () => {
  const id = nextId();
  const a = upsertAuction(noBids(id));
  assert.equal(a.priceCoins, 0.26);
  assert.equal(a.priceSource, "starting_price");
  assert.equal(a.priceIsEstimate, false);
  assert.equal(a.currentBidCoins, null);
  assert.equal(a.suggestedCoins, 0.28);
  assert.equal(a.discountPct, 7);
  removeAuction(id);
});

test("new auction with a bid: actionable price = next valid bid (equals documented purchase_price)", () => {
  const id = nextId();
  const a = upsertAuction(withBid(id));
  assert.equal(a.priceCoins, 736.97);
  assert.equal(a.priceSource, "next_bid");
  assert.equal(a.currentBidCoins, 729.67);
  assert.equal(a.priceIsEstimate, false);
  assert.equal(a.auction.bids, 1);
  removeAuction(id);
});

// ── Bid updates ─────────────────────────────────────────────────────────────
test("auction_update: bid and actionable price both follow the new bid; reference fields carried", () => {
  const id = nextId();
  upsertAuction(withBid(id));
  const a = upsertAuction(bidUpdate(id, 74000, 2));
  assert.equal(a.currentBidCoins, 740);
  assert.equal(a.priceCoins, 747.4);            // nextBid(74000) = 74740
  assert.equal(a.priceSource, "next_bid");
  assert.equal(a.auction.bids, 2);
  assert.equal(a.auction.highest_bid, 74000);
  assert.equal(a.suggestedCoins, 773.45);       // carried from the full event
  assert.equal(a.name, "Souvenir MP9 | Hot Rod (Factory New)");
  removeAuction(id);
});

test("first bid on a no-bid auction: price moves from starting price to next bid", () => {
  const id = nextId();
  upsertAuction(noBids(id));
  const a = upsertAuction(bidUpdate(id, 26, 1));
  assert.equal(a.currentBidCoins, 0.26);
  assert.equal(a.priceCoins, 0.27);             // nextBid(26) = max(27, 26.26→26) = 27
  assert.equal(a.priceSource, "next_bid");
  removeAuction(id);
});

test("stale purchase_price in a later full event cannot lower the price below the next bid", () => {
  const id = nextId();
  upsertAuction(withBid(id));
  upsertAuction(bidUpdate(id, 74000, 2));
  // full event with the same bid count but an older purchase_price
  const a = upsertAuction({ ...withBid(id), auction_highest_bid: 74000, auction_number_of_bids: 2, purchase_price: 73697 });
  assert.equal(a.priceCoins, 747.4);            // computed from the bid, not the stale field
  removeAuction(id);
});

test("queryAuctions filters and sorts on the actionable price", () => {
  const id = nextId();
  upsertAuction(withBid(id));
  upsertAuction(bidUpdate(id, 74000, 2));
  const hit = queryAuctions({ search: "hot rod", minPrice: "747.4", maxPrice: "747.4" }).items.find((x) => x.itemId === String(id));
  assert.ok(hit, "found at its actionable price");
  removeAuction(id);
});

// ── Partial and out-of-order events ─────────────────────────────────────────
test("partial first (auction_update before new_item): next bid is known immediately; suggested unknown until full event", () => {
  const id = nextId();
  const first = upsertAuction(bidUpdate(id, 72967, 1));
  assert.equal(first.priceCoins, 736.97);
  assert.equal(first.priceSource, "next_bid");
  assert.equal(first.suggestedCoins, null);     // no reference price yet → no profit claim
  const full = upsertAuction(withBid(id));
  assert.equal(full.priceCoins, 736.97);
  assert.equal(full.suggestedCoins, 773.45);
  removeAuction(id);
});

test("stale full event (fewer bids than cached) cannot roll back bid, bid count or price", () => {
  const id = nextId();
  upsertAuction(withBid(id));
  upsertAuction(bidUpdate(id, 75000, 3));
  const a = upsertAuction(withBid(id));         // older snapshot: 1 bid at 72967
  assert.equal(a.currentBidCoins, 750);
  assert.equal(a.priceCoins, 757.5);            // nextBid(75000) = 75750
  assert.equal(a.auction.bids, 3);
  assert.equal(a.auction.highest_bid, 75000);
  removeAuction(id);
});

test("stale auction_update (older bid) is ignored", () => {
  const id = nextId();
  upsertAuction(withBid(id));
  upsertAuction(bidUpdate(id, 75000, 3));
  const a = upsertAuction(bidUpdate(id, 74000, 2));
  assert.equal(a.currentBidCoins, 750);
  assert.equal(a.auction.bids, 3);
  assert.equal(a.priceCoins, 757.5);
  removeAuction(id);
});

test("event without bid value keeps the cached bid and price", () => {
  const id = nextId();
  upsertAuction(withBid(id));
  const a = upsertAuction({ id, auction_ends_at: FUTURE, auction_number_of_bids: 1 });
  assert.equal(a.currentBidCoins, 729.67);
  assert.equal(a.priceCoins, 736.97);
  assert.equal(a.priceIsEstimate, false);
  removeAuction(id);
});

// ── Missing fields → estimates, never profit claims ─────────────────────────
test("bids reported but no bid value and no purchase_price → estimate", () => {
  const id = nextId();
  const a = upsertAuction({ id, market_name: "X", auction_ends_at: FUTURE, auction_number_of_bids: 2, market_value: 5000 });
  assert.equal(a.priceIsEstimate, true);
  assert.equal(a.priceSource, "estimate");
  assert.equal(a.discountPct, 0);
  removeAuction(id);
});

test("only market_value, no bids → estimate", () => {
  const id = nextId();
  const a = upsertAuction({ id, market_name: "X", auction_ends_at: FUTURE, market_value: 5000, suggested_price: 9000 });
  assert.equal(a.priceIsEstimate, true);
  assert.equal(a.discountPct, 0);
  removeAuction(id);
});

test("no price fields at all → none, estimate, price 0", () => {
  const id = nextId();
  const a = upsertAuction({ id, market_name: "X", auction_ends_at: FUTURE });
  assert.equal(a.priceSource, "none");
  assert.equal(a.priceIsEstimate, true);
  assert.equal(a.priceCoins, 0);
  removeAuction(id);
});

test("suggested is never derived from market_value or a price", () => {
  const id = nextId();
  const a = upsertAuction({ ...withBid(id), suggested_price: undefined });
  assert.equal(a.suggestedCoins, null);
  removeAuction(id);
});

// ── REST-normalized items (auctionWorker path) ──────────────────────────────
test("auctionWorker item with a whole-coin price: correct coins (no /100 misread)", () => {
  const id = nextId();
  const rest = normalizeRest({ id, market_name: "AK-47 | Redline (Field-Tested)", purchase_price: 1200, market_value: 1200, suggested_price: 1500, auction_ends_at: FUTURE, auction_number_of_bids: 0 });
  const a = upsertAuction(rest);
  assert.equal(a.priceCoins, 12);
  assert.equal(a.priceSource, "starting_price");
  assert.equal(a.suggestedCoins, 15);           // REST suggestedCents accepted
  removeAuction(id);
});

test("auctionWorker item with a bid: next bid from auction.highest_bid", () => {
  const id = nextId();
  const rest = normalizeRest({ ...withBid(id) });
  const a = upsertAuction(rest);
  assert.equal(a.currentBidCoins, 729.67);
  assert.equal(a.priceCoins, 736.97);
  assert.equal(a.priceSource, "next_bid");
  removeAuction(id);
});

// ── Alert engine: thresholds on the actionable price ────────────────────────
const created = [];
let RULES = [];
before(async () => {
  const { default: AuctionAlertRule } = await import("../models/AuctionAlertRule.model.js");
  const { default: AlertState } = await import("../models/AlertState.js");
  const { default: AlertLog } = await import("../models/alertLog.models.js");
  const { default: NotificationEvent } = await import("../models/NotificationEvent.model.js");
  AuctionAlertRule.find = () => ({ lean: async () => RULES });
  AlertState.findOneAndUpdate = async () => ({});
  AlertLog.create = async (d) => { created.push(d); return { _id: new mongoose.Types.ObjectId(), ...d }; };
  AlertLog.updateOne = () => Promise.resolve({});
  NotificationEvent.create = () => Promise.resolve({});
});
beforeEach(() => { created.length = 0; });

async function runEngine(item, ruleFields) {
  const engine = await import("./auctionAlertEngine.js");
  RULES = [{ _id: new mongoose.Types.ObjectId(), userId: new mongoose.Types.ObjectId(), enabled: true, cooldownMin: 10, ...ruleFields }];
  engine.invalidateAuctionRulesCache();
  return engine.processAuctionAlerts([item]);
}

test("engine: profit = suggested − next bid; minProfitCoins boundary", async () => {
  const id = nextId();
  const item = upsertAuction(withBid(id));        // next bid 736.97, suggested 773.45 → profit 36.48
  assert.equal((await runEngine(item, { minProfitCoins: 36.48 })).matched, 1);
  assert.equal(created[0].priceCoins, 736.97);   // AlertLog / push "Bid" = next bid
  assert.equal(created[0].suggestedCoins, 773.45);
  assert.equal((await runEngine(item, { minProfitCoins: 36.49 })).matched, 0);
  removeAuction(id);
});

test("engine: minProfitPct and maxBidPrice use the next bid", async () => {
  const id = nextId();
  const item = upsertAuction(withBid(id));        // profitPct = 36.48 / 773.45 = 4.716%
  assert.equal((await runEngine(item, { minProfitCoins: 0, minProfitPct: 4.7 })).matched, 1);
  assert.equal((await runEngine(item, { minProfitCoins: 0, minProfitPct: 4.8 })).matched, 0);
  assert.equal((await runEngine(item, { minProfitCoins: 0, maxBidPrice: 736.97 })).matched, 1);
  assert.equal((await runEngine(item, { minProfitCoins: 0, maxBidPrice: 736.96 })).matched, 0);
  removeAuction(id);
});

test("engine: after a bid update the profit shrinks with the new next bid", async () => {
  const id = nextId();
  upsertAuction(withBid(id));
  const item = upsertAuction(bidUpdate(id, 74000, 2)); // next bid 747.40 → profit 26.05
  assert.equal((await runEngine(item, { minProfitCoins: 26.05 })).matched, 1);
  assert.equal((await runEngine(item, { minProfitCoins: 26.06 })).matched, 0);
  removeAuction(id);
});

test("engine: no-bid auction uses the starting price", async () => {
  const id = nextId();
  const item = upsertAuction(noBids(id));          // 0.26 vs 0.28 → profit 0.02
  assert.equal((await runEngine(item, { minProfitCoins: 0.02 })).matched, 1);
  assert.equal(created[0].priceCoins, 0.26);
  removeAuction(id);
});

test("engine: estimated price or missing reference → no profit alert", async () => {
  const id = nextId();
  const est = upsertAuction({ id, market_name: "X", auction_ends_at: FUTURE, auction_number_of_bids: 2, market_value: 5000, suggested_price: 900000 });
  assert.equal((await runEngine(est, { minProfitCoins: 0 })).matched, 0);
  removeAuction(id);
  const id2 = nextId();
  const noRef = upsertAuction(bidUpdate(id2, 72967, 1)); // no suggested yet
  assert.equal((await runEngine(noRef, { minProfitCoins: 0 })).matched, 0);
  removeAuction(id2);
  assert.equal(created.length, 0);
});
