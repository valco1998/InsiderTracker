// Historical Form 4 backfill: index → filings with the real parser, checkpoints and
// resume, SEC throttling (wait, no attempt consumed), no-index days, permanent
// failures, reuse of live-cache records, coverage. Uses REAL SEC filings from
// services/edgar/__fixtures__ through a fake HTTP client (no network).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createForm4Backfill } from "./form4Backfill.js";
import { loadHistoryStore, buildHistoryDataset, historyCoverage, readShard, readProgress } from "./form4History.js";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "edgar", "__fixtures__");
const A = "0001866581-26-000164", B = "0001866581-26-000166", C = "0001866581-26-000167", BAD = "0009999999-26-000001";
const NOW = Date.parse("2026-11-02T15:00:00Z");
const line = (acc) => `4          SOME ISSUER                                        1866581     20261030    edgar/data/1866581/${acc}.txt`;

function fakeClient({ throttleOnce = new Set() } = {}) {
  const calls = [];
  return {
    calls,
    async getText(url) {
      calls.push(url);
      if (url.includes("form.20261030.idx")) return ["Form Type   Company Name   CIK   Date Filed   File Name", line(A), line(B), line(C), line(BAD)].join("\n");
      if (url.includes("form.20261029.idx")) { const e = new Error("HTTP 404"); e.status = 404; throw e; }
      const acc = url.match(/(\d{10}-\d{2}-\d{6})\.txt$/)?.[1];
      if (throttleOnce.has(acc)) { throttleOnce.delete(acc); const e = new Error("HTTP 429"); e.status = 429; e.throttled = true; e.retryAfterMs = 1500; throw e; }
      if (acc === BAD) return "<SEC-DOCUMENT>\n<TYPE>4\nnot an ownership document\n</SEC-DOCUMENT>";
      return fs.readFileSync(path.join(FIX, `${acc}.txt`), "utf8");
    },
  };
}
const quiet = { log() {}, warn() {} };

test("backfill: checkpoints, resume, throttle wait, no-index day, permanent failures, coverage", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-"));
  const sleeps = [];
  const client = fakeClient({ throttleOnce: new Set([B]) });
  const bf = createForm4Backfill({ storeDir: dir, client, log: quiet, now: () => NOW, sleep: async (ms) => { sleeps.push(ms); } });

  // Run 1: stop after one download — the day stays incomplete (resumable).
  const r1 = await bf.run({ from: "2026-10-29", to: "2026-10-30", maxFilings: 1 });
  assert.equal(r1.state, "stopped");
  assert.equal(r1.stoppedReason, "max_filings");
  assert.equal(readShard(dir, "2026-10-29").noIndex, true, "404 for a past business day = SEC closed");
  const s1 = readShard(dir, "2026-10-30");
  assert.equal(s1.complete, false);
  assert.equal(Object.keys(s1.records).length, 1);
  assert.equal(readProgress(dir).stoppedReason, "max_filings");

  // Run 2: resumes — no re-download, waits out the 429 without consuming an attempt.
  const before = client.calls.length;
  const r2 = await bf.run({ from: "2026-10-29", to: "2026-10-30" });
  assert.equal(r2.state, "complete");
  assert.deepEqual(sleeps, [1500]);
  const s2 = readShard(dir, "2026-10-30");
  assert.equal(s2.complete, true);
  assert.deepEqual(Object.keys(s2.records).sort(), [A, B, C]);
  assert.equal(s2.failed[BAD].permanent, true);
  assert.equal(s2.failed[BAD].attempts, 1);
  assert.ok(!client.calls.slice(before).some((u) => u.endsWith(`${Object.keys(s1.records)[0]}.txt`)), "already parsed filing not fetched again");
  assert.ok(!client.calls.slice(before).some((u) => u.includes(".idx")), "index of a held day not fetched again");
  assert.equal(s2.records[A].formType, "4");
  assert.match(s2.records[A].acceptedAtET, /^2026-10-30 16:07:32/);

  // Run 3: everything complete — no SEC requests at all.
  const n = client.calls.length;
  await bf.run({ from: "2026-10-29", to: "2026-10-30" });
  assert.equal(client.calls.length, n);

  // The store feeds the same pipeline as the live cache.
  const store = loadHistoryStore(dir);
  assert.equal(store.records.size, 3);
  const ds = buildHistoryDataset({ store, live: null });
  assert.equal(ds.acceptedAtByAccession.get(A).slice(0, 19), "2026-10-30 16:07:32");
  const cov = historyCoverage({ from: "2026-10-28", to: "2026-10-30", store, today: "2026-11-02" });
  assert.equal(cov.businessDays, 3);
  assert.equal(cov.coveredDays, 2);
  assert.equal(cov.complete, false);
  assert.deepEqual(cov.firstMissing, ["2026-10-28"]);
  assert.equal(cov.coveredFrom, "2026-10-29");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("backfill reuses records the live ingest already holds (no download)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-"));
  const client = fakeClient();
  const known = new Map([[A, { formType: "4", transactions: [], acceptedAtET: "2026-10-30 16:07:32 ET" }]]);
  const r = await createForm4Backfill({ storeDir: dir, client, knownRecords: known, log: quiet, now: () => NOW, sleep: async () => {} }).run({ from: "2026-10-30", to: "2026-10-30" });
  assert.equal(r.reused, 1);
  assert.ok(!client.calls.some((u) => u.endsWith(`${A}.txt`)));
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- Bounded concurrency, idempotent resume, slim store, monthly coverage ----------
import { monthlyCoverage, isSignalRelevant, failureReason } from "./form4History.js";

function slowClient(delayMs = 5) {
  const base = fakeClient();
  let inFlight = 0, peak = 0;
  return {
    calls: base.calls, peak: () => peak,
    async getText(url) { inFlight++; peak = Math.max(peak, inFlight); try { await new Promise((r) => setTimeout(r, delayMs)); return await base.getText(url); } finally { inFlight--; } },
  };
}

test("concurrency: never more than N filings in flight; same result as sequential", async () => {
  const dirSeq = fs.mkdtempSync(path.join(os.tmpdir(), "bf-seq-")), dirPar = fs.mkdtempSync(path.join(os.tmpdir(), "bf-par-"));
  await createForm4Backfill({ storeDir: dirSeq, client: fakeClient(), log: quiet, now: () => NOW }).run({ from: "2026-10-30", to: "2026-10-30" });
  const c2 = slowClient();
  const r = await createForm4Backfill({ storeDir: dirPar, client: c2, log: quiet, now: () => NOW }).run({ from: "2026-10-30", to: "2026-10-30", concurrency: 2 });
  assert.equal(r.state, "complete");
  assert.equal(c2.peak(), 2, "at most 2 concurrent requests");
  const a = readShard(dirSeq, "2026-10-30"), b = readShard(dirPar, "2026-10-30");
  assert.deepEqual(Object.keys(b.records).sort(), Object.keys(a.records).sort());
  for (const acc of Object.keys(a.records)) assert.deepEqual(b.records[acc].transactions, a.records[acc].transactions);
  assert.deepEqual(Object.keys(b.failed), Object.keys(a.failed));
  for (const d of [dirSeq, dirPar]) fs.rmSync(d, { recursive: true, force: true });
});

test("interrupted with 2 workers → resume: every filing exactly once, no duplicates; re-running a complete day is a no-op", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-res-"));
  const c = slowClient();
  let stop = false;
  const bf = createForm4Backfill({ storeDir: dir, client: c, log: quiet, now: () => NOW });
  // Abort as soon as the first filing has been stored.
  const r1 = await bf.run({ from: "2026-10-30", to: "2026-10-30", concurrency: 2, isAborted: () => stop, onProgress: () => {} , maxFilings: Infinity }).catch((e) => e);
  assert.equal(r1.state, "complete", "small day finishes");
  // Simulate an interruption: remove one parsed record from the checkpoint and mark incomplete.
  const s = readShard(dir, "2026-10-30");
  delete s.records[B]; s.complete = false;
  fs.writeFileSync(path.join(dir, "2026-10-30.json"), JSON.stringify(s));
  const before = c.calls.length;
  const r2 = await bf.run({ from: "2026-10-30", to: "2026-10-30", concurrency: 2 });
  assert.equal(r2.state, "complete");
  const fetched = c.calls.slice(before).filter((u) => u.endsWith(".txt"));
  assert.deepEqual(fetched.map((u) => u.match(/(\d{10}-\d{2}-\d{6})\.txt$/)[1]), [B], "only the missing filing is fetched again");
  const n = c.calls.length;
  const r3 = await bf.run({ from: "2026-10-30", to: "2026-10-30", concurrency: 2 });
  assert.equal(r3.state, "complete");
  assert.equal(c.calls.length, n, "complete day: zero requests (idempotent)");
  const st = loadHistoryStore(dir);
  assert.equal(new Set([...st.records.keys()]).size, st.records.size);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("slim in-memory store keeps signal-relevant records only; day stats still count every filing", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-slim-"));
  await createForm4Backfill({ storeDir: dir, client: fakeClient(), log: quiet, now: () => NOW }).run({ from: "2026-10-30", to: "2026-10-30" });
  const shard = readShard(dir, "2026-10-30");
  const st = loadHistoryStore(dir);
  const relevant = Object.values(shard.records).filter(isSignalRelevant).length;
  assert.equal(st.records.size, relevant);
  const day = st.days.get("2026-10-30");
  assert.equal(day.parsed, Object.keys(shard.records).length, "parsed counts every filing, relevant or not");
  assert.equal(day.listed, 4);
  assert.deepEqual(day.failedReasons, { "no ownershipDocument": 1 });
  assert.equal(isSignalRelevant({ formType: "4", transactions: [] }), false);
  assert.equal(isSignalRelevant({ formType: "4/A", transactions: [] }), true, "amendments always kept");
  assert.equal(failureReason("[EDGAR] HTTP 404 /x"), "HTTP 404");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("monthly coverage: complete / partial / missing / SEC-closed days, never missing-as-zero", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-mon-"));
  await createForm4Backfill({ storeDir: dir, client: fakeClient(), log: quiet, now: () => NOW }).run({ from: "2026-10-29", to: "2026-10-30" });
  const store = loadHistoryStore(dir);
  const live = { coverage: [{ day: "2026-11-02", listed: 10, parsed: 10, failed: 0, pending: 0 }], noIndexDays: [] };
  const rows = monthlyCoverage({ from: "2026-10-26", to: "2026-11-03", store, live, today: "2026-11-03" });
  const oct = rows.find((r) => r.month === "2026-10"), nov = rows.find((r) => r.month === "2026-11");
  assert.deepEqual([oct.businessDays, oct.complete, oct.closed, oct.missing], [5, 1, 1, 3], "Oct 26–28 missing, 29 closed, 30 complete");
  assert.equal(oct.listed, 4);
  assert.ok(oct.ratio < 1);
  assert.deepEqual([nov.businessDays, nov.complete, nov.source.live, nov.missing], [1, 1, 1, 0], "Nov 3 = today is excluded; Nov 2 from live");
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── SEC-closed days answered with 403, removed filings (404), bounded throttling ──
// Fake EDGAR: per-URL scripted answers (queue of responses; last one repeats). No network.
function scriptedClient(script) {
  const calls = [];
  const err = (status, extra = {}) => Object.assign(new Error(`HTTP ${status}`), { status, ...extra });
  const th403 = () => err(403, { throttled: true, retryAfterMs: 600_000 }); // what edgarClient throws for a 403
  return {
    calls, err, th403,
    async getText(url) {
      calls.push(url);
      const key = Object.keys(script).find((k) => url.includes(k));
      if (!key) throw err(404);
      const q = script[key]; const r = q.length > 1 ? q.shift() : q[0];
      if (r instanceof Error) throw r;
      return typeof r === "function" ? r() : r;
    },
  };
}
const idx = (...accs) => ["Form Type   Company Name   CIK   Date Filed   File Name", ...accs.map(line)].join("\n");
const listing = (...days) => JSON.stringify({ directory: { item: days.map((d) => ({ name: `form.${d}.idx` })) } });
const filing = (acc) => () => fs.readFileSync(path.join(FIX, `${acc}.txt`), "utf8");

test("SEC-closed day answered with 403 (2025-12-24 case): absent from the quarter listing → closed day, no throttle wait, no hang", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-"));
  const c = scriptedClient({});
  const client = scriptedClient({ "form.20261029.idx": [c.th403()], "QTR4/index.json": [listing("20261028", "20261030")], "form.20261030.idx": [idx(A)], [`${A}.txt`]: [filing(A)] });
  const sleeps = [];
  const r = await createForm4Backfill({ storeDir: dir, client, log: quiet, now: () => NOW, sleep: async (ms) => sleeps.push(ms) }).run({ from: "2026-10-29", to: "2026-10-30" });
  assert.equal(r.state, "complete");
  assert.deepEqual(sleeps, [], "never waits out a 403 for a day SEC does not list");
  const s = readShard(dir, "2026-10-29");
  assert.equal(s.noIndex, true); assert.equal(s.complete, true); assert.equal(s.noIndexReason, "absent_from_quarter_listing_http_403");
  assert.equal(client.calls.filter((u) => u.includes("index.json")).length, 1, "one listing request");
  assert.equal(readShard(dir, "2026-10-30").complete, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("genuine 403 throttle on a LISTED day: waits (backoff preserved) and then succeeds", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-"));
  const c = scriptedClient({});
  const client = scriptedClient({ "form.20261030.idx": [c.th403(), idx(A)], "QTR4/index.json": [listing("20261030")], [`${A}.txt`]: [filing(A)] });
  const sleeps = [];
  const r = await createForm4Backfill({ storeDir: dir, client, log: quiet, now: () => NOW, sleep: async (ms) => sleeps.push(ms) }).run({ from: "2026-10-30", to: "2026-10-30" });
  assert.equal(r.state, "complete");
  assert.deepEqual(sleeps, [600_000]);
  assert.equal(readShard(dir, "2026-10-30").complete, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("recent day (listing not yet trustworthy) + persistent 403: bounded waits, run stops 'throttled:<day>', day NOT marked closed", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-"));
  const c = scriptedClient({});
  const client = scriptedClient({ "form.20261030.idx": [c.th403()] });
  const sleeps = [];
  const now = () => Date.parse("2026-10-31T15:00:00Z"); // day = yesterday
  const r = await createForm4Backfill({ storeDir: dir, client, log: quiet, now, sleep: async (ms) => sleeps.push(ms), maxThrottleWaits: 3 }).run({ from: "2026-10-30", to: "2026-10-30" });
  assert.equal(r.state, "stopped");
  assert.equal(r.stoppedReason, "throttled:2026-10-30");
  assert.equal(sleeps.length, 3, "bounded, not infinite");
  assert.ok(!client.calls.some((u) => u.includes("index.json")), "listing not consulted for a recent day");
  assert.equal(readShard(dir, "2026-10-30"), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("filing throttled beyond the bound: run stops 'throttled' without consuming an attempt; resumes later", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-"));
  const c = scriptedClient({});
  const script = { "form.20261030.idx": [idx(A, B)], [`${A}.txt`]: [filing(A)], [`${B}.txt`]: [c.th403()] };
  const client = scriptedClient(script);
  const bf = createForm4Backfill({ storeDir: dir, client, log: quiet, now: () => NOW, sleep: async () => {}, maxThrottleWaits: 2 });
  const r1 = await bf.run({ from: "2026-10-30", to: "2026-10-30" });
  assert.equal(r1.state, "stopped"); assert.equal(r1.stoppedReason, "throttled");
  const s1 = readShard(dir, "2026-10-30");
  assert.equal(s1.complete, false); assert.equal(s1.failed[B], undefined, "throttling never counts as a failed attempt");
  script[`${B}.txt`] = [filing(B)];
  const r2 = await bf.run({ from: "2026-10-30", to: "2026-10-30" });
  assert.equal(r2.state, "complete");
  assert.deepEqual(Object.keys(readShard(dir, "2026-10-30").records).sort(), [A, B]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("filing removed from EDGAR (404) → permanent 'removed_from_edgar', day completes; transient 503 → retried on the next run", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-"));
  const c = scriptedClient({});
  const script = { "form.20261030.idx": [idx(A, B, C)], [`${A}.txt`]: [filing(A)], [`${B}.txt`]: [c.err(404)], [`${C}.txt`]: [c.err(503)] };
  const client = scriptedClient(script);
  const bf = createForm4Backfill({ storeDir: dir, client, log: quiet, now: () => NOW, sleep: async () => {} });
  await bf.run({ from: "2026-10-30", to: "2026-10-30" });
  let s = readShard(dir, "2026-10-30");
  assert.equal(s.failed[B].permanent, true); assert.equal(s.failed[B].reason, "removed_from_edgar"); assert.equal(s.failed[B].attempts, 1);
  assert.equal(s.failed[C].permanent, false, "503 is transient");
  assert.equal(s.complete, false, "a transient failure keeps the day open");
  script[`${C}.txt`] = [filing(C)];
  const r2 = await bf.run({ from: "2026-10-30", to: "2026-10-30" });
  s = readShard(dir, "2026-10-30");
  assert.equal(r2.state, "complete"); assert.equal(s.complete, true);
  assert.deepEqual(Object.keys(s.records).sort(), [A, C]);
  assert.equal(client.calls.filter((u) => u.endsWith(`${B}.txt`)).length, 1, "a removed filing is never requested again");
  fs.rmSync(dir, { recursive: true, force: true });
});
