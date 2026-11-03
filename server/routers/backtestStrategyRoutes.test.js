// Saved Backtesting strategies — real router + real protectRoute over loopback HTTP;
// Mongoose statics stubbed with an in-memory store (no database).
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import mongoose from "mongoose";

process.env.JWT_SECRET = "t".repeat(40);
const { default: User } = await import("../models/User.model.js");
const { default: BacktestStrategy } = await import("../models/BacktestStrategy.model.js");
const { default: protectRoute } = await import("../middelware/protectRoute.js");
const { createBacktestStrategyRouter, MAX_STRATEGIES_PER_USER, sanitizeParams } = await import("./backtestStrategyRoutes.js");
const { setFirebaseVerifierForTests } = await import("../services/firebaseAuth.js");

const ALICE = new mongoose.Types.ObjectId();
const BOB = new mongoose.Types.ObjectId();
const known = (id) => [String(ALICE), String(BOB)].includes(String(id));
User.findById = (id) => ({ select: async () => (known(id) ? { _id: id } : null) });
User.findOne = (q) => ({ select: async () => (known(q?.firebaseUid) ? { _id: q.firebaseUid } : null) });
setFirebaseVerifierForTests(async (t) => ({ uid: JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString()).uid, firebase: { sign_in_provider: "google.com" } }));
const tokenFor = (id) => `h.${Buffer.from(JSON.stringify({ iss: "https://securetoken.google.com/test", uid: String(id) })).toString("base64url")}.sig`;

let rows = [];
const matches = (r, q) => Object.entries(q).every(([k, v]) => String(r[k]) === String(v));
BacktestStrategy.find = (q) => ({ sort: () => ({ limit: () => ({ lean: async () => rows.filter((r) => matches(r, q)).map((r) => ({ ...r })) }) }) });
BacktestStrategy.countDocuments = async (q) => rows.filter((r) => matches(r, q)).length;
BacktestStrategy.create = async (d) => { const r = { _id: new mongoose.Types.ObjectId(), ...d, createdAt: new Date(), updatedAt: new Date() }; rows.push(r); return { ...r }; };
BacktestStrategy.findOneAndUpdate = (q, u) => ({ lean: async () => { const r = rows.find((x) => matches(x, q)); if (!r) return null; Object.assign(r, u.$set, { updatedAt: new Date() }); return { ...r }; } });
BacktestStrategy.deleteOne = async (q) => { const n = rows.length; rows = rows.filter((r) => !matches(r, q)); return { deletedCount: n - rows.length }; };

let server, base;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use("/s", protectRoute, createBacktestStrategyRouter({ now: () => Date.parse("2026-11-03T12:00:00Z") }));
  server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  base = `http://127.0.0.1:${server.address().port}/s`;
});
after(() => server.close());
beforeEach(() => { rows = []; });

const call = (method, path, user, body) => fetch(`${base}${path}`, {
  method, headers: { "Content-Type": "application/json", ...(user ? { Authorization: `Bearer ${tokenFor(user)}` } : {}) }, body: body ? JSON.stringify(body) : undefined,
});
const PARAMS = { from: "2026-05-01", to: "2026-10-31", minBuyers: 3, minValueUsd: 100000, windowDays: 14, horizonSessions: 10, executionLatencySeconds: 120, entrySession: "regular", roles: ["CEO", "Director"] };

test("unauthenticated requests are rejected", async () => {
  assert.equal((await call("GET", "/", null)).status, 401);
  assert.equal((await call("POST", "/", null, { name: "x", params: PARAMS })).status, 401);
});

test("create, list, update, delete — scoped to the signed-in user; params stored exactly as entered", async () => {
  const c = await call("POST", "/", ALICE, { name: "  Three   insiders  ", params: PARAMS });
  assert.equal(c.status, 201);
  const { strategy } = await c.json();
  assert.equal(strategy.name, "Three insiders");
  assert.deepEqual(strategy.params, PARAMS, "nothing re-defaulted or changed");
  assert.equal((await (await call("GET", "/", BOB)).json()).strategies.length, 0, "Bob cannot see Alice's strategies");
  assert.equal((await call("PUT", `/${strategy.id}`, BOB, { name: "hijack" })).status, 404);
  assert.equal((await call("DELETE", `/${strategy.id}`, BOB)).status, 404);
  const u = await (await call("PUT", `/${strategy.id}`, ALICE, { params: { ...PARAMS, horizonSessions: 60 } })).json();
  assert.equal(u.strategy.params.horizonSessions, 60);
  assert.equal((await (await call("GET", "/", ALICE)).json()).strategies.length, 1);
  assert.equal((await call("DELETE", `/${strategy.id}`, ALICE)).status, 200);
  assert.equal(rows.length, 0);
});

test("invalid input → 400 with a plain message; no operators or unknown keys stored", async () => {
  const bad = async (body) => { const r = await call("POST", "/", ALICE, body); return [r.status, (await r.json()).error]; };
  assert.equal((await bad({ name: "", params: PARAMS }))[0], 400);
  assert.equal((await bad({ name: "x".repeat(81), params: PARAMS }))[0], 400);
  assert.match((await bad({ name: "x", params: { ...PARAMS, horizonSessions: 0 } }))[1], /horizonSessions/);
  assert.match((await bad({ name: "x", params: { ...PARAMS, minBuyers: { $gt: 1 } } }))[1], /minBuyers must be a number/);
  assert.match((await bad({ name: "x", params: { ...PARAMS, from: "yesterday" } }))[1], /from must be/);
  assert.match((await bad({ name: "x", params: "nope" }))[1], /params must be an object/);
  const s = sanitizeParams({ ...PARAMS, $where: "1", evil: { $ne: 1 } });
  assert.deepEqual(Object.keys(s.params).sort(), Object.keys(PARAMS).sort(), "allow-listed keys only");
  assert.equal((await call("PUT", "/not-an-id", ALICE, { name: "x" })).status, 400);
  assert.equal(rows.length, 0);
});

test("per-user limit", async () => {
  for (let i = 0; i < MAX_STRATEGIES_PER_USER; i++) rows.push({ _id: new mongoose.Types.ObjectId(), userId: ALICE, name: `s${i}`, params: PARAMS });
  const r = await call("POST", "/", ALICE, { name: "one more", params: PARAMS });
  assert.equal(r.status, 400);
  assert.equal((await call("POST", "/", BOB, { name: "bob's", params: PARAMS })).status, 201);
});
