// Phase A ingestion reliability tests — a SIMULATED SEC endpoint and a
// controllable clock drive createInsiderIngest(). Filing bodies are REAL SEC
// fixtures; the daily-index and feed documents are SYNTHETIC listings in SEC's
// formats that reference those real accession numbers. No network, no timers
// (polls are invoked directly), cache files live in a temp directory.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInsiderIngest } from "./insiderIngest.js";
import { parseForm4Submission } from "./form4Parser.js";

const fx = (acc) => fs.readFileSync(new URL(`./__fixtures__/${acc}.txt`, import.meta.url), "utf8");
const F = {
  BOERSMA: { acc: "0001866581-26-000164", cik: "1866581" },
  DM_TRUST: { acc: "0001866581-26-000166", cik: "1866581" },
  DM_IND: { acc: "0001866581-26-000167", cik: "1866581" },
  LONA: { acc: "0002126186-26-000002", cik: "2126186" },
  FLG: { acc: "0001649471-26-000006", cik: "1649471" },
  SCCO_A: { acc: "0001284489-26-000042", cik: "1284489" },
};
const BODY = Object.fromEntries(Object.values(F).map((f) => [f.acc, fx(f.acc)]));

const httpError = (status) => Object.assign(new Error(`[EDGAR] HTTP ${status}`), { status });
const idxLine = (f) => `4           FIXTURE ISSUER                                               ${f.cik}     20261030    edgar/data/${f.cik}/${f.acc}.txt`;
const dailyIndex = (files) => ["Form Type   Company Name   CIK   Date Filed  File Name", "-".repeat(80), ...files.map(idxLine)].join("\n");
const atom = (files) => `<feed>${files.map((f) => `<entry><category scheme="https://www.sec.gov/" label="form type" term="4"/><link href="https://www.sec.gov/Archives/edgar/data/${f.cik}/${f.acc.replace(/-/g, "")}/${f.acc}-index.htm"/></entry>`).join("")}</feed>`;

// Simulated SEC. `days`: ISO day → [fixtures] | "404"; `filings`: accession → array of
// scripted outcomes consumed per request ("ok" | status number | "not-form4").
function fakeSec(cfg = {}) {
  const days = (cfg.days ??= {}), filings = (cfg.filings ??= {});
  cfg.feed ??= [];
  const requests = [];
  const fetchText = async (url) => {
    requests.push(url);
    const u = new URL(url);
    if (u.pathname === "/cgi-bin/browse-edgar") return atom(u.searchParams.get("start") === "0" ? cfg.feed : []);
    let m = u.pathname.match(/form\.(\d{8})\.idx$/);
    if (m) {
      const iso = `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}`;
      const d = days[iso];
      if (d === undefined || d === "404") throw httpError(404);
      if (typeof d === "number") throw httpError(d);
      return dailyIndex(d);
    }
    m = u.pathname.match(/\/(\d{10}-\d{2}-\d{6})\.txt$/);
    if (m) {
      const script = filings[m[1]];
      const outcome = script?.length ? script.shift() : "ok";
      if (outcome === "not-form4") return "<SEC-DOCUMENT>\nACCESSION NUMBER: " + m[1] + "\n<XML><foo/></XML>";
      if (typeof outcome === "number") throw httpError(outcome);
      if (typeof outcome === "function") return outcome();
      if (!BODY[m[1]]) throw httpError(404);
      return BODY[m[1]];
    }
    throw new Error(`unexpected URL ${url}`);
  };
  const count = (re) => requests.filter((r) => re.test(r)).length;
  return { fetchText, requests, count };
}

const tmpCache = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "insider-ingest-")), "cache.json");
const quietLog = () => { const lines = []; return { lines, log: (m) => lines.push(m), warn: (m) => lines.push(m), error: (m) => lines.push(m) }; };
const clock = (iso) => { let t = Date.parse(iso); return { now: () => t, advance: (ms) => { t += ms; }, set: (s) => { t = Date.parse(s); } }; };
const make = (sec, c, o = {}) => createInsiderIngest({
  fetchText: sec.fetchText, now: c.now, cacheFile: o.cacheFile ?? tmpCache(), log: o.log ?? quietLog(),
  backfillDays: 1, recoveryMaxDays: 30, retryBaseMs: 1000, retryMaxMs: 60_000, retryMaxAttempts: 5,
  getClientStats: () => ({}), ...o,
});
const fileUrl = (f) => new RegExp(`${f.acc}\\.txt$`);
const day = (ing, d) => ing.getCoverage().find((c) => c.day === d);

// 2026-11-10 15:00Z = 10:00 ET Tuesday → newest published index is Monday 2026-11-09.
const TUE = "2026-11-10T15:00:00Z";

test("H1: a filing from an already-known daily index is retried with exponential backoff until it succeeds", async () => {
  const sec = fakeSec({ days: { "2026-11-09": [F.BOERSMA] }, filings: { [F.BOERSMA.acc]: [503, 503] } });
  const c = clock(TUE);
  const ing = make(sec, c);

  await ing.pollOnce();
  assert.deepEqual(day(ing, "2026-11-09"), { day: "2026-11-09", listed: 1, parsed: 0, failed: 0, pending: 1, retrying: 1 });
  assert.equal(ing._state.retries.get(F.BOERSMA.acc).nextAt - c.now(), 1000, "first backoff = base");

  await ing.pollOnce(); // not due yet → no request
  assert.equal(sec.count(fileUrl(F.BOERSMA)), 1);

  c.advance(1000);
  await ing.pollOnce(); // attempt 2 fails → backoff doubles
  assert.equal(sec.count(fileUrl(F.BOERSMA)), 2);
  assert.equal(ing._state.retries.get(F.BOERSMA.acc).nextAt - c.now(), 2000);

  c.advance(1999);
  await ing.pollOnce();
  assert.equal(sec.count(fileUrl(F.BOERSMA)), 2, "still waiting");
  c.advance(1);
  await ing.pollOnce(); // attempt 3 succeeds
  assert.equal(sec.count(fileUrl(F.BOERSMA)), 3);
  assert.deepEqual(day(ing, "2026-11-09"), { day: "2026-11-09", listed: 1, parsed: 1, failed: 0, pending: 0, retrying: 0 });
  assert.equal(ing._state.retries.size, 0);
  assert.equal(sec.count(/form\.20261109\.idx$/), 1, "the known index itself is never re-downloaded");
  assert.ok(ing.getTransactions().some((t) => t.accessionNo === F.BOERSMA.acc));
});

test("H1: retries are bounded — backoff is capped and the filing is marked failed after max attempts", async () => {
  const sec = fakeSec({ days: { "2026-11-09": [F.LONA] }, filings: { [F.LONA.acc]: Array(20).fill(503) } });
  const c = clock(TUE);
  const ing = make(sec, c, { retryBaseMs: 1000, retryMaxMs: 3000, retryMaxAttempts: 4 });
  const gaps = [];
  for (let i = 0; i < 10; i++) {
    await ing.pollOnce();
    const r = ing._state.retries.get(F.LONA.acc);
    if (r.nextAt) gaps.push(r.nextAt - c.now());
    c.advance(10_000);
  }
  assert.equal(sec.count(fileUrl(F.LONA)), 4, "exactly maxAttempts requests");
  assert.deepEqual(gaps.slice(0, 3), [1000, 2000, 3000], "doubling, capped at retryMaxMs");
  assert.equal(day(ing, "2026-11-09").failed, 1);
  assert.equal(ing.getStatus().retry.exhausted, 1);
});

test("H1: a document that is not a Form 4 is a permanent failure and never retried", async () => {
  const sec = fakeSec({ days: { "2026-11-09": [F.LONA] }, filings: { [F.LONA.acc]: ["not-form4"] } });
  const c = clock(TUE);
  const ing = make(sec, c);
  for (let i = 0; i < 3; i++) { await ing.pollOnce(); c.advance(3_600_000); }
  assert.equal(sec.count(fileUrl(F.LONA)), 1);
  assert.equal(ing.getStatus().retry.permanent, 1);
  assert.equal(day(ing, "2026-11-09").failed, 1);
});

test("retry state survives a restart; exhausted failures get one fresh round after restart", async () => {
  const cacheFile = tmpCache();
  const c = clock(TUE);
  const sec1 = fakeSec({ days: { "2026-11-09": [F.BOERSMA, F.LONA] }, filings: { [F.BOERSMA.acc]: [503], [F.LONA.acc]: Array(20).fill(503) } });
  const ing1 = make(sec1, c, { cacheFile, retryMaxAttempts: 2 });
  await ing1.pollOnce(); c.advance(5000); await ing1.pollOnce();
  assert.equal(ing1.getStatus().retry.exhausted, 1, "LONA exhausted");
  await ing1.saveNow();
  const saved = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  assert.ok(saved.retries[F.LONA.acc], "retry state persisted");

  // Restart: SEC healthy again. Nothing is re-listed by the feed; only the persisted state can recover these.
  const sec2 = fakeSec({ days: { "2026-11-09": [F.BOERSMA, F.LONA] } });
  const ing2 = make(sec2, c, { cacheFile, retryMaxAttempts: 2 });
  await ing2.start(); ing2.stop();
  assert.deepEqual(day(ing2, "2026-11-09"), { day: "2026-11-09", listed: 2, parsed: 2, failed: 0, pending: 0, retrying: 0 });
  assert.equal(sec2.count(/form\.20261109\.idx$/), 0, "index not re-downloaded: retry state covered the missing filings");
});

test("H4: an outage longer than 3 business days is fully recovered (holidays skipped, 404 days remembered)", async () => {
  const cacheFile = tmpCache();
  // Before the outage: Tuesday 2026-11-03 → backfill 3 days (11-02, 10-30, 10-29).
  const c = clock("2026-11-03T15:00:00Z");
  const before = fakeSec({ days: { "2026-11-02": [F.BOERSMA], "2026-10-30": [], "2026-10-29": [] } });
  const ing1 = make(before, c, { cacheFile, backfillDays: 3 });
  await ing1.pollOnce();
  assert.deepEqual([...ing1._state.indexes.keys()].sort(), ["2026-10-29", "2026-10-30", "2026-11-02"]);
  await ing1.saveNow();

  // Back online Friday 2026-11-13 10:00 ET → newest index 11-12. Missed: 11-03…11-12
  // = 7 business days (11-11 Veterans Day has no index). 11-06 returns 404.
  c.set("2026-11-13T15:00:00Z");
  const gap = { "2026-11-03": [F.DM_TRUST], "2026-11-04": [], "2026-11-05": [F.LONA], "2026-11-06": "404", "2026-11-09": [], "2026-11-10": [F.FLG], "2026-11-12": [F.DM_IND] };
  const after = fakeSec({ days: gap });
  const ing2 = make(after, c, { cacheFile, backfillDays: 3 });
  await ing2.start(); ing2.stop();

  for (const d of ["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-09", "2026-11-10", "2026-11-12"]) assert.ok(ing2._state.indexes.has(d), d);
  assert.equal(after.count(/form\.20261111\.idx$/), 0, "holiday never requested");
  assert.ok(ing2._state.noIndexDays.has("2026-11-06"));
  const parsed = new Set(ing2.getTransactions().map((t) => t.accessionNo));
  for (const f of [F.BOERSMA, F.DM_TRUST, F.LONA, F.FLG, F.DM_IND]) assert.ok(parsed.has(f.acc), f.acc);
  assert.equal(ing2.getStatus().recovery.missingDays, 0);
  assert.equal(ing2.getStatus().recovery.truncated, false);

  // Next poll: nothing re-requested, including the remembered 404 day.
  const n = after.requests.length;
  await ing2.pollOnce();
  assert.equal(after.requests.filter((r) => /\.idx$/.test(r)).length, after.requests.slice(0, n).filter((r) => /\.idx$/.test(r)).length);
});

test("H4: recovery is capped at recoveryMaxDays and reports truncation", async () => {
  const cacheFile = tmpCache();
  const c = clock("2026-11-03T15:00:00Z");
  const ing1 = make(fakeSec({ days: { "2026-11-02": [] } }), c, { cacheFile });
  await ing1.pollOnce(); await ing1.saveNow();

  c.set("2026-11-13T15:00:00Z"); // 7 business days missed, cap 4
  const days = Object.fromEntries(["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-09", "2026-11-10", "2026-11-12"].map((d) => [d, []]));
  const sec = fakeSec({ days });
  const ing2 = make(sec, c, { cacheFile, recoveryMaxDays: 4 });
  await ing2.start(); ing2.stop();
  assert.deepEqual([...ing2._state.indexes.keys()].filter((d) => d > "2026-11-02").sort(), ["2026-11-06", "2026-11-09", "2026-11-10", "2026-11-12"]);
  assert.equal(ing2.getStatus().recovery.truncated, true);
});

test("H4: a transient index error does not block other days and is retried next poll", async () => {
  const c = clock(TUE);
  const days = { "2026-11-09": 503, "2026-11-06": [F.LONA] };
  const sec = fakeSec({ days });
  const ing = make(sec, c, { backfillDays: 2 });
  await ing.pollOnce();
  assert.ok(ing._state.indexes.has("2026-11-06"));
  assert.ok(!ing._state.indexes.has("2026-11-09"));
  assert.match(ing.getStatus().lastPollError, /index/);
  days["2026-11-09"] = [F.BOERSMA];
  await ing.pollOnce();
  assert.ok(ing._state.indexes.has("2026-11-09"));
  assert.equal(ing.getStatus().lastPollError, null);
  assert.ok(ing.getTransactions().some((t) => t.accessionNo === F.BOERSMA.acc));
});

test("H4: live-feed filings are processed before a recovery backlog", async () => {
  const c = clock(TUE);
  let release;
  const gate = new Promise((r) => { release = r; });
  const cfg = {
    days: { "2026-11-09": [F.BOERSMA, F.DM_TRUST, F.DM_IND] },
    // The daily index lists newest accessions first, so DM_IND (…167) downloads first.
    filings: { [F.DM_IND.acc]: [async () => { await gate; return BODY[F.DM_IND.acc]; }] },
  };
  const sec = fakeSec(cfg);
  const ing = make(sec, c);
  const first = ing.pollOnce(); // index → 3 filings queued; the first download blocks
  while (!sec.requests.some((r) => r.endsWith(`${F.DM_IND.acc}.txt`))) await new Promise((r) => setTimeout(r, 1));
  cfg.feed = [F.LONA]; // a new filing appears in the live feed during the backlog
  await ing.pollOnce();
  release();
  await first;
  const order = sec.requests.filter((r) => r.endsWith(".txt")).map((r) => r.match(/(\d{10}-\d{2}-\d{6})\.txt$/)[1]);
  assert.deepEqual(order, [F.DM_IND.acc, F.LONA.acc, F.DM_TRUST.acc, F.BOERSMA.acc]);
});

test("legacy cache records: tickers upgraded in place (SEC value kept), 4/A re-fetched without losing the old record", async () => {
  const cacheFile = tmpCache();
  const legacyRows = (p) => p.transactions.map(({ tickerReported, tickerSymbols, originalSubmissionDate, ...t }) => ({ ...t, ticker: tickerReported?.toUpperCase().trim() ?? t.ticker }));
  const flg = parseForm4Submission(BODY[F.FLG.acc]);
  const scco = parseForm4Submission(BODY[F.SCCO_A.acc]);
  // The cache shape written before Phase A (version 2): no tickerReported, no amendment metadata.
  const legacy = (p, cikDir) => ({ cikDir, formType: p.formType, issuerName: p.issuerName, ticker: p.tickerReported, filingDate: p.filingDate, parserVersion: 3, parsedAt: "2026-11-01T00:00:00.000Z", transactions: legacyRows(p) });
  fs.writeFileSync(cacheFile, JSON.stringify({ version: 2, filings: { [F.FLG.acc]: legacy(flg, F.FLG.cik), [F.SCCO_A.acc]: legacy(scco, F.SCCO_A.cik) }, indexes: {} }));

  const c = clock(TUE);
  const sec = fakeSec({ filings: { [F.SCCO_A.acc]: [503] } });
  const ing = make(sec, c, { cacheFile });
  await ing.start(); ing.stop();

  const flgRows = ing.getTransactions().filter((t) => t.accessionNo === F.FLG.acc);
  assert.ok(flgRows.length > 0);
  for (const t of flgRows) { assert.equal(t.ticker, "FLG"); assert.equal(t.tickerReported, "NYSE:FLG"); }
  assert.equal(ing._state.filings.get(F.FLG.acc).tickerReported, "NYSE:FLG");

  // Refresh failed once: the old 4/A record must still be there.
  assert.ok(ing._state.filings.has(F.SCCO_A.acc));
  assert.equal(ing._state.filings.get(F.SCCO_A.acc).originalSubmissionDate, undefined);
  assert.equal(ing.getAmendmentFilings()[0].originalSubmissionDate, null);

  c.advance(1000);
  await ing.pollOnce();
  assert.equal(ing._state.filings.get(F.SCCO_A.acc).originalSubmissionDate, "2026-09-25");
  assert.deepEqual(ing.getAmendmentFilings().map((a) => [a.accessionNo, a.originalSubmissionDate, a.totalNonDerivative]), [[F.SCCO_A.acc, "2026-09-25", 1]]);
  assert.equal(sec.count(fileUrl(F.FLG)), 0, "non-amendment records are never re-downloaded");
});

// ── Phase B: asynchronous, atomic, coalesced cache writes ───────────────────
test("cache writes: async + atomic, concurrent saves coalesce, content round-trips, no temp files left", async () => {
  const cacheFile = tmpCache();
  const c = clock(TUE);
  const sec = fakeSec({ days: { "2026-11-09": [F.BOERSMA, F.DM_TRUST, F.LONA] } });
  const ing = make(sec, c, { cacheFile });
  await ing.pollOnce();
  const saves = Promise.all([ing.saveNow(), ing.saveNow(), ing.saveNow()]);
  // While the write is in flight the previous file (none yet) is never half-written.
  await saves;
  const st = ing.getStatus().cache;
  assert.ok(st.saves >= 1 && st.saves <= 2, `coalesced: ${st.saves} writes for 3 calls`);
  assert.equal(st.saveFailures, 0);
  const disk = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  assert.equal(disk.version, 3);
  assert.deepEqual(Object.keys(disk.filings).sort(), [F.BOERSMA.acc, F.DM_TRUST.acc, F.LONA.acc].sort());
  assert.deepEqual(disk.filings[F.LONA.acc], JSON.parse(JSON.stringify(ing._state.filings.get(F.LONA.acc))));
  assert.deepEqual(disk.indexes, { "2026-11-09": ing._state.indexes.get("2026-11-09") });
  assert.deepEqual(fs.readdirSync(path.dirname(cacheFile)).filter((f) => f.endsWith(".tmp")), []);

  // A restart from that file sees exactly the same data.
  const ing2 = make(fakeSec(), c, { cacheFile });
  await ing2.start(); ing2.stop();
  assert.deepEqual(ing2.getTransactions(), ing.getTransactions());
});

test("cache writes: flush persists pending changes; a failed write is retried by the next save", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "insider-ingest-"));
  const cacheFile = path.join(dir, "cache.json");
  const c = clock(TUE);
  const lines = quietLog();
  const ing = make(fakeSec({ days: { "2026-11-09": [F.LONA] } }), c, { cacheFile, log: lines, saveDelayMs: 60_000 });
  await ing.pollOnce();
  assert.equal(fs.existsSync(cacheFile), false, "debounced, not yet written");
  assert.equal(ing.getStatus().cache.dirty, true);
  // Make the target a directory → rename fails.
  fs.mkdirSync(cacheFile);
  await ing.flush();
  assert.equal(ing.getStatus().cache.saveFailures, 1);
  assert.equal(ing.getStatus().cache.dirty, true, "still dirty after a failure");
  assert.ok(lines.lines.some((l) => /INSIDER_CACHE_SAVE_FAILED/.test(l)));
  fs.rmSync(cacheFile, { recursive: true });
  await ing.flush();
  assert.equal(ing.getStatus().cache.dirty, false);
  assert.ok(JSON.parse(fs.readFileSync(cacheFile, "utf8")).filings[F.LONA.acc]);
});

test("data version changes only when stored filings change", async () => {
  const c = clock(TUE);
  const ing = make(fakeSec({ days: { "2026-11-09": [F.LONA] } }), c);
  const v0 = ing.getDataVersion();
  await ing.pollOnce();
  const v1 = ing.getDataVersion();
  assert.ok(v1 > v0);
  await ing.pollOnce(); // nothing new
  assert.equal(ing.getDataVersion(), v1);
});

// ── Phase C: freshness, failure and recovery as seen by /api/health ─────────
const { computeHealth } = await import("../healthReport.js");
const { buildSnapshot } = await import("./insiderSnapshot.js");
const healthOf = (ing, c) => computeHealth({ db: { configured: false }, ingest: ing.getStatus(), accountsConfigured: false, now: c.now() });

test("stale SEC polling is detected from the last successful poll, and clears on recovery", async () => {
  const c = clock(TUE);
  const cfg = { days: { "2026-11-09": [F.LONA] } };
  const sec = fakeSec(cfg);
  const ing = make(sec, c);
  await ing.start(); ing.stop();
  assert.equal(healthOf(ing, c).status, "ok");

  // A second instance whose SEC is down at startup (feed and index both 503), then recovers.
  const failing = async () => { throw Object.assign(new Error("[EDGAR] HTTP 503 /cgi-bin/browse-edgar"), { status: 503 }); };
  const ok = sec.fetchText;
  let down = true;
  const wrapped = make({ fetchText: (u, o) => (down ? failing(u, o) : ok(u, o)) }, c);
  await wrapped.start(); wrapped.stop(); // first poll fails
  assert.equal(wrapped.getStatus().consecutivePollFailures, 1);
  assert.equal(wrapped.getStatus().lastPollAt, null);
  assert.match(wrapped.getStatus().lastPollError, /HTTP 503/);
  assert.deepEqual(healthOf(wrapped, c).reasons, ["sec_poll_stale"], "no successful poll yet");
  for (let i = 0; i < 3; i++) { c.advance(60_000); await wrapped.pollOnce(); }
  assert.equal(wrapped.getStatus().consecutivePollFailures, 4);
  assert.equal(healthOf(wrapped, c).ready, false);

  down = false;
  c.advance(60_000);
  await wrapped.pollOnce();
  const s = wrapped.getStatus();
  assert.equal(s.consecutivePollFailures, 0);
  assert.equal(s.lastPollError, null);
  assert.equal(s.lastPollAt, new Date(c.now()).toISOString());
  const h = healthOf(wrapped, c);
  assert.equal(h.status, "ok");
  assert.equal(h.ready, true);

  // Healthy for a while, then polls stop succeeding → stale after 3 intervals.
  c.advance(2 * 60_000);
  assert.equal(healthOf(wrapped, c).status, "ok");
  c.advance(2 * 60_000);
  assert.deepEqual(healthOf(wrapped, c).reasons, ["sec_poll_stale"]);
  assert.equal(healthOf(wrapped, c).ready, true, "stale but not yet 15 min");
});

test("failed cache writes: consecutive count, redacted error, health 'failing', auto-retry, then recovery", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "insider-ingest-"));
  const cacheFile = path.join(dir, "cache.json");
  const c = clock(TUE);
  const ing = make(fakeSec({ days: { "2026-11-09": [F.LONA] } }), c, { cacheFile, saveDelayMs: 60_000 });
  fs.mkdirSync(cacheFile); // rename onto a directory fails
  await ing.start(); ing.stop();
  await ing.saveNow();
  await ing.saveNow();
  let st = ing.getStatus().cache;
  assert.equal(st.consecutiveFailures, 2);
  assert.ok(st.lastError && st.lastFailureAt);
  assert.ok(st.dirtySince, "pending changes remembered");
  assert.equal(healthOf(ing, c).checks.cache.state, "failing");
  assert.deepEqual(healthOf(ing, c).reasons, ["cache_write_failing"]);

  fs.rmSync(cacheFile, { recursive: true });
  await ing.saveNow();
  st = ing.getStatus().cache;
  assert.equal(st.consecutiveFailures, 0);
  assert.equal(st.lastError, null);
  assert.equal(st.dirtySince, null);
  assert.equal(healthOf(ing, c).checks.cache.state, "ok");
  assert.ok(JSON.parse(fs.readFileSync(cacheFile, "utf8")).filings[F.LONA.acc]);
});

test("restart: ingest state, amendment links and the processed snapshot are identical after reload", async () => {
  const cacheFile = tmpCache();
  const c = clock(TUE);
  const all = [F.BOERSMA, F.DM_TRUST, F.DM_IND, F.LONA, F.FLG, F.SCCO_A];
  const ing1 = make(fakeSec({ days: { "2026-11-09": all } }), c, { cacheFile });
  await ing1.pollOnce();
  await ing1.saveNow();
  const snapOf = (ing) => buildSnapshot({ transactions: ing.getTransactions(), amendmentFilings: ing.getAmendmentFilings(), version: 1, now: 0 });
  const s1 = snapOf(ing1);

  const sec2 = fakeSec({ days: { "2026-11-09": all } });
  const ing2 = make(sec2, c, { cacheFile });
  await ing2.start(); ing2.stop();
  assert.equal(sec2.count(/\.txt$/), 0, "nothing re-downloaded after restart");
  assert.deepEqual(ing2.getCoverage(), ing1.getCoverage());
  assert.deepEqual(ing2.getAmendmentFilings(), ing1.getAmendmentFilings());
  const s2 = snapOf(ing2);
  const strip = (s) => JSON.parse(JSON.stringify({ raw: s.raw, economic: s.economic, totals: s.totalsAll }));
  assert.deepEqual(strip(s2), strip(s1));
  assert.ok(s2.totalsAll.count > 0);
});
