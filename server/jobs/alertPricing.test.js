// C1 regression tests — price/suggested values must never be divided by 100
// a second time. Drives BOTH engines end to end:
//   live     = processLiveItemForAlerts (controllers/alerts.controller.js)
//   fallback = scanWatchRules, warm-cache path (jobs/alertEngine.js)
// with Empire-shaped listings (cents) normalized by the real marketCache.
// Mongoose statics are stubbed in memory (no DB); FCM is not initialized (no
// push is sent); price_alert emits are captured on the real Socket.IO server.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

delete process.env.WATCHLIST_DEBUG_RULE_IDS;

const { default: WatchRule }  = await import("../models/WatchRule.model.js");
const { default: AlertState } = await import("../models/AlertState.js");
const { default: AlertLog }   = await import("../models/alertLog.models.js");
const { default: NotificationEvent } = await import("../models/NotificationEvent.model.js");
const { normalizeItem, upsertIntoCache, resetMarketCache } = await import("../services/marketCache.js");
const { buildAlertPushPayload } = await import("../utils/pushNotificationFormat.js");
const { initSocket, getIO } = await import("../socket/socket.js");
const live = await import("../controllers/alerts.controller.js");
const engine = await import("./alertEngine.js");

// ── In-memory stand-ins ─────────────────────────────────────────────────────
const STATE = new Map();
const LOGS = [];
const EMITS = [];
let RULES = [];
const stateKey = (f) => `${f.userId}|${f.ruleId}|${f.itemId}`;

before(() => {
  const io = initSocket();
  const origTo = io.to.bind(io);
  io.to = (room) => {
    const op = origTo(room);
    return { emit: (event, payload) => { if (event === "price_alert") EMITS.push(payload); return op.emit(event, payload); } };
  };
});

after(() => { getIO().close(); });

beforeEach(() => {
  STATE.clear(); LOGS.length = 0; EMITS.length = 0; RULES = [];
  resetMarketCache();
  live.invalidateLiveRuleCache();
  WatchRule.find = () => ({ lean: async () => RULES });
  WatchRule.updateOne = () => Promise.resolve({});
  AlertState.findOne = (f) => ({ lean: async () => (STATE.has(stateKey(f)) ? { ...STATE.get(stateKey(f)) } : null) });
  AlertState.updateOne = async () => ({});
  AlertState.findOneAndUpdate = async (f, u) => {
    const k = stateKey(f);
    const cur = STATE.get(k);
    const expired = !cur || cur.lastNotifiedAt == null || cur.lastNotifiedAt < f.$or[1].lastNotifiedAt.$lt;
    if (!expired) throw Object.assign(new Error("E11000"), { code: 11000 });
    STATE.set(k, { ...(cur || {}), ...u.$setOnInsert, ...u.$set });
    return {};
  };
  AlertLog.create = async (doc) => {
    const m = new AlertLog(doc);
    const err = m.validateSync();
    if (err) throw err;
    const o = m.toObject();
    LOGS.push(o);
    return { ...o, toObject: () => ({ ...o }) };
  };
  AlertLog.updateOne = () => Promise.resolve({});
  NotificationEvent.create = () => Promise.resolve({});
});

// ── Fixtures ────────────────────────────────────────────────────────────────
let seq = 1;
function makeRule() {
  return {
    _id: new mongoose.Types.ObjectId(),
    userId: new mongoose.Types.ObjectId(),
    baseName: "AWP | Dragon Lore",
    marketHashName: "AWP | Dragon Lore (Factory New)",
    wear: "Factory New",
    cooldownMin: 5,
  };
}
// Empire-shaped raw listing: prices in cents, as Empire sends them.
function empireRaw(coins, suggestedCoins, id = 70_000_000 + seq++) {
  return {
    id,
    market_name: "AWP | Dragon Lore (Factory New)",
    wear_name: "Factory New",
    purchase_price: Math.round(coins * 100),
    suggested_price: Math.round(suggestedCoins * 100),
    market_value: Math.round(coins * 100),
  };
}

const ENGINES = {
  live: async (raw) => {
    await live.default(normalizeItem(raw), { source: "empire-ws:new_item" });
  },
  fallback: async (raw) => {
    upsertIntoCache(raw);            // warm cache → scanWatchRules uses searchInCache, no network
    await engine.scanWatchRules();
  },
};

function pushBody(log) {
  return buildAlertPushPayload({
    type: "price_alert", alertId: log._id, itemId: log.itemId, name: log.name,
    priceCoins: log.priceCoins, suggestedCoins: log.suggestedCoins, profitPct: log.discountPct,
  }).body;
}

async function runOnce(engineName, raw) {
  const rule = makeRule();
  RULES = [rule];
  live.invalidateLiveRuleCache();
  await ENGINES[engineName](raw);
  return { rule, log: LOGS.at(-1), emit: EMITS.at(-1), state: STATE.get(`${rule.userId}|${rule._id}|${String(raw.id)}`) };
}

// ── Stored / emitted values at and around 100,000 coins ─────────────────────
const PRICES = [99_999.99, 100_000, 100_000.01, 150_000, 1_000_000];

for (const engineName of Object.keys(ENGINES)) {
  for (const coins of PRICES) {
    test(`${engineName}: ${coins} coins (suggested ×1.1) stored, emitted and pushed unchanged`, async () => {
      const raw = empireRaw(coins, coins * 1.1);
      const expected = normalizeItem(raw);
      const { log, emit, state } = await runOnce(engineName, raw);

      assert.ok(log, "alert was not created");
      assert.equal(log.priceCoins, expected.priceCoins);
      assert.equal(log.suggestedCoins, expected.suggestedCoins);
      assert.equal(log.discountPct, expected.discountPct);
      assert.equal(state.lastPrice, expected.priceCoins);

      assert.ok(emit, "price_alert was not emitted");
      assert.equal(emit.priceCoins, expected.priceCoins);
      assert.equal(emit.suggestedCoins, expected.suggestedCoins);
      assert.equal(emit.discountPct, expected.discountPct);

      const profit = expected.suggestedCoins - expected.priceCoins;
      assert.equal(
        pushBody(log),
        `Bid ${expected.priceCoins.toFixed(2)} · Profit +${profit.toFixed(2)} (${expected.discountPct.toFixed(1)}%)`
      );
    });
  }

  test(`${engineName}: price 95,000 / suggested 104,500 — suggested not divided, real profit`, async () => {
    const { log, emit } = await runOnce(engineName, empireRaw(95_000, 104_500));
    assert.equal(log.priceCoins, 95_000);
    assert.equal(log.suggestedCoins, 104_500);
    assert.equal(emit.suggestedCoins, 104_500);
    assert.equal(pushBody(log), "Bid 95000.00 · Profit +9500.00 (9.1%)");
  });

  test(`${engineName}: price 100,500 / suggested 99,000 (overpriced) — discount stays 0, not 99`, async () => {
    const { log, emit } = await runOnce(engineName, empireRaw(100_500, 99_000));
    assert.equal(log.priceCoins, 100_500);
    assert.equal(log.suggestedCoins, 99_000);
    assert.equal(log.discountPct, 0);
    assert.equal(emit.discountPct, 0);
    assert.equal(pushBody(log), "Bid 100500.00 · Profit +0.00 (0.0%)");
  });
}

// ── Price-improvement retrigger after cooldown, across the old threshold ────
const RETRIGGERS = [
  ["150,000 → 149,995 (drop 5 = threshold)",       150_000, 149_995, true],
  ["150,000 → 149,996 (drop 4 < threshold)",       150_000, 149_996, false],
  ["100,500 → 99,000 (real drop across 100k)",     100_500,  99_000, true],
  ["99,000 → 100,500 (real RISE across 100k)",      99_000, 100_500, false],
  ["control 50,000 → 49,995 (drop 5)",              50_000,  49_995, true],
  ["control 50,000 → 49,996 (drop 4)",              50_000,  49_996, false],
];

for (const engineName of Object.keys(ENGINES)) {
  for (const [label, first, second, shouldRetrigger] of RETRIGGERS) {
    test(`${engineName}: retrigger ${label} -> ${shouldRetrigger ? "re-alerts" : "no alert"}`, async () => {
      const rule = makeRule();
      RULES = [rule];
      const id = 80_000_000 + seq++;
      await ENGINES[engineName](empireRaw(first, first * 1.1, id));
      assert.equal(LOGS.length, 1, "first alert missing");
      const st = STATE.get(`${rule.userId}|${rule._id}|${id}`);
      assert.equal(st.lastPrice, first);

      st.lastNotifiedAt = new Date(Date.now() - 6 * 60_000); // cooldown (5 min) expired
      resetMarketCache();
      live.invalidateLiveRuleCache();
      await ENGINES[engineName](empireRaw(second, second * 1.1, id));

      assert.equal(LOGS.length === 2, shouldRetrigger);
      assert.equal(st.lastPrice === second || STATE.get(`${rule.userId}|${rule._id}|${id}`).lastPrice === second, shouldRetrigger);
    });
  }

  test(`${engineName}: cooldown still active -> no alert even with a large drop`, async () => {
    const rule = makeRule();
    RULES = [rule];
    const id = 81_000_000 + seq++;
    await ENGINES[engineName](empireRaw(150_000, 165_000, id));
    resetMarketCache();
    live.invalidateLiveRuleCache();
    await ENGINES[engineName](empireRaw(100_000, 165_000, id));
    assert.equal(LOGS.length, 1);
  });
}

// ── Legacy raw-field fallbacks (no normalized field present) are unchanged ──
const LEGACY = [
  // [item, expectedPrice]
  [{ purchase_price: 28 }, 28],                 // small raw values pass through
  [{ purchase_price: 100_000 }, 100_000],       // not above threshold
  [{ purchase_price: 150_000 }, 1_500],         // legacy "cents-like" heuristic kept
  [{ market_value: 12_345_600 }, 123_456],
  [{ price: 99_999.99 }, 99_999.99],
  [{ auction_highest_bid: 250_000 }, 2_500],
  [{ priceCoinsValue: 150_000 }, 1_500],
  [{ purchase_price: -5 }, 0],
  [{ purchase_price: "abc" }, 0],
  [{}, 0],
];

for (const [label, mod] of [["live", live], ["fallback", engine]]) {
  test(`${label}: legacy raw price fallbacks keep the old heuristic`, () => {
    for (const [item, expected] of LEGACY) {
      assert.equal(mod.getPriceCoins(item), expected, JSON.stringify(item));
    }
  });

  test(`${label}: legacy raw suggested fallbacks keep the old heuristic`, () => {
    assert.equal(mod.getSuggestedCoins({ suggested_price: 150_000 }), 1_500);
    assert.equal(mod.getSuggestedCoins({ suggested_price: 99_999 }), 99_999);
    assert.equal(mod.getSuggestedCoins({ suggestedPrice: 250_000 }), 2_500);
    assert.equal(mod.getSuggestedCoins({ marketPrice: 42 }), 42);
    assert.equal(mod.getSuggestedCoins({}), 0);
  });

  test(`${label}: normalized fields are used as-is and take precedence over raw fields`, () => {
    assert.equal(mod.getPriceCoins({ priceCoins: 150_000, purchase_price: 999 }), 150_000);
    assert.equal(mod.getSuggestedCoins({ suggestedCoins: 150_000, suggested_price: 999 }), 150_000);
    assert.equal(mod.getPriceCoins({ priceCoins: 1_000_000 }), 1_000_000);
    assert.equal(mod.getPriceCoins({ priceCoins: 0, purchase_price: 999 }), 0);    // present 0 does not fall through (as before)
    assert.equal(mod.getPriceCoins({ priceCoins: "abc" }), 0);
    assert.equal(mod.getPriceCoins({ priceCoins: null, purchase_price: 28 }), 28); // null falls through (as before)
  });
}
