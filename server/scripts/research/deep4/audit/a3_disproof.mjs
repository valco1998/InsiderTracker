// deep4/audit/a3_disproof.mjs — Phase A item 10: attempts to disprove the strongest findings (registered by a0_register.mjs).
//  (a) insider events beat matched controls by ~1 point: covariate imbalance, hindsight-selected control universe, unmatched gap
//  (b) the only predictability is generic short-term reversal: training-free reversal IC on events vs controls; M3c recomputed
//  (c) missed insider-specific edges (post-hoc exploratory): fast filers, non-positive entry gap, v2 class 'unknown'
//   node --max-old-space-size=8192 scripts/research/deep4/audit/a3_disproof.mjs
import fs from "node:fs";
import path from "node:path";
import { phaseA, L4, V, loadP, loadC, writeOut, checkpoint, recordOnce, mean, median, r4, r6, fin, group, countBy, rng, spearman, cstats, isPrimaryPurchase, toCsv, outPath } from "./common.mjs";
import * as PL from "../panel/panelLib.mjs";
import { OUT_DIR } from "../../lib.mjs";

phaseA();
const t0 = Date.now();
const P = loadP(["design", "confirm"]);
const C = loadC(["design", "confirm"]);
const M = PL.createMarket({ cutoff: null });
// ---------------- visible insider-purchase marks per symbol (deep-2 purchaseBlocks marks) ----------------
const secAll = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "deep2", "sec-rows.json"), "utf8"));
const SEC = L4.visible(secAll.rows, (r) => r.acceptedAt, "audit"); secAll.rows = null;
const cik2sym = new Map(); for (const r of SEC) if (r.ticker && r.cik && !cik2sym.has(r.cik)) cik2sym.set(r.cik, PL.symOf(r.ticker));
const marks = new Map();
for (const r of SEC) {
  if (r.code !== "P") continue;
  const s = r.ticker ? PL.symOf(r.ticker) : cik2sym.get(r.cik); if (!s) continue;
  const m = marks.get(s) || marks.set(s, []).get(s);
  const ad = String(r.acceptedAt || "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(ad)) { const j = M.firstOnOrAfter(ad); m.push(j, j + 1); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(r.tradeDate || "")) m.push(M.firstOnOrAfter(r.tradeDate));
}
for (const [s, m] of marks) marks.set(s, [...new Set(m)].sort((a, b) => a - b));
const markInfo = (sym, entryDate) => { const j = M.idx.get(entryDate); const m = marks.get(sym) || []; let prev = null, next = null; for (const x of m) { if (x < j) prev = x; else if (x > j) { next = x; break; } } return { j, prev: prev == null ? null : j - prev, next: next == null ? null : next - j }; };
// ---------------- data ----------------
const segs = ["design", "confirm"];
const prim = (seg) => P.rows.filter((r) => r.segment === seg && isPrimaryPurchase(r) && fin(r.B_xsNet30) != null);
const ctlOf = (r) => C.of(r.key).filter((c) => fin(c.B_xsNet30) != null);
const out = { builtAt: new Date().toISOString(), tests: {}, diagnostics: {} };
const rec = (id, res) => { out.tests[id] = res; recordOnce(id, { segment: id.endsWith("design") ? "design" : "confirm", ...res }); };
const md = (rows, val, ctls, B = 1000) => { const m = V.matchedDiff(rows.map((r) => ({ issuer: r.cik, x: val(r), controls: ctls(r) })), { value: "x", controls: "controls", cluster: "issuer", B, seed: 7 });
  return m.n ? { n: m.n, clusters: m.clusters, eventMean: r6(m.eventMean), controlMean: r6(m.controlMean), estimate: r6(m.diff), ci: m.ci.map(r6), t: r4(m.t), p: r4(m.p) } : { n: 0 }; };
// generic n-weighted within-month IC with cluster bootstrap
function icBoot(items, B = 1000, seed = 7) { // items: { month, cl, p, y }
  const val = (xs) => { const by = group(xs, (x) => x.month); let s = 0, w = 0; for (const g of by.values()) { if (g.length < 10) continue; const v = spearman(g.map((x) => x.p), g.map((x) => x.y)); if (v != null) { s += v * g.length; w += g.length; } } return w ? s / w : null; };
  const est = val(items); const G = [...group(items, (x) => x.cl).values()], rnd = rng(seed), d = [];
  for (let b = 0; b < B; b++) { const rep = []; for (let k = 0; k < G.length; k++) for (const it of G[(rnd() * G.length) | 0]) rep.push(it); const v = val(rep); if (v != null) d.push(v); }
  const m = mean(d), se = Math.sqrt(d.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, d.length - 1)), z = se > 0 ? est / se : null;
  const months = [...group(items, (x) => x.month)].sort().map(([mo, g]) => ({ month: mo, n: g.length, ic: r4(spearman(g.map((x) => x.p), g.map((x) => x.y))) }));
  return { n: items.length, clusters: G.length, estimate: r4(est), se: r4(se), z: r4(z), p: z == null ? null : r4(V.tPValue(z)), months, _draws: d };
}
for (const seg of segs) {
  const E = prim(seg);
  // ---- (a1) base reproduction ----
  rec(`audit4.ctl.base.${seg}`, md(E, (r) => r.B_xsNet30, (r) => ctlOf(r).map((c) => c.B_xsNet30)));
  // other horizons (descriptive)
  out.diagnostics[`horizons.${seg}`] = Object.fromEntries([5, 10, 20, 30].map((H) => [H, (({ n, eventMean, controlMean, estimate, t }) => ({ n, eventMean, controlMean, estimate, t }))(md(E.filter((r) => fin(r[`B_xsNet${H}`]) != null), (r) => r[`B_xsNet${H}`], (r) => C.of(r.key).map((c) => c[`B_xsNet${H}`]).filter((x) => fin(x) != null), 300))]));
  // by month (Fama-MacBeth over months of the event-minus-control difference)
  const dItems = E.map((r) => { const cs = ctlOf(r); return cs.length ? { issuer: r.cik, month: r.month, x: r.B_xsNet30 - mean(cs.map((c) => c.B_xsNet30)) } : null; }).filter(Boolean);
  out.diagnostics[`diffByMonth.${seg}`] = cstats(dItems);
  // ---- (a2) regression (bias-corrected matching) adjustment ----
  const COV = ["r5", "r20", "r60", "dHi60", "dLo60", "mdd60", "vol20", "vol60", "ldv20", "gapPrev", "sma50r"];
  const cv = (o, k) => (k === "ldv20" ? (fin(o.dv20) > 0 ? Math.log(o.dv20) : null) : fin(o[k]));
  const AR = E.map((r) => { const cs = ctlOf(r); if (!cs.length) return null; const dx = COV.map((k) => { const e = cv(r, k), c = mean(cs.map((c) => cv(c, k))); return e != null && c != null ? e - c : 0; });
    return { issuer: r.cik, d: r.B_xsNet30 - mean(cs.map((c) => c.B_xsNet30)), dx }; }).filter(Boolean);
  const ols = (rows) => { const p = COV.length + 1, A = Array.from({ length: p }, () => new Float64Array(p)), b = new Float64Array(p);
    for (const r of rows) { const x = [1, ...r.dx]; for (let i = 0; i < p; i++) { b[i] += x[i] * r.d; for (let j = 0; j < p; j++) A[i][j] += x[i] * x[j]; } }
    for (let i = 1; i < p; i++) A[i][i] += 1e-9 * rows.length; // tiny ridge for numerical safety
    // Gauss-Jordan
    const Mx = A.map((row, i) => [...row, b[i]]); for (let c = 0; c < p; c++) { let piv = c; for (let r = c + 1; r < p; r++) if (Math.abs(Mx[r][c]) > Math.abs(Mx[piv][c])) piv = r; [Mx[c], Mx[piv]] = [Mx[piv], Mx[c]]; const d = Mx[c][c] || 1e-12; for (let k = c; k <= p; k++) Mx[c][k] /= d; for (let r = 0; r < p; r++) if (r !== c) { const f = Mx[r][c]; for (let k = c; k <= p; k++) Mx[r][k] -= f * Mx[c][k]; } }
    return Mx.map((row) => row[p]); };
  const beta = ols(AR);
  const G = [...group(AR, (r) => r.issuer).values()], rnd = rng(11), draws = [];
  for (let bI = 0; bI < 500; bI++) { const rep = []; for (let k = 0; k < G.length; k++) for (const it of G[(rnd() * G.length) | 0]) rep.push(it); draws.push(ols(rep)[0]); }
  const mD = mean(draws), seD = Math.sqrt(draws.reduce((a, x) => a + (x - mD) ** 2, 0) / (draws.length - 1));
  const meanDx = Object.fromEntries(COV.map((k, i) => [k, r6(mean(AR.map((r) => r.dx[i])))]));
  rec(`audit4.ctl.regadj.${seg}`, { n: AR.length, clusters: G.length, unadjusted: r6(mean(AR.map((r) => r.d))), estimate: r6(beta[0]), se: r6(seD), z: r4(beta[0] / seD), p: r4(V.tPValue(beta[0] / seD)), meanCovariateGap: meanDx,
    slopes: Object.fromEntries(COV.map((k, i) => [k, r6(beta[i + 1])])), contribution: Object.fromEntries(COV.map((k, i) => [k, r6(beta[i + 1] * meanDx[k])])) });
  // ---- (a3) hindsight control universe: control return by visible-mark position; point-in-time-known universe ----
  const ctlSeen = new Map(); for (const r of E) for (const c of ctlOf(r)) if (!ctlSeen.has(c.ctlKey)) ctlSeen.set(c.ctlKey, { ...c, mi: markInfo(c.sym, c.entryDate) });
  const bucket = (mi) => (mi.prev == null && mi.next == null ? "noVisibleMark" : mi.prev == null ? (mi.next <= 40 ? "futureOnly_next<=40s" : mi.next <= 80 ? "futureOnly_next41-80s" : "futureOnly_next>80s") : mi.next == null ? "pastOnly" : mi.next <= 40 ? "past+next<=40s" : "past+next>40s");
  const byB = group([...ctlSeen.values()], (c) => bucket(c.mi));
  out.diagnostics[`controlByMarkPosition.${seg}`] = Object.fromEntries([...byB].sort().map(([k, xs]) => [k, { n: xs.length, xsNet30: r4(mean(xs.map((c) => c.B_xsNet30))), median: r4(median(xs.map((c) => c.B_xsNet30))), r20: r4(mean(xs.map((c) => c.r20))) }]));
  const pitCtl = (r) => ctlOf(r).filter((c) => ctlSeen.get(c.ctlKey)?.mi.prev != null).map((c) => c.B_xsNet30);
  const Ep = E.filter((r) => pitCtl(r).length);
  rec(`audit4.ctl.pitUniverse.${seg}`, { ...md(Ep, (r) => r.B_xsNet30, pitCtl), sameEventsAllControls: (({ n, estimate, t }) => ({ n, estimate, t }))(md(Ep, (r) => r.B_xsNet30, (r) => ctlOf(r).map((c) => c.B_xsNet30), 300)),
    futureOnlyControls: (({ n, estimate, t, controlMean }) => ({ n, estimate, t, controlMean }))(md(E, (r) => r.B_xsNet30, (r) => ctlOf(r).filter((c) => ctlSeen.get(c.ctlKey)?.mi.prev == null && ctlSeen.get(c.ctlKey)?.mi.next != null).map((c) => c.B_xsNet30), 300)),
    eventsWithPitControl: Ep.length, share: r4(Ep.length / E.length), pitControlsPerEvent: r4(mean(Ep.map((r) => pitCtl(r).length))) });
  // ---- (a4) gap decomposition: gross excess from the decision close ----
  const fromClose = (o) => { if (fin(o.gapEntry) == null || fin(o.gapEntryX) == null || fin(o.B_gross30) == null || fin(o.B_spy30) == null) return null; const sg = o.gapEntry - o.gapEntryX; return (1 + o.gapEntry) * (1 + o.B_gross30) - 1 - ((1 + sg) * (1 + o.B_spy30) - 1); };
  const Eg = E.filter((r) => fromClose(r) != null);
  rec(`audit4.ctl.fromClose.${seg}`, { ...md(Eg, fromClose, (r) => ctlOf(r).map(fromClose).filter((x) => x != null)), openBasedGrossDiff: (({ n, estimate, t }) => ({ n, estimate, t }))(md(Eg, (r) => r.B_xs30, (r) => ctlOf(r).map((c) => c.B_xs30).filter((x) => fin(x) != null), 300)),
    meanGapEvents: r4(mean(Eg.map((r) => r.gapEntry))), meanGapControls: r4(mean(Eg.flatMap((r) => ctlOf(r).map((c) => c.gapEntry)).filter((x) => fin(x) != null))) });
  // ---- (b) generic reversal, training-free ----
  const evItems = E.filter((r) => fin(r.r5) != null).map((r) => ({ month: r.month, cl: r.cik, p: -r.r5, y: r.B_xsNet30 }));
  const ctlRows = [...ctlSeen.values()].filter((c) => fin(c.r5) != null);
  const ctItems = ctlRows.map((c) => ({ month: c.entryMonth, cl: c.sym, p: -c.r5, y: c.B_xsNet30 }));
  const ie = icBoot(evItems), ic = icBoot(ctItems);
  const { _draws: de, ...ieS } = ie; const { _draws: dc, ...icS } = ic;
  rec(`audit4.gen.rev5.events.${seg}`, ieS);
  rec(`audit4.gen.rev5.controls.${seg}`, icS);
  const diffSe = Math.sqrt(ie.se ** 2 + ic.se ** 2);
  out.diagnostics[`rev5.eventsMinusControls.${seg}`] = { estimate: r4(ie.estimate - ic.estimate), se: r4(diffSe), z: r4((ie.estimate - ic.estimate) / diffSe) };
  // other one-feature generic scores (descriptive): -r20, dHi60 (deeper below the high = higher), -vol20
  out.diagnostics[`oneFeatureIC.${seg}`] = Object.fromEntries([["-r20", (o) => (fin(o.r20) == null ? null : -o.r20)], ["-dHi60", (o) => (fin(o.dHi60) == null ? null : -o.dHi60)], ["-vol20", (o) => (fin(o.vol20) == null ? null : -o.vol20)], ["-gapPrev", (o) => (fin(o.gapPrev) == null ? null : -o.gapPrev)]].map(([k, f]) => {
    const a = icBoot(E.filter((r) => f(r) != null).map((r) => ({ month: r.month, cl: r.cik, p: f(r), y: r.B_xsNet30 })), 200), b = icBoot(ctlRows.filter((c) => f(c) != null).map((c) => ({ month: c.entryMonth, cl: c.sym, p: f(c), y: c.B_xsNet30 })), 200);
    return [k, { events: a.estimate, eventsZ: a.z, controls: b.estimate, controlsZ: b.z }]; }));
  // ---- (b) M3c recomputed from learn's saved walk-forward records ----
  const f = path.join(L4.DEEP4, "learn", `wf-${seg}`, "recs-xs30-M3c.json");
  if (fs.existsSync(f)) {
    const R = JSON.parse(fs.readFileSync(f, "utf8"));
    const a = icBoot(R.recs.map((x) => ({ month: x.month, cl: x.issuer, p: x.p, y: x.y }))), b = icBoot(R.crecs.map((x) => ({ month: x.month, cl: x.issuer, p: x.p, y: x.y })));
    const se = Math.sqrt(a.se ** 2 + b.se ** 2), dd = a.estimate - b.estimate;
    rec(`audit4.gen.m3c.evMinusCtl.${seg}`, { nEvents: a.n, nControls: b.n, icEvents: a.estimate, icControls: b.estimate, estimate: r4(dd), se: r4(se), z: r4(dd / se), p: r4(V.tPValue(dd / se)), monthsEvents: a.months, monthsControls: b.months,
      note: "IC uses months with >= 10 scored rows; learn's own estimate weights all months" });
  }
  // ---- (c) post-hoc edges ----
  const edge = (xs) => { const cs = cstats(xs.map((r) => ({ issuer: r.cik, x: r.B_xsNet30, month: r.month }))); const x2 = cstats(xs.filter((r) => fin(r.B_xsNet2x30) != null).map((r) => ({ issuer: r.cik, x: r.B_xsNet2x30, month: r.month })));
    const vc = md(xs, (r) => r.B_xsNet30, (r) => ctlOf(r).map((c) => c.B_xsNet30), 500);
    return { n: cs.n, issuers: cs.issuers, estimate: cs.mean, median: cs.median, t: cs.t, p: cs.p, exTop5: cs.meanExTop5Issuers, x2cost: x2.mean, vsControls: vc.estimate, vsControlsT: vc.t, months: cs.months, fmT: cs.fmT }; };
  rec(`audit4.edge.lag01.${seg}`, edge(E.filter((r) => fin(r.lagDays) != null && r.lagDays <= 1)));
  rec(`audit4.edge.gapNonPos.${seg}`, edge(E.filter((r) => fin(r.gapEntry) != null && r.gapEntry <= 0)));
  rec(`audit4.edge.unknownCls.${seg}`, edge(P.rows.filter((r) => r.segment === seg && r.cls === "unknown" && r.valued === 1 && r.priced === 1 && r.isPrimary === 1 && fin(r.B_xsNet30) != null)));
  out.diagnostics[`baseline.${seg}`] = edge(E);
  console.log(`${seg} done (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}
out.elapsedSec = (Date.now() - t0) / 1000;
writeOut("a3-disproof.json", out);
checkpoint("a3_disproof", { tests: Object.keys(out.tests).length });
for (const [k, v] of Object.entries(out.tests)) console.log(k.padEnd(36), JSON.stringify(Object.fromEntries(Object.entries(v).filter(([kk]) => !["months", "monthsEvents", "monthsControls", "slopes", "contribution", "meanCovariateGap"].includes(kk)))).slice(0, 420));
for (const [k, v] of Object.entries(out.diagnostics)) console.log("DIAG", k, JSON.stringify(v).slice(0, 900));
