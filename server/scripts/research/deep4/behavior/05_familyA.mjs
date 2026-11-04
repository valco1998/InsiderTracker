// deep4/behavior/05_familyA.mjs — family A (behaviour-based selection) on DESIGN outcomes. Hypotheses: defs.mjs (registered).
//   node --max-old-space-size=6144 scripts/research/deep4/behavior/05_familyA.mjs
// Primary: mean B_xsNet30 of selected primary purchases, issuer-clustered t (df G-1), two-sided vs 0, BH within family A.
// Secondary (family A.sec, BH within): B_xsNet5/10/20 vs 0; vs matched controls (30d); +10% touch vs controls; MAE vs controls.
// Descriptive: outcome A (insider's unrealised mark), month-adjusted difference vs the complement, time to +10%, MFE, costs x2.
import { loadDesign, isPrimaryPurchase, readJson, writeJson, writeCsv, checkpoint, group, mean, median, quantile, r4, r6, fin, stats, vsControls, vsComplement, bh, V, L4, AGENT } from "./common.mjs";
import { STYLE_RULES_FILE } from "./styles.mjs";
import { A_HYPS, A_SECONDARY, profileOf } from "./defs.mjs";

const th = readJson(STYLE_RULES_FILE).thresholds;
const { rows, C } = loadDesign({ controls: true });
const byPerson = group(rows, (r) => r.person);
for (const xs of byPerson.values()) xs.sort((a, b) => (a.publishedAt < b.publishedAt ? -1 : a.publishedAt > b.publishedAt ? 1 : a.key < b.key ? -1 : 1));
const prim = rows.filter(isPrimaryPurchase);
for (const e of prim) e.P = profileOf(e, byPerson.get(e.person), th);
const ctlVals = (e, f) => C.of(e.key).map((c) => c[f]).filter((x) => fin(x) != null);
const val = (f) => (e) => fin(e[f]);

function block(sel, all) {
  const rest = all.filter((e) => !sel.includes(e));
  const ok30 = sel.filter((e) => fin(e.B_xsNet30) != null);
  const cm = V.clusteredMean(ok30.map((e) => ({ issuer: e.cik, x: e.B_xsNet30 })), { value: "x", cluster: "issuer" });
  const o = { n: sel.length, n30: ok30.length, issuers30: new Set(ok30.map((e) => e.cik)).size, persons30: new Set(ok30.map((e) => e.person)).size,
    primary: { mean: r6(cm.mean), t: r4(cm.t), df: cm.df, p: r4(cm.p), ...stats(ok30, { value: val("B_xsNet30") }) } };
  o.horizons = {}; for (const H of [5, 10, 20, 30]) { const s = stats(sel, { value: val(`B_xsNet${H}`) }); const cmH = V.clusteredMean(sel.filter((e) => fin(e[`B_xsNet${H}`]) != null).map((e) => ({ issuer: e.cik, x: e[`B_xsNet${H}`] })), { value: "x", cluster: "issuer" }); o.horizons[H] = { n: s.n, mean: s.mean, median: s.median, positive: s.positive, t: r4(cmH.t), p: r4(cmH.p), ci95: s.ci95, meanExTop5Issuers: s.meanExTop5Issuers, x2: r6(mean(sel.map((e) => e[`B_xsNet2x${H}`]))) }; }
  o.vsControls30 = vsControls(ok30, { value: val("B_xsNet30"), ctlValues: (e) => ctlVals(e, "B_xsNet30") });
  o.vsControls5 = vsControls(sel.filter((e) => fin(e.B_xsNet5) != null), { value: val("B_xsNet5"), ctlValues: (e) => ctlVals(e, "B_xsNet5") });
  o.hit10_30 = vsControls(sel.filter((e) => fin(e.B_hit10_30) != null), { value: val("B_hit10_30"), ctlValues: (e) => ctlVals(e, "B_hit10_30") });
  o.mae30 = vsControls(sel.filter((e) => fin(e.B_mae30) != null), { value: val("B_mae30"), ctlValues: (e) => ctlVals(e, "B_mae30") });
  o.mfe30Median = r6(median(sel.map((e) => e.B_mfe30))); o.mae30Median = r6(median(sel.map((e) => e.B_mae30)));
  const tt = sel.filter((e) => e.B_tt10obs === 1); o.timeTo10 = { windowComplete: sel.filter((e) => e.B_tt10obs != null).length, touched: tt.length, medianCalDays: median(tt.map((e) => e.B_tt10d)), medianSessions: median(tt.map((e) => e.B_tt10s)) };
  o.lim10_30 = r6(mean(sel.map((e) => e.B_lim10_30)));
  o.outcomeA = { note: "insider's hypothetical unrealised mark from the reported price (NOT executable)", xs5: stats(sel, { value: val("A_xs5") }).mean, xs30: stats(sel, { value: val("A_xs30") }).mean, n30: sel.filter((e) => fin(e.A_xs30) != null).length, hit10_30: r4(mean(sel.map((e) => e.A_hit10_30))) };
  o.vsComplement30 = vsComplement(ok30, rest.filter((e) => fin(e.B_xsNet30) != null), { value: val("B_xsNet30") });
  // month-adjusted difference vs complement (selected-count weights)
  const bm = group(ok30, (e) => e.month), rm = group(rest.filter((e) => fin(e.B_xsNet30) != null), (e) => e.month);
  let num_ = 0, den = 0; const per = {};
  for (const [m, xs] of bm) { const cs = rm.get(m) || []; if (!cs.length) continue; const d = mean(xs.map((e) => e.B_xsNet30)) - mean(cs.map((e) => e.B_xsNet30)); per[m] = { n: xs.length, d: r4(d) }; num_ += d * xs.length; den += xs.length; }
  o.monthAdjDiffVsComplement30 = den ? r6(num_ / den) : null; o.monthAdjDetail = per;
  o.topIssuers = [...group(ok30, (e) => e.sym).entries()].map(([s, xs]) => ({ sym: s, n: xs.length, sum: r4(xs.reduce((a, e) => a + e.B_xsNet30, 0)) })).sort((a, b) => b.sum - a.sum).slice(0, 5);
  o.bottomIssuers = [...group(ok30, (e) => e.sym).entries()].map(([s, xs]) => ({ sym: s, n: xs.length, sum: r4(xs.reduce((a, e) => a + e.B_xsNet30, 0)) })).sort((a, b) => a.sum - b.sum).slice(0, 5);
  return o;
}
const out = { builtAt: new Date().toISOString(), segment: "design", note: "primary = B_xsNet30 (net of tier x1 costs, minus SPY); outcome A labelled unrealised", references: {}, hypotheses: [] };
// reference rows (not hypotheses; no BH)
out.references.allPrimary = block(prim, prim);
out.references.hasPriorEpisode = block(prim.filter((e) => e.P.kPE >= 1), prim);
out.references.sameIssuerRepeat = block(prim.filter((e) => e.pPriorCo >= 1), prim);
out.references.firstEver = block(prim.filter((e) => e.pFirstEver === 1), prim);
for (const h of A_HYPS) {
  const sel = prim.filter((e) => h.sel(e, e.P));
  const b = block(sel, prim);
  out.hypotheses.push({ id: h.id, name: h.name, rule: h.rule, ...b });
}
// BH: primary family and secondary family
const pA = out.hypotheses.map((h) => h.primary.p), qA = bh(pA);
out.hypotheses.forEach((h, i) => { h.primary.qFamilyA = r4(qA[i]); });
const secP = [];
for (const h of out.hypotheses) for (const s of A_SECONDARY) {
  const p = s.key === "xsNet5" ? h.horizons[5].p : s.key === "xsNet10" ? h.horizons[10].p : s.key === "xsNet20" ? h.horizons[20].p : s.key === "ctl30" ? h.vsControls30.p : s.key === "hit10ctl" ? h.hit10_30.p : h.mae30.p;
  const est = s.key === "xsNet5" ? h.horizons[5].mean : s.key === "xsNet10" ? h.horizons[10].mean : s.key === "xsNet20" ? h.horizons[20].mean : s.key === "ctl30" ? h.vsControls30.diff : s.key === "hit10ctl" ? h.hit10_30.diff : h.mae30.diff;
  secP.push({ id: `${h.id}.${s.key}`, p, est });
}
const qS = bh(secP.map((x) => x.p)); secP.forEach((x, i) => { x.q = r4(qS[i]); });
out.secondary = secP;
for (const h of out.hypotheses) L4.recordResult(h.id, AGENT, { n30: h.n30, issuers: h.issuers30, mean: h.primary.mean, median: h.primary.median, t: h.primary.t, p: h.primary.p, q: h.primary.qFamilyA, vsControls30: h.vsControls30.diff, vsCtlP: h.vsControls30.p });
for (const x of secP) L4.recordResult(x.id, AGENT, { est: x.est, p: x.p, qFamilySec: x.q });
writeJson("familyA.json", out);
// event-level file
const evRows = prim.map((e) => ({ key: e.key, person: e.person, cik: e.cik, sym: e.sym, publishedAt: e.publishedAt, entryDate: e.entryDate, month: e.month, primaryRole: e.primaryRole, usd: e.usd, tier: e.tier,
  kS: e.P.kS, kPE: e.P.kPE, isEpisodeStart: e.P.isEpisodeStart ? 1 : 0, issuersSInclE: e.P.issuersSInclE, sh_CONTRA: r4(e.P.sh.CONTRA), sh_LOW: r4(e.P.sh.LOW), sh_MOM: r4(e.P.sh.MOM), sh_FOLLOW: r4(e.P.sh.FOLLOW),
  ...Object.fromEntries(Object.entries(e.P.L).map(([k, v]) => [`L_${k}`, v])), pPriorCo: e.pPriorCo, chgSincePrevBuy: e.chgSincePrevBuy, pctHold: e.pctHold, firstPosition: e.firstPosition, pFirstEver: e.pFirstEver,
  ...Object.fromEntries(A_HYPS.map((h) => [h.id.replace("behavior.", ""), h.sel(e, e.P) ? 1 : 0])),
  B_xsNet5: e.B_xsNet5, B_xsNet10: e.B_xsNet10, B_xsNet20: e.B_xsNet20, B_xsNet30: e.B_xsNet30, B_xsNet2x30: e.B_xsNet2x30, B_hit10_30: e.B_hit10_30, B_mae30: e.B_mae30, B_mfe30: e.B_mfe30, C_xsNet30: e.C_xsNet30, A_xs5: e.A_xs5, A_xs30: e.A_xs30 }));
writeCsv("familyA-events.csv", evRows);
checkpoint("05_familyA", { hypotheses: out.hypotheses.length });
const f = (x) => (x == null ? "  —  " : (x * 100).toFixed(2).padStart(6));
console.log("id      n30  iss  mean30  med30   t     p     q   | x5    x10   x20  | vsCtl30 (p)     | hit10 ev/ctl      | MAE ev/ctl  | A30  | monthAdjVsRest");
const show = (id, h) => console.log(`${id.padEnd(7)} ${String(h.n30).padStart(4)} ${String(h.issuers30).padStart(4)} ${f(h.primary.mean)} ${f(h.primary.median)} ${String(h.primary.t).padStart(5)} ${String(h.primary.p).padStart(6)} ${String(h.primary.qFamilyA ?? "").padStart(5)} |${f(h.horizons[5].mean)}${f(h.horizons[10].mean)}${f(h.horizons[20].mean)} |${f(h.vsControls30.diff)} (${h.vsControls30.p}) | ${f(h.hit10_30.eventMean)}/${f(h.hit10_30.controlMean)} | ${f(h.mae30.eventMean)}/${f(h.mae30.controlMean)} |${f(h.outcomeA.xs30)} | ${f(h.monthAdjDiffVsComplement30)}`);
for (const [k, h] of Object.entries(out.references)) show(k.slice(0, 7), h);
for (const h of out.hypotheses) show(h.id.replace("behavior.", ""), h);
console.log("secondary q<0.1:", JSON.stringify(secP.filter((x) => x.q != null && x.q < 0.1)));
for (const h of out.hypotheses) console.log(h.id, "months:", JSON.stringify(h.primary.monthMeans), "ex-top5:", h.primary.meanExTop5Issuers, "ci:", JSON.stringify(h.primary.ci95), "persons:", h.persons30, "top:", JSON.stringify(h.topIssuers.map((x) => `${x.sym}:${x.sum}`)));
