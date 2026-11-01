// Push Reliability Phase 1.6 — DEVICE_RECEIVED diagnostics.
// Part 1 runs the REAL push router over a loopback HTTP server with Mongoose
// statics stubbed (no DB). Part 2 loads the REAL client/public/
// firebase-messaging-sw.js in a vm sandbox with Firebase / IndexedDB / fetch
// faked, and finally wires the SW's receipt into the real endpoint.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import express from "express";
import mongoose from "mongoose";

const { default: DeviceToken }       = await import("../models/DeviceToken.model.js");
const { default: User }              = await import("../models/User.model.js");
const { default: AlertLog }          = await import("../models/alertLog.models.js");
const { default: NotificationEvent } = await import("../models/NotificationEvent.model.js");
const { _resetDeviceReceiptState }   = await import("../controllers/push.controller.js");
const { default: pushRoutes }        = await import("./pushRoutes.js");

// ── Stubs ────────────────────────────────────────────────────────────────────
const OWNER_ID  = new mongoose.Types.ObjectId();
const ALERT_ID  = String(new mongoose.Types.ObjectId());
const OLD_ALERT = String(new mongoose.Types.ObjectId());
const ALERTS = new Map();
AlertLog.findById = (id) => ({ select: () => ({ lean: async () => ALERTS.get(String(id)) || null }) });

let events = [];
NotificationEvent.create = async (doc) => { events.push(doc); return doc; };

// Any write to these models during a receipt is a test failure.
let forbidden = [];
const guard = (model, name) => {
  for (const m of ["create", "updateOne", "updateMany", "findOneAndUpdate", "findByIdAndUpdate", "deleteOne", "deleteMany", "replaceOne"]) {
    model[m] = () => { forbidden.push(`${name}.${m}`); throw new Error("forbidden write"); };
  }
};
guard(DeviceToken, "DeviceToken");
guard(User, "User");
guard(AlertLog, "AlertLog");

let server;
let base;

before(async () => {
  const app = express();
  app.use(express.json({ limit: "10mb" })); // same global parser as server.js
  app.use("/api/push", pushRoutes);
  server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  _resetDeviceReceiptState();
  events = [];
  forbidden = [];
  ALERTS.clear();
  ALERTS.set(ALERT_ID,  { _id: ALERT_ID,  userId: OWNER_ID, triggeredAt: new Date(Date.now() - 5_000) });
  ALERTS.set(OLD_ALERT, { _id: OLD_ALERT, userId: OWNER_ID, triggeredAt: new Date(Date.now() - 49 * 3600 * 1000) });
});

async function post(body, { raw = false, contentType = "application/json" } = {}) {
  const res = await fetch(`${base}/api/push/device-received`, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: raw ? body : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text };
}

const VALID = () => ({ alertId: ALERT_ID, tokenTail: "abcdefghij0123456789", platform: "web", browser: "Chrome", receivedAt: Date.now() });

// ── Endpoint ─────────────────────────────────────────────────────────────────
test("valid receipt -> 204 empty body, one DEVICE_RECEIVED with owner from AlertLog", async () => {
  const r = await post(VALID());
  assert.equal(r.status, 204);
  assert.equal(r.text, "");
  assert.equal(events.length, 1);
  const e = events[0];
  assert.equal(e.type, "DEVICE_RECEIVED");
  assert.equal(String(e.userId), String(OWNER_ID));
  assert.equal(e.alertId, ALERT_ID);
  assert.equal(e.source, "sw");
  assert.equal(e.meta.tokenTail, "...abcdefghij0123456789");
  assert.equal(e.meta.platform, "web");
  assert.equal(e.meta.browser, "Chrome");
  assert.equal(typeof e.meta.receivedAt, "string");
  assert.deepEqual(forbidden, []);
});

test("minimal receipt (alertId only) is accepted", async () => {
  const r = await post({ alertId: ALERT_ID });
  assert.equal(r.status, 204);
  assert.equal(events.length, 1);
  assert.equal(events[0].meta.tokenTail, null);
});

test("malformed payloads -> 400, nothing recorded", async () => {
  const cases = [
    {},
    { alertId: "not-an-id" },
    { alertId: ALERT_ID.toUpperCase() },
    { alertId: 12345 },
    { ...VALID(), platform: "windows" },
    { ...VALID(), browser: "<script>" },
    { ...VALID(), receivedAt: "yesterday" },
    { ...VALID(), receivedAt: Date.now() - 72 * 3600 * 1000 },
    { ...VALID(), tokenTail: "has spaces" },
  ];
  for (const c of cases) {
    const r = await post(c);
    assert.equal(r.status, 400, `expected 400 for ${JSON.stringify(c)}`);
    assert.equal(r.text, "");
  }
  assert.equal((await post(JSON.stringify([VALID()]), { raw: true })).status, 400);
  assert.equal((await post(JSON.stringify(VALID()), { raw: true, contentType: "text/plain" })).status, 400);
  assert.equal(events.length, 0);
});

test("unexpected keys are rejected (client cannot choose userId or anything else)", async () => {
  for (const extra of [{ userId: String(new mongoose.Types.ObjectId()) }, { token: "x".repeat(40) }, { active: false }, { meta: {} }]) {
    const r = await post({ ...VALID(), ...extra });
    assert.equal(r.status, 400);
  }
  assert.equal(events.length, 0);
  assert.deepEqual(forbidden, []);
});

test("oversized payload -> 413, nothing recorded", async () => {
  const r = await post({ alertId: ALERT_ID, tokenTail: "a".repeat(5000) });
  assert.equal(r.status, 413);
  assert.equal(events.length, 0);
});

test("a full FCM token is rejected and never stored", async () => {
  const fullToken = "dK3xYz:APA91b" + "A".repeat(140);
  const r = await post({ alertId: ALERT_ID, tokenTail: fullToken });
  assert.equal(r.status, 400);
  assert.equal(events.length, 0);

  // A max-length (20 char) tail is stored with the "..." prefix only.
  await post({ alertId: ALERT_ID, tokenTail: fullToken.slice(-20) });
  assert.equal(events.length, 1);
  assert.ok(!JSON.stringify(events[0]).includes(fullToken));
  assert.equal(events[0].meta.tokenTail.length, 23);
});

test("unknown alert or alert older than 48h -> 204 but nothing recorded (no oracle)", async () => {
  const unknown = await post({ ...VALID(), alertId: String(new mongoose.Types.ObjectId()) });
  const old     = await post({ ...VALID(), alertId: OLD_ALERT });
  assert.equal(unknown.status, 204);
  assert.equal(old.status, 204);
  assert.equal(unknown.text, "");
  assert.equal(events.length, 0);
});

test("duplicate receipts are tolerated and recorded once", async () => {
  const body = VALID();
  for (let i = 0; i < 5; i++) assert.equal((await post(body)).status, 204);
  assert.equal(events.length, 1);
  // A different device for the same alert is a separate receipt.
  await post({ ...body, tokenTail: "zzzzzzzzzzzzzzzzzzzz", platform: "android" });
  assert.equal(events.length, 2);
});

test("per-alert cap: at most 20 receipts recorded for one alertId", async () => {
  for (let i = 0; i < 30; i++) await post({ alertId: ALERT_ID, tokenTail: `device${String(i).padStart(4, "0")}` });
  assert.equal(events.length, 20);
});

test("global rate limit -> 429 after 300 receipts/minute", async () => {
  const unknownId = String(new mongoose.Types.ObjectId());
  for (let i = 0; i < 300; i++) {
    const r = await post({ alertId: unknownId, tokenTail: `t${i}` });
    assert.equal(r.status, 204);
  }
  const limited = await post({ alertId: ALERT_ID });
  assert.equal(limited.status, 429);
  assert.equal(events.length, 0);
});

test("AlertLog lookup failure -> 204, no error details leaked", async () => {
  const orig = AlertLog.findById;
  AlertLog.findById = () => ({ select: () => ({ lean: async () => { throw new Error("db exploded: secret-host:27017"); } }) });
  try {
    const r = await post(VALID());
    assert.equal(r.status, 204);
    assert.equal(r.text, "");
    assert.equal(events.length, 0);
  } finally {
    AlertLog.findById = orig;
  }
});

test("existing authenticated push routes still require auth", async () => {
  for (const [method, path] of [["POST", "/register"], ["POST", "/test"], ["GET", "/health"], ["GET", "/debug"]]) {
    const res = await fetch(`${base}/api/push${path}`, { method });
    assert.equal(res.status, 401, `${method} ${path}`);
  }
});

// ── Service worker ───────────────────────────────────────────────────────────
const SW_SRC = fs.readFileSync(new URL("../../client/public/firebase-messaging-sw.js", import.meta.url), "utf8");
// Fake, test-only Firebase identifiers — never a real project.
const SENDER_ID = "100000000001";
const APP_ID = `1:${SENDER_ID}:web:0000000000000000test00`;
const TEST_API_BASE = "https://api.insider-tracker.test/api";
const TEST_FIREBASE_CONFIG = {
  apiKey: "test-api-key",
  authDomain: "insider-tracker-test.firebaseapp.com",
  projectId: "insider-tracker-test",
  storageBucket: "insider-tracker-test.firebasestorage.app",
  messagingSenderId: SENDER_ID,
  appId: APP_ID,
};
const FULL_TOKEN = "fXyZ123:APA91bHk" + "Q".repeat(120) + "TAILtail0123456789ab";

function fakeIndexedDB({ token = FULL_TOKEN, exists = true } = {}) {
  const state = { aborted: false };
  const api = {
    open() {
      const req = {};
      setTimeout(() => {
        if (!exists) {
          req.transaction = { abort: () => { state.aborted = true; } };
          req.onupgradeneeded?.();
          req.onerror?.();
          return;
        }
        req.result = {
          objectStoreNames: { contains: (n) => n === "firebase-messaging-store" },
          transaction: (_store, mode) => {
            state.mode = mode;
            return {
              objectStore: () => ({
                get: (key) => {
                  const g = {};
                  setTimeout(() => { g.result = key === APP_ID ? { token } : undefined; g.onsuccess(); });
                  return g;
                },
              }),
            };
          },
          close() {},
        };
        req.onsuccess();
      });
      return req;
    },
  };
  return { api, state };
}

// swConfig mimics /firebase-sw-config.js (generated by client/vite.config.js):
//   object → importScripts sets self.FIREBASE_CONFIG / self.API_BASE
//   null   → the generated file has incomplete config (FIREBASE_CONFIG = null, no API_BASE)
//   "404"  → importScripts('/firebase-sw-config.js') throws (file not served)
function loadSw({ fetchImpl = async () => ({ ok: true }), idb = fakeIndexedDB(), userAgent,
  swConfig = { FIREBASE_CONFIG: TEST_FIREBASE_CONFIG, API_BASE: TEST_API_BASE } } = {}) {
  const listeners = {};
  const shown = [];
  const fetchCalls = [];
  const opened = [];
  const calls = [];
  let bgHandler = null;
  class ServiceWorkerRegistration {
    showNotification(title, options) { shown.push({ title, options }); return Promise.resolve(); }
  }
  const self = {
    location: { hostname: "app.insider-tracker.test", origin: "https://app.insider-tracker.test" },
    navigator: { userAgent: userAgent ?? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36" },
    registration: new ServiceWorkerRegistration(),
    indexedDB: idb.api,
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
    skipWaiting() {},
  };
  const silent = { log() {}, warn() {}, error() {} };
  const ctx = {
    self,
    importScripts(path) {
      calls.push(`importScripts:${path}`);
      if (path !== "/firebase-sw-config.js") return;
      if (swConfig === "404") throw new Error("NetworkError: failed to load /firebase-sw-config.js");
      self.FIREBASE_CONFIG = swConfig ? swConfig.FIREBASE_CONFIG : null;
      if (swConfig && swConfig.API_BASE !== undefined) self.API_BASE = swConfig.API_BASE;
    },
    firebase: {
      initializeApp(cfg) { calls.push("initializeApp"); self._initConfig = cfg; },
      app: () => ({ options: { appId: APP_ID } }),
      messaging: () => { calls.push("messaging"); return { onBackgroundMessage: (fn) => { bgHandler = fn; } }; },
    },
    ServiceWorkerRegistration,
    clients: { matchAll: async () => [], openWindow: async (u) => { opened.push(u); return null; } },
    fetch: (url, init) => { fetchCalls.push({ url, init }); return fetchImpl(url, init); },
    AbortController, setTimeout, clearTimeout, Promise, JSON, Date, URL,
    console: silent,
  };
  vm.createContext(ctx);
  vm.runInContext(SW_SRC, ctx);

  function dispatchPush(fcmPayload, { badJson = false } = {}) {
    const waits = [];
    const event = {
      data: {
        text: () => JSON.stringify(fcmPayload),
        json: () => { if (badJson) throw new SyntaxError("bad json"); return JSON.parse(JSON.stringify(fcmPayload)); },
      },
      waitUntil: (p) => waits.push(p),
    };
    for (const fn of listeners.push || []) fn(event); // must never throw
    // Firebase's own push listener then hands the payload to onBackgroundMessage.
    const displayed = bgHandler ? bgHandler(JSON.parse(JSON.stringify(fcmPayload))) : null;
    return { waits, displayed };
  }
  function click(notificationData, action = "") {
    const waits = [];
    const event = { action, notification: { data: notificationData, close() {} }, waitUntil: (p) => waits.push(p) };
    for (const fn of listeners.notificationclick || []) fn(event);
    return Promise.all(waits);
  }
  return { dispatchPush, click, opened, shown, fetchCalls, idb, calls, listeners, self };
}

// Insider-alert payload shape, as built by services/insiderPushFormat.js.
const SEC_URL = "https://www.sec.gov/Archives/edgar/data/1866581/000186658126000164/0001866581-26-000164-index.htm";
const alertPayload = (overrides = {}) => ({
  from: SENDER_ID,
  notification: { title: "BROS · Insider sale · $11.7M", body: "Boersma Travis (Executive Chairman of Board) sold 266,000 sh @ $44.0266" },
  data: {
    type: "price_alert",
    kind: "insider_trade",
    alertId: ALERT_ID,
    image: "https://cdn.example/preview.png",
    url: SEC_URL,
    filingUrl: SEC_URL,
    ...overrides,
  },
});

test("SW: real alert push sends one receipt with only safe fields and a 20-char token tail", async () => {
  const sw = loadSw();
  const { waits } = sw.dispatchPush(alertPayload());
  assert.equal(waits.length, 1);
  await Promise.all(waits);
  assert.equal(sw.fetchCalls.length, 1);
  const { url, init } = sw.fetchCalls[0];
  assert.equal(url, `${TEST_API_BASE}/push/device-received`);
  assert.equal(init.method, "POST");
  assert.equal(init.credentials, "omit");
  const body = JSON.parse(init.body);
  assert.deepEqual(Object.keys(body).sort(), ["alertId", "browser", "platform", "receivedAt", "tokenTail"]);
  assert.equal(body.alertId, ALERT_ID);
  assert.equal(body.tokenTail, FULL_TOKEN.slice(-20));
  assert.equal(body.platform, "web");
  assert.equal(body.browser, "Chrome");
  assert.ok(!init.body.includes(FULL_TOKEN));
  assert.equal(sw.idb.state.mode, "readonly");
});

test("SW: android UA is labelled android/Chrome (matches DeviceToken metadata)", async () => {
  const sw = loadSw({ userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36" });
  await Promise.all(sw.dispatchPush(alertPayload({ type: "price_alert" })).waits);
  const body = JSON.parse(sw.fetchCalls[0].init.body);
  assert.equal(body.platform, "android");
  assert.equal(body.browser, "Chrome");
});

test("SW: non-alert pushes (test / aggregated / malformed) send no receipt and never throw", async () => {
  const sw = loadSw();
  const r1 = sw.dispatchPush({ data: { type: "test", url: "/alerts" }, notification: { title: "t" } });
  const r2 = sw.dispatchPush(alertPayload({ type: "price_alert", alertId: "agg_1712345678901" }));
  const r3 = sw.dispatchPush(alertPayload(), { badJson: true });
  assert.equal(r1.waits.length + r2.waits.length + r3.waits.length, 0);
  assert.equal(sw.fetchCalls.length, 0);
  // Notifications are still displayed for all three.
  assert.equal(sw.shown.length, 3);
});

test("SW: missing Firebase IndexedDB is never created; receipt still sent without a tail", async () => {
  const idb = fakeIndexedDB({ exists: false });
  const sw = loadSw({ idb });
  await Promise.all(sw.dispatchPush(alertPayload()).waits);
  assert.equal(idb.state.aborted, true);
  assert.equal(JSON.parse(sw.fetchCalls[0].init.body).tokenTail, null);
});

test("SW: receipt failure or slow backend never blocks or breaks the notification", async () => {
  // Rejecting fetch
  const failing = loadSw({ fetchImpl: async () => { throw new TypeError("Failed to fetch"); } });
  const f = failing.dispatchPush(alertPayload());
  assert.equal(failing.shown.length, 1, "notification shown immediately");
  await assert.doesNotReject(Promise.all(f.waits));

  // Slow fetch: the notification is shown before the receipt resolves
  let release;
  const slow = loadSw({ fetchImpl: () => new Promise((r) => { release = r; }) });
  const s = slow.dispatchPush(alertPayload());
  assert.equal(slow.shown.length, 1);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(slow.fetchCalls.length, 1);
  release({ ok: true });
  await Promise.all(s.waits);
});

test("SW: background notification uses the Insider Tracker template (phase 4b)", async () => {
  const sw = loadSw();
  const { displayed } = sw.dispatchPush(alertPayload());
  await displayed;
  assert.equal(sw.shown.length, 1);
  const { title, options } = sw.shown[0];
  assert.equal(title, "BROS · Insider sale · $11.7M");
  assert.equal(options.body, "Boersma Travis (Executive Chairman of Board) sold 266,000 sh @ $44.0266");
  assert.equal(options.icon, "/icons/insider-notification-192.png");
  assert.equal(options.badge, "/icons/insider-badge-96.png");
  assert.equal(options.tag, ALERT_ID);
  assert.equal(options.renotify, true);
  assert.equal(options.requireInteraction, false);
  assert.equal(options.image, "https://cdn.example/preview.png");
  assert.equal(options.data.clickUrl, SEC_URL);
  // Copy into this realm: arrays built inside the vm context have a different
  // Array.prototype, which deepStrictEqual treats as a mismatch.
  assert.deepEqual([...options.actions.map((a) => [a.action, a.title])], [["open_filing", "Open SEC filing"], ["view_alerts", "View alerts"]]);
});

test("SW: missing title / url / alertId fall back to Insider Tracker defaults", async () => {
  const sw = loadSw();
  await sw.dispatchPush({ data: { type: "test" } }).displayed;
  const { title, options } = sw.shown[0];
  assert.equal(title, "Insider Tracker alert");
  assert.equal(options.data.clickUrl, "/insider");
  assert.equal(options.tag, "test");
  await sw.dispatchPush({ data: {} }).displayed;
  assert.equal(sw.shown[1].options.tag, "insider-tracker");
});

test("SW click: 'Open SEC filing' and body tap open the SEC filing in a new window", async () => {
  const sw = loadSw();
  await sw.click({ clickUrl: SEC_URL }, "open_filing");
  await sw.click({ clickUrl: SEC_URL }, "");
  assert.deepEqual(sw.opened, [SEC_URL, SEC_URL]);
});

test("SW click: 'View alerts' and missing URLs stay inside the app — never a third-party fallback", async () => {
  const sw = loadSw();
  await sw.click({ clickUrl: SEC_URL }, "view_alerts");
  await sw.click({}, "open_filing");
  await sw.click({}, "");
  await sw.click({}, "open_auction"); // legacy action id → app fallback, not an external site
  assert.deepEqual(sw.opened, Array(4).fill("https://app.insider-tracker.test/insider"));
  assert.ok(!SW_SRC.includes("csgoempire"));
});

test("SW: auction_alert type still sends a delivery receipt (receipt allow-list unchanged)", async () => {
  const sw = loadSw();
  await Promise.all(sw.dispatchPush(alertPayload({ type: "auction_alert" })).waits);
  assert.equal(sw.fetchCalls.length, 1);
});

test("FCM message (fcm.js buildMessage) uses Insider Tracker branding and keeps the delivery contract", async () => {
  const { buildMessage } = await import("../services/fcm.js");
  const m = buildMessage(["tokA", "tokB"], { title: "BROS · Insider sale", body: "b", data: { type: "price_alert", alertId: ALERT_ID, url: SEC_URL } });
  assert.deepEqual(m.tokens, ["tokA", "tokB"]);
  assert.deepEqual(m.notification, { title: "BROS · Insider sale", body: "b" });
  assert.equal(m.data.alertId, ALERT_ID);
  assert.equal(m.data.type, "price_alert");
  assert.deepEqual(m.webpush.headers, { Urgency: "high", TTL: "86400" });
  assert.equal(m.webpush.fcmOptions.link, SEC_URL);
  assert.equal(m.webpush.notification.icon, "/icons/insider-notification-192.png");
  assert.equal(m.webpush.notification.badge, "/icons/insider-badge-96.png");
  assert.equal(m.webpush.notification.tag, ALERT_ID);
  assert.deepEqual(m.webpush.notification.actions, [{ action: "open_filing", title: "Open SEC filing" }, { action: "view_alerts", title: "View alerts" }]);
  const noUrl = buildMessage(["t"], { title: "t", body: "b", data: {} });
  assert.equal(noUrl.webpush.fcmOptions.link, "/insider");
  assert.equal(noUrl.webpush.notification.tag, "insider-tracker");
});

test("no SkinTel branding, csgoempire links or full-token logging remain in the notification flow", () => {
  const read = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
  const files = {
    "services/fcm.js": read("../services/fcm.js"),
    "controllers/push.controller.js": read("../controllers/push.controller.js"),
    "client firebase-messaging-sw.js": SW_SRC,
    "client usePushNotifications.js": read("../../client/src/hooks/usePushNotifications.js"),
    "services/insiderPushFormat.js": read("../services/insiderPushFormat.js"),
  };
  for (const [name, src] of Object.entries(files)) {
    assert.doesNotMatch(src, /SkinTel Alert|— SkinTel|SkinTel —|telIcon\.png|Open Auction|open_auction"|csgoempire\.com/, `${name} still has legacy branding`);
    assert.doesNotMatch(src, /Full token|token\[\$\{i\}\]: \$\{t\}/, `${name} logs full FCM tokens`);
  }
  // Push endpoint URLs are logged as tails only in the client hook.
  assert.doesNotMatch(files["client usePushNotifications.js"], /"\\n  endpoint:", \w+Endpoint \?\?/);
  assert.match(files["services/fcm.js"], /tails=\[/);
});

test("SW: generated config is loaded before Firebase is initialized, and used as-is", () => {
  const sw = loadSw();
  const cfgIdx = sw.calls.indexOf("importScripts:/firebase-sw-config.js");
  const initIdx = sw.calls.indexOf("initializeApp");
  assert.ok(cfgIdx >= 0, "config script imported");
  assert.ok(initIdx > cfgIdx, "initializeApp runs after the config script");
  assert.ok(sw.calls.indexOf("messaging") > initIdx, "messaging() runs after initializeApp");
  assert.equal(sw.self._initConfig.projectId, TEST_FIREBASE_CONFIG.projectId);
  assert.equal(sw.self._initConfig.appId, TEST_FIREBASE_CONFIG.appId);
});

test("SW source contains no hardcoded SkinTel production config or URLs", () => {
  assert.doesNotMatch(SW_SRC, /skintel-3fbc1|skintel-app\.onrender\.com|skin-tel\.com|AIza[0-9A-Za-z_-]{10,}/);
});

for (const [label, swConfig] of [["incomplete (null)", null], ["missing (404)", "404"]]) {
  test(`SW: ${label} config fails safe — no init, no receipt, click handler still registered`, async () => {
    let sw;
    assert.doesNotThrow(() => { sw = loadSw({ swConfig }); });
    assert.ok(!sw.calls.includes("initializeApp"), "Firebase not initialized");
    assert.ok(!sw.calls.includes("messaging"), "messaging() not called");
    assert.equal((sw.listeners.notificationclick || []).length, 1);
    assert.equal((sw.listeners.pushsubscriptionchange || []).length, 1);
    const { waits } = sw.dispatchPush(alertPayload());
    await Promise.all(waits);
    assert.equal(waits.length, 0);
    assert.equal(sw.fetchCalls.length, 0, "no receipt without API_BASE");
  });
}

test("SW: config present but API_BASE missing → push still initialized, receipts skipped", async () => {
  const sw = loadSw({ swConfig: { FIREBASE_CONFIG: TEST_FIREBASE_CONFIG } });
  assert.ok(sw.calls.includes("initializeApp"));
  const { waits, displayed } = sw.dispatchPush(alertPayload());
  await displayed;
  assert.equal(waits.length, 0);
  assert.equal(sw.fetchCalls.length, 0);
  assert.equal(sw.shown.length, 1, "notification still displayed");
});

test("SW -> real endpoint: receipt is recorded as DEVICE_RECEIVED without the full token", async () => {
  const sw = loadSw({ fetchImpl: (_url, init) => fetch(`${base}/api/push/device-received`, init) });
  await Promise.all(sw.dispatchPush(alertPayload()).waits);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "DEVICE_RECEIVED");
  assert.equal(String(events[0].userId), String(OWNER_ID));
  assert.equal(events[0].meta.tokenTail, "..." + FULL_TOKEN.slice(-20));
  assert.ok(!JSON.stringify(events[0]).includes(FULL_TOKEN));
  assert.deepEqual(forbidden, []);
});
