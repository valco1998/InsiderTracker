// deep2/audit/holdout.mjs — auditor (agent "audit"): the SINGLE evaluation of the frozen rules F1, F2, F3 on the SEEN
// holdout (events published >= 2026-09-01), exactly as written in frozen-rules.json (sha256 4b1ac11d…), via execLib.
//
//   node scripts/research/deep2/audit/holdout.mjs --dry                 same code path on the CONFIRMATION period,
//                                                                       holdout locked, prints only, writes nothing
//   DEEP2_HOLDOUT=1 node scripts/research/deep2/audit/holdout.mjs        the one real run (refuses to run twice)
//
// Pre-declared before the run (not changed afterwards):
//   • F1/F2: execLib.evaluate(T3 events, { entry: nextOpen, exitSessions 3 | 5, costModel "tier", costMultiplier 1 (stress 2),
//     mooCutoff "09:28:00", requireVolume true, excludeSuspects true }); holdout rows = status "ok" and period "holdout"
//     (execLib returns "pending" when the entry or exit session is after completeThrough).
//   • F3: T3 AND inAhPool (session day, published 16:00–19:55 ET); execLib.evaluate({ entry "ah", latencyMinutes 1,
//     exitSessions "nextOpen", costModel 25 (stress 50), same common options }); invalidation: no eligible AH print
//     (status != ok) or ahBuyable15 < $5,000.
//   • Statistics: lib2.companyStats on excessNet (+ Student-t p on G−1 clusters, sign test).
//   • Label "survived the seen holdout" only if, at the primary cost: mean > 0, clustered p < 0.10, issuer median of
//     means > 0, mean ex-top-5 issuers > 0, and mean > 0 at the stress cost. Otherwise "did not survive".
//   • Two descriptive, NON-frozen diagnostics, labelled as such: (a) the untrapped stage-C h[3]/h[5] (= deep-1 H22 spec),
//     to reconcile with deep 1's earlier test-split computation; (b) F3 without the look-ahead buyable filter (audit A1).
import fs from "node:fs";
import path from "node:path";
import * as L from "../lib2.mjs";
import { OUT, writeOut, sha256File, FROZEN_SHA, r4, mean, median, pT, binom2, clusterT, countBy, groupBy, readOut } from "./auditLib.mjs";

const DRY = process.argv.includes("--dry");
const TARGET = DRY ? "confirm" : "holdout";
if (sha256File(L.FROZEN_FILE) !== FROZEN_SHA) throw new Error("frozen-rules.json hash mismatch — abort");
if (DRY) { if (process.env.DEEP2_HOLDOUT) throw new Error("--dry must run with the holdout locked"); }
else {
  if (process.env.DEEP2_HOLDOUT !== "1") throw new Error("the real run needs DEEP2_HOLDOUT=1 for this process only");
  for (const f of ["code-audit.json", "multiple-testing.json", "recompute.json"]) if (!fs.existsSync(path.join(OUT, f))) throw new Error(`steps 1-3 must be saved first (${f} missing)`);
  if (fs.existsSync(path.join(OUT, "holdout.json")) || fs.existsSync(path.join(OUT, "holdout-events.csv"))) throw new Error("holdout already evaluated once — refusing to run again");
}
const X = await import("../execution/execLib.mjs");
const frozen = JSON.parse(fs.readFileSync(L.FROZEN_FILE, "utf8"));
const T3 = (e) => (e.isCeo || e.isCfo) && e.ownership === "D" && e.venue === "open_market" && e.filingValue >= 2.5e5;
const COMMON = { mooCutoff: "09:28:00", requireVolume: true, excludeSuspects: true };
const SPEC = {
  F1: { entry: "nextOpen", exitSessions: 3, costModel: "tier", costMultiplier: 1, ...COMMON }, F1x2: { entry: "nextOpen", exitSessions: 3, costModel: "tier", costMultiplier: 2, ...COMMON },
  F2: { entry: "nextOpen", exitSessions: 5, costModel: "tier", costMultiplier: 1, ...COMMON }, F2x2: { entry: "nextOpen", exitSessions: 5, costModel: "tier", costMultiplier: 2, ...COMMON },
  F3: { entry: "ah", latencyMinutes: 1, exitSessions: "nextOpen", costModel: 25, costMultiplier: 1, ...COMMON }, F3c50: { entry: "ah", latencyMinutes: 1, exitSessions: "nextOpen", costModel: 50, costMultiplier: 1, ...COMMON },
};
const allEvents = L.loadEvents({ includeUnpriced: true });
const priced = allEvents.filter((e) => e.priceStatus === "ok");
const inTarget = (e) => L.periodOf(e) === TARGET;
const t3All = allEvents.filter((e) => T3(e) && inTarget(e)); // incl. unpriced, for coverage
const t3 = priced.filter((e) => T3(e) && inTarget(e));
const t3ah = t3.filter((e) => X.inAhPool(e));
const usableRow = (r) => r.status === "ok" && r.period === TARGET && (TARGET === "holdout" || r.exitDate < L.HOLDOUT_START);
const buyableOk = (r) => (r.ahBuyable15 ?? 0) >= 5000;

const run = {}; const rowsById = {};
for (const [k, o] of Object.entries(SPEC)) {
  const evs = k.startsWith("F3") ? t3ah : t3;
  const res = X.evaluate(evs, o);
  rowsById[k] = new Map(res.rows.map((r) => [r.id, r]));
  let ok = res.rows.filter(usableRow);
  const invalidBuyable = k.startsWith("F3") ? ok.filter((r) => !buyableOk(r)).length : null;
  if (k.startsWith("F3")) ok = ok.filter(buyableOk);
  run[k] = { opts: o, eventsIn: evs.length, statusCounts: countBy(res.rows, (r) => r.status), excludedAsSuspect: evs.length - res.rows.length, invalidBuyableLt5k: invalidBuyable, ok };
}
function fullStats(rows) {
  const cs = X.summarize(rows); if (!rows.length) return cs;
  const ct = clusterT(rows.map((r) => ({ issuer: r.issuerCik, x: r.excessNet }))); const pos = rows.filter((r) => r.excessNet > 0).length;
  return { ...cs, pT_Gminus1: ct.t == null ? null : r4(pT(ct.t, ct.G - 1)), clusters: ct.G, signTestP: r4(binom2(pos, rows.length)) };
}
const stat = Object.fromEntries(Object.entries(run).map(([k, v]) => [k, fullStats(v.ok)]));
const verdict = (prim, stress) => {
  const checks = { meanPositive: prim.n > 0 && prim.mean > 0, pBelow10: prim.p != null && prim.p < 0.1, issuerMedianPositive: prim.issuerMedianOfMeans > 0, exTop5Positive: prim.meanExTop5Issuers > 0, stressPositive: stress.n > 0 && stress.mean > 0 };
  return { checks, label: Object.values(checks).every(Boolean) ? "survived the seen holdout; awaiting forward test" : "did not survive the seen holdout" };
};
const verdicts = { F1: verdict(stat.F1, stat.F1x2), F2: verdict(stat.F2, stat.F2x2), F3: verdict(stat.F3, stat.F3c50) };

// Coverage, pending exits and the 40/60-session horizons (stage-C h[N] status for the T3 events in the target period).
const hStatus = Object.fromEntries([1, 2, 3, 5, 10, 20, 40, 60].map((N) => [N, countBy(t3, (e) => e.h?.[N]?.status || "missing")]));
const coverage = {
  t3FilingsInPeriod: t3All.length, t3Priced: t3.length, t3PriceStatus: countBy(t3All, (e) => e.priceStatus), byPublicationMonth: countBy(t3, (e) => e.publishedAt.slice(0, 7)),
  t3AfterClosePool: t3ah.length, stageC_hStatus: hStatus,
  pendingF1: run.F1.statusCounts.pending || 0, pendingF2: run.F2.statusCounts.pending || 0,
  completeThrough: X.COMPLETE_THROUGH, lastPublishedAt: t3.reduce((m, e) => (e.publishedAt > m ? e.publishedAt : m), ""),
};

// Descriptive context: by month, issuer concentration, winners/losers, non-frozen diagnostics.
const byMonth = (rows) => [...groupBy(rows, (r) => r.entryDate.slice(0, 7)).entries()].sort().map(([m, rs]) => ({ month: m, n: rs.length, mean: r4(mean(rs.map((r) => r.excessNet))), median: r4(median(rs.map((r) => r.excessNet))) }));
const contrib = (rows) => { const g = groupBy(rows, (r) => r.issuerCik); const tot = rows.reduce((a, r) => a + r.excessNet, 0); const c = [...g.entries()].map(([k, v]) => ({ ticker: v[0].ticker, n: v.length, sum: r4(v.reduce((a, r) => a + r.excessNet, 0)) })).sort((a, b) => b.sum - a.sum); return { sum: r4(tot), top5: c.slice(0, 5), bottom5: c.slice(-5).reverse() }; };
const evById = new Map(t3.map((e) => [e.id, e]));
const wl = (rows) => { const s = [...rows].sort((a, b) => b.excessNet - a.excessNet); const v = (r) => { const e = evById.get(r.id); return { ticker: r.ticker, publishedAt: r.publishedAt, insider: e?.insider, role: e?.role, value: Math.round(e?.filingValue || 0), dd60: r4(e?.dd60), ret20: r4(e?.ret20), gross: r4(r.gross), excessNet: r4(r.excessNet) }; }; return { winners: s.slice(0, 6).map(v), losers: s.slice(-6).reverse().map(v) }; };
const diagnostics = {
  NOTE: "descriptive, NOT the frozen rules",
  stageC_untrapped_h3: X.L.companyStats(t3.filter((e) => e.h?.[3]?.status === "ok").map((e) => ({ issuer: e.issuerCik, x: e.h[3].excessNet }))),
  stageC_untrapped_h5: X.L.companyStats(t3.filter((e) => e.h?.[5]?.status === "ok").map((e) => ({ issuer: e.issuerCik, x: e.h[5].excessNet }))),
  F3_withoutLookAheadBuyableFilter_25bps: fullStats([...rowsById.F3.values()].filter(usableRow)),
  F3_withoutLookAheadBuyableFilter_50bps: fullStats([...rowsById.F3c50.values()].filter(usableRow)),
};

// Reference values (discovery / confirmation), computed before this run.
const rc = DRY ? null : readOut("recompute.json"), ce = DRY ? null : readOut("code-audit-evidence.json");
const reference = DRY ? null : {
  F1: { discovery: rc.recompute.F1.discover.own_frozen_tier1, confirmation: rc.recompute.F1.confirm.own_frozen_tier1 },
  F2: { discovery: rc.recompute.F2.discover.own_frozen_tier1, confirmation: rc.recompute.F2.confirm.own_frozen_tier1 },
  F3: { discovery: ce.f3BuyableFilter.discover.buyableGe5k_25bps, confirmation: ce.f3BuyableFilter.confirm.buyableGe5k_25bps },
};

const slim = (s) => (s?.n ? { n: s.n, issuers: s.issuers, mean: s.mean, median: s.median, issuerMedianOfMeans: s.issuerMedianOfMeans, positive: s.positive, t: s.t, p: s.p == null ? null : r4(s.p), pT_Gminus1: s.pT_Gminus1, meanExTop5Issuers: s.meanExTop5Issuers, ci95: s.ci95, signTestP: s.signTestP, meanGross: s.meanGross, meanSpy: s.meanSpy, meanExcessGross: s.meanExcessGross, meanRoundTripCostBps: s.meanRoundTripCostBps } : { n: 0 });
const result = {
  label: DRY ? "DRY RUN on the confirmation period (not the holdout)" : "SEEN HOLDOUT (published >= 2026-09-01) — single evaluation by the auditor",
  runAt: new Date().toISOString(), frozenRulesSha256: FROZEN_SHA, frozenAt: frozen.frozenAt, period: TARGET,
  rules: {
    F1: { spec: frozen.rules.find((r) => r.id === "F1"), tier1: slim(stat.F1), tier2: slim(stat.F1x2), statusCounts: run.F1.statusCounts, excludedAsSuspect: run.F1.excludedAsSuspect, byMonth: byMonth(run.F1.ok), concentration: contrib(run.F1.ok), ...wl(run.F1.ok), verdict: verdicts.F1 },
    F2: { spec: frozen.rules.find((r) => r.id === "F2"), tier1: slim(stat.F2), tier2: slim(stat.F2x2), statusCounts: run.F2.statusCounts, excludedAsSuspect: run.F2.excludedAsSuspect, byMonth: byMonth(run.F2.ok), concentration: contrib(run.F2.ok), ...wl(run.F2.ok), verdict: verdicts.F2 },
    F3: { spec: frozen.rules.find((r) => r.id === "F3"), bps25: slim(stat.F3), bps50: slim(stat.F3c50), statusCounts: run.F3.statusCounts, excludedAsSuspect: run.F3.excludedAsSuspect, invalidBuyableLt5k: run.F3.invalidBuyableLt5k, byMonth: byMonth(run.F3.ok), concentration: contrib(run.F3.ok), ...wl(run.F3.ok), verdict: verdicts.F3 },
  },
  coverage, diagnostics: Object.fromEntries(Object.entries(diagnostics).map(([k, v]) => [k, typeof v === "string" ? v : slim(v)])), reference,
};

// Event-level CSV: one row per T3 event in the target period.
const cols = ["id", "issuerCik", "ticker", "issuerName", "insider", "role", "publishedAt", "pubBucket", "filingValue", "costBpsTier", "suspectSymbol", "inAhPool",
  ...["F1", "F2"].flatMap((k) => [`${k}_status`, `${k}_entryDate`, `${k}_entryPrice`, `${k}_exitDate`, `${k}_exitPrice`, `${k}_gross`, `${k}_spy`, `${k}_net`, `${k}_excessNet_x1`, `${k}_excessNet_x2`]),
  "F3_status", "F3_minutesAfterAcceptance", "F3_entryRaw", "F3_splitFactor", "F3_entryAdj", "F3_exitDate", "F3_exitPrice", "F3_gross", "F3_spy", "F3_excessNet_25", "F3_excessNet_50", "F3_ahBuyable15", "F3_passesBuyable5k", "F3_usable",
  ...[1, 2, 3, 5, 10, 20, 40, 60].map((N) => `stageC_h${N}_status`)];
const csvRows = t3.map((e) => {
  const o = { id: e.id, issuerCik: e.issuerCik, ticker: e.ticker, issuerName: e.issuerName, insider: e.insider, role: e.role, publishedAt: e.publishedAt, pubBucket: X.pubBucket(e), filingValue: Math.round(e.filingValue), costBpsTier: e.costBpsPerSide, suspectSymbol: X.SUSPECT_SYMBOLS.has(X.symOf(e.ticker)) ? 1 : 0, inAhPool: X.inAhPool(e) ? 1 : 0 };
  for (const k of ["F1", "F2"]) { const r = rowsById[k].get(e.id), r2 = rowsById[`${k}x2`].get(e.id); o[`${k}_status`] = r ? r.status : "excluded_suspect"; if (r?.status === "ok") Object.assign(o, { [`${k}_entryDate`]: r.entryDate, [`${k}_entryPrice`]: r.entryPrice, [`${k}_exitDate`]: r.exitDate, [`${k}_exitPrice`]: r.exitPrice, [`${k}_gross`]: r.gross, [`${k}_spy`]: r.spyRet, [`${k}_net`]: r.net, [`${k}_excessNet_x1`]: r.excessNet, [`${k}_excessNet_x2`]: r2?.excessNet }); else if (r) Object.assign(o, { [`${k}_entryDate`]: r.entryDate ?? null, [`${k}_exitDate`]: r.exitDate ?? null }); }
  const a = rowsById.F3.get(e.id), a50 = rowsById.F3c50.get(e.id);
  if (X.inAhPool(e)) { o.F3_status = a ? a.status : "excluded_suspect"; if (a?.status === "ok") Object.assign(o, { F3_minutesAfterAcceptance: a.minutesAfterAcceptance, F3_entryRaw: a.entryRaw, F3_splitFactor: a.splitFactor, F3_entryAdj: a.entryPrice, F3_exitDate: a.exitDate, F3_exitPrice: a.exitPrice, F3_gross: a.gross, F3_spy: a.spyRet, F3_excessNet_25: a.excessNet, F3_excessNet_50: a50?.excessNet, F3_ahBuyable15: a.ahBuyable15, F3_passesBuyable5k: buyableOk(a) ? 1 : 0, F3_usable: usableRow(a) && buyableOk(a) ? 1 : 0 }); }
  else o.F3_status = "not_after_close";
  for (const N of [1, 2, 3, 5, 10, 20, 40, 60]) o[`stageC_h${N}_status`] = e.h?.[N]?.status || "missing";
  return o;
});

const show = (k, s) => console.log(`${k.padEnd(5)} n ${s.n ?? 0}/${s.issuers ?? 0} mean ${s.mean} med ${s.median} imed ${s.issuerMedianOfMeans} t ${s.t} p ${s.p == null ? null : r4(s.p)} pT ${s.pT_Gminus1} exTop5 ${s.meanExTop5Issuers} ci ${JSON.stringify(s.ci95)}`);
console.log(result.label);
for (const k of Object.keys(SPEC)) show(k, stat[k]);
console.log("verdicts", JSON.stringify(verdicts));
console.log("coverage", JSON.stringify(coverage));
console.log("status", JSON.stringify(Object.fromEntries(Object.entries(run).map(([k, v]) => [k, { ...v.statusCounts, suspect: v.excludedAsSuspect, buyableLt5k: v.invalidBuyableLt5k }]))));
if (DRY) { console.log("[dry] nothing written"); process.exit(0); }
writeOut("holdout.json", result);
writeOut("holdout-events.csv", X.toCsv(csvRows, cols));
console.log(`written: ${path.join(OUT, "holdout.json")} and holdout-events.csv (${csvRows.length} rows)`);
