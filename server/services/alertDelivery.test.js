// Phase 4 — delivery tests. deliverAlert() runs with stubbed AlertLog / FCM /
// metrics (no DB, no real FCM). Payloads are built from the REAL BROS filings.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import mongoose from "mongoose";
import { deliverAlert } from "./alertDelivery.js";
import { buildInsiderAlertDoc, buildInsiderPushPayload, insiderAlertTitle, insiderAlertBody } from "./insiderPushFormat.js";
import { parseForm4Submission } from "./edgar/form4Parser.js";
import { annotatePriceChecks } from "./edgar/priceAnomalies.js";
import { groupTransactions } from "./edgar/transactionGroups.js";
import { alertKeyOf } from "./insiderAlertEngine.js";
import AlertLog from "../models/alertLog.models.js";

const fx = (acc) => fs.readFileSync(new URL(`./edgar/__fixtures__/${acc}.txt`, import.meta.url), "utf8");
const econ = groupTransactions(annotatePriceChecks(["0001866581-26-000164", "0001866581-26-000166"].flatMap((a) => parseForm4Submission(fx(a)).transactions)));
const TX = econ.find((t) => t.shares === 266000); // Boersma + DM Trust, confirmed group
const WATCH = { _id: new mongoose.Types.ObjectId(), userId: new mongoose.Types.ObjectId(), cik: "0001866581", types: "both" };
const KEY = alertKeyOf(TX);

function stubDeps({ fcmReady = true, createFails = false } = {}) {
  const calls = [];
  const id = new mongoose.Types.ObjectId();
  return {
    calls, id,
    deps: {
      AlertLog: { create: async (doc) => { calls.push(["create", doc]); if (createFails) throw new Error("db down"); return { ...doc, _id: id }; } },
      isFcmReady: () => fcmReady,
      sendPushToUser: async (uid, payload) => { calls.push(["push", uid, payload]); return { successCount: 1, tokenCount: 1 }; },
      recordEvent: (type, p) => calls.push(["event", type, p]),
      recordAlertTiming: (aid, stage) => calls.push(["timing", stage]),
    },
  };
}
const quiet = async (fn) => { const l = console.log, e = console.error; console.log = () => {}; console.error = () => {}; try { return await fn(); } finally { console.log = l; console.error = e; } };

test("deliverAlert keeps the existing pipeline order: create → emit → timings → PUSH_SEND_START → push", async () => {
  const s = stubDeps();
  const emitted = [];
  const r = await quiet(() => deliverAlert({
    userId: WATCH.userId,
    alert: buildInsiderAlertDoc({ tx: TX, watch: WATCH, alertKey: KEY }),
    buildPush: (alertId) => buildInsiderPushPayload({ tx: TX, alertId, alertKey: KEY }),
    emit: (p) => { emitted.push(p); s.calls.push(["emit"]); },
    deps: s.deps,
  }));
  await new Promise((x) => setImmediate(x));
  assert.deepEqual(s.calls.map((c) => (c[0] === "timing" ? `timing:${c[1]}` : c[0] === "event" ? `event:${c[1]}` : c[0])),
    ["create", "emit", "timing:socketEmitAt", "timing:pushStartAt", "event:PUSH_SEND_START", "push"]);
  assert.equal(r.alertId, String(s.id));
  assert.equal(emitted[0]._id, String(s.id));
  const [, uid, payload] = s.calls.find((c) => c[0] === "push");
  assert.equal(uid, String(WATCH.userId));
  assert.equal(payload.data.alertId, String(s.id), "FCM alertId = AlertLog _id (dedup, receipts, metrics)");
});

test("FCM payload keeps the service-worker receipt contract and links the SEC filing", () => {
  const alertId = String(new mongoose.Types.ObjectId());
  const p = buildInsiderPushPayload({ tx: TX, alertId, alertKey: KEY });
  // firebase-messaging-sw.js only sends receipts for these:
  assert.equal(p.data.type, "price_alert");
  assert.match(p.data.alertId, /^[a-f0-9]{24}$/);
  assert.equal(p.data.kind, "insider_trade");
  assert.match(p.data.url, /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/1866581\/\d{18}\/0001866581-26-00016[46]-index\.htm$/);
  assert.equal(p.data.filingUrl, p.data.url);
  assert.ok(Object.values(p.data).every((v) => typeof v === "string"), "FCM data values must be strings");
});

test("notification text: ticker, direction, value once, insider, trade vs filing date", () => {
  assert.equal(insiderAlertTitle(TX), "BROS · Insider sale · $11.7M");
  const body = insiderAlertBody(TX);
  assert.match(body, /^Boersma Travis \(Executive Chairman of Board\) sold 266,000 sh @ \$44\.0266 · traded Oct 29 · Form 4 filed Oct 30 · 2 related filings$/);
  assert.ok(body.length <= 180);
  const noPrice = { ...TX, price: null, value: null, reportedBy: undefined };
  assert.equal(insiderAlertTitle(noPrice), "BROS · Insider sale");
  assert.match(insiderAlertBody(noPrice), /price not reported/);
});

test("AlertLog document validates against the schema and preserves every SEC filing link", () => {
  const doc = buildInsiderAlertDoc({ tx: TX, watch: WATCH, alertKey: KEY });
  const m = new AlertLog({ ...doc, userId: WATCH.userId });
  assert.equal(m.validateSync(), undefined);
  assert.equal(m.kind, "insider_trade");
  assert.equal(m.itemId, KEY);
  assert.equal(String(m.ruleId), String(WATCH._id));
  assert.deepEqual(m.insider.filings.map((f) => f.accessionNo).sort(), ["0001866581-26-000164", "0001866581-26-000166"]);
  assert.ok(m.insider.filings.every((f) => f.filingUrl.startsWith("https://www.sec.gov/")));
  // Legacy CS2 documents are unaffected: insider is absent by default.
  assert.equal(new AlertLog({ userId: WATCH.userId, ruleId: WATCH._id, itemId: "x", name: "legacy" }).insider, undefined);
});

test("Firebase not ready → AlertLog kept, no push attempted (fail closed)", async () => {
  const s = stubDeps({ fcmReady: false });
  const r = await quiet(() => deliverAlert({ userId: WATCH.userId, alert: buildInsiderAlertDoc({ tx: TX, watch: WATCH, alertKey: KEY }), buildPush: () => { throw new Error("must not build"); }, deps: s.deps }));
  assert.equal(r.push, "not_ready");
  assert.ok(!s.calls.some((c) => c[0] === "push"));
});

test("AlertLog failure throws (engine marks the claim failed) and sends nothing", async () => {
  const s = stubDeps({ createFails: true });
  await assert.rejects(() => quiet(() => deliverAlert({ userId: WATCH.userId, alert: {}, buildPush: () => ({}), deps: s.deps })), /db down/);
  assert.ok(!s.calls.some((c) => c[0] === "push"));
});

test("a push payload whose alertId differs from the AlertLog id is refused", async () => {
  const s = stubDeps();
  await assert.rejects(() => quiet(() => deliverAlert({ userId: WATCH.userId, alert: {}, buildPush: () => ({ title: "t", body: "b", data: { alertId: "something-else" } }), deps: s.deps })), /must equal/);
  assert.ok(!s.calls.some((c) => c[0] === "push"));
});
