// Phase D3 — SSE snapshot stream, gzip filter and /transactions ETag/304.
// Real HTTP on 127.0.0.1 (ephemeral ports); no SEC traffic, no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import compression from "compression";
import { createSnapshotStream, describeSnapshot, secFreshness, compressionFilter } from "./insiderStream.js";

async function serve(app) {
  const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}

const until = async (cond, ms = 3000) => { const end = Date.now() + ms; while (!cond()) { if (Date.now() > end) throw new Error("timeout"); await new Promise((r) => setTimeout(r, 2)); } };

// Minimal SSE client over fetch: collects parsed frames.
async function openStream(url, headers = {}) {
  const ac = new AbortController();
  const res = await fetch(url, { headers: { "Accept-Encoding": "gzip", ...headers }, signal: ac.signal });
  const s = { res, events: [], closed: false, close: () => ac.abort() };
  if (!res.body || res.status !== 200) { s.closed = true; return s; }
  (async () => {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const ev = {};
          for (const line of buf.slice(0, i).split("\n")) {
            const k = line.slice(0, line.indexOf(":")), v = line.slice(line.indexOf(":") + 1).trimStart();
            if (k === "data") ev.data = JSON.parse(v); else if (k) ev[k] = v; else ev.comment = v;
          }
          ev.receivedAt = performance.now();
          s.events.push(ev);
          buf = buf.slice(i + 2);
        }
      }
    } catch { /* aborted */ }
    s.closed = true;
  })();
  return s;
}
const ofType = (s, type) => s.events.filter((e) => e.event === type);

const info = (version) => ({ version, publishedAt: new Date(1_800_000_000_000 + version).toISOString(), rows: version * 10, total: version * 9, newestAcceptedAt: "2026-10-30 16:07:47 ET" });

function streamApp(opts = {}) {
  let currentCalls = 0;
  const hub = createSnapshotStream({ heartbeatMs: 60_000, getCurrent: () => { currentCalls++; return info(1); }, getSecStatus: () => ({ state: "ok", lastPollAt: "2026-11-02T15:00:00.000Z", pollIntervalMs: 60_000, queueLength: 0 }), ...opts });
  const app = express();
  app.use(compression({ filter: compressionFilter }));
  app.get("/stream", (req, res) => hub.handle(req, res));
  app.get("/big", (_req, res) => res.json({ rows: Array.from({ length: 2000 }, (_, i) => ({ i, text: "Form 4 transaction row" })) }));
  return { app, hub, currentCalls: () => currentCalls };
}

test("connect: SSE headers, never gzip-buffered, retry hint, current snapshot sent once with id = version", async () => {
  const { app, hub } = streamApp();
  const srv = await serve(app);
  try {
    const s = await openStream(`${srv.base}/stream`);
    assert.equal(s.res.status, 200);
    assert.match(s.res.headers.get("content-type"), /^text\/event-stream/);
    assert.equal(s.res.headers.get("content-encoding"), null, "SSE must not be compressed");
    assert.match(s.res.headers.get("cache-control"), /no-cache/);
    await until(() => ofType(s, "snapshot").length === 1);
    assert.equal(s.events[0].retry, "5000");
    const ev = ofType(s, "snapshot")[0];
    assert.equal(ev.id, "1");
    assert.deepEqual(ev.data, info(1));
    // JSON responses on the same app ARE gzipped.
    const big = await fetch(`${srv.base}/big`, { headers: { "Accept-Encoding": "gzip" } });
    assert.equal(big.headers.get("content-encoding"), "gzip");
    assert.equal((await big.json()).rows.length, 2000);
    s.close();
    await until(() => hub.getStats().clients === 0);
  } finally { hub.close(); await srv.close(); }
});

test("50 simultaneous clients: each new version reaches every client exactly once; repeats/older versions are never sent; no per-client snapshot work", async () => {
  const { app, hub, currentCalls } = streamApp({ maxPerIp: 100 }); // all test clients share 127.0.0.1
  const srv = await serve(app);
  try {
    const clients = await Promise.all(Array.from({ length: 50 }, () => openStream(`${srv.base}/stream`)));
    await until(() => clients.every((c) => ofType(c, "snapshot").length === 1));
    assert.equal(currentCalls(), 1, "current state computed once for all 50 clients");
    assert.equal(hub.getStats().clients, 50);

    assert.equal(hub.publish(info(2)), 50);
    assert.equal(hub.publish(info(2)), 0, "same version → nothing");
    assert.equal(hub.publish(info(1)), 0, "older version → nothing");
    hub.publish(info(3));
    await until(() => clients.every((c) => ofType(c, "snapshot").length === 3));
    for (const c of clients) assert.deepEqual(ofType(c, "snapshot").map((e) => Number(e.id)), [1, 2, 3]);
    assert.equal(hub.getStats().events, 2);
    clients.forEach((c) => c.close());
    await until(() => hub.getStats().clients === 0);
  } finally { hub.close(); await srv.close(); }
});

test("reconnect: Last-Event-ID (header or ?lastEventId) equal to the current version → no duplicate snapshot; stale id → current state", async () => {
  const { app, hub } = streamApp();
  const srv = await serve(app);
  try {
    hub.publish(info(7));
    const upToDate = await openStream(`${srv.base}/stream`, { "Last-Event-ID": "7" });
    const viaQuery = await openStream(`${srv.base}/stream?lastEventId=7`);
    const behind = await openStream(`${srv.base}/stream`, { "Last-Event-ID": "4" });
    await until(() => ofType(behind, "snapshot").length === 1);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(ofType(upToDate, "snapshot").length, 0);
    assert.equal(ofType(viaQuery, "snapshot").length, 0);
    assert.equal(ofType(behind, "snapshot")[0].id, "7");
    hub.publish(info(8));
    await until(() => [upToDate, viaQuery, behind].every((c) => ofType(c, "snapshot").some((e) => e.id === "8")));
    [upToDate, viaQuery, behind].forEach((c) => c.close());
  } finally { hub.close(); await srv.close(); }
});

test("heartbeat carries real SEC freshness; timer stops when the last client leaves", async () => {
  const { app, hub } = streamApp({ heartbeatMs: 30 });
  const srv = await serve(app);
  try {
    const s = await openStream(`${srv.base}/stream`);
    await until(() => ofType(s, "heartbeat").length >= 2);
    const hb = ofType(s, "heartbeat")[0].data;
    assert.equal(hb.version, 1);
    assert.deepEqual(hb.sec, { state: "ok", lastPollAt: "2026-11-02T15:00:00.000Z", pollIntervalMs: 60_000, queueLength: 0 });
    assert.ok(Date.parse(hb.at) > 0);
    s.close();
    await until(() => hub.getStats().clients === 0);
    const n = hub.getStats().heartbeats;
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(hub.getStats().heartbeats, n, "no heartbeats without clients");
  } finally { hub.close(); await srv.close(); }
});

test("connection limits: per-IP → 429, global → 503 (with Retry-After); close() ends every stream", async () => {
  const { app, hub } = streamApp({ maxPerIp: 2, maxClients: 3 });
  const srv = await serve(app);
  try {
    const a = await openStream(`${srv.base}/stream`);
    const b = await openStream(`${srv.base}/stream`);
    const c = await openStream(`${srv.base}/stream`);
    assert.equal(c.res.status, 429);
    assert.equal(c.res.headers.get("retry-after"), "30");
    assert.equal(hub.getStats().rejected, 1);
    hub.close();
    await until(() => a.closed && b.closed);
    assert.equal(hub.getStats().clients, 0);
  } finally { hub.close(); await srv.close(); }
  // Global cap (different "IPs" via a fake request object).
  const hub2 = createSnapshotStream({ maxClients: 1, maxPerIp: 5, getCurrent: () => info(1) });
  const fakeRes = () => ({ statusCode: 0, headers: {}, body: null, writableLength: 0, status(c) { this.statusCode = c; return this; }, set(k, v) { if (typeof k === "object") Object.assign(this.headers, k); else this.headers[k] = v; return this; }, json(b) { this.body = b; return this; }, write() { return true; }, end() {} });
  const fakeReq = (ip) => ({ ip, on() {}, get: () => undefined, query: {} });
  hub2.handle(fakeReq("10.0.0.1"), fakeRes());
  const r = fakeRes();
  hub2.handle(fakeReq("10.0.0.2"), r);
  assert.equal(r.statusCode, 503);
  hub2.close();
});

test("a slow consumer (unsent backlog > 256 KB) is dropped without affecting others", () => {
  const hub = createSnapshotStream({ getCurrent: () => info(1) });
  const mk = (writable) => ({ ended: false, writableLength: writable, status() { return this; }, set() { return this; }, write() { return true; }, end() { this.ended = true; } });
  const req = (ip) => ({ ip, on() {}, get: () => undefined, query: {} });
  const fast = mk(0);
  const slow = mk(0);
  hub.handle(req("1.1.1.1"), fast);
  hub.handle(req("2.2.2.2"), slow);
  slow.writableLength = 300 * 1024;
  hub.publish(info(2));
  assert.equal(slow.ended, true);
  assert.equal(fast.ended, false);
  assert.equal(hub.getStats().clients, 1);
  assert.equal(hub.getStats().dropped, 1);
  hub.close();
});

test("describeSnapshot / secFreshness take every value from real state (nothing synthesized)", () => {
  const snap = { version: 42, builtAt: Date.parse("2026-11-02T15:00:00Z"), raw: [{ acceptedAtET: "2026-11-02 09:59:01 ET" }, {}], economic: [{}] };
  assert.deepEqual(describeSnapshot(snap, Date.parse("2026-11-02T15:00:01Z")), { version: 42, publishedAt: "2026-11-02T15:00:01.000Z", rows: 2, total: 1, newestAcceptedAt: "2026-11-02 09:59:01 ET" });
  assert.equal(describeSnapshot({ ...snap, raw: [], economic: [] }).newestAcceptedAt, null);
  const fresh = new Date(Date.now() - 10_000).toISOString();
  const base = { initialSyncCompletedAt: fresh, lastPollAt: fresh, pollIntervalMs: 60_000, queueLength: 3 };
  assert.deepEqual(secFreshness(base), { state: "ok", lastPollAt: fresh, pollIntervalMs: 60_000, queueLength: 3 });
  assert.equal(secFreshness({ ...base, initialSyncCompletedAt: null }).state, "initial_sync");
  assert.equal(secFreshness({ ...base, throttle: { paused: true } }).state, "throttled");
  assert.equal(secFreshness({ ...base, lastPollAt: new Date(Date.now() - 4 * 60_000).toISOString() }).state, "stale");
  assert.equal(secFreshness({ ...base, lastPollAt: null }).state, "stale");
  assert.equal(secFreshness({ ...base, lastPollError: "feed: HTTP 503" }).state, "error");
  assert.equal(secFreshness(null), null);
});

// ── Real routes (default, unstarted ingest → empty but real snapshot) ─────────
test("routes: /transactions ETag → 304 before querying; query/status/version changes → 200; /stream serves the real snapshot version", async () => {
  const { default: insiderRoutes, transactionsEtag } = await import("../../routers/insiderRoutes.js");
  const app = express();
  app.use(compression({ filter: compressionFilter }));
  app.use("/api/insider", insiderRoutes);
  const srv = await serve(app);
  try {
    const url = `${srv.base}/api/insider/transactions?view=compact&limit=100`;
    const r1 = await fetch(url);
    assert.equal(r1.status, 200);
    const etag = r1.headers.get("etag");
    assert.match(etag, /^W\/"v\d+-[A-Za-z0-9_-]{22}"$/);
    assert.equal(r1.headers.get("cache-control"), "no-cache");
    const body = await r1.json();
    assert.equal(typeof body.snapshotVersion, "number");
    assert.ok(Array.isArray(body.transactions) && body.status, "existing fields unchanged");

    const r2 = await fetch(url, { headers: { "If-None-Match": etag } });
    assert.equal(r2.status, 304);
    assert.equal(await r2.text(), "");

    const r3 = await fetch(`${srv.base}/api/insider/transactions?view=compact&limit=50`, { headers: { "If-None-Match": etag } });
    assert.equal(r3.status, 200, "different query → different ETag");
    assert.notEqual(transactionsEtag(1, { a: 1 }, { s: 1 }), transactionsEtag(2, { a: 1 }, { s: 1 }), "version is part of the ETag");
    assert.notEqual(transactionsEtag(1, { a: 1 }, { s: 1 }), transactionsEtag(1, { a: 1 }, { s: 2 }), "status is part of the ETag");
    const { ifNoneMatch } = await import("../../routers/insiderRoutes.js");
    assert.equal(ifNoneMatch('W/"a", "b"', '"b"'), true, "list + weak comparison");
    assert.equal(ifNoneMatch("*", 'W/"x"'), true);
    assert.equal(ifNoneMatch('"c"', 'W/"x"'), false);
    assert.equal(ifNoneMatch(undefined, 'W/"x"'), false);

    const bad = await fetch(`${srv.base}/api/insider/transactions?type=nope`);
    assert.equal(bad.status, 400);
    assert.doesNotMatch(bad.headers.get("etag") ?? "", /^W\/"v\d/, "an error is never tagged with the snapshot ETag");

    const s = await openStream(`${srv.base}/api/insider/stream`);
    await until(() => ofType(s, "snapshot").length === 1);
    assert.equal(Number(ofType(s, "snapshot")[0].id), body.snapshotVersion);
    assert.equal(s.res.headers.get("content-encoding"), null);
    s.close();
    const status = await (await fetch(`${srv.base}/api/insider/status`)).json();
    assert.ok(status.stream && typeof status.stream.connects === "number");
  } finally {
    (await import("./insiderData.js")).snapshotStream.close();
    await srv.close();
  }
});
