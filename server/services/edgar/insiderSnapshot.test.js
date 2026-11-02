// Phase B — processed-data snapshot: equivalence with the pre-snapshot route,
// cursor pagination, compact view, detail lookup, rebuild policy, performance.
// Rows come from the REAL SEC fixtures; scaled datasets for timing are
// SYNTHETIC copies of those rows (new accession numbers) and labelled as such.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseForm4Submission } from "./form4Parser.js";
import { groupTransactions, computeTotals } from "./transactionGroups.js";
import { buildSnapshot, createSnapshotStore, queryTransactions, getTransactionById, checkRows, decodeCursor } from "./insiderSnapshot.js";

const FIXTURES = fs.readdirSync(new URL("./__fixtures__/", import.meta.url)).filter((f) => f.endsWith(".txt"));
const parsed = FIXTURES.map((f) => parseForm4Submission(fs.readFileSync(new URL(`./__fixtures__/${f}`, import.meta.url), "utf8")));
const ROWS = parsed.flatMap((p) => p.transactions);
const AMENDS = parsed.filter((p) => p.formType === "4/A").map((p) => ({
  accessionNo: p.accessionNo, issuerCik: p.issuerCik, ownerCiks: p.ownerCiks, originalSubmissionDate: p.originalSubmissionDate,
  hasNonDerivativeTable: p.hasNonDerivativeTable, totalNonDerivative: p.totalNonDerivative, acceptedAtET: p.acceptedAtET, filingDate: p.filingDate,
}));
const snapOf = (rows = ROWS, amends = AMENDS, version = 1) => buildSnapshot({ transactions: rows, amendmentFilings: amends, version });

// The /api/insider/transactions logic exactly as it was before the snapshot
// (recomputed per request) — the reference the snapshot must reproduce.
function legacyQuery(transactions, amends, q) {
  const TYPES = { all: null, purchase: "P", sale: "S" };
  const type = String(q.type || "all").toLowerCase();
  const venue = String(q.venue || "all").toLowerCase();
  const check = String(q.check || "all").toLowerCase();
  const ticker = String(q.ticker || "").trim().toUpperCase();
  const from = String(q.from || ""), to = String(q.to || "");
  const dedupe = String(q.dedupe ?? "true") !== "false";
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 200, 1), 1000);
  const raw = checkRows(transactions, amends);
  const economic = groupTransactions(raw);
  const all = dedupe ? economic : raw;
  const code = TYPES[type];
  const canonical = (s) => String(s || "").replace(/-/g, ".");
  const inRange = (d) => !!d && (!from || d >= from) && (!to || d <= to);
  const rows = all.filter((t) => (!code || t.code === code) &&
    (venue === "all" || (t.code === "P" && t.purchaseContext === venue)) &&
    (check === "all" || t.priceCheck?.status === check) &&
    (!ticker || canonical(t.ticker) === canonical(ticker) || (t.tickerSymbols || []).some((s) => canonical(s) === canonical(ticker))) &&
    (!from && !to ? true : (t.reportedBy || [t]).some((r) => inRange(r.filingDate))));
  rows.sort((a, b) => (b.acceptedAtET || b.filingDate || "").localeCompare(a.acceptedAtET || a.filingDate || "") || a.id.localeCompare(b.id, undefined, { numeric: true }));
  const economicMatching = dedupe ? rows : groupTransactions(rows);
  return { total: rows.length, rawRowCount: raw.length, dedupe, totals: computeTotals(economicMatching), transactions: rows.slice(0, limit) };
}

const QUERIES = [
  {}, { limit: "1000" }, { type: "purchase" }, { type: "sale", limit: "3" }, { venue: "open_market" }, { check: "anomaly" },
  { check: "ok" }, { ticker: "BROS" }, { ticker: "FLG" }, { ticker: "SCCO" }, { from: "2026-10-30", to: "2026-10-30" },
  { dedupe: "false" }, { dedupe: "false", type: "sale" }, { type: "purchase", from: "2026-09-01", limit: "2" },
];

test("snapshot queries return exactly what the per-request route returned", () => {
  const snap = snapOf();
  for (const q of QUERIES) {
    const r = queryTransactions(snap, q);
    assert.equal(r.status, 200);
    const { nextCursor, view, ...body } = r.body;
    assert.deepEqual(JSON.parse(JSON.stringify(body)), JSON.parse(JSON.stringify(legacyQuery(ROWS, AMENDS, q))), JSON.stringify(q));
    assert.equal(view, "full");
  }
});

test("validation errors are unchanged, plus view and cursor validation", () => {
  const snap = snapOf();
  assert.deepEqual(queryTransactions(snap, { type: "bogus" }), { status: 400, error: "type must be all, purchase or sale" });
  assert.equal(queryTransactions(snap, { ticker: "@@" }).error, "invalid ticker");
  assert.equal(queryTransactions(snap, { from: "yesterday" }).error, "dates must be YYYY-MM-DD");
  assert.equal(queryTransactions(snap, { view: "everything" }).error, "view must be full or compact");
  for (const bad of ["%%%", "eyJ0IjoxfQ", Buffer.from(JSON.stringify({ t: "x", i: "y".repeat(70) })).toString("base64url"), "a".repeat(201)]) {
    assert.equal(queryTransactions(snap, { cursor: bad }).error, "invalid cursor", bad);
  }
});

test("cursor pagination walks every row exactly once, in order", () => {
  const snap = snapOf();
  for (const dedupe of ["true", "false"]) {
    const full = queryTransactions(snap, { dedupe, limit: "1000" }).body.transactions.map((t) => t.id);
    for (const limit of [1, 2, 5]) {
      const seen = [];
      let cursor;
      for (let guard = 0; guard < 500; guard++) {
        const r = queryTransactions(snap, { dedupe, limit: String(limit), ...(cursor ? { cursor } : {}) }).body;
        seen.push(...r.transactions.map((t) => t.id));
        if (!r.nextCursor) break;
        cursor = r.nextCursor;
      }
      assert.deepEqual(seen, full, `dedupe=${dedupe} limit=${limit}`);
    }
  }
});

test("cursor pages stay stable when newer filings arrive between requests", () => {
  const before = snapOf(ROWS, AMENDS, 1);
  const p1 = queryTransactions(before, { limit: "3" }).body;
  const p2before = queryTransactions(before, { limit: "3", cursor: p1.nextCursor }).body.transactions.map((t) => t.id);
  // SYNTHETIC newer filing (copy of a real row, new accession, accepted later).
  const newer = { ...ROWS[0], id: "0009999999-26-000001:0", accessionNo: "0009999999-26-000001", acceptedAtET: "2026-12-31 09:00:00 ET", filingDate: "2026-12-31" };
  const after = snapOf([...ROWS, newer], AMENDS, 2);
  const p2after = queryTransactions(after, { limit: "3", cursor: p1.nextCursor }).body.transactions.map((t) => t.id);
  assert.deepEqual(p2after, p2before);
  assert.equal(queryTransactions(after, { limit: "1" }).body.transactions[0].id, newer.id, "new filing appears on the first page");
  assert.deepEqual(decodeCursor(p1.nextCursor).i, p1.transactions[2].id);
});

test("compact view drops bulky audit text but keeps every field the dashboard shows", () => {
  const snap = snapOf();
  const full = queryTransactions(snap, { limit: "1000" }).body;
  const compact = queryTransactions(snap, { limit: "1000", view: "compact" }).body;
  assert.equal(compact.total, full.total);
  assert.deepEqual(compact.totals, full.totals);
  assert.equal(compact.view, "compact");
  compact.transactions.forEach((c, i) => {
    const f = full.transactions[i];
    for (const k of ["owners", "footnotes", "remarks"]) assert.equal(k in c, false, k);
    if (f.reportedBy.length > 1) assert.deepEqual(c.reportedBy, f.reportedBy); else assert.equal("reportedBy" in c, false);
    for (const k of ["economicId", "id", "ticker", "issuerCik", "issuerName", "insiderName", "role", "code", "shares", "price", "value", "reported",
      "transactionDate", "filingDate", "acceptedAtET", "filingUrl", "formType", "ownership", "natureOfOwnership", "priceCheck", "dedupe",
      "purchaseContext", "purchaseContextEvidence", "is10b5_1", "filingDelay"]) {
      assert.deepEqual(c[k], f[k], k);
    }
    if (f.amendment) assert.deepEqual(c.amendment, f.amendment);
  });
  assert.ok(JSON.stringify(compact.transactions).length < JSON.stringify(full.transactions).length * 0.8);
  // Compact objects are built once per snapshot.
  assert.equal(queryTransactions(snap, { view: "compact" }).body.transactions[0], queryTransactions(snap, { view: "compact" }).body.transactions[0]);
});

test("detail lookup by economicId or raw row id", () => {
  const snap = snapOf();
  const e = snap.economic.find((x) => x.reportedBy.length > 1);
  assert.equal(getTransactionById(snap, e.economicId).body.transaction, e);
  const raw = snap.raw[0];
  assert.equal(getTransactionById(snap, raw.id).body.transaction, raw);
  assert.ok(getTransactionById(snap, raw.id).body.transaction.footnotes, "full record includes footnotes");
  assert.equal(getTransactionById(snap, "econ_0000000000000000").status, 404);
  for (const bad of ["", "../etc", "econ_xyz", "1".repeat(100), { $gt: "" }]) assert.equal(getTransactionById(snap, bad).status, 400, String(bad));
});

test("store rebuilds only when the ingest data version changes; throttled unless fresh", () => {
  let version = 1, t = 0, reads = 0;
  const source = { getDataVersion: () => version, getTransactions: () => { reads++; return ROWS; }, getAmendmentFilings: () => AMENDS };
  const store = createSnapshotStore({ source, minRebuildMs: 2000, now: () => t, log: { warn() {} } });
  const s1 = store.get();
  assert.equal(store.get(), s1);
  assert.equal(reads, 1);
  version = 2; t = 500;
  assert.equal(store.get(), s1, "throttled: served the previous snapshot");
  assert.notEqual(store.get({ fresh: true }), s1, "fresh read rebuilds immediately");
  version = 3; t = 3000;
  const s3 = store.get();
  assert.equal(s3.version, 3);
  assert.equal(store.stats().builds, 3);
});

test("performance: SYNTHETIC 4,000-row dataset — one build, then cheap queries", () => {
  const big = [];
  for (let k = 0; big.length < 4000; k++) {
    for (const r of ROWS) {
      const acc = `09${String(k).padStart(8, "0")}-26-${String(big.length % 999999).padStart(6, "0")}`;
      big.push({ ...r, id: `${acc}:0`, accessionNo: acc, issuerCik: String(1000 + (k % 400)).padStart(10, "0"), acceptedAtET: `2026-10-${String(10 + (k % 20)).padStart(2, "0")} 1${k % 10}:00:00 ET` });
    }
  }
  const t0 = performance.now();
  const snap = snapOf(big, AMENDS);
  const buildMs = performance.now() - t0;
  const times = [];
  for (let i = 0; i < 50; i++) {
    const t = performance.now();
    queryTransactions(snap, { type: i % 2 ? "purchase" : "all", limit: "100", view: "compact" });
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  const p95 = times[Math.floor(times.length * 0.95)];
  assert.ok(buildMs < 2000, `build ${buildMs.toFixed(0)} ms`);
  assert.ok(p95 < 25, `query p95 ${p95.toFixed(1)} ms`);
});

test("economicId can be shared by two identical rows of one filing — row ids stay unique and lookups stay unambiguous", () => {
  // SYNTHETIC: a second, identical row in the same filing (as seen in real META/IBTA filings).
  const base = ROWS.find((r) => r.ticker === "FLG"); // an ordinary single row (not superseded, not grouped)
  const twin = { ...base, id: `${base.accessionNo}:99` };
  const snap = snapOf([...ROWS, twin], AMENDS);
  const both = snap.economic.filter((e) => e.accessionNo === base.accessionNo && e.shares === base.shares && e.transactionDate === base.transactionDate && e.price === base.price);
  assert.equal(both.length, 2, "never merged: both rows counted");
  assert.equal(both[0].economicId, both[1].economicId);
  assert.notEqual(both[0].id, both[1].id);
  const r = getTransactionById(snap, both[0].economicId);
  assert.equal(r.status, 409);
  assert.deepEqual([...r.rowIds].sort(), [both[0].id, both[1].id].sort());
  const byRow = getTransactionById(snap, twin.id);
  assert.equal(byRow.status, 200);
  assert.equal(byRow.body.transaction, snap.rawById.get(twin.id));
  assert.equal(byRow.body.economic.reportedBy[0].rowId, twin.id);
  // Cursor walk visits both.
  const ids = [];
  let cursor;
  do { const p = queryTransactions(snap, { limit: "2", ...(cursor ? { cursor } : {}) }).body; ids.push(...p.transactions.map((t) => t.id)); cursor = p.nextCursor; } while (cursor);
  assert.ok(ids.includes(base.id) && ids.includes(twin.id));
  assert.equal(new Set(ids).size, ids.length);
});
