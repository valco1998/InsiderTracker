// Phase 5E.1 — authorization regression tests for the global alert-stats
// endpoints. Runs the REAL router + protectRoute + requireAdmin + JWT verify
// over a loopback HTTP server. Only Mongoose statics are stubbed (no DB), and
// the JWT secret / admin email are throwaway values generated per run.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

process.env.JWT_SECRET  = crypto.randomBytes(24).toString("hex");
process.env.ADMIN_EMAIL = "operator@example.test";
delete process.env.WATCHLIST_DEBUG_RULE_IDS;

const { default: User }       = await import("../models/User.model.js");
const { default: WatchRule }  = await import("../models/WatchRule.model.js");
const { default: AlertState } = await import("../models/AlertState.js");
const { default: AlertLog }   = await import("../models/alertLog.models.js");
const { default: NotificationEvent } = await import("../models/NotificationEvent.model.js");
const { getAlertStats, resetAlertStats, inc, recordLatency } = await import("../services/alertStats.js");
const { default: processLiveItemForAlerts, invalidateLiveRuleCache } = await import("../controllers/alerts.controller.js");
const { default: alertRoutes } = await import("./alertRoutes.js");

const REGULAR = { _id: new mongoose.Types.ObjectId(), email: "regular@example.test" };
const ADMIN   = { _id: new mongoose.Types.ObjectId(), email: "operator@example.test" };
const USERS   = new Map([[String(REGULAR._id), REGULAR], [String(ADMIN._id), ADMIN]]);
User.findById = (id) => ({ select: async () => USERS.get(String(id)) || null });

let server;
let base;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/alerts", alertRoutes);
  server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  process.env.ADMIN_EMAIL = "operator@example.test";
  resetAlertStats();
  inc("itemsScanned", 500);
  inc("alertsCreated", 7);
  inc("liveProcessRejected", 2);
  recordLatency("detectionToSocket", 120);
});

function tokenFor(user) {
  return jwt.sign({ sub: String(user._id) }, process.env.JWT_SECRET, { expiresIn: "5m" });
}

async function call(method, path, user) {
  const res = await fetch(base + path, {
    method,
    headers: user ? { Authorization: `Bearer ${tokenFor(user)}` } : {},
  });
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, body };
}

function assertCountersUntouched() {
  const s = getAlertStats();
  assert.equal(s.itemsScanned, 500);
  assert.equal(s.alertsCreated, 7);
  assert.equal(s.liveProcessRejected, 2);
  assert.equal(s.latency.detectionToSocket.count, 1);
}

// ── POST /stats/reset ────────────────────────────────────────────────────────
test("RESET: unauthenticated -> 401, counters untouched", async () => {
  const r = await call("POST", "/api/alerts/stats/reset", null);
  assert.equal(r.status, 401);
  assertCountersUntouched();
});

test("RESET: regular authenticated user -> 403, counters untouched", async () => {
  const r = await call("POST", "/api/alerts/stats/reset", REGULAR);
  assert.equal(r.status, 403);
  assert.equal(r.body?.ok, false);
  assertCountersUntouched();
});

test("RESET: admin -> 200 and all counters + latency buffers cleared", async () => {
  const r = await call("POST", "/api/alerts/stats/reset", ADMIN);
  assert.equal(r.status, 200);
  assert.equal(r.body?.ok, true);
  const s = getAlertStats();
  assert.equal(s.itemsScanned, 0);
  assert.equal(s.alertsCreated, 0);
  assert.equal(s.liveProcessRejected, 0);
  assert.equal(s.latency.detectionToSocket, null);
  assert.equal(r.body.stats.itemsScanned, 0);
});

test("RESET: ADMIN_EMAIL unset -> 403 even for the operator account (fails closed)", async () => {
  delete process.env.ADMIN_EMAIL;
  const r = await call("POST", "/api/alerts/stats/reset", ADMIN);
  assert.equal(r.status, 403);
  assertCountersUntouched();
});

// ── GET /stats unchanged ─────────────────────────────────────────────────────
test("GET /stats: unauthenticated -> 401", async () => {
  const r = await call("GET", "/api/alerts/stats", null);
  assert.equal(r.status, 401);
});

test("GET /stats: regular user -> 200 with the same response shape as before", async () => {
  const r = await call("GET", "/api/alerts/stats", REGULAR);
  assert.equal(r.status, 200);
  assert.equal(r.body?.ok, true);
  assert.deepEqual(Object.keys(r.body.stats).sort(), Object.keys(getAlertStats()).sort());
  assert.equal(r.body.stats.itemsScanned, 500);
  assert.equal(r.body.stats.alertsCreated, 7);
});

test("GET /stats: admin -> 200", async () => {
  const r = await call("GET", "/api/alerts/stats", ADMIN);
  assert.equal(r.status, 200);
  assert.equal(r.body?.ok, true);
});

// ── Alert delivery unaffected ────────────────────────────────────────────────
test("DELIVERY: live alert pipeline still creates alerts after rejected and accepted resets", async () => {
  const rule = {
    _id: new mongoose.Types.ObjectId(),
    userId: REGULAR._id,
    baseName: "AK-47 | Redline",
    marketHashName: "AK-47 | Redline (Field-Tested)",
    wear: "Field-Tested",
    cooldownMin: 5,
  };
  WatchRule.find = () => ({ lean: async () => [rule] });
  AlertState.findOne = () => ({ lean: async () => null });
  AlertState.findOneAndUpdate = async () => ({});
  AlertLog.updateOne = () => Promise.resolve({});
  NotificationEvent.create = () => Promise.resolve({});
  const created = [];
  AlertLog.create = async (doc) => {
    const d = { _id: new mongoose.Types.ObjectId(), ...doc };
    created.push(d);
    return { ...d, toObject: () => ({ ...d }) };
  };
  invalidateLiveRuleCache();

  const item = (id) => ({
    itemId: id,
    market_hash_name: "AK-47 | Redline (Field-Tested)",
    priceCoins: 10,
    discountPct: 5,
  });

  assert.equal((await call("POST", "/api/alerts/stats/reset", REGULAR)).status, 403);
  const first = await processLiveItemForAlerts(item("deliv-1"), { source: "empire-ws:new_item" });
  assert.equal(first.length, 1);

  assert.equal((await call("POST", "/api/alerts/stats/reset", ADMIN)).status, 200);
  const second = await processLiveItemForAlerts(item("deliv-2"), { source: "empire-ws:new_item" });
  assert.equal(second.length, 1);

  assert.equal(created.length, 2);
  assert.equal(getAlertStats().alertsCreated, 1); // counted again from zero after the admin reset
});
