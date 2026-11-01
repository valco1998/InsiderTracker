// Phase 5E.2 — deleted_item handling regression tests.
// Uses Empire's documented payload verbatim (an array of numeric ids — see
// https://docs.csgoempire.com/reference/websocket-events.md). Runs the real
// handler, marketCache and auctionCache; AlertLog statics are stubbed (no DB)
// and Socket.IO emits are captured on the real io instance, per target room.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

const { default: AlertLog } = await import("../models/alertLog.models.js");
const { initSocket, getIO } = await import("../socket/socket.js");
const { upsertIntoCache, getAllFromCache, resetMarketCache } = await import("./marketCache.js");
const { upsertAuction, getAllAuctions, removeAuction } = await import("./auctionCache.js");
const { handleDeletedItem, extractDeletedItemIds } = await import("./empireMarketSocket.js");

// Verbatim from Empire's docs: ["deleted_item", [ ...ids ]] — the handler
// receives the second element.
const DOC_PAYLOAD = [91997374, 92044606, 92019018, 92044607, 91997376, 92044608, 91997377];
const DOC_IDS = DOC_PAYLOAD.map(String);

let targeted = [];      // { room, event, payload } via io.to(room).emit
let globalEmits = [];   // { event, payload } via io.emit
let order = [];         // interleaving of emits and DB calls
let findCalls = [];
let updateManyCalls = [];
let deleteManyCalls = 0;
let findImpl;
let updateManyImpl;

before(() => {
  const io = initSocket();
  const origEmit = io.emit.bind(io);
  const origTo = io.to.bind(io);
  io.emit = (event, payload) => {
    globalEmits.push({ event, payload });
    return origEmit(event, payload);
  };
  io.to = (room) => {
    const op = origTo(room);
    return {
      emit: (event, payload) => {
        targeted.push({ room, event, payload });
        order.push(`emit:${room}`);
        return op.emit(event, payload);
      },
    };
  };
});

after(() => {
  getIO().close();
});

beforeEach(() => {
  targeted = [];
  globalEmits = [];
  order = [];
  findCalls = [];
  updateManyCalls = [];
  deleteManyCalls = 0;
  findImpl = async () => [];
  updateManyImpl = async (filter) => ({ modifiedCount: filter._id.$in.length });
  AlertLog.find = (filter) => {
    findCalls.push(filter);
    order.push("db:find");
    return { select: () => ({ lean: () => findImpl(filter) }) };
  };
  AlertLog.updateMany = async (filter, update) => {
    updateManyCalls.push({ filter, update });
    order.push("db:updateMany");
    return updateManyImpl(filter, update);
  };
  AlertLog.deleteMany = async () => {
    deleteManyCalls += 1;
    return { deletedCount: 0 };
  };
  resetMarketCache();
  for (const id of DOC_IDS) removeAuction(id);
});

function seedMarket(id) {
  upsertIntoCache({ id, market_name: "AK-47 | Redline (Field-Tested)", purchase_price: 1000, suggested_price: 1200 });
}

function seedAuction(id) {
  upsertAuction({
    id,
    market_name: "AWP | Asiimov (Field-Tested)",
    purchase_price: 5000,
    suggested_price: 6000,
    auction_highest_bid: 5000,
    auction_ends_at: Math.floor(Date.now() / 1000) + 3600,
  });
}

const alertDoc = (_id, userId, itemId) => ({ _id, userId, itemId });
const inMarket   = (id) => getAllFromCache().some((x) => String(x.itemId) === String(id));
const inAuctions = (id) => getAllAuctions().some((x) => String(x.itemId ?? x.id) === String(id));
const deletedTo  = (room) => targeted.filter((e) => e.room === room && e.event === "item_deleted").map((e) => e.payload);
const userRooms  = () => targeted.filter((e) => e.room.startsWith("user:"));
const globalItemDeleted = () => globalEmits.filter((e) => e.event === "item_deleted");

// ── extractDeletedItemIds ───────────────────────────────────────────────────
test("extract: documented Empire array of numeric ids -> string ids in order", () => {
  assert.deepEqual(extractDeletedItemIds(DOC_PAYLOAD), DOC_IDS);
});

test("extract: legacy single-object forms still supported", () => {
  assert.deepEqual(extractDeletedItemIds({ id: 123 }), ["123"]);
  assert.deepEqual(extractDeletedItemIds({ item_id: "456" }), ["456"]);
  assert.deepEqual(extractDeletedItemIds({ itemId: 789 }), ["789"]);
  assert.deepEqual(extractDeletedItemIds({ assetid: "a1" }), ["a1"]);
});

test("extract: duplicate ids are collapsed", () => {
  assert.deepEqual(extractDeletedItemIds([5, 5, "5", 6, 5]), ["5", "6"]);
});

test("extract: empty and malformed payloads yield no ids", () => {
  for (const bad of [undefined, null, [], {}, "", 0, -1, 1.5, NaN, Infinity, true,
    [null, undefined, {}, [], "", "   ", 0, -7, 2.5, NaN, "a b", "x".repeat(65), "{$ne:1}", { id: { $ne: 1 } }],
  ]) {
    assert.deepEqual(extractDeletedItemIds(bad), [], `payload=${JSON.stringify(bad)}`);
  }
});

test("extract: valid ids survive alongside malformed entries", () => {
  assert.deepEqual(extractDeletedItemIds([null, 91997374, "bad id", { id: 92044606 }, -1]), ["91997374", "92044606"]);
});

// ── caches ──────────────────────────────────────────────────────────────────
test("caches: documented payload removes every id from market and auction caches; unrelated listing kept", async () => {
  for (const id of DOC_PAYLOAD) { seedMarket(id); seedAuction(id); }
  seedMarket(11111); seedAuction(11111);
  await handleDeletedItem(DOC_PAYLOAD);
  assert.ok(DOC_PAYLOAD.every((id) => !inMarket(id)));
  assert.ok(DOC_PAYLOAD.every((id) => !inAuctions(id)));
  assert.ok(inMarket(11111) && inAuctions(11111));
  removeAuction("11111");
});

// ── no global broadcast ─────────────────────────────────────────────────────
test("broadcast: item_deleted is never emitted globally", async () => {
  for (const id of DOC_PAYLOAD) seedAuction(id);
  findImpl = async () => [alertDoc("a1", "userA", DOC_IDS[0])];
  await handleDeletedItem(DOC_PAYLOAD);
  assert.deepEqual(globalItemDeleted(), []);
  assert.ok(targeted.length > 0);
});

// ── auction subscribers ─────────────────────────────────────────────────────
test("auctions: only ids actually removed from the auction cache go to auctions:live", async () => {
  const auctionIds = [DOC_PAYLOAD[1], DOC_PAYLOAD[4]];
  for (const id of auctionIds) seedAuction(id);
  await handleDeletedItem(DOC_PAYLOAD);
  assert.deepEqual(deletedTo("auctions:live"), auctionIds.map((id) => ({ itemId: String(id) })));
});

test("auctions: no cached auctions -> nothing sent to auctions:live", async () => {
  await handleDeletedItem(DOC_PAYLOAD);
  assert.deepEqual(deletedTo("auctions:live"), []);
});

// ── affected users ──────────────────────────────────────────────────────────
test("users: read is an indexed itemId $in + status:live query; update targets exactly those _ids", async () => {
  findImpl = async () => [alertDoc("a1", "userA", DOC_IDS[0]), alertDoc("a2", "userB", DOC_IDS[2])];
  await handleDeletedItem(DOC_PAYLOAD);
  assert.deepEqual(findCalls, [{ itemId: { $in: DOC_IDS }, status: "live" }]);
  assert.equal(updateManyCalls.length, 1);
  const { filter, update } = updateManyCalls[0];
  assert.deepEqual(filter, { _id: { $in: ["a1", "a2"] }, status: "live" });
  assert.deepEqual(Object.keys(update), ["$set"]);
  assert.deepEqual(Object.keys(update.$set).sort(), ["expiredAt", "status"]);
  assert.equal(update.$set.status, "deleted");
  assert.ok(update.$set.expiredAt instanceof Date);
  assert.equal(deleteManyCalls, 0);
});

test("users: each affected owner gets item_deleted { itemId } in their own room only", async () => {
  findImpl = async () => [alertDoc("a1", "userA", DOC_IDS[0]), alertDoc("a2", "userB", DOC_IDS[2]), alertDoc("a3", "userA", DOC_IDS[3])];
  await handleDeletedItem(DOC_PAYLOAD);
  assert.deepEqual(deletedTo("user:userA"), [{ itemId: DOC_IDS[0] }, { itemId: DOC_IDS[3] }]);
  assert.deepEqual(deletedTo("user:userB"), [{ itemId: DOC_IDS[2] }]);
  assert.equal(userRooms().length, 3);
});

test("users: several alerts for the same (user, item) pair -> one event; all alerts still marked", async () => {
  // e.g. two of userA's watch rules fired on the same listing
  findImpl = async () => [alertDoc("a1", "userA", DOC_IDS[0]), alertDoc("a2", "userA", DOC_IDS[0])];
  await handleDeletedItem(DOC_PAYLOAD);
  assert.deepEqual(updateManyCalls[0].filter._id.$in, ["a1", "a2"]);
  assert.deepEqual(deletedTo("user:userA"), [{ itemId: DOC_IDS[0] }]);
});

test("users: ObjectId-like userIds are stringified into the room name", async () => {
  const oid = { toString: () => "65f000000000000000000001" };
  findImpl = async () => [alertDoc("a1", oid, 91997374)];
  await handleDeletedItem(DOC_PAYLOAD);
  assert.deepEqual(deletedTo("user:65f000000000000000000001"), [{ itemId: "91997374" }]);
});

test("no live alerts -> no write and no user events", async () => {
  await handleDeletedItem(DOC_PAYLOAD);
  assert.equal(findCalls.length, 1);
  assert.equal(updateManyCalls.length, 0);
  assert.deepEqual(userRooms(), []);
});

// ── duplicates / idempotency ────────────────────────────────────────────────
test("duplicates: duplicate ids in a batch -> one $in entry, one auction event", async () => {
  seedAuction(777);
  await handleDeletedItem([777, 777, "777"]);
  assert.deepEqual(findCalls[0].itemId.$in, ["777"]);
  assert.deepEqual(deletedTo("auctions:live"), [{ itemId: "777" }]);
});

test("idempotent: repeating the same deletion sends nothing and writes nothing the second time", async () => {
  seedAuction(DOC_PAYLOAD[0]);
  let live = [alertDoc("a1", "userA", DOC_IDS[0])];
  findImpl = async () => live;
  updateManyImpl = async (filter) => { live = []; return { modifiedCount: filter._id.$in.length }; };
  await handleDeletedItem(DOC_PAYLOAD);
  assert.equal(targeted.length, 2); // 1 auction + 1 user
  targeted = []; updateManyCalls = [];
  await handleDeletedItem(DOC_PAYLOAD);
  assert.deepEqual(targeted, []);
  assert.equal(updateManyCalls.length, 0);
});

// ── ordering / failures ─────────────────────────────────────────────────────
test("ordering: caches cleared and auction subscribers notified before the DB call resolves", async () => {
  seedMarket(DOC_PAYLOAD[0]); seedAuction(DOC_PAYLOAD[0]);
  let release;
  findImpl = () => new Promise((r) => { release = r; });
  const pending = handleDeletedItem(DOC_PAYLOAD);
  await new Promise((r) => setImmediate(r));
  assert.equal(inMarket(DOC_PAYLOAD[0]), false);
  assert.equal(inAuctions(DOC_PAYLOAD[0]), false);
  assert.deepEqual(deletedTo("auctions:live"), [{ itemId: DOC_IDS[0] }]);
  assert.deepEqual(order, ["emit:auctions:live", "db:find"]);
  release([alertDoc("a1", "userA", DOC_IDS[0])]);
  await pending;
  assert.deepEqual(order, ["emit:auctions:live", "db:find", "db:updateMany", "emit:user:userA"]);
});

test("DB unavailable (find throws): caches cleared, auction subscribers notified, no write, no user events", async () => {
  seedMarket(DOC_PAYLOAD[0]); seedAuction(DOC_PAYLOAD[0]);
  findImpl = async () => { throw new Error("simulated MongoDB unavailable"); };
  await assert.doesNotReject(handleDeletedItem(DOC_PAYLOAD));
  assert.equal(inMarket(DOC_PAYLOAD[0]), false);
  assert.deepEqual(deletedTo("auctions:live"), [{ itemId: DOC_IDS[0] }]);
  assert.equal(updateManyCalls.length, 0);
  assert.deepEqual(userRooms(), []);
  assert.deepEqual(globalItemDeleted(), []);
});

test("DB update failure: no user is notified (alerts stay live, so the UI must not hide them)", async () => {
  findImpl = async () => [alertDoc("a1", "userA", DOC_IDS[0])];
  updateManyImpl = async () => { throw new Error("simulated write failure"); };
  await assert.doesNotReject(handleDeletedItem(DOC_PAYLOAD));
  assert.deepEqual(userRooms(), []);
  assert.deepEqual(globalItemDeleted(), []);
});

// ── legacy / malformed ──────────────────────────────────────────────────────
test("legacy { id } object: removes cache entry, soft-deletes and notifies the owner", async () => {
  seedMarket(123);
  findImpl = async () => [alertDoc("a9", "userC", "123")];
  await handleDeletedItem({ id: 123 });
  assert.equal(inMarket(123), false);
  assert.deepEqual(findCalls[0], { itemId: { $in: ["123"] }, status: "live" });
  assert.deepEqual(deletedTo("user:userC"), [{ itemId: "123" }]);
});

test("empty / malformed payloads touch nothing (no DB call, no emit, no cache change)", async () => {
  seedMarket(22222);
  for (const bad of [[], {}, null, undefined, [null, "", -1, 1.5], { id: { $ne: 1 } }]) {
    await handleDeletedItem(bad);
  }
  assert.equal(findCalls.length, 0);
  assert.equal(updateManyCalls.length, 0);
  assert.equal(deleteManyCalls, 0);
  assert.deepEqual(targeted, []);
  assert.deepEqual(globalEmits, []);
  assert.ok(inMarket(22222));
});

// ── removeAuction contract ──────────────────────────────────────────────────
test("removeAuction returns true only when the id was cached", () => {
  seedAuction(31337);
  assert.equal(removeAuction(31337), true);
  assert.equal(removeAuction(31337), false);
  assert.equal(removeAuction(""), false);
  assert.equal(removeAuction(undefined), false);
});
