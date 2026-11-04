// deep3/audit/finalSummary.mjs — auditor (agent "audit3"): audit-summary.json (verdicts, key numbers, judgment).
//   node scripts/research/deep3/audit/finalSummary.mjs        (reads saved audit outputs; no holdout access needed)
import fs from "node:fs";
import path from "node:path";
import * as V from "../dataquality/validate.mjs";
import { L, OUT, SEQ, TGT, DEEP3, readJson, writeOut, r4, sha256File, FROZEN3, FROZEN3_SHA, readJsonl } from "./common.mjs";

const CA = readJson(path.join(OUT, "code-audit.json")), PW = readJson(path.join(OUT, "power.json")), MT = readJson(path.join(OUT, "multiple-testing.json")), XP = readJson(path.join(OUT, "exposed-period.json"));
const csv = (f) => { const [h, ...ls] = fs.readFileSync(f, "utf8").split("\n").filter(Boolean); const cols = h.split(","); return ls.map((l) => { const v = l.split(","); return Object.fromEntries(cols.map((c, i) => [c, v[i]])); }); };
const num = (x) => (x === "" || x == null ? null : Number(x));
// pooled out-of-sample (confirmation + exposed) per lead, frozen metric, tier x1
const seqConf = csv(path.join(SEQ, "frozen-leads-events.csv")).filter((r) => r.period === "confirm");
const xpEv = csv(path.join(OUT, "exposed-period-events.csv"));
const pooled = {}, powerDisc = {};
const disc = { "S-L1_buyer2": 0.0093, "S-L2_fastFollower": 0.0111, "S-L3_drawdownFollower": 0.0155, "T-othersPlanOnly|x5": 0.0155, "T-othersPlanOnly|tp": 0.0193, "T-C5_clu_low60|x5": 0.0135 };
const stats = (rows) => { const c = L.companyStats(rows); return { n: c.n, issuers: c.issuers, mean: c.mean, median: c.median, issuerMedianOfMeans: c.issuerMedianOfMeans, t: c.t, p: c.p == null ? null : r4(c.p), meanExTop5Issuers: c.meanExTop5Issuers, ci95: c.ci95 }; };
const pw = (rows, delta) => { const c = V.clusteredMean(rows, { value: "x", cluster: "issuer" }); return c.n > 2 ? r4(V.powerMean({ delta, sd: c.sd, n: c.n, deff: Math.max(1, c.deff || 1) })) : null; };
for (const k of ["L1_buyer2", "L2_fastFollower", "L3_drawdownFollower"]) {
  const a = seqConf.filter((r) => r.lead === k).map((r) => ({ issuer: r.issuer, x: num(r.x1) })), b = xpEv.filter((r) => r.lead === `S-${k}`).map((r) => ({ issuer: r.issuer, x: num(r.x1) }));
  pooled[`S-${k}`] = stats([...a, ...b]); powerDisc[`S-${k}`] = { exposedOnly: pw(b, disc[`S-${k}`]), confirmPlusExposed: pw([...a, ...b], disc[`S-${k}`]), discoveryEffect: disc[`S-${k}`] };
}
for (const [pid, file] of [["othersPlanOnly", "exec-trades-othersPlanOnly-confirm.csv"], ["C5_clu_low60", "exec-trades-C5_clu_low60-confirm.csv"]]) {
  const a = csv(path.join(TGT, file)).map((r) => ({ issuer: r.issuerCik, x: num(r.excessNet) })), b = xpEv.filter((r) => r.lead === `T-${pid}` && r.variant === "execLib close of session 5").map((r) => ({ issuer: r.issuer, x: num(r.x1) }));
  pooled[`T-${pid}|x5`] = stats([...a, ...b]); powerDisc[`T-${pid}|x5`] = { exposedOnly: pw(b, disc[`T-${pid}|x5`]), confirmPlusExposed: pw([...a, ...b], disc[`T-${pid}|x5`]), discoveryEffect: disc[`T-${pid}|x5`] };
}
{ const b = xpEv.filter((r) => r.lead === "T-othersPlanOnly" && r.variant === "limit-fill approximation").map((r) => ({ issuer: r.issuer, x: num(r.x1) })); powerDisc["T-othersPlanOnly|tp"] = { exposedOnly: pw(b, disc["T-othersPlanOnly|tp"]), discoveryEffect: disc["T-othersPlanOnly|tp"] }; }

const reg = readJsonl(path.join(DEEP3, "registry.jsonl")), res = readJsonl(path.join(DEEP3, "registry-results.jsonl"));
const lead = (k) => XP.leads[k];
const sl = (s) => s && { n: s.n, issuers: s.issuers, mean: s.mean, median: s.median, issuerMedianOfMeans: s.issuerMedianOfMeans, meanExTop5Issuers: s.meanExTop5Issuers, t: s.t, p: s.p, ci95: s.ci95 };
const summary = {
  generatedAt: new Date().toISOString(), agent: "audit3 (role G)",
  integrity: { frozenRulesSha256Verified: sha256File(FROZEN3) === FROZEN3_SHA, frozenRulesSha256: FROZEN3_SHA, innerFileHashesVerifiedBeforeAndAfter: true,
    exposedPeriodRuns: 1, dryRunReproducedSpecialistOutputsExactly: readJson(path.join(OUT, "exposed", "dry", "dry-check.json")).seqFrozenLeadMetrics === true,
    exposedRunLeftPreHoldoutDataIdentical: XP.integrity, copiesDifferOnlyIn: "import depth, output folder, private registry file, period switch (exposed-diff.txt)", holdoutAccess: "only inside the single exposed run (DEEP2_HOLDOUT=1 scoped to that process)" },
  registry: { deep3Registered: reg.length, byAgent: reg.reduce((m, r) => ((m[r.agent] = (m[r.agent] || 0) + 1), m), {}), resultRecords: res.length, audit3: { registered: reg.filter((r) => r.agent === "audit3").length, resultsBeforeRegistration: 0 },
    acrossStudiesPValues: { deep1Train: MT.counts.deep1TrainPValues, deep2: MT.counts.deep2PValues, deep3BeforeExposedRun: MT.counts.deep3TestsWithP, audit3ExposedIdsAdded: reg.filter((r) => r.id.startsWith("audit3-X-")).length } },
  codeAudit: { issues: CA.issues.map((i) => ({ id: i.id, severity: i.severity, area: i.area, where: i.where })), lookAhead: CA.summary.lookAheadFound },
  power: { pooledPreHoldoutMDE80_touch10w5_points: Object.fromEntries(["1", "2", "3", "4", "5", "6+", "2+"].map((b) => [b, { n: PW.power.pooled[b].touch10w5.n, mde: PW.power.pooled[b].touch10w5.mde80Paired, observed: PW.power.pooled[b].touch10w5.diff, ci95: PW.power.pooled[b].touch10w5.ci95, powerFor: PW.power.pooled[b].touch10w5.power }])),
    pooledPreHoldoutMDE80_net3: Object.fromEntries(["1", "2", "3", "4", "5", "6+", "2+"].map((b) => [b, { n: PW.power.pooled[b].net3.n, mde: PW.power.pooled[b].net3.mde80, observed: PW.power.pooled[b].net3.mean, ci95: PW.power.pooled[b].net3.ci95 }])),
    C1_combined: PW.C1.pooled, C1_byPeriod: { discover: PW.C1.discover, confirm: PW.C1.confirm },
    E1_entryDay: { vsGapControls_notBlind: PW.E1.a_day0Up10_vsGapCtl.pooled, vsVolMom: PW.E1.ref_day0Up10_vsVolMom.pooled, downside: PW.E1.b_day0Down10_vsVolMom.pooled, day0Net: PW.E1.c_day0Net_vsVolMom, topGapTercile: PW.E1.d_topGapTercile.topMinusRest, byTercile: { top: PW.E1.d_topGapTercile.top, middle: PW.E1.d_topGapTercile.middle, bottom: PW.E1.d_topGapTercile.bottom },
      gapInclusiveTouch: { pos1: PW.E1.e_gapInclusive_T10W5.pos1.pooled, pos2plus: PW.E1.e_gapInclusive_T10W5.pos2plus.pooled, byBucket: PW.E1.e_gapInclusive_T10W5.byBucketPooled } } },
  multipleTesting: { bh: MT.bh.map((b) => ({ name: b.name, tests: b.tests, survivorsQ10: b.survivorsQ10, bySign: b.bySign, positiveExecutableLongNet: b.positiveExecutableLongNetSurvivors })), frozenLeadsPosition: MT.frozenLeadsPosition },
  exposedPeriod: { label: XP.label, verdicts: XP.verdicts,
    table: Object.fromEntries(Object.entries(XP.leads).flatMap(([k, v]) => (v.primary ? [[k, { ...sl(v.primary), costX2: v.costX2?.mean, profitFactorNet: v.profitFactorNet, worstTrade: v.worstTrade, touch: v.touch10w5VsControls, oneRowPerTrade: sl(v.diagnosticOneRowPerTrade) }]] : [[`${k}|x5`, { ...sl(v.x5.primary), costX2: v.x5.costX2.mean, profitFactorVsSpy: v.x5.profitFactorVsSpy, worstTrade: v.x5.worstTrade, touch: v.touch10_5VsControls }], ...(v.tpApprox ? [[`${k}|tpApprox`, { ...sl(v.tpApprox.primary), costX2: v.tpApprox.costX2.mean, profitFactorVsSpy: v.tpApprox.profitFactorVsSpy, worstTrade: v.tpApprox.worstTrade, exits: { tp: v.tpApprox.fills, stop: v.tpApprox.stops, time: v.tpApprox.timeExits } }]] : [])]))),
    pooledConfirmationPlusExposed: pooled, powerToDetectDiscoverySizedEffect: powerDisc, buyerPositionTable: XP.buyerPositionTouchTable.table },
  verdicts: {
    sequence: { main: "CONFIRMED", note: "No buyer position or 'largest so far' signal gives more +10% touches or a positive net return after the open, vs matched non-event stock-days. Identity rule (S4), control design (S9), amendments (S5) and embargo/costs (S10/S11) do not change it; positions 1-2 are adequately powered (MDE 2.1 / 4.3 points), positions 4-6+ are not (MDE 9-31 points). Frozen leads: REFUTED (all three significantly negative on the exposed period). 'Partial SEC days inflate the weak positives': the conclusion holds but the mechanism is REFUTED (calendar effect, S2). L2/L3 discovery evidence was inflated by duplicate trades (S1)." },
    targets: { main: "CONFIRMED", note: "No more or faster large up-moves (holds under gap and volRich controls; exposed period all open-market +0.3 points); nothing monetisable (exposed: othersPlanOnly x5 +0.06%, limit approx -0.56%, C5 -2.67%). 'The robust insider effect is less downside': WEAKENED (confirmation -2.5 points primary, -1.3 points t -0.83 with volRich controls: partly volatility mean-reversion)." },
    dataquality: { main: "CONFIRMED (immaterial for deep 3)", note: "I1 is real for all-P trade-date months but changes 0 of 4,018 open-market calendar-month positions; A1 affects about 2% of targets' universe with negligible effect; P4 fields are not used by deep 3; partial days miss 31 filings in total. validate.mjs used here without problems." },
    overall: "CONFIRMED: in this data, the buyer's chronological position within the month (alone or combined with amount rank and prior drawdown) does not predict a >= 10% gain after the first price a public trader can get; median time to +10% among the ~20% that touch it is the second session after the entry day, the same for controls. Insider filings DO precede more >= 10% moves when the opening gap is counted (+5.7 to +6.8 points vs controls, similar for positions 1-4), but that move is priced before the first public auction print.",
  },
  judgment: {
    paperTrade: "No. None of the five frozen leads survived; four of the six exposed-period metrics are negative (three significantly). C1 (position >= 2 x largest-so-far x drawdown >= 30%) is +7.8 touch points and +1.03% N3 but not significant (p 0.13 / 0.29) and mixed across periods. At most: zero-cost forward data collection (log every filing with its position, amount and acceptance time, plus the post-publication minute path).",
    download: "Item 3 (1-minute bars for the 7,043 after-close and overnight filings, about 750-1,500 requests, 5-10 minutes). The only robust positive in deep 3 is the gap-inclusive one (E1e); minute bars are the only listed download that shows how much of the move is still available between acceptance and the open (after hours, premarket, opening auction). Prices would then need trades (items 5-6) and, for spreads, quotes (item 7, needs approval). Older SEC history (item 9) is the only route to an independent test and to adequate power at positions >= 3, but with negative point estimates in all three periods it would more likely confirm than overturn the 'no'.",
  },
};
writeOut("audit-summary.json", summary);
console.log(JSON.stringify({ pooled, powerDisc, integrity: summary.integrity, registry: summary.registry }, null, 1));
