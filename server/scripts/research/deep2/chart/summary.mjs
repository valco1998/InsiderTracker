// deep2/chart/summary.mjs — final BH over every chart-agent test, the matched-control results table, task 2/3 tables,
// a descriptive gross-vs-net decomposition, and candidates.json. Computes no new hypothesis test.
//   node scripts/research/deep2/chart/summary.mjs
import fs from "node:fs";
import path from "node:path";
import { setup } from "./mcSetup.mjs";
import { myRegistry, myResults, bhQ, r4, mean, median, usable, usableN, writeOut, OUT, pct } from "./common.mjs";

const reg = myRegistry(), res = myResults();
const latest = new Map(); for (const x of res) latest.set(x.id, x.result);
const ids = reg.map((h) => h.id).filter((k) => latest.has(k));
const ps = ids.map((k) => latest.get(k)?.p ?? null), qs = bhQ(ps);
const Q = new Map(ids.map((k, i) => [k, qs[i]]));
const tests = reg.map((h) => ({ id: h.id, family: h.family, familySize: h.familySize, statement: h.statement, p: latest.get(h.id)?.p ?? null, q: r4(Q.get(h.id)), effect: latest.get(h.id)?.mean ?? latest.get(h.id)?.diff ?? null }));
const famCount = {}; for (const h of reg) famCount[h.family] = (famCount[h.family] || 0) + 1;
writeOut("tests-summary.json", { generatedAt: new Date().toISOString(), registered: reg.length, withResults: ids.length, withP: ps.filter((p) => p != null).length, families: famCount, passingQ10: tests.filter((t) => t.q != null && t.q < 0.1).length, tests });

// ---- matched-control table (task 1) with final q ----
const mc = JSON.parse(fs.readFileSync(path.join(OUT, "mc-results.json"), "utf8"));
const mcTable = [];
for (const [sub, o] of Object.entries(mc.primary)) for (const [k, x] of Object.entries(o)) mcTable.push({ design: "primary", subset: sub, outcome: k, n: x.diff.n, issuers: x.diff.issuers, eventMean: x.event.mean, eventMedian: x.event.median, controlMean: x.control.mean, diffMean: x.diff.mean, diffWmean: x.diff.wmean, diffMedian: x.diff.median, diffIssuerMedianOfMeans: x.diff.issuerMedianOfMeans, issuersPositive: x.diff.issuersPositive, t: x.diff.t, p: r4(x.diff.p), q: r4(Q.get(`chart-T1-${sub}-${k}`)), meanExTop5: x.diff.meanExTop5Issuers, ci95: x.diff.ci95 });
for (const [v, o] of Object.entries(mc.robustness)) for (const [k, x] of Object.entries(o)) mcTable.push({ design: v, subset: "all", outcome: k, n: x.diff.n, issuers: x.diff.issuers, eventMean: x.event.mean, eventMedian: x.event.median, controlMean: x.control.mean, diffMean: x.diff.mean, diffWmean: x.diff.wmean, diffMedian: x.diff.median, diffIssuerMedianOfMeans: x.diff.issuerMedianOfMeans, issuersPositive: x.diff.issuersPositive, t: x.diff.t, p: r4(x.diff.p), q: r4(Q.get(`chart-T1R-${v}-all-${k}`)), meanExTop5: x.diff.meanExTop5Issuers, ci95: x.diff.ci95 });
writeOut("mc-table.json", mcTable);
const cols = ["design", "subset", "outcome", "n", "issuers", "eventMean", "controlMean", "diffMean", "diffWmean", "diffMedian", "diffIssuerMedianOfMeans", "t", "p", "q", "meanExTop5"];
writeOut("mc-table.csv", [cols.join(","), ...mcTable.map((r) => cols.map((c) => r[c]).join(","))].join("\n"));

// ---- descriptive: gross excess vs net excess and costs (discovery events, same samples as task 1 'all') ----
const S = await setup({ log: () => {} });
const disc = S.ev.filter((r) => r.per === "discover");
const decomp = {};
for (const N of [0, 1, 2, 3, 4, 5]) {
  const rows = disc.filter((r) => ([1, 2, 3, 5].includes(N) ? usable(r.e, N, "discover") : usableN(r, N)) && r.o.x[N]);
  decomp[`x${N}`] = { n: rows.length, grossExcessMean: r4(mean(rows.map((r) => r.o.x[N].excess))), grossExcessMedian: r4(median(rows.map((r) => r.o.x[N].excess))), netExcessMean: r4(mean(rows.map((r) => r.o.x[N].xnet))), roundTripCostMean: r4(mean(rows.map((r) => (2 * r.e.costBpsPerSide) / 1e4))) };
}
const byTier = {};
for (const t of [5, 15, 35, 75, 100]) { const rows = disc.filter((r) => r.e.costBpsPerSide === t && usable(r.e, 5, "discover")); byTier[t] = { n: rows.length, grossExcess5Mean: r4(mean(rows.map((r) => r.e.h[5].excess))), grossExcess5Median: r4(median(rows.map((r) => r.e.h[5].excess))), netExcess5Mean: r4(mean(rows.map((r) => r.e.h[5].excessNet))) }; }
writeOut("cost-decomposition.json", { note: "Descriptive only (no test): discovery events, gross excess = (exit/entry − 1) − SPY; net subtracts the per-side tier cost on both sides.", byHorizon: decomp, x5ByCostTier: byTier });

// ---- candidates.json ----
const cr = JSON.parse(fs.readFileSync(path.join(OUT, "candidate-results.json"), "utf8"));
const candidates = [
  { id: "chart-C1", status: cr.frozen.includes("chart-C1") ? "frozen" : "rejected_at_discovery (BH q " + cr.discovery["chart-C1"].checks.bhQ + " >= 0.10); not frozen, confirmation NOT evaluated",
    rule: "venue === 'open_market' (stage C, largest valued row of the filing) AND r5 <= -0.0346, where r5 = close(decision bar) / close(5 bars earlier) - 1 on split-adjusted daily bars and the decision bar is the last bar strictly before the entry session",
    entry: "official open of the first regular session whose 09:30 ET open is >= SEC acceptance + 60 s (stage-C entryPrice)", exit: "official close of the 5th session after the entry session (stage-C h[5].exitPrice)", horizon: 5,
    discovery: cr.discovery["chart-C1"].main, confirmation: null,
    notes: `Selected after tasks 1-3 (data-driven). Discovery mean is carried by a few extreme winners (median +0.03%, issuer median of means -0.08%). Stress (discovery): costs x2 mean ${pct(cr.discovery["chart-C1"].diag.cost2.mean)}; one-session delay ${pct(cr.discovery["chart-C1"].diag.delay1.mean)}; MOC entry ${pct(cr.discovery["chart-C1"].diag.moc.mean)}; vs matched controls ${pct(cr.discovery["chart-C1"].diag.vsControls.mean)} (t ${cr.discovery["chart-C1"].diag.vsControls.t}). Event rows: candidate-C1-events.csv.` },
  { id: "chart-C2", status: "rejected_at_discovery (BH q " + cr.discovery["chart-C2"].checks.bhQ + "); not frozen, confirmation NOT evaluated",
    rule: "any priced stage-C purchase filing AND r5 <= -0.0293 (same r5 definition)", entry: "same as chart-C1", exit: "same as chart-C1", horizon: 5,
    discovery: cr.discovery["chart-C2"].main, confirmation: null, notes: "Broader sibling of C1 without the stated-venue condition; mean excluding the top-5 issuers is 0.00%. Event rows: candidate-C2-events.csv." },
];
writeOut("candidates.json", candidates);

console.log(`registered ${reg.length}, with results ${ids.length}, with p ${ps.filter((p) => p != null).length}, q<0.10: ${tests.filter((t) => t.q != null && t.q < 0.1).length}`);
console.log("families", famCount);
console.log("decomposition", JSON.stringify(decomp, null, 0)); console.log("x5 by cost tier", JSON.stringify(byTier, null, 0));
console.log("\nT1 primary + robustness (final q):");
for (const r of mcTable) console.log(`${r.design.padEnd(8)} ${r.subset.padEnd(16)} ${r.outcome.padEnd(5)} n ${String(r.n).padStart(5)} ev ${pct(r.eventMean)} ctl ${pct(r.controlMean)} diff ${pct(r.diffMean)} w ${pct(r.diffWmean)} med ${pct(r.diffMedian)} issMed ${pct(r.diffIssuerMedianOfMeans)} t ${r.t} q ${r.q} exTop5 ${pct(r.meanExTop5)}`);
console.log("\nfinal q for task 2/3/candidates:");
for (const t of tests.filter((t) => /chart-T2|chart-T3|chart-C|chart-T1D/.test(t.id))) console.log(t.id.padEnd(46), "effect", r4(t.effect), "p", t.p == null ? null : r4(t.p), "q", t.q);
