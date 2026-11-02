// node --test src/utils  (framework-free module; fake EventSource + mocked timers)
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { createLiveStream, liveIndicator } from "./insiderLiveStream.js";

class FakeES {
  static all = [];
  constructor(url) { this.url = url; this.readyState = 0; this.handlers = {}; this.closed = false; FakeES.all.push(this); }
  addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); }
  close() { this.closed = true; this.readyState = 2; }
  // test helpers
  open() { this.readyState = 1; this.onopen?.(); }
  emit(type, data) { (this.handlers[type] || []).forEach((fn) => fn({ data: JSON.stringify(data) })); }
  fail(readyState) { this.readyState = readyState; this.onerror?.(); }
}
const last = () => FakeES.all[FakeES.all.length - 1];

function setup(opts = {}) {
  FakeES.all = [];
  mock.timers.enable({ apis: ["setTimeout"] });
  const live = createLiveStream("http://api/insider/stream", { EventSourceImpl: FakeES, stallMs: 70_000, ...opts });
  const versions = [];
  live.onSnapshot((d) => versions.push(d.version));
  live.start();
  return { live, versions };
}
const teardown = (live) => { live.stop(); mock.timers.reset(); };

test("one connection; open → state open", () => {
  const { live } = setup();
  assert.equal(FakeES.all.length, 1);
  assert.equal(live.getState().connection, "connecting");
  last().open();
  assert.equal(live.getState().connection, "open");
  live.start(); // idempotent: no second EventSource
  assert.equal(FakeES.all.length, 1);
  teardown(live);
});

test("snapshot: new version notifies once; same version does not", () => {
  const { live, versions } = setup();
  last().open();
  last().emit("snapshot", { version: 10, newestAcceptedAt: "2026-11-02 09:00:00 ET" });
  last().emit("snapshot", { version: 10 });
  last().emit("snapshot", { version: 11 });
  assert.deepEqual(versions, [10, 11]);
  assert.equal(live.getState().snapshot.newestAcceptedAt, undefined); // last snapshot payload is kept as sent
  assert.equal(live.getState().version, 11);
  teardown(live);
});

test("server restart: a LOWER version is still reported as new data", () => {
  const { live, versions } = setup();
  last().open();
  last().emit("snapshot", { version: 500 });
  last().emit("snapshot", { version: 3 });
  assert.deepEqual(versions, [500, 3]);
  teardown(live);
});

test("missed event: heartbeat naming another version notifies", () => {
  const { live, versions } = setup();
  last().open();
  last().emit("snapshot", { version: 7 });
  last().emit("heartbeat", { at: "x", version: 7, sec: { state: "ok" } });
  last().emit("heartbeat", { at: "y", version: 9, sec: { state: "ok" } });
  last().emit("heartbeat", { at: "z", version: 9, sec: { state: "ok" } });
  assert.deepEqual(versions, [7, 9]);
  assert.equal(live.getState().heartbeat.at, "z");
  teardown(live);
});

test("browser auto-reconnect (CONNECTING) → reconnecting, then open again on the same EventSource", () => {
  const { live } = setup();
  last().open();
  last().fail(0);
  assert.equal(live.getState().connection, "reconnecting");
  assert.equal(FakeES.all.length, 1);
  last().open();
  assert.equal(live.getState().connection, "open");
  teardown(live);
});

test("refused (CLOSED, e.g. 404/429) → unavailable, retried with backoff, lastEventId carried", () => {
  const { live } = setup();
  last().open();
  last().emit("snapshot", { version: 42 });
  last().fail(2);
  assert.equal(live.getState().connection, "unavailable");
  assert.equal(FakeES.all.length, 1);
  mock.timers.tick(4_999);
  assert.equal(FakeES.all.length, 1);
  mock.timers.tick(1);
  assert.equal(FakeES.all.length, 2);
  assert.match(last().url, /\?lastEventId=42$/);
  last().fail(2);
  mock.timers.tick(9_999);
  assert.equal(FakeES.all.length, 2); // backoff doubled to 10 s
  mock.timers.tick(1);
  assert.equal(FakeES.all.length, 3);
  last().open();
  assert.equal(live.getState().connection, "open");
  teardown(live);
});

test("silent stream: watchdog reopens after stallMs", () => {
  const { live } = setup();
  last().open();
  const first = last();
  mock.timers.tick(69_999);
  assert.equal(FakeES.all.length, 1);
  mock.timers.tick(1);
  assert.equal(first.closed, true);
  assert.equal(FakeES.all.length, 2);
  assert.equal(live.getState().connection, "reconnecting");
  teardown(live);
});

test("heartbeats keep the watchdog quiet", () => {
  const { live } = setup();
  last().open();
  for (let i = 0; i < 5; i++) { mock.timers.tick(25_000); last().emit("heartbeat", { version: null, sec: null }); }
  assert.equal(FakeES.all.length, 1);
  teardown(live);
});

test("stop closes the connection and cancels retries", () => {
  const { live } = setup();
  last().fail(2);
  live.stop();
  mock.timers.tick(600_000);
  assert.equal(FakeES.all.length, 1);
  assert.equal(live.getState().connection, "idle");
  mock.timers.reset();
});

test("unsupported browser → polling only", () => {
  const live = createLiveStream("u", { EventSourceImpl: undefined });
  live.start();
  assert.equal(live.getState().connection, "unsupported");
  assert.match(liveIndicator(live.getState(), Date.now(), 60_000).text, /Polling every 60s/);
  live.stop();
});

test("liveIndicator reflects real states", () => {
  const now = 1_000_000;
  assert.equal(liveIndicator({ connection: "connecting" }, now), null);
  assert.match(liveIndicator({ connection: "reconnecting" }, now, 8_000).text, /Reconnecting.*8s/);
  assert.match(liveIndicator({ connection: "unavailable" }, now).text, /Polling every 60s/);
  const hb = (state, q = 0) => ({ connection: "open", heartbeat: { sec: { state, queueLength: q } }, lastMessageAt: now - 1000 });
  assert.equal(liveIndicator(hb("ok"), now).text, "Live · SEC EDGAR");
  assert.match(liveIndicator(hb("throttled"), now).text, /rate limit/);
  assert.match(liveIndicator(hb("stale"), now).text, /delayed/);
  // open but silent longer than the stall window → not claimed as fresh
  assert.equal(liveIndicator({ ...hb("ok"), lastMessageAt: now - 80_000 }, now).text, "Live");
});
