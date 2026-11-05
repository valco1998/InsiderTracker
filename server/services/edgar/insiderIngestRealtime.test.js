// Phase D0–D2 regression tests: non-blocking discovery during backlogs, prompt
// publication, SEC throttling without lost/duplicated filings, restart recovery
// and latency instrumentation. SIMULATED SEC + controllable clock; filing bodies
// are REAL SEC fixtures, feed/index documents are synthetic listings in SEC's
// formats. No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInsiderIngest } from "./insiderIngest.js";
import { createEdgarClient } from "./edgarClient.js";
import { createSnapshotStore } from "./insiderSnapshot.js";
import { summarize, timelineMetrics, acceptedAtIso, createLatencyTracker } from "./ingestLatency.js";
import { parseFeedForm4, parseFeedTimestamp } from "./edgarSources.js";
import { computeHealth } from "../healthReport.js";

const fx = (acc) => fs.readFileSync(new URL(`./__fixtures__/${acc}.txt`, import.meta.url), "utf8");
const F = {
  BOERSMA: { acc: "0001866581-26-000164", cik: "1866581", accepted: "2026-10-30T20:07:32.000Z" },
  DM_TRUST: { acc: "0001866581-26-000166", cik: "1866581" },
  DM_IND: { acc: "0001866581-26-000167", cik: "1866581" },
  LONA: { acc: "0002126186-26-000002", cik: "2126186", accepted: "2026-10-29T00:43:08.000Z" },
  FLG: { acc: "0001649471-26-000006", cik: "1649471" },
  USCB: { acc: "0001437749-26-034087", cik: "1437749" },
};
const BODY = Object.fromEntries(Object.values(F).map((f) => [f.acc, fx(f.acc)]));
const BACKLOG = [F.DM_IND, F.DM_TRUST, F.FLG, F.USCB, F.BOERSMA];

const httpError = (status, extra = {}) => Object.assign(new Error(`[EDGAR] HTTP ${status}`), { status, ...extra });
const idxLine = (f) => `4           FIXTURE ISSUER                                               ${f.cik}     20261029    edgar/data/${f.cik}/${f.acc}.txt`;
const dailyIndex = (files) => ["Form Type   Company Name   CIK   Date Filed  File Name", "-".repeat(80), ...files.map(idxLine)].join("\n");
const atom = (files) => `<feed><updated>2026-10-30T16:10:00-04:00</updated>${files.map((f) => `<entry><updated>${f.updated ?? ""}</updated><category scheme="https://www.sec.gov/" label="form type" term="4"/><link href="https://www.sec.gov/Archives/edgar/data/${f.cik}/${f.acc.replace(/-/g, "")}/${f.acc}-index.htm"/></entry>`).join("")}</feed>`;

// Simulated SEC as a fetchText(url) function. `hooks.txt(acc)` may return a body,
// throw, or await; `hooks.feed()` may block.
function fakeSec(cfg = {}) {
  cfg.days ??= {}; cfg.feed ??= []; cfg.hooks ??= {};
  const requests = [];
  const fetchText = async (url) => {
    requests.push(url);
    const u = new URL(url);
    if (u.pathname === "/cgi-bin/browse-edgar") {
      if (cfg.hooks.feed) await cfg.hooks.feed();
      return atom(u.searchParams.get("start") === "0" ? cfg.feed : []);
    }
    let m = u.pathname.match(/form\.(\d{8})\.idx$/);
    if (m) {
      const iso = `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}`;
      const d = cfg.days[iso];
      if (d === undefined) throw httpError(404);
      if (typeof d === "number") throw httpError(d);
      return dailyIndex(d);
    }
    // Quarter directory listing: `cfg.listing` = ISO days listed; absent → 404 (index requested directly).
    if (u.pathname.endsWith("/index.json")) {
      if (!cfg.listing) throw httpError(404);
      return JSON.stringify({ directory: { item: cfg.listing.map((d) => ({ name: `form.${d.replace(/-/g, "")}.idx` })) } });
    }
    m = u.pathname.match(/\/(\d{10}-\d{2}-\d{6})\.txt$/);
    if (m) {
      if (cfg.hooks.txt) { const r = await cfg.hooks.txt(m[1]); if (r !== undefined) return r; }
      if (!BODY[m[1]]) throw httpError(404);
      return BODY[m[1]];
    }
    throw new Error(`unexpected URL ${url}`);
  };
  const txtOf = (acc) => requests.filter((r) => r.endsWith(`${acc}.txt`)).length;
  return { fetchText, requests, txtOf, cfg };
}

const tmpCache = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "insider-rt-")), "cache.json");
const quietLog = () => { const lines = []; return { lines, log: (m) => lines.push(m), warn: (m) => lines.push(m), error: (m) => lines.push(m) }; };
const clock = (iso) => { let t = Date.parse(iso); return { now: () => t, advance: (ms) => { t += ms; }, set: (s) => { t = Date.parse(s); } }; };
const make = (fetchText, c, o = {}) => createInsiderIngest({
  fetchText, now: c.now, cacheFile: o.cacheFile ?? tmpCache(), log: o.log ?? quietLog(),
  backfillDays: 1, recoveryMaxDays: 30, retryBaseMs: 1000, retryMaxMs: 60_000, retryMaxAttempts: 5,
  getClientStats: () => ({}), setTimer: () => null, clearTimer: () => {}, ...o,
});
const tick = () => new Promise((r) => setImmediate(r));
const until = async (cond, ms = 2000) => { const end = Date.now() + ms; while (!cond()) { if (Date.now() > end) throw new Error("timeout"); await new Promise((r) => setTimeout(r, 2)); } };
const parsedAccs = (ing) => [...ing._state.filings.keys()].sort();

// Friday 2026-10-30 16:08:02 ET (EDT) → newest expected index is Thursday 10-29.
const FRI = "2026-10-30T20:08:02Z";

// ── D1 ─────────────────────────────────────────────────────────────────────
test("D1: the live feed keeps being polled DURING the startup backlog; the new filing is downloaded next", async () => {
  const c = clock(FRI);
  let release;
  const gate = new Promise((r) => { release = r; });
  const sec = fakeSec({ days: { "2026-10-29": BACKLOG } });
  sec.cfg.hooks.txt = async (acc) => { if (acc === F.DM_IND.acc) await gate; };
  // Real interval at 5 ms → automatic polls while the first download is blocked.
  const ing = make(sec.fetchText, c, { pollMs: 5 });
  const started = ing.start();
  await until(() => sec.txtOf(F.DM_IND.acc) === 1);
  assert.equal(ing.getStatus().initialSyncCompletedAt, null, "backlog still running");

  sec.cfg.feed = [F.LONA]; // appears on SEC while the backlog downloads
  const feedCallsBefore = sec.requests.filter((r) => r.includes("browse-edgar")).length;
  await until(() => sec.requests.filter((r) => r.includes("browse-edgar")).length > feedCallsBefore);
  await until(() => ing._state.queue[0]?.accessionNo === F.LONA.acc);
  release();
  await started;
  ing.stop();

  const order = sec.requests.filter((r) => r.endsWith(".txt")).map((r) => r.match(/(\d{10}-\d{2}-\d{6})\.txt$/)[1]);
  assert.equal(order[0], F.DM_IND.acc);
  assert.equal(order[1], F.LONA.acc, "live filing jumps the backlog");
  assert.deepEqual(parsedAccs(ing), [...BACKLOG, F.LONA].map((f) => f.acc).sort(), "nothing lost");
  for (const f of [...BACKLOG, F.LONA]) assert.equal(sec.txtOf(f.acc), 1, `${f.acc} downloaded exactly once`);
  assert.ok(ing.getStatus().initialSyncCompletedAt, "initial sync completes after the backlog drains");
});

test("D1: overlapping polls share one discovery run (no duplicate SEC requests)", async () => {
  const c = clock(FRI);
  let release;
  const gate = new Promise((r) => { release = r; });
  const sec = fakeSec({ days: { "2026-10-29": [F.FLG] }, feed: [F.LONA] });
  sec.cfg.hooks.feed = () => gate;
  const ing = make(sec.fetchText, c);
  const a = ing.pollOnce();
  const b = ing.pollOnce();
  const d = ing.pollOnce();
  release();
  await Promise.all([a, b, d]);
  assert.equal(sec.requests.filter((r) => r.includes("browse-edgar")).length, 1);
  assert.equal(sec.requests.filter((r) => r.endsWith(".idx")).length, 1);
  assert.equal(ing.getStatus().overlappingPollsJoined, 2);
  assert.equal(sec.txtOf(F.LONA.acc), 1);
  assert.equal(sec.txtOf(F.FLG.acc), 1);
});

test("D1: an index item later seen in the live feed is promoted to the front (and not downloaded twice)", async () => {
  const c = clock(FRI);
  let release;
  const gate = new Promise((r) => { release = r; });
  const sec = fakeSec({ days: { "2026-10-29": [F.DM_IND, F.DM_TRUST, F.FLG, F.BOERSMA] } });
  sec.cfg.hooks.txt = async (acc) => { if (acc === F.DM_IND.acc) await gate; };
  const ing = make(sec.fetchText, c);
  const first = ing.pollOnce();
  await until(() => sec.txtOf(F.DM_IND.acc) === 1);
  sec.cfg.feed = [{ ...F.BOERSMA, updated: "2026-10-30T16:07:32-04:00" }];
  await ing.pollOnce();
  assert.equal(ing._state.queue[0].accessionNo, F.BOERSMA.acc);
  assert.equal(ing._state.queue[0].live, true);
  assert.equal(ing._state.timelines.get(F.BOERSMA.acc).feedUpdatedAt, "2026-10-30T20:07:32.000Z", "feed timestamp attached");
  assert.equal(ing._state.timelines.get(F.BOERSMA.acc).source, "index:2026-10-29", "first discovery is kept");
  release();
  await first;
  assert.equal(sec.txtOf(F.BOERSMA.acc), 1);
  assert.equal(ing._state.queue.length, 0);
});

test("D1: parsed data is published while a backlog is still downloading (live run end + every publishEveryMs)", async () => {
  const c = clock(FRI);
  const sec = fakeSec({ days: { "2026-10-29": BACKLOG }, feed: [F.LONA] });
  sec.cfg.hooks.txt = async () => { c.advance(2000); }; // each download takes 2 s of (fake) time
  const ing = make(sec.fetchText, c, { publishEveryMs: 5000 });
  const seen = [];
  ing.onIngestBatch(() => seen.push({ queue: ing._state.queue.length, parsed: ing._state.filings.size, hasLona: ing._state.filings.has(F.LONA.acc) }));
  await ing.pollOnce();
  assert.ok(seen.length >= 3, `published ${seen.length}× for 6 filings`);
  assert.deepEqual(seen[0], { queue: 5, parsed: 1, hasLona: true }, "the live filing is published as soon as the live run ends");
  assert.ok(seen.slice(1, -1).some((s) => s.queue > 0), "time-based publication mid-backlog");
  assert.deepEqual(seen.at(-1), { queue: 0, parsed: 6, hasLona: true });
  assert.ok(ing.getStatus().publish.publishedMidBacklog >= 2);
});

// ── D2 ─────────────────────────────────────────────────────────────────────
test("D2: a 429 mid-backlog defers the download without consuming a retry attempt; polls skip SEC while paused; nothing lost or duplicated", async () => {
  const c = clock(FRI);
  const sec = fakeSec({ days: { "2026-10-29": BACKLOG } });
  let throttleOnce = true;
  sec.cfg.hooks.txt = async (acc) => {
    if (acc === F.FLG.acc && throttleOnce) { throttleOnce = false; throw httpError(429, { throttled: true, retryAfterMs: 30_000 }); }
  };
  const timers = [];
  const ing = make(sec.fetchText, c, { setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; } });
  await ing.pollOnce();

  // Index order is newest accession first: DM_IND, DM_TRUST, BOERSMA, FLG, USCB.
  assert.deepEqual(parsedAccs(ing), [F.DM_IND.acc, F.DM_TRUST.acc, F.BOERSMA.acc].sort());
  assert.equal(ing._state.queue[0].accessionNo, F.FLG.acc, "deferred item kept at the front");
  assert.ok(ing._state.queued.has(F.FLG.acc), "still marked queued (no duplicate enqueue)");
  assert.equal(ing._state.retries.size, 0, "no retry attempt consumed");
  let st = ing.getStatus();
  assert.equal(st.throttle.paused, true);
  assert.equal(st.throttle.remainingMs, 30_000);
  assert.equal(st.throttle.deferredDownloads, 1);
  assert.equal(st.filingsFailed, 0);
  assert.equal(timers.at(-1).ms, 30_050, "resume scheduled for the end of the pause");

  // A poll during the pause sends nothing to SEC.
  const n = sec.requests.length;
  c.advance(10_000);
  await ing.pollOnce();
  assert.equal(sec.requests.length, n);
  assert.equal(ing.getStatus().throttle.skippedPolls, 1);

  // Pause over → the resume timer drains the queue.
  c.advance(20_000);
  await timers.at(-1).fn();
  await until(() => !ing.getStatus().processing && ing._state.queue.length === 0);
  assert.deepEqual(parsedAccs(ing), BACKLOG.map((f) => f.acc).sort());
  for (const f of BACKLOG) assert.equal(sec.txtOf(f.acc), f === F.FLG ? 2 : 1, f.acc);
  st = ing.getStatus();
  assert.equal(st.throttle.paused, false);
  assert.equal(ing._state.retries.size, 0);
});

test("D2 integration: a 10-minute SEC 403 block with the REAL client — one request reaches SEC during the block, then full recovery", async () => {
  const c = clock(FRI);
  const sec = fakeSec({ days: { "2026-10-29": BACKLOG } });
  const blockUntil = c.now() + 10 * 60_000;
  const secCalls = [];
  // Network layer: SEC answers 403 to everything until blockUntil (after the first download:
  // feed, quarter listing for the past index day, index, first filing).
  const fetchImpl = async (url) => {
    secCalls.push({ url: String(url), t: c.now() });
    if (secCalls.length > 4 && c.now() < blockUntil) return { status: 403, ok: false, headers: { get: () => null }, text: async () => "" };
    const body = await sec.fetchText(String(url)).catch((e) => ({ err: e }));
    if (body?.err) return { status: body.err.status || 500, ok: false, headers: { get: () => null }, text: async () => "" };
    return { status: 200, ok: true, headers: { get: () => null }, text: async () => body };
  };
  const client = createEdgarClient({ fetchImpl, now: c.now, sleep: async (ms) => c.advance(ms), userAgent: () => "IT test@example.com", maxRps: 5, throttle403Ms: 600_000, log: quietLog() });
  const ing = make((u, o) => client.getText(u, o), c, { getClientStats: client.getStats });

  await ing.pollOnce(); // feed + index + DM_IND ok, then 403 → pause
  assert.equal(ing._state.filings.size, 1);
  const blockedAt = secCalls.length;
  // Polls every minute through the block (as the server timer would).
  for (let i = 0; i < 9; i++) { c.advance(60_000); await ing.pollOnce(); }
  assert.equal(secCalls.length, blockedAt, "no SEC traffic while paused");
  const h = computeHealth({ db: { configured: false }, ingest: ing.getStatus(), accountsConfigured: false, now: c.now() });
  assert.ok(h.reasons.includes("sec_throttled"), JSON.stringify(h.reasons));
  assert.equal(h.checks.sec.throttle.state, "throttled");
  assert.equal(h.checks.sec.throttle.lastStatus, 403);

  c.advance(61_000); // block lifted, pause elapsed (the rate limiter advanced the clock a little too)
  await ing.pollOnce();
  assert.deepEqual(parsedAccs(ing), BACKLOG.map((f) => f.acc).sort(), "every filing recovered");
  assert.equal(ing._state.retries.size, 0, "throttling never consumed retry attempts");
  const h2 = computeHealth({ db: { configured: false }, ingest: ing.getStatus(), accountsConfigured: false, now: c.now() });
  assert.equal(h2.checks.sec.throttle.state, "ok");
  assert.ok(!h2.reasons.includes("sec_throttled"));
  assert.equal(client.getStats().breaker.throttleEvents, 1);
});

test("D2 + restart: a crash while throttled loses nothing — held index lists are re-read and missing filings downloaded once", async () => {
  const cacheFile = tmpCache();
  const c = clock(FRI);
  const sec1 = fakeSec({ days: { "2026-10-29": BACKLOG } });
  sec1.cfg.hooks.txt = async (acc) => { if (acc === F.FLG.acc) throw httpError(403, { throttled: true, retryAfterMs: 600_000 }); };
  const ing1 = make(sec1.fetchText, c, { cacheFile });
  await ing1.pollOnce();
  await ing1.saveNow();
  assert.equal(ing1._state.filings.size, 3, "DM_IND, DM_TRUST, BOERSMA before the block");

  c.advance(15 * 60_000); // "restart" after the block
  const sec2 = fakeSec({ days: { "2026-10-29": BACKLOG } });
  const ing2 = make(sec2.fetchText, c, { cacheFile });
  await ing2.start(); ing2.stop();
  assert.deepEqual(parsedAccs(ing2), BACKLOG.map((f) => f.acc).sort());
  for (const f of BACKLOG) assert.equal(sec2.txtOf(f.acc), [F.DM_IND, F.DM_TRUST, F.BOERSMA].includes(f) ? 0 : 1, f.acc);
  assert.equal(ing2._state.retries.size, 0);
});

test("D2: a throttle during startup delays initialSyncCompletedAt until the backlog has drained", async () => {
  const c = clock(FRI);
  const sec = fakeSec({ days: { "2026-10-29": BACKLOG } });
  let first = true;
  sec.cfg.hooks.txt = async () => { if (first) { first = false; throw httpError(429, { throttled: true, retryAfterMs: 5000 }); } };
  const timers = [];
  const ing = make(sec.fetchText, c, { setTimer: (fn) => { timers.push(fn); return 1; } });
  await ing.start();
  assert.equal(ing.getStatus().initialSyncCompletedAt, null, "alerts must not see a half-loaded store");
  c.advance(5000);
  timers.at(-1)(); // the resume timer fires
  await until(() => !!ing.getStatus().initialSyncCompletedAt);
  ing.stop();
  assert.equal(ing._state.filings.size, BACKLOG.length);
});

// ── D0 ─────────────────────────────────────────────────────────────────────
test("D0: live filing timeline — acceptance, feed time, discovery, download, parse, publication — exact, and only observed values", async () => {
  const cacheFile = tmpCache();
  const c = clock(FRI); // 30 s after BOERSMA's SEC acceptance
  const sec = fakeSec({ feed: [{ ...F.BOERSMA, updated: "2026-10-30T16:07:32-04:00" }, F.LONA /* no <updated> */] });
  sec.cfg.hooks.txt = async () => { c.advance(2000); };
  const log = quietLog();
  const ing = make(sec.fetchText, c, { cacheFile, log });
  const store = createSnapshotStore({ source: { getTransactions: ing.getTransactions, getAmendmentFilings: ing.getAmendmentFilings, getDataVersion: ing.getDataVersion }, now: c.now, onBuild: (v, at) => ing.markPublished(v, at) });
  ing.onIngestBatch(() => { c.advance(500); store.get({ fresh: true }); });
  const v0 = ing.getDataVersion();
  await ing.pollOnce();

  const tl = ing._state.timelines.get(F.BOERSMA.acc);
  const t0 = Date.parse(FRI);
  assert.equal(tl.source, "feed");
  assert.equal(tl.acceptedAt, F.BOERSMA.accepted, "from ACCEPTANCE-DATETIME (EDT), not the transaction date");
  assert.equal(tl.feedUpdatedAt, F.BOERSMA.accepted);
  assert.equal(tl.discoveredAt, new Date(t0).toISOString());
  assert.equal(typeof tl.downloadMs, "number");
  const m = timelineMetrics(tl);
  assert.equal(m.acceptedToDiscovered, 30_000);
  assert.equal(m.feedToDiscovered, 30_000);
  assert.equal(m.acceptedToFeed, 0);
  assert.ok(m.discoveredToParsed >= 2000);
  assert.ok(m.parsedToPublished >= 500);
  assert.equal(m.acceptedToPublished, m.acceptedToDiscovered + m.discoveredToParsed + m.parsedToPublished);

  const lona = timelineMetrics(ing._state.timelines.get(F.LONA.acc));
  assert.equal(lona.feedToDiscovered, null, "no <updated> → unavailable, never guessed");
  assert.equal(ing._state.timelines.get(F.LONA.acc).acceptedAt, F.LONA.accepted);

  const lat = ing.getStatus().latency;
  assert.equal(lat.live.filings, 2);
  assert.equal(lat.live.unavailable.feedToDiscovered, 1);
  assert.equal(lat.live.unavailable.acceptedToFeed, 1);
  assert.equal(lat.live.metrics.acceptedToPublished.n, 2);
  assert.equal(lat.awaitingPublication, 0);
  assert.equal(lat.backfill.filings, 0);
  assert.ok(log.lines.some((l) => l.startsWith(`[FORM4_PUBLISHED] acc=${F.BOERSMA.acc} source=feed e2eMs=`)));
  assert.equal(ing.getDataVersion(), v0 + 2, "publication stamps never bump the data version (no rebuild loop)");

  // Restart: timelines and latency statistics survive.
  await ing.saveNow();
  const ing2 = make(fakeSec().fetchText, c, { cacheFile });
  await ing2.start(); ing2.stop();
  assert.deepEqual(ing2._state.timelines.get(F.BOERSMA.acc), tl);
  assert.equal(ing2.getStatus().latency.live.filings, 2);
});

test("D0: backfill filings are tracked separately; refresh re-downloads never create timelines; unpublished stays 'awaiting'", async () => {
  const c = clock(FRI);
  const sec = fakeSec({ days: { "2026-10-29": [F.FLG] } });
  const ing = make(sec.fetchText, c);
  await ing.pollOnce();
  const tl = ing._state.timelines.get(F.FLG.acc);
  assert.equal(tl.source, "index:2026-10-29");
  assert.equal(tl.publishedAt, null, "no snapshot consumer → not published, not invented");
  assert.equal(ing.getStatus().latency.awaitingPublication, 1);
  ing.markPublished(ing.getDataVersion(), c.now());
  const lat = ing.getStatus().latency;
  assert.equal(lat.backfill.filings, 1);
  assert.equal(lat.live.filings, 0);
  assert.equal(lat.live.metrics.acceptedToPublished, null);
  // Publishing an older version than the one containing the filing does nothing.
  const sec2 = fakeSec({ feed: [F.LONA] });
  const ing2 = make(sec2.fetchText, c);
  await ing2.pollOnce();
  assert.equal(ing2.markPublished(0, c.now()), 0);
  assert.equal(ing2.getStatus().latency.awaitingPublication, 1);
});

test("D0 units: feed timestamps need an explicit offset; ET acceptance handles EDT/EST; percentiles are nearest-rank", () => {
  assert.equal(parseFeedTimestamp("2026-10-30T16:07:32-04:00"), "2026-10-30T20:07:32.000Z");
  assert.equal(parseFeedTimestamp("2026-11-02T09:00:00-05:00"), "2026-11-02T14:00:00.000Z");
  assert.equal(parseFeedTimestamp("2026-10-30T16:07:32"), null, "no offset → unavailable");
  assert.equal(parseFeedTimestamp("yesterday"), null);
  assert.equal(parseFeedTimestamp(undefined), null);
  assert.equal(acceptedAtIso("2026-10-30 16:07:32 ET"), "2026-10-30T20:07:32.000Z"); // EDT
  assert.equal(acceptedAtIso("2026-11-02 16:07:32 ET"), "2026-11-02T21:07:32.000Z"); // EST
  assert.equal(acceptedAtIso(null), null);
  const s = summarize(Array.from({ length: 100 }, (_, i) => i + 1));
  assert.deepEqual(s, { n: 100, min: 1, p50: 50, p95: 95, p99: 99, max: 100 });
  assert.equal(summarize([]), null);
  const tr = createLatencyTracker({ window: 3 });
  for (let i = 0; i < 5; i++) tr.add({ source: "feed", downloadMs: i });
  assert.equal(tr.summary().live.filings, 3, "bounded window");
  assert.deepEqual(tr.summary().live.metrics.downloadMs, { n: 3, min: 2, p50: 3, p95: 4, p99: 4, max: 4 });
  const feed = parseFeedForm4(atom([{ ...F.LONA, updated: "2026-10-28T20:43:08-04:00" }]));
  assert.equal(feed.form4[0].updatedAt, F.LONA.accepted);
});

// ── Wave 1: 403 = missing object, adaptive feed paging, feed-vs-index freshness ──
// REAL edgarClient over a scripted network layer (`route(url)` → body | status).
function realSec(c, route) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    const r = await route(new URL(String(url)));
    if (typeof r === "number") return { status: r, ok: false, headers: { get: () => null }, text: async () => "" };
    return { status: 200, ok: true, headers: { get: () => null }, text: async () => r };
  };
  const client = createEdgarClient({ fetchImpl, now: c.now, sleep: async (ms) => c.advance(ms), userAgent: () => "IT test@example.com", maxRps: 5, throttle403Ms: 600_000, log: quietLog() });
  return { client, calls, fetchText: (u, o) => client.getText(u, o) };
}
const listingJson = (days) => JSON.stringify({ directory: { item: days.map((d) => ({ name: `form.${d.replace(/-/g, "")}.idx`, type: "file" })) } });
// 2026-12-24 (Thu): an unscheduled closure that businessDays.js does not know; EDGAR answers its index with 403.
const closureRoute = ({ listed, feed = () => atom([]) }) => (u) => {
  if (u.pathname === "/cgi-bin/browse-edgar") return feed();
  if (u.pathname.endsWith("/index.json")) return listingJson(listed);
  if (/form\.20261224\.idx$/.test(u.pathname)) return 403;
  if (/\.idx$/.test(u.pathname)) return 404;
  const m = u.pathname.match(/\/(\d{10}-\d{2}-\d{6})\.txt$/);
  return m && BODY[m[1]] ? BODY[m[1]] : 404;
};

test("P1: a past day absent from the quarter listing is never requested — no-index (persisted), breaker stays closed", async () => {
  const cacheFile = tmpCache();
  const c = clock("2026-12-26T15:00:00Z"); // Sat 10:00 ET → latest expected index day is Thu 12-24 (12-25 holiday)
  const sec = realSec(c, closureRoute({ listed: ["2026-12-22", "2026-12-23"] }));
  const ing = make(sec.fetchText, c, { cacheFile, getClientStats: sec.client.getStats });

  // Inside LISTING_TRUST_DAYS (2 days old): treated as not yet published, re-checked later.
  await ing.pollOnce();
  assert.equal(sec.calls.filter((u) => /form\.20261224\.idx$/.test(u)).length, 0, "the missing index is never requested");
  assert.equal(sec.calls.filter((u) => u.endsWith("/2026/QTR4/index.json")).length, 1);
  assert.equal(ing._state.noIndexDays.has("2026-12-24"), false);
  assert.ok(ing.getStatus().lastIndexCheck.results.includes("2026-12-24:not-listed"));
  assert.equal(sec.client.getStats().breaker.state, "closed");
  assert.equal(ing.getStatus().lastPollError, null);

  c.advance(60_000); await ing.pollOnce(); // within 30 min: nothing re-requested
  assert.equal(sec.calls.filter((u) => u.endsWith("/index.json")).length, 1);

  // Monday: 4 days old and still absent → recorded as a closed day.
  c.set("2026-12-28T15:00:00Z");
  await ing.pollOnce();
  assert.ok(ing._state.noIndexDays.has("2026-12-24"));
  assert.ok(ing.getStatus().lastIndexCheck.results.includes("2026-12-24:no-index(not-listed)"));
  assert.equal(sec.calls.filter((u) => /form\.20261224\.idx$/.test(u)).length, 0);
  const st = sec.client.getStats().breaker;
  assert.equal(st.state, "closed");
  assert.equal(st.throttleEvents, 0);
  assert.equal(ing.getStatus().throttle.paused, false);
  assert.equal(ing.getStatus().lastPollError, null);
  assert.ok(ing.getStatus().lastPollAt, "the poll fully succeeded");
  await ing.saveNow();
  assert.ok(JSON.parse(fs.readFileSync(cacheFile, "utf8")).noIndexDays.includes("2026-12-24"), "persisted like other no-index days");
  const n = sec.calls.length;
  c.advance(31 * 60_000); await ing.pollOnce();
  assert.equal(sec.calls.slice(n).filter((u) => /index\.json$|\.idx$/.test(u)).length, 0, "never re-checked once recorded");
});

test("P1: a past day that IS listed but answers 403 is real throttling — breaker opens exactly as before", async () => {
  const c = clock("2026-12-28T15:00:00Z");
  const sec = realSec(c, closureRoute({ listed: ["2026-12-23", "2026-12-24"] }));
  const ing = make(sec.fetchText, c, { getClientStats: sec.client.getStats });
  await ing.pollOnce();
  assert.equal(sec.calls.filter((u) => /form\.20261224\.idx$/.test(u)).length, 1);
  const st = sec.client.getStats().breaker;
  assert.equal(st.state, "open");
  assert.equal(st.lastStatus, 403);
  assert.ok(st.remainingMs > 590_000, String(st.remainingMs));
  assert.equal(ing.getStatus().throttle.paused, true);
  assert.equal(ing._state.noIndexDays.has("2026-12-24"), false);
  assert.ok(ing.getStatus().lastIndexCheck.results.includes("2026-12-24:throttled"));
  const n = sec.calls.length;
  c.advance(60_000); await ing.pollOnce();
  assert.equal(sec.calls.length, n, "no SEC traffic while paused");
});

test("P1: a 403 on the live feed (getcurrent) still opens the global breaker", async () => {
  const c = clock(FRI);
  const sec = realSec(c, closureRoute({ listed: [], feed: () => 403 }));
  const ing = make(sec.fetchText, c, { getClientStats: sec.client.getStats });
  await ing.pollOnce();
  const st = sec.client.getStats().breaker;
  assert.equal(st.state, "open");
  assert.equal(st.lastStatus, 403);
  assert.equal(ing.getStatus().throttle.paused, true);
  assert.match(ing.getStatus().lastPollError, /feed: .*403/);
  assert.equal(ing.getStatus().lastFeedOkAt, null);
  assert.equal(sec.calls.length, 1, "nothing else requested once paused");
});

// Synthetic feed of distinct Form 4 entries (newest first), 100 per page.
const synth = (i) => ({ acc: `0009999999-26-${String(i).padStart(6, "0")}`, cik: "9999999" });
function pagedSec() {
  const s = { list: [], feedRequests: 0 };
  s.fetchText = async (url) => {
    const u = new URL(url);
    if (u.pathname === "/cgi-bin/browse-edgar") { s.feedRequests++; const st = Number(u.searchParams.get("start")); return atom(s.list.slice(st, st + 100)); }
    throw httpError(404); // indexes, listings, downloads (a 404 download stays in backoff → "known")
  };
  return s;
}
const feedPages = async (ing, s) => { const n = s.feedRequests; await ing.pollOnce(); return s.feedRequests - n; };

test("P2: adaptive paging — beyond feedMaxPages only while every page is entirely new; stops at the first page with nothing new", async () => {
  const c = clock(FRI);
  const s = pagedSec();
  const ing = make(s.fetchText, c, { feedMaxPages: 10, feedBurstMaxPages: 40 });
  s.list = Array.from({ length: 500 }, (_, i) => synth(10_000 - i)); // older filings, seen first
  assert.equal(await feedPages(ing, s), 6, "5 full pages + the empty end page");
  // Outage: 1,500 new filings on top → 15 entirely-new pages (old cap: 10), stop at page 16 (all known).
  s.list = [...Array.from({ length: 1500 }, (_, i) => synth(20_000 - i)), ...s.list];
  assert.equal(await feedPages(ing, s), 16);
  assert.equal(ing.getStatus().lastFeed.added, 1500);
  assert.equal(ing.getStatus().lastFeed.capped, false);
  // Caught up → a single page.
  assert.equal(await feedPages(ing, s), 1);
});

test("P2: adaptive paging respects the burst cap, and pages with known filings keep the normal cap", async () => {
  const c = clock(FRI);
  const lg = quietLog();
  const s = pagedSec();
  const ing = make(s.fetchText, c, { feedMaxPages: 10, feedBurstMaxPages: 40, log: lg });
  s.list = Array.from({ length: 5000 }, (_, i) => synth(50_000 - i));
  assert.equal(await feedPages(ing, s), 40, "burst cap");
  assert.equal(ing.getStatus().lastFeed.capped, true);
  assert.ok(lg.lines.some((l) => /EDGAR_FEED_CAPPED/.test(l)));

  const c2 = clock(FRI);
  const s2 = pagedSec();
  const ing2 = make(s2.fetchText, c2, { feedMaxPages: 10, feedBurstMaxPages: 40 });
  const old = Array.from({ length: 30 }, (_, i) => synth(90_000 - i));
  s2.list = old;
  await feedPages(ing2, s2);
  // Every page mixes 99 new + 1 known → never "entirely new" → normal cap of 10 pages.
  s2.list = Array.from({ length: 20 }, (_, p) => [...Array.from({ length: 99 }, (_, i) => synth(60_000 - p * 100 - i)), old[p]]).flat();
  assert.equal(await feedPages(ing2, s2), 10);
});

test("P3: an index 5xx does not make the feed stale — lastFeedOkAt advances, health reports 'error' not 'stale'", async () => {
  const c = clock(FRI);
  const sec = fakeSec({ days: { "2026-10-29": 503 }, feed: [{ ...F.LONA, updated: "2026-10-30T16:07:00-04:00" }] });
  const ing = make(sec.fetchText, c);
  await ing.start(); ing.stop();
  for (let i = 0; i < 5; i++) { c.advance(60_000); await ing.pollOnce(); }
  const s = ing.getStatus();
  assert.equal(s.lastPollAt, null, "lastPollAt keeps its meaning: last FULLY successful poll");
  assert.equal(s.lastFeedOkAt, new Date(c.now()).toISOString());
  assert.equal(s.feedContent.newestAcceptedAt, "2026-10-30T20:07:00.000Z");
  const h = computeHealth({ db: { configured: false }, ingest: s, accountsConfigured: false, now: c.now() });
  assert.equal(h.checks.sec.state, "error");
  assert.ok(!h.reasons.includes("sec_poll_stale"), JSON.stringify(h.reasons));
  assert.ok(h.reasons.includes("sec_poll_error"));
  assert.equal(h.ready, true);
});
