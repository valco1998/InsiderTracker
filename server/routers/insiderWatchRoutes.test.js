// Phase 2 — follow API tests. Real router + real protectRoute over loopback HTTP;
// Mongoose statics are stubbed with an in-memory store (no database).
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { parseCompanyTickers, normalizeTicker } from "../services/edgar/companyTickers.js";

process.env.JWT_SECRET = "t".repeat(40);
const { default: User } = await import("../models/User.model.js");
const { default: InsiderWatch } = await import("../models/InsiderWatch.model.js");
const { default: protectRoute } = await import("../middelware/protectRoute.js");
const { createInsiderWatchRouter, MAX_WATCHES_PER_USER } = await import("./insiderWatchRoutes.js");
const { CompanyLookupUnavailable } = await import("../services/edgar/companyTickers.js");

// SYNTHETIC company list in SEC's company_tickers_exchange.json shape.
const COMPANIES = parseCompanyTickers({
  fields: ["cik", "name", "ticker", "exchange"],
  data: [[1866581, "Dutch Bros Inc.", "BROS", "NYSE"], [1067983, "BERKSHIRE HATHAWAY INC", "BRK-B", "NYSE"], [320193, "Apple Inc.", "AAPL", "Nasdaq"]],
});
let lookupMode = "ok";
const lookupTicker = async (t) => { if (lookupMode === "down") throw new CompanyLookupUnavailable("down"); return COMPANIES.get(normalizeTicker(t)) || null; };

const ALICE = new mongoose.Types.ObjectId();
const BOB = new mongoose.Types.ObjectId();
const tokenFor = (id) => jwt.sign({ sub: String(id) }, process.env.JWT_SECRET);
User.findById = (id) => ({ select: async () => ([String(ALICE), String(BOB)].includes(String(id)) ? { _id: id, username: "u" } : null) });

// In-memory InsiderWatch store.
let rows = [];
const matches = (r, q) => Object.entries(q).every(([k, v]) => String(r[k]) === String(v));
const doc = (r) => ({ ...r, save: async function () { Object.assign(r, this, { updatedAt: new Date() }); delete r.save; } });
InsiderWatch.find = (q) => ({ sort: () => ({ lean: async () => rows.filter((r) => matches(r, q)).map((r) => ({ ...r })) }) });
InsiderWatch.countDocuments = async (q) => rows.filter((r) => matches(r, q)).length;
InsiderWatch.create = async (d) => {
  if (rows.some((r) => String(r.userId) === String(d.userId) && r.cik === d.cik)) { const e = new Error("dup"); e.code = 11000; throw e; }
  const r = { _id: new mongoose.Types.ObjectId(), ...d, createdAt: new Date(), updatedAt: new Date() };
  rows.push(r);
  return { ...r };
};
InsiderWatch.findOne = async (q) => { const r = rows.find((x) => matches(x, q)); return r ? doc(r) : null; };
InsiderWatch.deleteOne = async (q) => { const n = rows.length; rows = rows.filter((r) => !matches(r, q)); return { deletedCount: n - rows.length }; };

let server, base;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/insider/watches", protectRoute, createInsiderWatchRouter({ lookupTicker }));
  server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  base = `http://127.0.0.1:${server.address().port}/api/insider/watches`;
});
after(() => new Promise((r) => server.close(r)));
beforeEach(() => { rows = []; lookupMode = "ok"; });

const call = async (method, path = "", body, who = ALICE) => {
  const r = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", ...(who ? { Authorization: `Bearer ${tokenFor(who)}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
};

test("unauthenticated requests are rejected", async () => {
  for (const m of ["GET", "POST"]) assert.equal((await call(m, "", m === "POST" ? { ticker: "BROS" } : undefined, null)).status, 401);
});

test("follow resolves the ticker to the SEC issuer CIK and starts alertsFrom now", async () => {
  const t0 = Date.now();
  const r = await call("POST", "", { ticker: "bros", types: "sale" });
  assert.equal(r.status, 201);
  assert.equal(r.body.watch.ticker, "BROS");
  assert.equal(r.body.watch.cik, "0001866581");
  assert.equal(r.body.watch.companyName, "Dutch Bros Inc.");
  assert.equal(r.body.watch.types, "sale");
  assert.ok(new Date(r.body.watch.alertsFrom).getTime() >= t0, "historical filings can never qualify");
  assert.equal((await call("GET")).body.watches.length, 1);
});

test("BRK.B is accepted as SEC's BRK-B; default types = both", async () => {
  const r = await call("POST", "", { ticker: "BRK.B" });
  assert.equal(r.status, 201);
  assert.equal(r.body.watch.ticker, "BRK-B");
  assert.equal(r.body.watch.types, "both");
});

test("input validation", async () => {
  assert.equal((await call("POST", "", { ticker: "" })).status, 400);
  assert.equal((await call("POST", "", { ticker: { $gt: "" } })).status, 400, "NoSQL operator object rejected");
  assert.equal((await call("POST", "", { ticker: "AAPL", types: "everything" })).status, 400);
  assert.equal((await call("POST", "", { ticker: "ZZZZ" })).status, 404);
  assert.equal((await call("PATCH", "/not-an-id", { enabled: false })).status, 400);
});

test("duplicate follow → 409; company list down → 503 (fail closed)", async () => {
  await call("POST", "", { ticker: "AAPL" });
  assert.equal((await call("POST", "", { ticker: "AAPL" })).status, 409);
  lookupMode = "down";
  assert.equal((await call("POST", "", { ticker: "BROS" })).status, 503);
});

test("per-user follow limit", async () => {
  for (let i = 0; i < MAX_WATCHES_PER_USER; i++) rows.push({ _id: new mongoose.Types.ObjectId(), userId: ALICE, cik: String(i).padStart(10, "0") });
  const r = await call("POST", "", { ticker: "AAPL" });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /up to/);
});

test("re-enabling resets alertsFrom so a paused period never back-fills alerts", async () => {
  const { body } = await call("POST", "", { ticker: "BROS" });
  const id = body.watch.id;
  rows[0].alertsFrom = new Date("2026-01-01T00:00:00Z");
  await call("PATCH", `/${id}`, { enabled: false });
  assert.equal(rows[0].enabled, false);
  assert.equal(rows[0].alertsFrom.toISOString(), "2026-01-01T00:00:00.000Z", "disabling keeps it");
  const t0 = Date.now();
  const r = await call("PATCH", `/${id}`, { enabled: true, types: "purchase" });
  assert.equal(r.status, 200);
  assert.equal(r.body.watch.types, "purchase");
  assert.ok(new Date(r.body.watch.alertsFrom).getTime() >= t0);
});

test("users cannot see, change or delete another user's follows", async () => {
  const { body } = await call("POST", "", { ticker: "BROS" }, ALICE);
  const id = body.watch.id;
  assert.equal((await call("GET", "", undefined, BOB)).body.watches.length, 0);
  assert.equal((await call("PATCH", `/${id}`, { enabled: false }, BOB)).status, 404);
  assert.equal((await call("DELETE", `/${id}`, undefined, BOB)).status, 404);
  assert.equal((await call("DELETE", `/${id}`, undefined, ALICE)).status, 200);
});

test("company list parser: 10-digit CIKs, first ticker wins, dot→dash", () => {
  const m = parseCompanyTickers({ fields: ["cik", "name", "ticker", "exchange"], data: [[42, "A", "abc", "NYSE"], [43, "B", "ABC", "NYSE"]] });
  assert.equal(m.get("ABC").cik, "0000000042");
  assert.equal(normalizeTicker(" brk.b "), "BRK-B");
  assert.throws(() => parseCompanyTickers({ fields: ["x"], data: [] }), /unexpected/);
});
