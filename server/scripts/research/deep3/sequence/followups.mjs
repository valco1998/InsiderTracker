// deep3/sequence/followups.mjs — POST-HOC follow-ups (selected after seeing S1–S10 discovery results) + robustness of the
// promising items. Registered here BEFORE computation (family R1 = follow-up levels/controls, R2 = robustness variants).
//   node scripts/research/deep3/sequence/followups.mjs
// Selection basis (disclosed): S8 speed contrasts (q 0.023–0.088), S8 drawdown contrast (q < 0.001), S3/S6 position-1/2
// residuals vs matched controls (q 0.000–0.045). Nothing here touches the confirmation period except R3 (frozen candidate,
// registered at freeze time, evaluated once).
import { readOut, writePretty, regMany, recMany, clusteredMean, companyStats, r4, mean, median, group, bootCI } from "./common.mjs";
import { METRICS, MIN_N, MIN_ISSUERS } from "./tests.mjs";

const signals = readOut("signals.json"), outc = readOut("outcomes.json"), ctl = readOut("controls.json");
const J = signals.map((s) => { const o = outc[s.acc]; return { ...s, out: o?.status === "ok" ? o : null, feat: o?.feat || null, ctl: ctl[s.acc] || null }; })
  .filter((s) => s.out && !(s.grouping === "roll" && s.windowTruncated));
const P = (g, p) => J.filter((s) => s.grouping === g && s.universe === "om" && s.period === p);
const net = (s, N, { v = "o", m = 1 } = {}) => s.out?.[v]?.x?.[N]?.[m - 1] ?? null;
const touch = (s, X, W) => { const O = s.out.o; if (O.availTouchW < W) return null; const f = O.first[`t${Math.round(X * 100)}`]; return f != null && f <= W ? 1 : 0; };
const SEL = {
  fast: (s) => s.position >= 2 && s.daysSinceFirst <= 3,
  slow: (s) => s.position >= 2 && s.daysSinceFirst > 10,
  dd30: (s) => s.position >= 2 && s.feat?.dd60 != null && s.feat.dd60 <= -0.3,
  pos1: (s) => s.position === 1,
  pos2: (s) => s.position === 2,
};
const R1 = [
  ["fast-N3-level", "cal", "fast", "level", "N3", "Cal month, positions >= 2 arriving <= 3 days after buyer #1: net excess N=3 (tier ×1) > 0."],
  ["fast-N5-level", "cal", "fast", "level", "N5", "Same subset: net excess N=5 > 0."],
  ["fast-T10W5-ctl", "cal", "fast", "ctlTouch", "T10W5", "Same subset: touch +10% within 5 sessions minus volMom controls."],
  ["fast-N3-ctl", "cal", "fast", "ctlNet", "N3", "Same subset: net N=3 minus volMom controls."],
  ["slow-N3-level", "cal", "slow", "level", "N3", "Cal month, positions >= 2 arriving > 10 days after buyer #1: net excess N=3 (expected negative)."],
  ["slow-N3-ctl", "cal", "slow", "ctlNet", "N3", "Same subset: net N=3 minus volMom controls."],
  ["dd30-T10W5-ctl", "cal", "dd30", "ctlTouch", "T10W5", "Cal month, positions >= 2 after a >= 30% fall from the 60-session high: touch +10%/5 minus volMom controls (is the high touch rate only volatility?)."],
  ["dd30-N3-level", "cal", "dd30", "level", "N3", "Same subset: net excess N=3 > 0."],
  ["dd30-N3-ctl", "cal", "dd30", "ctlNet", "N3", "Same subset: net N=3 minus volMom controls."],
  ["roll-fast-N3-level", "roll", "fast", "level", "N3", "Rolling 30 days, positions >= 2 <= 3 days after the window's first buyer: net excess N=3 > 0."],
];
const VARIANTS = ["exTop5", "onePerCompanyMonth", "costsX2", "delay1", "cleanCoverage", "monthsPositive"];
const R2T = [["pos1-N3-ctl", "cal", "pos1", "ctlNet", "N3"], ["pos2-N3-ctl", "cal", "pos2", "ctlNet", "N3"], ["fast-N3-level", "cal", "fast", "level", "N3"], ["dd30-N3-level", "cal", "dd30", "level", "N3"]];
const regs = [
  ...R1.map(([k, g, sel, kind, m, st]) => ({ id: `sequence-R1-${k}`, family: "R1-posthoc-followups", familySize: R1.length, statement: `POST-HOC (chosen after S8). ${st}`,
    rationale: "Speed: insiders buying together within days (coordinated board buying, an open trading window after news) may carry more information than stragglers; drawdown: buying into a fall (reversal + volatility).",
    spec: { grouping: g, sel, kind, metric: m, period: "discover" } })),
  ...R2T.flatMap(([k, g, sel, kind, m]) => VARIANTS.map((v) => ({ id: `sequence-R2-${k}-${v}`, family: "R2-robustness", familySize: R2T.length * VARIANTS.length,
    statement: `Robustness of ${k} (discovery): variant ${v}.`, rationale: "Robustness checks required by the brief for anything promising.", spec: { grouping: g, sel, kind, metric: m, variant: v, period: "discover" } }))),
];
console.log("registered", regMany(regs), "new follow-up ids");

const okS = (rows) => rows.length >= MIN_N && new Set(rows.map((r) => r.issuer)).size >= MIN_ISSUERS;
function rowsOf(evs, kind, m, { mult = 1, v = "o" } = {}) {
  const M = METRICS[m];
  return evs.map((s) => {
    if (kind === "level") { const x = net(s, M.N, { v, m: mult }); return x == null ? null : { issuer: s.cik, x, s }; }
    if (kind === "ctlNet") { const a = net(s, M.N, { v, m: mult }); const b = mult === 1 ? s.ctl?.volMom?.x?.[M.N] : s.ctl?.volMom?.x2?.[M.N]; return a == null || b == null ? null : { issuer: s.cik, x: a - b, s }; }
    if (kind === "ctlTouch") { const a = touch(s, M.X, M.W), b = s.ctl?.volMom?.hit?.[`t${Math.round(M.X * 100)}w${M.W}`]; return a == null || b == null ? null : { issuer: s.cik, x: a - b, s }; }
    return null;
  }).filter(Boolean);
}
function evalRows(rows) {
  if (!okS(rows)) return { status: "NA", n: rows.length };
  const cs = companyStats(rows), c = clusteredMean(rows);
  return { status: "ok", n: cs.n, issuers: cs.issuers, estimate: cs.mean, median: cs.median, positive: cs.positive, issuerMedianOfMeans: cs.issuerMedianOfMeans, meanExTop5Issuers: cs.meanExTop5Issuers, ci95: cs.ci95, t: c.t, p: c.p };
}
const res = [];
for (const [k, g, sel, kind, m] of R1) res.push([`sequence-R1-${k}`, evalRows(rowsOf(P(g, "discover").filter(SEL[sel]), kind, m))]);
for (const [k, g, sel, kind, m] of R2T) {
  const evs = P(g, "discover").filter(SEL[sel]);
  for (const v of VARIANTS) {
    let r;
    if (v === "exTop5") { const base = evalRows(rowsOf(evs, kind, m)); r = { status: base.status, estimate: base.meanExTop5Issuers, full: base.estimate, n: base.n }; }
    else if (v === "onePerCompanyMonth") { const first = [...group(evs, (s) => `${s.cik}|${s.month}`).values()].map((xs) => xs.sort((a, b) => a.T.localeCompare(b.T))[0]); r = evalRows(rowsOf(first, kind, m)); }
    else if (v === "costsX2") r = evalRows(rowsOf(evs, kind, m, { mult: 2 }));
    else if (v === "delay1") r = evalRows(rowsOf(evs, "level", m, { v: "od" })); // level only: controls were not re-entered a session later
    else if (v === "cleanCoverage") r = evalRows(rowsOf(evs.filter((s) => !s.gapDaysInWindow), kind, m));
    else if (v === "monthsPositive") { const rows = rowsOf(evs, kind, m); const bm = [...group(rows, (r) => r.s.month).entries()].sort().map(([mo, xs]) => [mo, xs.length, r4(mean(xs.map((x) => x.x)))]); r = { status: "ok", months: bm, positiveMonths: bm.filter((x) => x[2] > 0).length, nMonths: bm.length }; }
    res.push([`sequence-R2-${k}-${v}`, r]);
  }
}
recMany(res);
writePretty("followups.json", Object.fromEntries(res));
const f = (v) => (v == null ? "—" : (v * 100).toFixed(2));
for (const [id, r] of res) console.log(id.replace("sequence-", "").padEnd(40), r.status, "n", r.n ?? "", "est", f(r.estimate), "med", f(r.median), "t", r.t ?? "", "p", r.p ?? "", "exTop5", f(r.meanExTop5Issuers), r.months ? `months+ ${r.positiveMonths}/${r.nMonths} ${JSON.stringify(r.months)}` : "");
