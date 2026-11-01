// Phase 3 — alert engine tests. REAL SEC fixtures (BROS duplicate reports,
// LONA price anomaly) + an in-memory claim store with a unique constraint.
// Synthetic variants are derived in memory and labelled as such. No DB, no FCM.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseForm4Submission } from "./edgar/form4Parser.js";
import { annotatePriceChecks } from "./edgar/priceAnomalies.js";
import { groupTransactions } from "./edgar/transactionGroups.js";
import { parseAcceptedAtET } from "./edgar/easternTime.js";
import { createAlertEngine, selectAlertCandidates, alertKeyOf, RESTART_GRACE_MS } from "./insiderAlertEngine.js";

const fx = (acc) => fs.readFileSync(new URL(`./edgar/__fixtures__/${acc}.txt`, import.meta.url), "utf8");
const BOERSMA = fx("0001866581-26-000164"), DM_TRUST = fx("0001866581-26-000166"), DM_IND = fx("0001866581-26-000167"), LONA = fx("0002126186-26-000002");
const econ = (...txts) => groupTransactions(annotatePriceChecks(txts.flatMap((t) => parseForm4Submission(t).transactions)));

const BROS_CIK = "0001866581";
const ALICE = "6ae7543c5036c880bb1df51b", BOB = "6ae7543c5036c880bb1df51c";
const accepted = Math.max(...econ(BOERSMA, DM_TRUST, DM_IND).map((t) => parseAcceptedAtET(t.acceptedAtET).getTime()));
const MIN = 60_000, HOUR = 3600_000;
const flagsLive = { enabled: true, dryRun: false, settleMs: 2 * MIN, maxAgeMs: 24 * HOUR };
const watch = (o = {}) => ({ _id: o._id ?? `w-${o.userId ?? ALICE}`, userId: o.userId ?? ALICE, cik: o.cik ?? BROS_CIK, types: o.types ?? "both", enabled: o.enabled ?? true, alertsFrom: new Date(o.alertsFrom ?? accepted - HOUR) });

// In-memory claim store with the same unique (userId, economicId) guarantee.
function harness({ transactions, watches, flags = flagsLive, startedAt = accepted - HOUR, claims = new Map(), deliverImpl } = {}) {
  const delivered = [];
  const logs = [];
  const deps = {
    getTransactions: () => (typeof transactions === "function" ? transactions() : transactions),
    findWatches: async (ciks) => watches.filter((w) => ciks.includes(w.cik)),
    claim: async (c) => { const k = `${c.watch.userId}:${c.alertKey}`; if (claims.has(k)) return false; claims.set(k, { status: "claimed" }); return true; },
    deliver: deliverImpl || (async (c) => { delivered.push(c); return { alertId: `alert-${delivered.length}` }; }),
    markClaim: async (c, u) => { Object.assign(claims.get(`${c.watch.userId}:${c.alertKey}`), u); },
    isDbReady: () => true,
    isIngestReady: () => true,
    isLiveReady: () => true,
  };
  const log = { log: (m) => logs.push(m), error: (m) => logs.push(m) };
  return { engine: createAlertEngine({ flags, deps, startedAt, log }), delivered, claims, logs, deps };
}

// ── Eastern time ─────────────────────────────────────────────────────────────
test("EDGAR ET timestamps convert with correct EDT/EST offsets", () => {
  assert.equal(parseAcceptedAtET("2026-10-30 21:35:06 ET").toISOString(), "2026-10-31T01:35:06.000Z"); // EDT −4
  assert.equal(parseAcceptedAtET("2026-11-02 10:00:00 ET").toISOString(), "2026-11-02T15:00:00.000Z"); // EST −5 (DST ended Nov 1)
  assert.equal(parseAcceptedAtET("2026-03-09 09:30:00 ET").toISOString(), "2026-03-09T13:30:00.000Z"); // EDT again
  assert.equal(parseAcceptedAtET("garbage"), null);
});

// ── Gates ────────────────────────────────────────────────────────────────────
test("eligible new BROS sales → one candidate per economic transaction (not per filing)", async () => {
  const h = harness({ transactions: econ(BOERSMA, DM_TRUST, DM_IND), watches: [watch({ types: "sale" })] });
  await h.engine.runOnce({ now: accepted + 5 * MIN });
  assert.equal(h.delivered.length, 2, "4 filing rows → 2 economic sales → 2 alerts");
  assert.ok(h.delivered.every((c) => c.tx.reportedBy.length === 2), "each alert carries both SEC filings");
  assert.deepEqual(h.delivered.map((c) => c.tx.shares).sort((a, b) => a - b), [142023, 266000]);
});

test("type filters: purchase-only follower gets no sale alerts", async () => {
  const h = harness({ transactions: econ(BOERSMA, DM_TRUST), watches: [watch({ types: "purchase" })] });
  const r = await h.engine.runOnce({ now: accepted + 5 * MIN });
  assert.equal(h.delivered.length, 0);
  assert.ok(r.skipped.type_filtered >= 1);
});

test("historical backfill never alerts: filings accepted before the engine started", async () => {
  const h = harness({ transactions: econ(BOERSMA, DM_TRUST), watches: [watch()], startedAt: accepted + RESTART_GRACE_MS + MIN });
  await h.engine.runOnce({ now: accepted + RESTART_GRACE_MS + 2 * MIN });
  assert.equal(h.delivered.length, 0);
});

test("filings accepted before the user followed never alert", async () => {
  const h = harness({ transactions: econ(BOERSMA, DM_TRUST), watches: [watch({ alertsFrom: accepted + 1000 })] });
  const r = await h.engine.runOnce({ now: accepted + 5 * MIN });
  assert.equal(h.delivered.length, 0);
  assert.ok(r.skipped.before_follow >= 1);
});

test("settle window holds alerts; stale filings never alert", async () => {
  const h = harness({ transactions: econ(BOERSMA, DM_TRUST), watches: [watch()], startedAt: accepted - 48 * HOUR });
  const early = await h.engine.runOnce({ now: accepted + 30_000 });
  assert.ok(early.skipped.settling >= 1);
  assert.equal(h.delivered.length, 0);
  const sel = selectAlertCandidates({ transactions: econ(BOERSMA), watches: [watch({ alertsFrom: accepted - 48 * HOUR })], now: accepted + 25 * HOUR, settleMs: 2 * MIN, maxAgeMs: 24 * HOUR, notBefore: 0 });
  assert.equal(sel.candidates.length, 0);
  assert.ok(sel.skipped.too_old >= 1);
});

test("REAL LONA price anomaly never alerts", async () => {
  const rows = econ(LONA);
  const t = parseAcceptedAtET(rows[0].acceptedAtET).getTime();
  const sel = selectAlertCandidates({ transactions: rows, watches: [watch({ cik: "0001620463", alertsFrom: t - HOUR })], now: t + 5 * MIN, settleMs: 2 * MIN, maxAgeMs: 24 * HOUR, notBefore: t - HOUR });
  assert.equal(sel.candidates.length, 0);
  assert.equal(sel.skipped.price_anomaly, 1);
});

test("disabled follows and other companies' follows never match", async () => {
  const h = harness({ transactions: econ(BOERSMA, DM_TRUST), watches: [watch({ enabled: false }), watch({ userId: BOB, cik: "0000320193" })] });
  await h.engine.runOnce({ now: accepted + 5 * MIN });
  assert.equal(h.delivered.length, 0);
});

// ── Duplicates ───────────────────────────────────────────────────────────────
test("repeated polling never re-alerts the same economic transaction", async () => {
  const h = harness({ transactions: econ(BOERSMA, DM_TRUST), watches: [watch()] });
  for (let i = 0; i < 5; i++) await h.engine.runOnce({ now: accepted + (5 + i) * MIN });
  assert.equal(h.delivered.length, 2);
  assert.ok(h.logs.filter((l) => l.startsWith("[INSIDER_ALERT_DUPLICATE_SKIPPED]")).length >= 8);
});

test("concurrent runs cannot double-deliver", async () => {
  const h = harness({ transactions: econ(BOERSMA, DM_TRUST), watches: [watch()] });
  const results = await Promise.all([h.engine.runOnce({ now: accepted + 5 * MIN }), h.engine.runOnce({ now: accepted + 5 * MIN })]);
  assert.ok(results.some((r) => r.skipped === "already_running"));
  assert.equal(h.delivered.length, 2);
});

test("late related filing joins the same economic transaction → no second alert", async () => {
  let data = econ(DM_TRUST); // DM Trust filing seen first, alone
  const h = harness({ transactions: () => data, watches: [watch()] });
  await h.engine.runOnce({ now: accepted + 5 * MIN });
  assert.equal(h.delivered.length, 1);
  data = econ(BOERSMA, DM_TRUST); // Boersma's related filing arrives
  await h.engine.runOnce({ now: accepted + 6 * MIN });
  const trustAlerts = h.delivered.filter((c) => c.tx.shares === 266000);
  assert.equal(trustAlerts.length, 1, "266,000-share sale alerted once");
});

test("uncertain (needs_review) duplicates share one alert key → at most one alert", async () => {
  // SYNTHETIC: Boersma filing with the relationship evidence removed.
  const SYN = BOERSMA.replaceAll("DM Trust Aggregator", "Unrelated Holdings").replaceAll("DM Individual Aggregator", "Other Unrelated Holdings");
  const rows = econ(SYN, DM_TRUST).filter((t) => t.shares === 266000);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((t) => t.dedupe.status === "needs_review"));
  assert.notEqual(rows[0].economicId, rows[1].economicId);
  assert.equal(alertKeyOf(rows[0]), alertKeyOf(rows[1]));
  const h = harness({ transactions: rows, watches: [watch()] });
  await h.engine.runOnce({ now: accepted + 5 * MIN });
  assert.equal(h.delivered.length, 1);
});

test("after a restart (new engine, same claim store) nothing is re-sent", async () => {
  const claims = new Map();
  const a = harness({ transactions: econ(BOERSMA, DM_TRUST), watches: [watch()], claims });
  await a.engine.runOnce({ now: accepted + 5 * MIN });
  const b = harness({ transactions: econ(BOERSMA, DM_TRUST), watches: [watch()], claims, startedAt: accepted + 10 * MIN });
  await b.engine.runOnce({ now: accepted + 11 * MIN });
  assert.equal(a.delivered.length, 2);
  assert.equal(b.delivered.length, 0);
});

test("two followers each get their own single alert", async () => {
  const h = harness({ transactions: econ(BOERSMA, DM_TRUST), watches: [watch(), watch({ userId: BOB })] });
  await h.engine.runOnce({ now: accepted + 5 * MIN });
  assert.equal(h.delivered.filter((c) => c.watch.userId === ALICE).length, 2);
  assert.equal(h.delivered.filter((c) => c.watch.userId === BOB).length, 2);
});

test("failed delivery keeps the claim (status=failed) and is not retried into a duplicate", async () => {
  let calls = 0;
  const h = harness({ transactions: econ(DM_TRUST), watches: [watch()], deliverImpl: async () => { calls++; throw new Error("push down"); } });
  await h.engine.runOnce({ now: accepted + 5 * MIN });
  await h.engine.runOnce({ now: accepted + 6 * MIN });
  assert.equal(calls, 1);
  assert.equal([...h.claims.values()][0].status, "failed");
});

// ── Flags / readiness ────────────────────────────────────────────────────────
test("defaults: disabled engine does nothing", async () => {
  const h = harness({ transactions: econ(DM_TRUST), watches: [watch()], flags: { ...flagsLive, enabled: false } });
  assert.deepEqual(await h.engine.runOnce({ now: accepted + 5 * MIN }), { skipped: "disabled" });
  assert.equal(h.claims.size, 0);
});

test("dry run: logs each match once, writes no claims, delivers nothing", async () => {
  const h = harness({ transactions: econ(BOERSMA, DM_TRUST), watches: [watch()], flags: { ...flagsLive, dryRun: true } });
  await h.engine.runOnce({ now: accepted + 5 * MIN });
  await h.engine.runOnce({ now: accepted + 6 * MIN });
  assert.equal(h.delivered.length, 0);
  assert.equal(h.claims.size, 0);
  assert.equal(h.logs.filter((l) => l.startsWith("[INSIDER_ALERT_DRY_RUN]")).length, 2);
});

test("live mode refuses to run until DB + push isolation are verified; waits for initial sync", async () => {
  const h = harness({ transactions: econ(DM_TRUST), watches: [watch()] });
  h.deps.isLiveReady = () => false;
  assert.deepEqual(await h.engine.runOnce({ now: accepted + 5 * MIN }), { skipped: "live_not_ready" });
  h.deps.isLiveReady = () => true;
  h.deps.isIngestReady = () => false;
  assert.deepEqual(await h.engine.runOnce({ now: accepted + 5 * MIN }), { skipped: "ingest_not_ready" });
  h.deps.isIngestReady = () => true;
  h.deps.isDbReady = () => false;
  const dry = harness({ transactions: econ(DM_TRUST), watches: [watch()], flags: { ...flagsLive, dryRun: true } });
  dry.deps.isDbReady = () => false;
  assert.deepEqual(await dry.engine.runOnce({ now: accepted + 5 * MIN }), { skipped: "db_not_ready" }, "even dry-run needs a verified DB");
  delete dry.deps.isDbReady;
  assert.deepEqual(await dry.engine.runOnce({ now: accepted + 5 * MIN }), { skipped: "db_not_ready" }, "missing readiness check ⇒ not ready");
  assert.equal(h.delivered.length, 0);
});
