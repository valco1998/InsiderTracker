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
