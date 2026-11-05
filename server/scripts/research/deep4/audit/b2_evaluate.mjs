// deep4/audit/b2_evaluate.mjs — evaluates every frozen item (frozen-rules.json "evaluate") on one segment, from the audit COPIES.
//   --segment=confirm : DRY RUN = reproduction of the agents' confirmation results (records nothing)
//   --segment=exposed : the single exposed run (needs DEEP4_EXPOSED=1 and audit/exposed-criteria.json); records audit4.exp.*
//   node --max-old-space-size=12288 scripts/research/deep4/audit/b2_evaluate.mjs --segment=confirm
import fs from "node:fs";
import path from "node:path";
import { L4, V, writeOut, outPath, checkpoint, recordOnce, mean, median, r4, r6, fin, group, rng, toCsv, cstats } from "./common.mjs";
import { loadPanel, loadControls } from "./exposed/panel/data.mjs";
import * as SL from "./exposed/panel/strategyLib.mjs";
import * as PL from "./exposed/panel/panelLib.mjs";
import { walkForward } from "./exposed/panel/walkforward.mjs";
import { runRule } from "./exposed/behavior/stratLib.mjs";
import { ALL_RULES, prepareContext } from "./exposed/behavior/candDefs.mjs";
import { A_HYPS, C_FILTER } from "./exposed/behavior/defs.mjs";
import { stats as bStats, vsControls as bVsControls, isPrimaryPurchase } from "./exposed/behavior/common.mjs";
import * as E from "./exposed/learn/evalLib.mjs";
import { OUT_DIR } from "../../lib.mjs";

const SEG = (process.argv.find((a) => a.startsWith("--segment=")) || "--segment=confirm").split("=")[1];
if (!["confirm", "exposed"].includes(SEG)) throw new Error("segment must be confirm or exposed");
if (SEG === "exposed") { if (!L4.exposedUnlocked()) throw new Error("exposed run needs DEEP4_EXPOSED=1"); if (!fs.existsSync(outPath("exposed-criteria.json"))) throw new Error("exposed-criteria.json missing"); }
if (SEG === "confirm" && L4.exposedUnlocked()) throw new Error("dry run must be executed with the exposed period locked");
const AG = "audit";
const t0 = Date.now();
const log = (...a) => console.log(`[B2 ${SEG} ${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
const segs = SEG === "exposed" ? ["design", "confirm", "exposed"] : ["design", "confirm"];
const P = loadPanel({ agent: AG, segments: segs });
const C = loadControls({ agent: AG, segments: segs });
const rows = P.rows, segRows = rows.filter((r) => r.segment === SEG);
const M = SL.marketFor(null);
const XL = path.join(L4.DEEP4, "audit", "exposed", "learn");
const LIM = "2026-11-03";
log(`rows ${rows.length}; segment rows ${segRows.length}; primary ${segRows.filter(isPrimaryPurchase).length}`);
// ---------------- behaviour rules (same code path as behavior/10_confirm.mjs) ----------------
const ctx = prepareContext(rows, { segment: SEG });
const H = ctx.H;
const wfSelected = (() => {
  const o = { outcome: "B", metric: "xsNet", horizon: 30, filter: C_FILTER };
  const fit = (train, c) => { const prior = H.poolPriorAt(`${c.monthStart} 00:00:00`, { ...o, groupBy: "person" }); return Object.freeze({ prior: Object.freeze({ ...prior }), trainN: train.length }); };
  const hist = (m, row) => H.historyAt(row.person, row.decisionAt, { ...o, prior: m.prior, excludeKey: row.key, excludeDupKey: row.dupKey, priorBefore: row.publishedAt });
  const sel = walkForward({ agent: AG, rows, segment: SEG, horizon: 30, outcome: "B", target: (r) => r.B_xsNet30, endField: (r) => r.B_end30, eligible: isPrimaryPurchase, trainFilter: (r) => r.isPrimary === 1 && C_FILTER(r), fit,
    predict: (m, row) => { if (!m.prior.ok) return null; const h = hist(m, row); return h.matured.n >= 1 && h.eb != null && h.eb.estimate > 0; } });
  return { keys: new Set(sel.predictions.filter((p) => p.prediction === true).map((p) => p.key)), months: sel.months.map((m) => ({ month: m.month, trainN: m.trainN, evalN: m.evalN, scoredN: m.scoredN, selectedN: m.selectedN, selectedMean: r4(m.selectedMean) })) };
})();
const RULES = [...ALL_RULES().map((r) => ({ id: r.id, select: (e) => r.select(e, ctx) })),
  ...A_HYPS.map((h) => ({ id: h.id, select: (e) => e.segment === SEG && h.sel(e, ctx.profile.get(e.key)) })),
  { id: "behavior.C08", select: (e) => e.segment === SEG && (() => { const r = ctx.recs.get(e.key)?.pB30; return !!r && r.n >= 1 && r.est != null && r.est > 0; })() },
  { id: "behavior.C09", select: (e) => e.segment === SEG && (() => { const r = ctx.recs.get(e.key)?.pB5; return !!r && r.n >= 1 && r.est != null && r.est > 0; })() },
  { id: "behavior.C10", select: (e) => e.segment === SEG && wfSelected.keys.has(e.key) }];
const summarize = (id, m, extra = {}) => {
  if (!m || !m.n) return { id, n: 0, ...extra };
  const x2 = m.costSensitivity?.find((c) => c.mult === 2)?.meanXsNet ?? null;
  return { id, nAll: m.nAll, n: m.n, issuers: m.issuers, months: m.months, mean: m.meanXsNet, median: m.medianXsNet, exTop5: m.companyStats?.meanExTop5Issuers ?? null, x2cost: x2, t: m.companyStats?.t ?? null, p: m.companyStats?.p ?? null,
    vsCtl: m.vsControls?.diff?.mean ?? null, vsCtlT: m.vsControls?.diff?.t ?? null, ctlMean: m.vsControls?.controlMean ?? null, pfVsSpy: m.profitFactorVsSpy, pfNet: m.profitFactorNet, meanNet: m.meanNet, winVsSpy: m.winRateVsSpy, meanSpy: m.meanSpy,
    monthTable: (m.monthTable || []).map((x) => `${x.month}:${r4(x.mean)}(${x.n})`).join(" "), ...extra };
};
const verdictOf = (s) => { if (!s.n || s.n < 20) return { pass: false, verdict: "INSUFFICIENT DATA" };
  const pass = s.mean > 0 && s.p != null && s.p < 0.05 && s.exTop5 > 0 && s.x2cost > 0 && s.vsCtl > 0;
  return { pass, verdict: pass ? "PASS (supports at most PROMISING BUT UNVALIDATED)" : s.mean <= 0 ? "FAIL (mean <= 0)" : "FAIL (mean > 0 but not all criteria)" }; };
const table = [], tradeRows = [];
const byKey = new Map(rows.map((r) => [r.key, r]));
for (const R of RULES) {
  const res = runRule({ M, rows: segRows, controls: C, select: R.select, label: R.id });
  const censored = res.skipped?.censored ?? 0;
  const s = summarize(R.id, res.metrics, { events: res.events, skipped: res.skipped, censored });
  // event-level (behaviour's family-A replication statistic) for reproduction
  const sel = segRows.filter((e) => isPrimaryPurchase(e) && R.select(e));
  const ev = bStats(sel, { value: (e) => fin(e.B_xsNet30) });
  s.eventLevel = { n: ev.n, mean: ev.mean, t: ev.t };
  s.nearestControlStrategy = res.ctlMetrics?.n ? { n: res.ctlMetrics.n, mean: res.ctlMetrics.meanXsNet } : null;
  Object.assign(s, verdictOf(s));
  table.push(s);
  const ind = new Set(SL.independentTrades(res.trades).map((t) => t.key));
  for (const t of res.trades) tradeRows.push({ rule: R.id, key: t.key, ticker: t.sym, person: t.person, publishedAt: t.publishedAt, entryDate: t.entryDate, exitDate: t.exitDate, costBps: t.costBps, gross: t.gross, net: t.net, spyRet: t.spyRet, xsNet: t.xsNet, independent: ind.has(t.key) ? 1 : 0 });
  log(`${R.id}: n ${s.n} mean ${s.mean} t ${s.t} vsCtl ${s.vsCtl} censored ${censored}`);
}
// ---------------- learn strategies (from the copy's strategies-<seg>.json) ----------------
const LS = JSON.parse(fs.readFileSync(path.join(XL, `strategies-${SEG}.json`), "utf8"));
for (const id of ["S0", "S0all", "S1", "S2", "S3", "SC"]) {
  const S = LS.strategies[id]; const s = summarize(`learn.${id}`, S?.metrics, { censored: S?.skipped?.censored ?? null, skipped: S?.skipped ?? null, vsBaseline: S?.vsBaseline ? { estimate: r6(S.vsBaseline.estimate), z: r4(S.vsBaseline.z), p: r4(S.vsBaseline.p), nSelected: S.vsBaseline.nSelected } : null, gates: S?.gates ?? null });
  Object.assign(s, id === "SC" ? { pass: null, verdict: "reference (no-insider controls)" } : verdictOf(s));
  table.push(s);
  log(`learn.${id}: n ${s.n} mean ${s.mean} t ${s.t}`);
}
// ---------------- learn walk-forward skill ----------------
const WF = path.join(XL, `wf-${SEG}`);
const recs = (t, m) => { const f = path.join(WF, `recs-${t}-${m}.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null; };
const skill = {};
const MODELS = { xs30: ["M1", "M2", "M3", "M4", "M3c", "M3p", "M5", "TREE", "EN", "D1", "D2"], hit30: ["M1", "M2", "M3", "M4", "M3c", "M3p", "M5", "TREE", "D1", "D2"] };
for (const [t, ms] of Object.entries(MODELS)) {
  const kind = t.startsWith("hit") ? "auc" : "ic";
  for (const m of ms) { const R = recs(t, m); if (!R) { skill[`${t}.${m}.skill`] = { n: 0 }; continue; } const b = E.bootSkill(R.recs, kind, { B: 1000 }); skill[`${t}.${m}.skill`] = { n: b.n, clusters: b.clusters, estimate: r4(b.estimate), se: r4(b.se), z: r4(b.z), p: r4(b.p), months: (b.months || []).map((x) => ({ month: x.month, n: x.n, value: r4(x.value) })) };
    if (m === "M3c" && R.crecs?.length) { const c = E.bootSkill(R.crecs, kind, { B: 1000 }); skill[`${t}.M3c.ctlSkill`] = { n: c.n, estimate: r4(c.estimate), z: r4(c.z), p: r4(c.p) }; } }
  for (const d of ["M4-M3", "M5-M3p", ...(t === "xs30" ? ["M3-M3c"] : [])]) { const [a, b] = d.split("-"); const RA = recs(t, a), RB = recs(t, b); if (!RA || !RB) { skill[`${t}.${d}`] = { n: 0 }; continue; } const x = E.bootSkillDiff(RA.recs, RB.recs, kind, { B: 1000 }); skill[`${t}.${d}`] = { n: x.n, a: r4(x.a), b: r4(x.b), estimate: r4(x.estimate), z: r4(x.z), p: r4(x.p) }; }
}
log("skill done");
// ---------------- generic check: M3c top quintile minus rest, events vs controls ----------------
function topRest(items, B = 1000, seed = 7) { // items { month, issuer, p, y }
  const val = (xs) => { const by = group(xs, (x) => x.month); let s = 0, w = 0; for (const g of by.values()) { if (g.length < 10) continue; const st = [...g].sort((a, b) => b.p - a.p), k = Math.max(1, Math.round(g.length / 5)); const d = mean(st.slice(0, k).map((x) => x.y)) - mean(st.slice(k).map((x) => x.y)); s += d * g.length; w += g.length; } return w ? s / w : null; };
  const est = val(items); const G = [...group(items, (x) => x.issuer).values()], rnd = rng(seed), dr = [];
  for (let b = 0; b < B; b++) { const rep = []; for (let k = 0; k < G.length; k++) for (const it of G[(rnd() * G.length) | 0]) rep.push(it); const v = val(rep); if (v != null) dr.push(v); }
  const m = mean(dr), se = Math.sqrt(dr.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, dr.length - 1));
  const months = [...group(items, (x) => x.month)].sort().map(([mo, g]) => { const st = [...g].sort((a, b) => b.p - a.p), k = Math.max(1, Math.round(g.length / 5)); return { month: mo, n: g.length, top: r4(mean(st.slice(0, k).map((x) => x.y))), rest: r4(mean(st.slice(k).map((x) => x.y))) }; });
  return { n: items.length, estimate: r4(est), se: r4(se), z: r4(se > 0 ? est / se : null), p: r4(se > 0 ? V.tPValue(est / se) : null), months };
}
const R3c = recs("xs30", "M3c");
const generic = R3c ? (() => { const a = topRest(R3c.recs), b = topRest(R3c.crecs || []); const se = Math.sqrt((a.se || 0) ** 2 + (b.se || 0) ** 2), d = a.estimate - b.estimate; return { events: a, controls: b, evMinusCtl: { estimate: r4(d), se: r4(se), z: r4(se > 0 ? d / se : null), p: r4(se > 0 ? V.tPValue(d / se) : null) } }; })() : null;
// ---------------- controls: frozen panel controls and the point-in-time rebuild (diagnostic) ----------------
const Ev = segRows.filter((r) => isPrimaryPurchase(r) && r.featOk === 1 && fin(r.B_xsNet30) != null);
const md = (rs, val, ctls, B = 1000) => { const m = V.matchedDiff(rs.map((r) => ({ issuer: r.cik, x: val(r), controls: ctls(r) })), { value: "x", controls: "controls", cluster: "issuer", B, seed: 7 }); return m.n ? { n: m.n, clusters: m.clusters, eventMean: r6(m.eventMean), controlMean: r6(m.controlMean), estimate: r6(m.diff), t: r4(m.t), p: r4(m.p) } : { n: 0 }; };
const ctlBase = md(Ev, (r) => r.B_xsNet30, (r) => C.of(r.key).map((c) => c.B_xsNet30).filter((x) => fin(x) != null));
const ctlPIT = (() => {
  const secAll = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "deep2", "sec-rows.json"), "utf8"));
  const SEC = L4.visible(secAll.rows, (r) => r.acceptedAt, AG); secAll.rows = null;
  const Prows = SEC.filter((r) => r.code === "P"); const cik2sym = new Map(); for (const r of SEC) if (r.ticker && r.cik && !cik2sym.has(r.cik)) cik2sym.set(r.cik, PL.symOf(r.ticker));
  const Mp = SEG === "confirm" ? PL.createMarket({ cutoff: L4.EXPOSED_START }) : PL.createMarket({ cutoff: null });
  const firstMark = new Map(); for (const r of Prows) { const s = r.ticker ? PL.symOf(r.ticker) : cik2sym.get(r.cik); if (!s) continue; for (const d of [String(r.acceptedAt || "").slice(0, 10), r.tradeDate]) { if (!/^\d{4}-\d{2}-\d{2}$/.test(d || "")) continue; const m = Mp.firstOnOrAfter(d); if (!firstMark.has(s) || m < firstMark.get(s)) firstMark.set(s, m); } }
  const blocked = PL.purchaseBlocks(Mp, Prows, cik2sym, { before: 20, after: 0 });
  const pool = PL.buildPool(Mp, blocked, { visibleUntil: null, segOf: (d) => L4.segmentOf(d) });
  const sp = pool.rows.filter((r) => r.per === SEG && firstMark.has(r.s) && firstMark.get(r.s) < r.j);
  PL.prepareVectors(sp, PL.MATCH_FEATURES, "fv"); const scales = PL.robustScales(sp, PL.MATCH_FEATURES), idx = PL.indexPool(sp);
  const vals = new Map(), cache = new Map();
  for (const e of Ev) { const ms = PL.nearest({ m: e.entryMonth, tier: e.tier, per: SEG, r5: e.r5, r20: e.r20, dd60: e.dHi60, vol20: e.vol20, dv20: e.dv20, gapPrev: e.gapPrev }, idx, scales, pool.syms.length, { K: 10, filter: (r) => r.s !== e.sym });
    const v = []; for (const m of ms) { const k = `${m.r.s}|${m.r.D}`; if (!cache.has(k)) { const A = M.aligned(m.r.s); const mf = PL.marketFeatures(M, A, m.r.j - 1); cache.set(k, mf ? PL.outcomeB(M, A, m.r.j, mf.costBps).B_xsNet30 : null); } const x = cache.get(k); if (fin(x) != null) v.push(x); } vals.set(e.key, v); }
  return { ...md(Ev, (r) => r.B_xsNet30, (r) => vals.get(r.key) || []), poolRows: sp.length };
})();
log(`controls: base ${ctlBase.estimate} (t ${ctlBase.t}); PIT ${ctlPIT.estimate} (t ${ctlPIT.t})`);
// ---------------- monthly descriptive tables (outcomes A and B), primary purchases ----------------
const prim = segRows.filter(isPrimaryPurchase);
const months = ["ALL", ...[...new Set(prim.map((r) => r.month))].sort()];
const monthly = [];
for (const mo of months) { const rs = mo === "ALL" ? prim : prim.filter((r) => r.month === mo);
  for (const Hh of [5, 10, 20, 30]) {
    const okB = rs.filter((r) => fin(r[`B_xsNet${Hh}`]) != null), okA = rs.filter((r) => fin(r[`A_xs${Hh}`]) != null);
    monthly.push({ month: mo, H: Hh, events: rs.length, B_n: okB.length, B_censored: rs.filter((r) => r[`B_st${Hh}`] === "censored").length, B_meanXsNet: r4(mean(okB.map((r) => r[`B_xsNet${Hh}`]))), B_medianXsNet: r4(median(okB.map((r) => r[`B_xsNet${Hh}`]))),
      B_meanGross: r4(mean(okB.map((r) => r[`B_gross${Hh}`]))), B_meanSpy: r4(mean(okB.map((r) => r[`B_spy${Hh}`]))), B_meanXsNet2x: r4(mean(okB.map((r) => r[`B_xsNet2x${Hh}`]))), B_ctl: r4(mean(okB.map((r) => r[`C_xsNet${Hh}`]).filter((x) => fin(x) != null))),
      B_hit10: Hh === 30 || Hh === 5 || Hh === 10 || Hh === 20 ? r4(mean(okB.map((r) => r[`B_hit10_${Hh}`]).filter((x) => fin(x) != null))) : null, B_gapEntry: r4(mean(okB.map((r) => r.gapEntry).filter((x) => fin(x) != null))),
      A_n: okA.length, A_censored: rs.filter((r) => r[`A_st${Hh}`] === "censored").length, A_meanXs: r4(mean(okA.map((r) => r[`A_xs${Hh}`]))), A_medianXs: r4(median(okA.map((r) => r[`A_xs${Hh}`]))), A_meanRet: r4(mean(okA.map((r) => r[`A_ret${Hh}`]))) }); } }
const out = { builtAt: new Date().toISOString(), segment: SEG, status: SEG === "exposed" ? "PREVIOUSLY EXPOSED period; single run; not an independent holdout" : "DRY RUN on the confirmation segment (reproduction)",
  counts: { rows: segRows.length, primary: prim.length, primaryWithMatured30: prim.filter((r) => fin(r.B_xsNet30) != null).length, primaryCensored30: prim.filter((r) => r.B_st30 === "censored").length, months: months.slice(1) },
  table, skill, generic, controls: { base: ctlBase, rebuildPIT: ctlPIT }, monthly, c10Months: wfSelected.months, elapsedSec: (Date.now() - t0) / 1000 };
const tag = SEG === "exposed" ? "exposed-period" : "confirm-dryrun";
writeOut(`${tag}.json`, out);
fs.writeFileSync(outPath(`${tag}-trades.csv`), toCsv(tradeRows));
fs.writeFileSync(outPath(`${tag}-monthly.csv`), toCsv(monthly));
if (SEG === "exposed") {
  for (const s of table) recordOnce(`audit4.exp.${s.id}`, { segment: "exposed", n: s.n, estimate: s.mean ?? null, t: s.t ?? null, p: s.p ?? null, median: s.median ?? null, exTop5: s.exTop5 ?? null, x2cost: s.x2cost ?? null, vsCtl: s.vsCtl ?? null, pfVsSpy: s.pfVsSpy ?? null, censored: s.censored ?? null, verdict: s.verdict });
  for (const [k, v] of Object.entries(skill)) if (!k.endsWith("ctlSkill")) recordOnce(`audit4.exp.wf.${k}`, { segment: "exposed", ...v, months: undefined });
  if (generic) { recordOnce("audit4.exp.gen.M3c.topRest.events", { segment: "exposed", ...generic.events, months: undefined }); recordOnce("audit4.exp.gen.M3c.topRest.controls", { segment: "exposed", ...generic.controls, months: undefined }); recordOnce("audit4.exp.gen.M3c.topRest.evMinusCtl", { segment: "exposed", ...generic.evMinusCtl }); }
  recordOnce("audit4.exp.ctl.base", { segment: "exposed", ...ctlBase }); recordOnce("audit4.exp.ctl.rebuildPIT", { segment: "exposed", ...ctlPIT });
  checkpoint("b2_evaluate_exposed", { elapsedSec: out.elapsedSec });
}
const pc = (x) => (x == null ? "-" : `${(x * 100).toFixed(2)}%`);
console.log("\nid".padEnd(30), "n".padStart(5), "mean".padStart(8), "median".padStart(8), "exTop5".padStart(8), "x2".padStart(8), "p".padStart(7), "vsCtl".padStart(8), "PF".padStart(6), "cens".padStart(5), " verdict");
for (const s of table) console.log(s.id.padEnd(30), String(s.n).padStart(5), pc(s.mean).padStart(8), pc(s.median).padStart(8), pc(s.exTop5).padStart(8), pc(s.x2cost).padStart(8), String(s.p == null ? "-" : r4(s.p)).padStart(7), pc(s.vsCtl).padStart(8), String(s.pfVsSpy ?? "-").slice(0, 5).padStart(6), String(s.censored ?? "-").padStart(5), " ", s.verdict);
console.log("skill", JSON.stringify(Object.fromEntries(Object.entries(skill).map(([k, v]) => [k, `${v.estimate} (z ${v.z}, n ${v.n})`]))));
console.log("generic", JSON.stringify(generic && { ev: generic.events.estimate, evZ: generic.events.z, ctl: generic.controls.estimate, ctlZ: generic.controls.z, d: generic.evMinusCtl }));
console.log("controls", JSON.stringify(out.controls));
console.log("counts", JSON.stringify(out.counts));
