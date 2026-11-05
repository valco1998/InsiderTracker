// Wave 1: /transactions ETag (rendered status only), dedupe=false memoization,
// /companies LRU + ETag. Every cached response must be byte-identical to a cold one.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import express from "express";
import { parseForm4Submission } from "../services/edgar/form4Parser.js";
import { groupTransactions, computeTotals } from "../services/edgar/transactionGroups.js";
import { buildSnapshot, queryTransactions } from "../services/edgar/insiderSnapshot.js";
import { createScreener, screenCompanies } from "../services/edgar/companyScreener.js";
import { companiesHandler, transactionsEtag, etagStatus, normalizeQuery, LAST_POLL_BUCKET_MS } from "./insiderRoutes.js";

const FIX = new URL("../services/edgar/__fixtures__/", import.meta.url);
const parsed = fs.readdirSync(FIX).filter((f) => f.endsWith(".txt")).map((f) => parseForm4Submission(fs.readFileSync(new URL(f, FIX), "utf8")));
const ROWS = parsed.flatMap((p) => p.transactions);
const AMENDS = parsed.filter((p) => p.formType === "4/A").map((p) => ({
  accessionNo: p.accessionNo, issuerCik: p.issuerCik, ownerCiks: p.ownerCiks, originalSubmissionDate: p.originalSubmissionDate,
  hasNonDerivativeTable: p.hasNonDerivativeTable, totalNonDerivative: p.totalNonDerivative, acceptedAtET: p.acceptedAtET, filingDate: p.filingDate,
}));
const snapOf = (version = 1) => buildSnapshot({ transactions: ROWS, amendmentFilings: AMENDS, version });

const QUERIES = [
  { dedupe: "false" }, { dedupe: "false", limit: "1000" }, { dedupe: "false", type: "sale" }, { dedupe: "false", type: "purchase", view: "compact" },
  { dedupe: "false", ticker: "BROS" }, { dedupe: "false", from: "2026-10-30", to: "2026-10-30" }, { dedupe: "false", check: "ok", limit: "2" },
  { type: "purchase" }, { ticker: "FLG" }, {}, { limit: "3" },
];

test("dedupe=false (and filtered) results are memoized per snapshot and byte-identical to a cold computation", () => {
  const warm = snapOf();
  for (const q of QUERIES) {
    const first = JSON.stringify(queryTransactions(warm, q));
    const again = JSON.stringify(queryTransactions(warm, q)); // cache hit
    const cold = JSON.stringify(queryTransactions(snapOf(), q)); // fresh snapshot, empty cache
    assert.equal(again, first, `repeat ${JSON.stringify(q)}`);
    assert.equal(first, cold, `cold ${JSON.stringify(q)}`);
  }
  // Reference: dedupe=false totals are the economic totals of the filtered raw rows.
  const r = queryTransactions(warm, { dedupe: "false", type: "sale", limit: "1000" }).body;
  const rawSales = warm.raw.filter((t) => t.code === "S");
  assert.equal(r.total, rawSales.length);
  assert.deepEqual(r.totals, computeTotals(groupTransactions(rawSales)));
  // Cursor pages over a cached view still walk every row exactly once.
  const all = queryTransactions(warm, { dedupe: "false", limit: "1000" }).body.transactions.map((t) => t.id);
  const seen = [];
  let cursor = null;
  do {
    const b = queryTransactions(warm, { dedupe: "false", limit: "2", ...(cursor ? { cursor } : {}) }).body;
    seen.push(...b.transactions.map((t) => t.id));
    cursor = b.nextCursor;
  } while (cursor);
  assert.deepEqual(seen, all);
});

test("/transactions ETag: stable across telemetry / same-bucket lastPollAt, changes on rendered status, version and query", () => {
  const t0 = Math.floor(Date.parse("2026-11-02T15:00:00Z") / LAST_POLL_BUCKET_MS) * LAST_POLL_BUCKET_MS;
  const base = {
    dataVersion: 9, processing: false, queueLength: 0, lastPollError: null, pollIntervalMs: 60_000, filingsStored: 100,
    coverage: [{ day: "2026-11-02", listed: 5, parsed: 5, failed: 0, pending: 0 }],
    lastPollAt: new Date(t0 + 1_000).toISOString(), lastPollAttemptAt: "x", edgar: { requests: 1 }, latency: { p50: 1 }, cache: { dirty: false },
    throttle: { remainingMs: 0 },
  };
  const tag = (s, q = { view: "compact", limit: "100" }, v = 9) => transactionsEtag(v, normalizeQuery(q), etagStatus(s));
  const e = tag(base);
  assert.equal(tag({ ...base, lastPollAt: new Date(t0 + 61_000).toISOString(), lastPollAttemptAt: "y", edgar: { requests: 99 }, latency: { p50: 7 }, cache: { dirty: true }, throttle: { remainingMs: 5 } }), e,
    "next 60 s poll with nothing new → same ETag");
  assert.equal(tag(base, { limit: "100", view: "compact" }), e, "query key order does not matter");
  assert.notEqual(tag({ ...base, lastPollAt: new Date(t0 + LAST_POLL_BUCKET_MS + 1).toISOString() }), e, "lastPollAt bucket");
  for (const patch of [{ lastPollError: "feed: HTTP 503" }, { queueLength: 3 }, { processing: true }, { filingsStored: 101 }, { dataVersion: 10 },
    { pollIntervalMs: 30_000 }, { coverage: [{ day: "2026-11-02", listed: 6, parsed: 5, failed: 0, pending: 1 }] }]) {
    assert.notEqual(tag({ ...base, ...patch }), e, JSON.stringify(patch));
  }
  assert.notEqual(tag(base, undefined, 10), e, "snapshot version");
  assert.notEqual(tag(base, { view: "compact", limit: "50" }), e, "query value");
  assert.equal(etagStatus(null), null);
});

test("/companies: LRU + version ETag → 304 before screening; cached bodies identical to uncached", async () => {
  const NOW = Date.parse("2026-11-02T15:00:00Z");
  let snap = snapOf(3);
  let ingest = { lastPollAt: new Date(NOW - 20_000).toISOString(), pollIntervalMs: 60_000, coverage: [], noIndexDays: [], recovery: { latestExpectedDay: "2026-11-02" }, edgar: { requests: 1 } };
  let screens = 0;
  const screener = createScreener();
  const issuersOf = (s) => { screens++; return screener(s); };
  const app = express();
  app.get("/companies", companiesHandler({ snapshot: () => snap, ingestStatus: () => ingest, issuersOf, now: () => NOW }));
  const srv = app.listen(0);
  try {
    const base = `http://127.0.0.1:${srv.address().port}/companies`;
    const q = "?from=2026-09-01&to=2026-11-02&minBuyers=1";
    const r1 = await fetch(base + q);
    assert.equal(r1.status, 200);
    const etag = r1.headers.get("etag");
    assert.match(etag, /^W\/"c3-[A-Za-z0-9_-]{22}"$/);
    const body1 = await r1.text();
    const expected = JSON.stringify({ ...screenCompanies({ issuers: createScreener()(snap), query: { from: "2026-09-01", to: "2026-11-02", minBuyers: "1" }, ingest, now: NOW }), snapshotVersion: 3 });
    assert.equal(body1, expected, "first response = direct screenCompanies");

    const r2 = await fetch(base + "?minBuyers=1&to=2026-11-02&from=2026-09-01"); // same options, different order → cache hit
    assert.equal(await r2.text(), body1);
    assert.equal(r2.headers.get("etag"), etag);
    assert.equal(screens, 1, "second request served from the cache");

    const r3 = await fetch(base + q, { headers: { "If-None-Match": etag } });
    assert.equal(r3.status, 304);
    assert.equal(screens, 1);

    ingest = { ...ingest, edgar: { requests: 50 }, lastPollAt: new Date(NOW - 10_000).toISOString() }; // telemetry only
    assert.equal((await fetch(base + q, { headers: { "If-None-Match": etag } })).status, 304, "output-neutral status change keeps the ETag");

    ingest = { ...ingest, lastPollAt: new Date(NOW - 10 * 60_000).toISOString() }; // livePollOk flips → coverage output changes
    const r4 = await fetch(base + q, { headers: { "If-None-Match": etag } });
    assert.equal(r4.status, 200);
    const coldIngest = JSON.stringify({ ...screenCompanies({ issuers: createScreener()(snap), query: { from: "2026-09-01", to: "2026-11-02", minBuyers: "1" }, ingest, now: NOW }), snapshotVersion: 3 });
    assert.equal(await r4.text(), coldIngest);

    snap = snapOf(4);
    const r5 = await fetch(base + q, { headers: { "If-None-Match": etag } });
    assert.equal(r5.status, 200, "new snapshot version → recomputed");
    assert.equal(JSON.parse(await r5.text()).snapshotVersion, 4);

    const bad = await fetch(`${base}?sort=net`);
    assert.equal(bad.status, 400);
    assert.doesNotMatch(bad.headers.get("etag") ?? "", /^W\/"c\d/, "an error is never tagged with the screener ETag");
    assert.match((await bad.json()).error, /sort must be/);
  } finally { srv.close(); }
});
