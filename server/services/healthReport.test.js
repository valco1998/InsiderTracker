// Phase C — health classification (pure) and live MongoDB connectivity tracking.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import express from "express";
import { computeHealth } from "./healthReport.js";

process.env.JWT_SECRET = "t".repeat(40);
const { attachConnectionMonitor, createDbPinger, requireAccounts, isAccountsReady, getDbState, _resetDbStateForTests } = await import("./insiderDb.js");

const NOW = Date.parse("2026-11-02T15:00:00Z");
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const goodDb = () => ({ configured: true, verified: true, connected: true, lastPingAt: iso(10_000), lastPingMs: 180, pingFailures: 0, disconnects: 0, reconnects: 0, indexIssues: [] });
const goodIngest = () => ({
  pollIntervalMs: 60_000, lastPollAt: iso(20_000), lastPollAttemptAt: iso(20_000), lastPollError: null, consecutivePollFailures: 0,
  initialSyncCompletedAt: iso(3_600_000), queueLength: 0, filingsFailed: 0,
  retry: { scheduled: 0, exhausted: 0, permanent: 2 }, coverage: [{ day: "2026-10-30", listed: 318, parsed: 318, failed: 0, pending: 0 }],
  recovery: { missingDays: 0, truncated: false }, dataVersion: 7,
  cache: { saves: 3, saveFailures: 0, consecutiveFailures: 0, lastSaveAt: iso(30_000), dirtySince: null, lastError: null },
});
const snap = { builds: 2, lastBuildMs: 60, lastBuiltAt: iso(25_000), version: 7, rows: 2461 };
const health = (over = {}, opts) => computeHealth({ db: goodDb(), ingest: goodIngest(), snapshot: snap, accountsConfigured: true, now: NOW, ...over }, opts);

test("healthy system → ok and ready; permanent non-Form-4 failures are not unhealthy", () => {
  const h = health();
  assert.equal(h.status, "ok");
  assert.equal(h.ready, true);
  assert.deepEqual(h.reasons, []);
  assert.equal(h.checks.mongo.state, "connected");
  assert.equal(h.checks.sec.state, "ok");
  assert.equal(h.checks.ingestion.state, "ok");
  assert.equal(h.checks.cache.state, "ok");
  assert.equal(h.checks.snapshot.behindIngest, false);
});

test("MongoDB disconnected → degraded and NOT ready; ping failures → degraded only", () => {
  const down = health({ db: { ...goodDb(), connected: false, disconnectedSince: iso(45_000), lastError: "MongoNetworkError" } });
  assert.equal(down.status, "degraded");
  assert.equal(down.ready, false);
  assert.deepEqual(down.reasons, ["mongo_disconnected"]);
  assert.equal(down.checks.mongo.disconnectedForMs, 45_000);
  const flaky = health({ db: { ...goodDb(), pingFailures: 1 } });
  assert.deepEqual(flaky.reasons, ["mongo_ping_failing"]);
  assert.equal(flaky.ready, true);
});

test("accounts not configured → MongoDB 'disabled', never unhealthy", () => {
  const h = health({ db: { configured: false, verified: false, connected: false, reason: "MONGO_URI is not set" }, accountsConfigured: false });
  assert.equal(h.status, "ok");
  assert.equal(h.ready, true);
  assert.equal(h.checks.mongo.state, "disabled");
});

test("index conflicts (e.g. a TTL index blocked by a plain one) are surfaced", () => {
  const h = health({ db: { ...goodDb(), indexIssues: [{ collection: "alertlogs", code: "IndexOptionsConflict" }] } });
  assert.deepEqual(h.reasons, ["mongo_index_conflict"]);
  assert.equal(h.ready, true);
});

test("SEC polling: stale after 3 intervals (degraded), not ready after 15 min, initial sync pending, poll error", () => {
  const stale = health({ ingest: { ...goodIngest(), lastPollAt: iso(4 * 60_000) } });
  assert.deepEqual(stale.reasons, ["sec_poll_stale"]);
  assert.equal(stale.ready, true);
  assert.equal(stale.checks.sec.lastPollAgeMs, 240_000);
  const veryStale = health({ ingest: { ...goodIngest(), lastPollAt: iso(20 * 60_000), lastPollError: "feed: [EDGAR] HTTP 503", consecutivePollFailures: 20 } });
  assert.equal(veryStale.ready, false);
  assert.equal(veryStale.checks.sec.state, "stale");
  const never = health({ ingest: { ...goodIngest(), lastPollAt: null } });
  assert.equal(never.ready, false, "initial sync done but no poll ever succeeded");
  const syncing = health({ ingest: { ...goodIngest(), initialSyncCompletedAt: null } });
  assert.deepEqual(syncing.reasons, ["sec_initial_sync"]);
  assert.equal(syncing.ready, false);
  const errored = health({ ingest: { ...goodIngest(), lastPollError: "index: [EDGAR] HTTP 503" } });
  assert.deepEqual(errored.reasons, ["sec_poll_error"]);
});

test("ingestion: exhausted retries and failed days degrade; a backlog is only 'catching_up'", () => {
  const ex = health({ ingest: { ...goodIngest(), retry: { scheduled: 0, exhausted: 2, permanent: 0 }, coverage: [{ day: "2026-10-30", listed: 318, parsed: 316, failed: 2, pending: 0 }] } });
  assert.deepEqual(ex.reasons, ["sec_downloads_exhausted"]);
  assert.deepEqual(ex.checks.ingestion.daysWithFailures, ["2026-10-30"]);
  const busy = health({ ingest: { ...goodIngest(), queueLength: 900, retry: { scheduled: 3, exhausted: 0, permanent: 0 } } });
  assert.equal(busy.status, "ok");
  assert.equal(busy.checks.ingestion.state, "catching_up");
  const trunc = health({ ingest: { ...goodIngest(), recovery: { missingDays: 0, truncated: true } } });
  assert.deepEqual(trunc.reasons, ["sec_recovery_truncated"]);
});

test("cache writes: failing → degraded; unsaved changes older than 5 min → behind", () => {
  const failing = health({ ingest: { ...goodIngest(), cache: { ...goodIngest().cache, consecutiveFailures: 2, saveFailures: 2, lastError: "Error: EACCES", dirtySince: iso(60_000) } } });
  assert.deepEqual(failing.reasons, ["cache_write_failing"]);
  assert.equal(failing.checks.cache.lastError, "Error: EACCES");
  const behind = health({ ingest: { ...goodIngest(), cache: { ...goodIngest().cache, dirtySince: iso(6 * 60_000) } } });
  assert.deepEqual(behind.reasons, ["cache_write_behind"]);
  const pendingNormal = health({ ingest: { ...goodIngest(), cache: { ...goodIngest().cache, dirtySince: iso(1500) } } });
  assert.equal(pendingNormal.status, "ok");
});

// ── Live MongoDB connectivity (insiderDb) ────────────────────────────────────
const verifiedState = () => Object.assign(_resetDbStateForTests(), { configured: true, verified: true, connected: true, dbName: "insider_tracker" });
const quiet = () => { const o = console.warn, l = console.log; console.warn = () => {}; console.log = () => {}; return () => { console.warn = o; console.log = l; }; };

test("driver events: disconnect → 503 fail-fast on account routes; reconnect → routes served again", async () => {
  const restore = quiet();
  try {
    const st = verifiedState();
    const conn = new EventEmitter();
    attachConnectionMonitor(conn, st);
    const app = express();
    app.get("/acc", requireAccounts, (_req, res) => res.json({ ok: true }));
    const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
    const url = `http://127.0.0.1:${server.address().port}/acc`;
    try {
      assert.equal((await fetch(url)).status, 200);
      conn.emit("disconnected");
      assert.equal(isAccountsReady(), false);
      const r = await fetch(url);
      assert.equal(r.status, 503);
      assert.equal(r.headers.get("retry-after"), "15");
      assert.deepEqual(await r.json(), { ok: false, error: "Account features are temporarily unavailable" });
      assert.ok(getDbState().disconnectedSince);
      conn.emit("error", Object.assign(new Error("connect ECONNREFUSED mongodb+srv://x:y@h/db"), { name: "MongoNetworkError" }));
      assert.equal(getDbState().lastError, "MongoNetworkError");
      conn.emit("reconnected");
      assert.equal((await fetch(url)).status, 200);
      const s = getDbState();
      assert.equal(s.disconnects, 1);
      assert.equal(s.reconnects, 1);
      assert.equal(s.disconnectedSince, null);
    } finally { await new Promise((r) => server.close(r)); }
  } finally { restore(); }
});

test("unconfigured accounts keep the original 503 message", async () => {
  _resetDbStateForTests();
  const res = { statusCode: 0, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } };
  requireAccounts({}, res, () => assert.fail("must not pass"));
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, "Account features are not configured");
});

test("pinger: consecutive failures/timeouts mark MongoDB down; a successful ping recovers", async () => {
  const restore = quiet();
  try {
    const st = verifiedState();
    let mode = "ok";
    const ping = () => (mode === "ok" ? Promise.resolve({ ok: 1 }) : mode === "hang" ? new Promise(() => {}) : Promise.reject(Object.assign(new Error("boom"), { name: "MongoServerSelectionError" })));
    const tick = createDbPinger({ ping, st, timeoutMs: 20, failAfter: 2 });
    assert.equal(await tick(), true);
    assert.equal(st.pingFailures, 0);
    assert.ok(st.lastPingMs >= 0);
    mode = "fail";
    assert.equal(await tick(), false);
    assert.equal(st.connected, true, "one failure is tolerated");
    mode = "hang";
    assert.equal(await tick(), false);
    assert.equal(st.connected, false);
    assert.equal(st.lastError, "PingTimeout");
    mode = "ok";
    assert.equal(await tick(), true);
    assert.equal(st.connected, true);
    assert.equal(st.pingFailures, 0);
  } finally { restore(); }
});
