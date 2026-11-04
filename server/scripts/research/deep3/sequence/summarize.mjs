// deep3/sequence/summarize.mjs — per position × target table (CSV/JSON), candidates.json, summary.json, report text.
//   node scripts/research/deep3/sequence/summarize.mjs
import { readOut, writeOut, writePretty, toCsv, r4, myRegistry, myResults } from "./common.mjs";

const T = readOut("position-tables.json"), tests = readOut("tests-results.json"), leads = readOut("frozen-leads.json"), fu = readOut("followups.json");
const rows = [];
for (const [key, tab] of Object.entries(T)) {
  const [g, u, p] = key.split("|");
  const B = { ...tab.buckets, "6+": tab.testBuckets["6+"], ...Object.fromEntries(Object.entries(tab.exact || {}).map(([k, v]) => [`exact${k}`, v])), ALL: tab.all, ...(tab.allPurchaseBaseline ? { allPurchaseBaseline: tab.allPurchaseBaseline } : {}) };
  for (const [b, d] of Object.entries(B)) {
    if (!d || !d.n) continue;
    for (const X of ["t5", "t10", "t15", "t20"]) {
      const t = d.touch[X]; const st = tab.buckets[b]?.stability?.[`${X}w5`];
      rows.push({ grouping: g, universe: u, period: p, bucket: b, target: `+${X.slice(1)}%`, n: d.n, issuers: d.issuers, medianUsd: d.amountUsd.median, p25Usd: d.amountUsd.p25, p75Usd: d.amountUsd.p75,
        w1: t.w1.rate, w2: t.w2.rate, w3: t.w3.rate, w5: t.w5.rate, w10: t.w10.rate, ctl_w1: t.w1.ctlVolMom, ctl_w2: t.w2.ctlVolMom, ctl_w3: t.w3.ctlVolMom, ctl_w5: t.w5.ctlVolMom, ctl_w10: t.w10.ctlVolMom,
        diff_w5: t.w5.diffVsVolMom, diff_w5_lo: t.w5.diffCi95?.[0], diff_w5_hi: t.w5.diffCi95?.[1], diff_w5_vsVolOnly: t.w5.diffVsVolOnly,
        medianSessionsToTarget: t.timeToTarget.medianSession, ctlMedianSessions: t.timeToTarget.ctlMedianSession, hitters10: t.timeToTarget.hitters10, nFull10: t.timeToTarget.nFull,
        ddBeforeTargetMedian: t.drawdownBeforeTarget.medianWorstCase, ddBeforeTargetP25: t.drawdownBeforeTarget.p25WorstCase, ddBeforeStrictMedian: t.drawdownBeforeTarget.medianStrict, shareDDdeeper5: t.drawdownBeforeTarget.shareDeeperThan5pct, nonHittersMae10: t.nonHittersMae10,
        months: st?.monthsN, monthsAboveCtl: st?.monthsAboveCtl, issuersWithHitW5: st?.issuersWithHit, top5ShareOfHits: st?.top5ShareOfHits, rateExTop5: st?.rateExTop5, diffExTop5: st?.diffExTop5, issuerMedianRate: st?.issuerMedianRate,
        net_N1: d.net.N1?.meanX1, net_N3: d.net.N3?.meanX1, net_N3_median: d.net.N3?.medianX1, net_N5: d.net.N5?.meanX1, limitFill_N5: d.limitFill[`${X}n5`]?.meanNetX1, limitFill_N5_fillRate: d.limitFill[`${X}n5`]?.fillRate });
    }
  }
}
writeOut("position-target-table.csv", toCsv(rows, Object.keys(rows[0])));
writePretty("position-target-table.json", rows);

// candidates: none qualifies (documented)
const cand = [];
writePretty("candidates.json", cand);
writePretty("candidates-rationale.json", {
  candidates: cand.length,
  why: "No rule meets the deep-2/3 bar (discovery BH q < 0.10 as a positive net-of-cost long rule with n >= 40 and >= 25 issuers; confirmation same sign p < 0.10; positive median of issuer means; ex-top-5 same sign). None of the 30 registered net-level tests (S2) or the 18 rolling levels (S9) reached q < 0.10; the three best post-hoc leads (frozen in frozen-leads.json) all turned negative in confirmation and were negative with a one-session entry delay already in discovery.",
  frozenLeads: Object.fromEntries(Object.entries(leads.leads).map(([k, v]) => [k, { label: v.label, discovery: v.discover.spyRelative, confirmation: v.confirm.spyRelative }])),
});

// counts for the report
const reg = myRegistry(), res = myResults();
const fams = {}; for (const h of reg) fams[h.family] = h.familySize;
writePretty("summary.json", {
  registry: { ids: reg.length, results: res.length, families: fams },
  discovery: { tests: tests.discoveryTests, withP: tests.discoveryWithP, qBelow10: tests.qBelow10 },
  files: ["build-summary.json", "filings.json", "signals.json", "filing-seq.json", "trade-order.json", "tests-spec.json", "outcomes.json", "controls.json", "controls-balance.json", "validation-stageC.json",
    "tests-results.json", "position-tables.json", "position-target-table.csv", "position-target-table.json", "cross-tabs.json", "followups.json", "frozen-leads.json", "frozen-leads-events.csv",
    "sequence-events.csv", "cases-index.json", "case-*.json", "candidates.json", "candidates-rationale.json"],
});
// report text: cal|om discovery & confirmation, test buckets × targets
const f = (v, d = 0) => (v == null || !Number.isFinite(v) ? "—" : (v * 100).toFixed(d));
for (const p of ["discover", "confirm"]) {
  console.log(`\n### cal|om|${p}: touch % (event / matched controls) at 1, 2, 3, 5 sessions; median sessions to target; median worst-case drawdown before target; median $; stability (months above ctl; issuers with a hit; top-5 share of hits; diff ex top-5)`);
  console.log("| pos | target | n (issuers) | ≤1 | ≤2 | ≤3 | ≤5 | diff ≤5 [95% CI] | med sessions | DD before | med $ | months>ctl | issuers hit | top-5 share | diff ex-top5 |");
  console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of rows.filter((x) => x.grouping === "cal" && x.universe === "om" && x.period === p && ["1", "2", "3", "4", "5", "6+", "6-7", "8-10", "11+"].includes(x.bucket))) {
    console.log(`| ${r.bucket} | ${r.target} | ${r.n} (${r.issuers}) | ${f(r.w1)}/${f(r.ctl_w1)} | ${f(r.w2)}/${f(r.ctl_w2)} | ${f(r.w3)}/${f(r.ctl_w3)} | ${f(r.w5)}/${f(r.ctl_w5)} | ${f(r.diff_w5, 1)} [${f(r.diff_w5_lo, 1)}, ${f(r.diff_w5_hi, 1)}] | ${r.medianSessionsToTarget ?? "—"} | ${f(r.ddBeforeTargetMedian, 1)} | ${r.medianUsd ? Math.round(r.medianUsd / 1000) + "k" : "—"} | ${r.monthsAboveCtl ?? "—"}/${r.months ?? "—"} | ${r.issuersWithHitW5 ?? "—"} | ${f(r.top5ShareOfHits)} | ${f(r.diffExTop5, 1)} |`);
  }
}
