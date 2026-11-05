// deep4/behavior/07_familyC.mjs — family C (adaptive track record) on DESIGN data, history.mjs only. Hypotheses: defs.mjs.
//   node --max-old-space-size=6144 scripts/research/deep4/behavior/07_familyC.mjs [--perm=500]
// Rank tests (C01-C07): Spearman(record estimate, realised target) over primary purchases with >= 1 matured record item;
//   one-sided skill-vs-luck p: outcome fields permuted jointly within (decision month x availability) strata over the rows
//   history uses, history recomputed, rho recomputed (R permutations).
// Selection tests (C08-C09): mean realised B_xsNet30 of selected (EB > 0, >= 1 matured item), issuer-clustered t vs 0.
// C10: walkforward.mjs (monthly prior refit at the month start; frozen within the month), selected events pooled.
import { loadDesign, isPrimaryPurchase, writeJson, writeCsv, checkpoint, group, mean, median, quantile, r4, r6, fin, stats, vsControls, bh, rng, spearman, V, L4, AGENT } from "./common.mjs";
import { C_HYPS, C_FILTER } from "./defs.mjs";
import { CONFIGS, computeRecords, createHistory, permuteRows } from "./trackLib.mjs";
import { walkForward } from "../panel/walkforward.mjs";

const R = Number((process.argv.find((a) => a.startsWith("--perm=")) || "--perm=500").split("=")[1]);
const DRY = process.argv.includes("--timing-only"); // times one permutation, prints nothing else, records nothing
const { rows, C } = loadDesign({ controls: true });
const t0 = Date.now();
const H = createHistory(rows);
const prim = rows.filter(isPrimaryPurchase);
const recs = computeRecords(H, prim);
console.log(`records computed in ${((Date.now() - t0) / 1000).toFixed(1)}s for ${prim.length} events`);
const cfgName = (src) => Object.entries(CONFIGS).find(([, c]) => c.level === src.level && c.outcome === src.outcome && c.horizon === src.horizon)[0];

// ---------------- coverage ----------------
const coverage = {};
for (const [name] of Object.entries(CONFIGS)) {
  const ns = prim.map((e) => recs.get(e.key)[name].n);
  coverage[name] = { events: prim.length, ge1: r4(ns.filter((n) => n >= 1).length / prim.length), ge2: r4(ns.filter((n) => n >= 2).length / prim.length), ge3: r4(ns.filter((n) => n >= 3).length / prim.length), ge5: r4(ns.filter((n) => n >= 5).length / prim.length),
    withEstimate: r4(prim.filter((e) => recs.get(e.key)[name].est != null && recs.get(e.key)[name].n >= 1).length / prim.length),
    ge1WithTarget30: prim.filter((e) => recs.get(e.key)[name].n >= 1 && fin(e.B_xsNet30) != null).length, ge1WithTarget5: prim.filter((e) => recs.get(e.key)[name].n >= 1 && fin(e.B_xsNet5) != null).length };
}
// coverage by month for person records
coverage.byMonth = {};
for (const [m, es] of [...group(prim, (e) => e.month).entries()].sort()) coverage.byMonth[m] = Object.fromEntries(["pB30", "pB5", "pA30", "iB30"].map((n) => [n, r4(es.filter((e) => recs.get(e.key)[n].n >= 1).length / es.length)]));

// ---------------- statistics ----------------
function rankStat(recMap, evs, name, target) {
  const a = [], b = [];
  for (const e of evs) { const r = recMap.get(e.key)[name]; const y = e[target]; if (r.n >= 1 && r.est != null && fin(y) != null) { a.push(r.est); b.push(y); } }
  return { rho: spearman(a, b), n: a.length };
}
function selectSets(recMap, evs, name, target) {
  const sel = [], unsel = [];
  for (const e of evs) { const r = recMap.get(e.key)[name]; if (fin(e[target]) == null) continue; (r.n >= 1 && r.est != null && r.est > 0 ? sel : unsel).push(e); }
  return { sel, unsel };
}
const obs = {};
for (const h of C_HYPS) {
  if (h.kind === "wf") continue;
  const name = cfgName(h.src);
  if (h.kind === "rank") obs[h.id] = rankStat(recs, prim, name, h.target);
  else { const s = selectSets(recs, prim, name, h.target); obs[h.id] = { sel: s.sel, unsel: s.unsel, diff: mean(s.sel.map((e) => e[h.target])) - mean(s.unsel.map((e) => e[h.target])) }; }
}
// ---------------- permutations (skill vs luck) ----------------
const permStats = Object.fromEntries(C_HYPS.filter((h) => h.kind !== "wf").map((h) => [h.id, []]));
const rnd = rng(20261105);
const tp = Date.now();
for (let b = 0; b < R; b++) {
  const pr = permuteRows(rows, rnd);
  const Hb = createHistory(pr);
  const primB = pr.filter(isPrimaryPurchase);
  const recB = computeRecords(Hb, primB);
  for (const h of C_HYPS) {
    if (h.kind === "wf") continue;
    const name = cfgName(h.src);
    if (h.kind === "rank") permStats[h.id].push(rankStat(recB, primB, name, h.target).rho ?? 0);
    else { const s = selectSets(recB, primB, name, h.target); permStats[h.id].push(mean(s.sel.map((e) => e[h.target])) - mean(s.unsel.map((e) => e[h.target]))); }
  }
  if (b === 0) { console.log(`first permutation ${((Date.now() - tp) / 1000).toFixed(1)}s`); if (DRY) process.exit(0); }
}
console.log(`${R} permutations in ${((Date.now() - tp) / 1000).toFixed(0)}s`);

// ---------------- persistence diagnostics ----------------
const diag = {};
for (const [name, target] of [["pB30", "B_xsNet30"], ["pB5", "B_xsNet5"], ["pB5", "B_xsNet30"], ["pA30", "B_xsNet30"], ["iB30", "B_xsNet30"]]) {
  const ev = prim.filter((e) => recs.get(e.key)[name].n >= 1 && recs.get(e.key)[name].est != null && fin(e[target]) != null);
  const est = ev.map((e) => recs.get(e.key)[name].est), y = ev.map((e) => e[target]);
  const qs = [0.2, 0.4, 0.6, 0.8].map((p) => quantile(est, p));
  const qi = (x) => qs.filter((q) => x > q).length;
  const quint = [0, 1, 2, 3, 4].map((k) => { const xs = ev.filter((e, i) => qi(est[i]) === k); return { q: k + 1, n: xs.length, estMean: r4(mean(xs.map((e) => recs.get(e.key)[name].est))), realisedMean: r4(mean(xs.map((e) => e[target]))), realisedMedian: r4(median(xs.map((e) => e[target]))) }; });
  const byMonth = Object.fromEntries([...group(ev, (e) => e.month).entries()].sort().map(([m, xs]) => [m, { n: xs.length, rho: r4(spearman(xs.map((e) => recs.get(e.key)[name].est), xs.map((e) => e[target]))) }]));
  // partial Spearman controlling for the stock's own past return (r20, r60)
  const part = {};
  for (const z of ["r20", "r60", "dHi60"]) {
    const ok = ev.filter((e) => fin(e[z]) != null);
    const a = ok.map((e) => recs.get(e.key)[name].est), bb = ok.map((e) => e[target]), c = ok.map((e) => e[z]);
    const rxy = spearman(a, bb), rxz = spearman(a, c), ryz = spearman(bb, c);
    part[z] = { n: ok.length, rhoXY: r4(rxy), rhoXZ: r4(rxz), rhoYZ: r4(ryz), partial: r4((rxy - rxz * ryz) / Math.sqrt((1 - rxz ** 2) * (1 - ryz ** 2))) };
  }
  // same-issuer only vs other-issuers-only person records (person level only)
  diag[`${name}->${target}`] = { n: ev.length, persons: new Set(ev.map((e) => e.person)).size, issuers: new Set(ev.map((e) => e.cik)).size, rho: r4(spearman(est, y)), quintiles: quint, byMonth, partial: part };
}
for (const [label, f] of [["sameIssuerOnly", (r, e) => r.cik === e.cik], ["otherIssuersOnly", (r, e) => r.cik !== e.cik]]) {
  const rr = computeRecords(H, prim, { cfgNames: ["pB30", "pB5"], extraFilter: f });
  for (const [name, target] of [["pB30", "B_xsNet30"], ["pB5", "B_xsNet5"], ["pB5", "B_xsNet30"]]) {
    const ev = prim.filter((e) => rr.get(e.key)[name].n >= 1 && rr.get(e.key)[name].est != null && fin(e[target]) != null);
    diag[`${label}:${name}->${target}`] = { n: ev.length, persons: new Set(ev.map((e) => e.person)).size, rho: r4(spearman(ev.map((e) => rr.get(e.key)[name].est), ev.map((e) => e[target]))),
      selectedPos: (() => { const s = ev.filter((e) => rr.get(e.key)[name].est > 0); return { n: s.length, mean: r4(mean(s.map((e) => e[target]))), restMean: r4(mean(ev.filter((e) => !(rr.get(e.key)[name].est > 0)).map((e) => e[target]))) }; })() };
  }
}
// ---------------- C10 walk-forward ----------------
const wfOpts = { outcome: "B", metric: "xsNet", horizon: 30, filter: C_FILTER };
const fitWF = (train, ctx) => { const prior = H.poolPriorAt(`${ctx.monthStart} 00:00:00`, { ...wfOpts, groupBy: "person" }); return Object.freeze({ prior: Object.freeze({ ...prior }), trainN: train.length, priorN: prior.n }); };
const histWF = (model, row) => H.historyAt(row.person, row.decisionAt, { ...wfOpts, prior: model.prior, excludeKey: row.key, excludeDupKey: row.dupKey, priorBefore: row.publishedAt });
const wfSel = walkForward({ agent: AGENT, rows, horizon: 30, outcome: "B", eligible: isPrimaryPurchase, trainFilter: (r) => r.isPrimary === 1 && C_FILTER(r), fit: fitWF,
  predict: (model, row) => { if (!model.prior.ok) return null; const h = histWF(model, row); return h.matured.n >= 1 && h.eb != null && h.eb.estimate > 0; } });
const wfNum = walkForward({ agent: AGENT, rows, horizon: 30, outcome: "B", eligible: isPrimaryPurchase, trainFilter: (r) => r.isPrimary === 1 && C_FILTER(r), fit: fitWF,
  predict: (model, row) => { if (!model.prior.ok) return null; const h = histWF(model, row); return h.matured.n >= 1 && h.eb != null ? h.eb.estimate : null; } });
const wfSelected = wfSel.predictions.filter((p) => p.prediction === true && p.realized != null);
const wfNotSel = wfSel.predictions.filter((p) => p.prediction === false && p.realized != null);
const wfCm = V.clusteredMean(wfSelected.map((p) => ({ issuer: p.issuer, x: p.realized })), { value: "x", cluster: "issuer" });
const wfRes = { months: wfSel.months.map((m) => ({ month: m.month, warmup: m.warmup, trainN: m.trainN, evalN: m.evalN, scoredN: m.scoredN, selectedN: m.selectedN, selectedMean: r4(m.selectedMean), notSelectedMean: r4(m.notSelectedMean) })),
  numeric: wfNum.months.map((m) => ({ month: m.month, scoredN: m.scoredN, spearman: r4(m.spearman) })), selected: { n: wfSelected.length, issuers: new Set(wfSelected.map((p) => p.issuer)).size, mean: r6(wfCm.mean), t: r4(wfCm.t), p: r4(wfCm.p), median: r6(median(wfSelected.map((p) => p.realized))) },
  notSelected: { n: wfNotSel.length, mean: r6(mean(wfNotSel.map((p) => p.realized))) }, priorChecks: wfSel.months.map((m) => m.month) };
// ---------------- assemble ----------------
const res = [];
const pv = (arr, o) => r4((1 + arr.filter((x) => x >= o).length) / (arr.length + 1));
for (const h of C_HYPS) {
  if (h.kind === "rank") { const o = obs[h.id]; res.push({ id: h.id, name: h.name, kind: h.kind, n: o.n, rho: r4(o.rho), p: pv(permStats[h.id], o.rho), nullMean: r4(mean(permStats[h.id])), null95: r4(quantile(permStats[h.id], 0.95)) }); }
  else if (h.kind === "select") {
    const o = obs[h.id]; const cm = V.clusteredMean(o.sel.map((e) => ({ issuer: e.cik, x: e[h.target] })), { value: "x", cluster: "issuer" });
    res.push({ id: h.id, name: h.name, kind: h.kind, n: o.sel.length, issuers: new Set(o.sel.map((e) => e.cik)).size, persons: new Set(o.sel.map((e) => e.person)).size, mean: r6(cm.mean), t: r4(cm.t), p: r4(cm.p), median: r6(median(o.sel.map((e) => e[h.target]))),
      stats: stats(o.sel, { value: (e) => fin(e[h.target]) }), unselMean: r6(mean(o.unsel.map((e) => e[h.target]))), diffSelMinusUnsel: r6(o.diff), diffPermP: pv(permStats[h.id], o.diff), diffNullMean: r6(mean(permStats[h.id])),
      vsControls30: vsControls(o.sel, { value: (e) => fin(e.B_xsNet30), ctlValues: (e) => C.of(e.key).map((c) => c.B_xsNet30).filter((x) => fin(x) != null) }) });
  } else res.push({ id: h.id, name: h.name, kind: h.kind, n: wfRes.selected.n, mean: wfRes.selected.mean, t: wfRes.selected.t, p: wfRes.selected.p });
}
const q = bh(res.map((x) => x.p)); res.forEach((x, i) => { x.qFamilyC = r4(q[i]); });
for (const x of res) L4.recordResult(x.id, AGENT, { n: x.n, rho: x.rho ?? null, mean: x.mean ?? null, p: x.p, q: x.qFamilyC });
const out = { builtAt: new Date().toISOString(), segment: "design", R, note: "history.mjs only; open-market valued purchases (dedupe isPrimary); records left-censored at 2025-12-01", coverage, results: res, diagnostics: diag, walkForward: wfRes };
writeJson("familyC.json", out);
writeCsv("familyC-events.csv", prim.map((e) => { const r = recs.get(e.key); return { key: e.key, person: e.person, cik: e.cik, sym: e.sym, publishedAt: e.publishedAt, decisionAt: e.decisionAt, month: e.month, primaryRole: e.primaryRole,
  ...Object.fromEntries(Object.keys(CONFIGS).flatMap((n) => [[`${n}_n`, r[n].n], [`${n}_est`, r6(r[n].est)], [`${n}_pending`, r[n].pending]])), B_xsNet5: e.B_xsNet5, B_xsNet30: e.B_xsNet30, A_xs30: e.A_xs30 }; }));
checkpoint("07_familyC", { R, results: res.map((x) => [x.id, x.p, x.qFamilyC]) });
console.log(JSON.stringify({ coverage }, null, 0));
for (const x of res) console.log(JSON.stringify({ id: x.id, n: x.n, rho: x.rho, mean: x.mean, t: x.t, p: x.p, q: x.qFamilyC, unsel: x.unselMean, diff: x.diffSelMinusUnsel, diffP: x.diffPermP, vsCtl: x.vsControls30?.diff }));
for (const [k, d] of Object.entries(diag)) console.log(k, JSON.stringify({ n: d.n, rho: d.rho, partial: d.partial ? Object.fromEntries(Object.entries(d.partial).map(([z, v]) => [z, v.partial])) : undefined, q: d.quintiles?.map((x) => x.realisedMean), sel: d.selectedPos }));
console.log("WF", JSON.stringify(wfRes));
