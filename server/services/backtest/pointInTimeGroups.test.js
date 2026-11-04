// Point-in-time duplicate grouping (signals.groupVersions) and Form 4/A labelling of the
// company timeline. SYNTHETIC rows; the full pipeline (snapshot → signals) is used.
import { test } from "node:test";
import assert from "node:assert/strict";
import { OWNERS as O, tx, signalsFor } from "./testFixtures.js";
import { buildSnapshot } from "../edgar/insiderSnapshot.js";
import { buildHistoryDataset } from "./form4History.js";
import { detectSignals, normalizeSignalConfig } from "./signals.js";
import { purchaseEvents, trackSignalsFor } from "./tracking.js";

const GP_DIRECTOR = { cik: "0000000202", name: "Big Fund GP LLC", role: "Director", isDirector: true };
const F1 = { cik: "0000000301", name: "Alpha Partners LP", role: "10% Owner", isTenPercentOwner: true };
const F2 = { cik: "0000000302", name: "Beta Holdings LP", role: "10% Owner", isTenPercentOwner: true };

// Same pipeline as the engine, also returning the snapshot (for timeline checks).
function pipeline(transactions, { amendmentFilings = [], config = {}, cutoff = null } = {}) {
  const cut = (s) => !cutoff || String(s).replace(/ ET$/, "") <= cutoff;
  const ds = buildHistoryDataset({ store: { records: new Map() }, live: { transactions: transactions.filter((r) => cut(r.acceptedAtET)), amendmentFilings: amendmentFilings.filter((r) => cut(r.acceptedAtET)) } });
  const snap = buildSnapshot({ transactions: ds.transactions, amendmentFilings: ds.amendmentFilings });
  const res = detectSignals({ rows: snap.economic, acceptedAtByAccession: ds.acceptedAtByAccession, config: normalizeSignalConfig(config).config,
    reportOwners: (id) => snap.rawById.get(id)?.owners, reportRow: (id) => snap.rawById.get(id) });
  return { ...res, snap, ds };
}
const view = (r) => r.signals.map((s) => `${s.publishedAt}|${s.uniqueBuyers}|${s.purchases}|${s.valueUsd}`);

test("a duplicate report filed LATER never decides who the buyer was before it was public (owners / roles)", () => {
  // The fund's own report (10% owner, direct) is public first; its GP's duplicate report
  // (a director, indirect, naming the fund) only two days later. The final group's primary is
  // the GP's report — before the fix its owner and role were used from the fund's filing time.
  const fund = tx({ owners: [O.FUND], date: "2026-03-02", accepted: "2026-03-03 10:00:00", ownership: "D", sharesOwnedAfter: 50_000 });
  const gp = tx({ owners: [GP_DIRECTOR], date: "2026-03-02", accepted: "2026-03-05 10:00:00", ownership: "I", nature: "By Big Fund LP", sharesOwnedAfter: 50_000 });
  const ceo = tx({ owners: [O.CEO], date: "2026-03-03", accepted: "2026-03-04 10:00:00" });
  const rows = [fund, gp, ceo];
  const { snap } = pipeline(rows);
  const merged = snap.economic.find((e) => e.reportedBy?.length === 2);
  assert.ok(merged, "the two reports are one economic transaction (final view)");
  assert.equal(merged.reportedBy[0].rowId, gp.id, "final primary = the LATER report (the case being fixed)");

  const cfg = { minBuyers: 2, minValueUsd: 0, roles: ["10% Owner", "CEO"] };
  const r = pipeline(rows, { config: cfg });
  assert.deepEqual(view(r), ["2026-03-04 10:00:00 ET|2|2|300000"], "at 03-04 the public saw the FUND (10% owner) + the CEO");
  const p = r.signals[0].snapshot.purchases.find((x) => x.name === "Big Fund LP");
  assert.equal(p.rowId, fund.id, "snapshot holds the report that was public, not the later primary");
  assert.equal(p.publicAt, "2026-03-03 10:00:00 ET");
  assert.equal(r.stats.versionedGroups, 1);
  // Reproducible from only the filings public at the signal time.
  assert.deepEqual(view(pipeline(rows, { config: cfg, cutoff: "2026-03-04 10:00:00" })), view(r));
  // Role filter that only matches the LATER report's role: no signal from the fund's own filing.
  const dir = pipeline(rows, { config: { minBuyers: 2, minValueUsd: 0, roles: ["Director", "CEO"] } });
  assert.deepEqual(view(dir), ["2026-03-05 10:00:00 ET|2|2|300000"], "the CEO is also a director; the GP (director) counts only once its report is public");
});

test("a merge that only a LATER report creates is not applied before that report is public", () => {
  // Two direct holders report identical purchases with no evidence linking them → the public
  // saw two purchases by two buyers. A joint report filed later names both → final view merges
  // all three into one transaction. The earlier signal stays as published (frozen).
  const a = tx({ owners: [F1], date: "2026-04-01", accepted: "2026-04-02 09:00:00", ownership: "D", sharesOwnedAfter: 90_000 });
  const c = tx({ owners: [F2], date: "2026-04-01", accepted: "2026-04-02 11:00:00", ownership: "D", sharesOwnedAfter: 90_000 });
  const b = tx({ owners: [F1, F2], date: "2026-04-01", accepted: "2026-04-06 16:00:00", ownership: "I", nature: "See footnote", sharesOwnedAfter: 90_000 });
  const rows = [a, c, b];
  const { snap } = pipeline(rows);
  assert.equal(snap.economic.filter((e) => e.code === "P").length, 1, "final view: one economic transaction");
  const r = pipeline(rows, { config: { minBuyers: 2, minValueUsd: 250_000 } });
  assert.deepEqual(view(r), ["2026-04-02 11:00:00 ET|2|2|300000"], "what was public on 04-02: two separate purchases");
  assert.deepEqual(view(pipeline(rows, { config: { minBuyers: 2, minValueUsd: 250_000 }, cutoff: "2026-04-02 11:00:00" })), view(r), "identical to the cut-off rerun");
  // Hindsight (all filings now) shows the merged truth separately: one buyer, one purchase.
  assert.deepEqual([r.signals[0].hindsight.buyers, r.signals[0].hindsight.purchases], [1, 1]);
});

test("without later reports nothing changes (versioning is a no-op for same-time or single reports)", () => {
  const rows = [tx({ owners: [O.CEO], date: "2026-03-02", accepted: "2026-03-03 17:00:00" }), tx({ owners: [O.CFO], date: "2026-03-04", accepted: "2026-03-05 18:30:00" })];
  assert.deepEqual(view(pipeline(rows)), view(signalsFor(rows)));
  assert.equal(pipeline(rows).stats.versionedGroups, 0);
});

test("Form 4/A correcting a signal purchase: original stays in the snapshot and timeline; the amendment is a correction, not a new purchase", () => {
  const ceo = tx({ owners: [O.CEO], date: "2026-03-02", accepted: "2026-03-03 17:00:00" });
  const orig = tx({ owners: [O.CFO], date: "2026-03-03", accepted: "2026-03-04 17:00:00" });             // $150,000 → signal
  const fixed = tx({ owners: [O.CFO], date: "2026-03-03", accepted: "2026-03-04 18:00:00", formType: "4/A", shares: 3100 }); // restated 1 h later
  const later = tx({ owners: [O.CEO], date: "2026-03-09", accepted: "2026-03-10 17:00:00", shares: 1000 }); // a real later purchase
  const amend = [{ accessionNo: fixed.accessionNo, issuerCik: "0000005000", ownerCiks: [O.CFO.cik], originalSubmissionDate: "2026-03-04",
    hasNonDerivativeTable: true, totalNonDerivative: 1, acceptedAtET: "2026-03-04 18:00:00 ET", filingDate: "2026-03-04" }];
  const r = pipeline([ceo, orig, fixed, later], { amendmentFilings: amend });
  assert.equal(r.signals.length, 1);
  const s = r.signals[0];
  assert.deepEqual([s.publishedAt, s.uniqueBuyers, s.purchases, s.valueUsd], ["2026-03-04 17:00:00 ET", 2, 2, 300_000], "signal as public at 17:00");
  assert.ok(s.snapshot.purchases.some((p) => p.rowId === orig.id), "snapshot keeps the original");
  assert.ok(s.snapshot.purchases.every((p) => !("supersededBy" in p)), "no later information inside the frozen snapshot");
  const h = s.hindsight;
  assert.equal(h.purchasesAdded, 1, "only the real later purchase is 'added'");
  assert.equal(h.buyersAdded, 0, "the amending CFO is not a new buyer");
  assert.deepEqual(h.laterPurchases.map((p) => p.publicAt), ["2026-03-10 17:00:00 ET"]);
  assert.deepEqual(h.amendmentsOfSignalPurchases.map((p) => [p.rowId, p.amends]), [[fixed.id, orig.accessionNo]]);

  const { anchor, clusters } = trackSignalsFor(r.signals, s.issuerCik);
  const ev = purchaseEvents({ rows: r.snap.economic, issuerCik: s.issuerCik, from: anchor.windowFrom, to: "2026-12-31", clusters, acceptedAtByAccession: r.ds.acceptedAtByAccession });
  const byRow = Object.fromEntries(ev.map((e) => [e.rowId, e]));
  assert.equal(byRow[orig.id]?.signalRole, "signal_snapshot", "superseded original is still shown — the signal used it");
  assert.deepEqual(byRow[orig.id].amendedBy, { accessionNo: fixed.accessionNo, at: "2026-03-04 18:00:00 ET" });
  assert.equal(byRow[fixed.id]?.signalRole, "amendment_of_signal_purchase");
  assert.equal(byRow[fixed.id].amends, orig.accessionNo);
  assert.equal(byRow[later.id]?.signalRole, "subsequent_publication");
  assert.equal(byRow[later.id].insider, "Alpha Ann", "repeat purchase by an existing buyer = its own later event");
  assert.equal(byRow[ceo.id]?.signalRole, "signal_snapshot");
});

test("timeline: a snapshot purchase taken from an earlier point-in-time version is still recognised", () => {
  const fund = tx({ owners: [O.FUND], date: "2026-03-02", accepted: "2026-03-03 10:00:00", ownership: "D", sharesOwnedAfter: 50_000 });
  const gp = tx({ owners: [GP_DIRECTOR], date: "2026-03-02", accepted: "2026-03-05 10:00:00", ownership: "I", nature: "By Big Fund LP", sharesOwnedAfter: 50_000 });
  const ceo = tx({ owners: [O.CEO], date: "2026-03-03", accepted: "2026-03-04 10:00:00" });
  const r = pipeline([fund, gp, ceo], { config: { minBuyers: 2, minValueUsd: 0, roles: ["10% Owner", "CEO"] } });
  const { anchor, clusters } = trackSignalsFor(r.signals, r.signals[0].issuerCik);
  const ev = purchaseEvents({ rows: r.snap.economic, issuerCik: r.signals[0].issuerCik, from: anchor.windowFrom, to: "2026-12-31", clusters, acceptedAtByAccession: r.ds.acceptedAtByAccession });
  assert.equal(ev.length, 2, "one event per economic transaction");
  assert.ok(ev.every((e) => e.signalRole === "signal_snapshot"), "the merged row (final primary = GP report) maps to the snapshot's fund report");
});
