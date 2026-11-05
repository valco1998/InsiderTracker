// deep4/behavior/10_confirm.mjs — the ONE confirmation run of agent "behavior" (frozen rules, unchanged).
//   node --max-old-space-size=6144 scripts/research/deep4/behavior/10_confirm.mjs            (confirmation: needs frozen.json)
//   node --max-old-space-size=6144 scripts/research/deep4/behavior/10_confirm.mjs --dry-design (same code on the DESIGN segment only;
//        never loads confirmation rows; writes confirm-dryrun-design.json; records nothing in the registry)
// Guards (real run): frozen.json must exist and every hashed file must match; refuses to run if confirm-results.json exists.
import fs from "node:fs";
import path from "node:path";
import { L4, AGENT, OUT, SCRIPTS, sha256File, writeJson, writeCsv, readJson, checkpoint, loadPanel, loadControls, isPrimaryPurchase, group, mean, median, quantile, r4, r6, fin, stats, vsControls, rng, spearman, pearson, shuffleInPlace, V } from "./common.mjs";
import * as SL from "../panel/strategyLib.mjs";
import { walkForward } from "../panel/walkforward.mjs";
import { runRule, headline, winnersLosersDetailed } from "./stratLib.mjs";
import { ALL_RULES, CONFIRM_PLAN, prepareContext } from "./candDefs.mjs";
import { A_HYPS, C_HYPS, C_FILTER } from "./defs.mjs";
import { CONFIGS, computeRecords, createHistory, permuteRows } from "./trackLib.mjs";
import { labelsOf, episodesOf } from "./styles.mjs";

const DRY = process.argv.includes("--dry-design");
const EXPOSED = process.argv.includes("--exposed"); // AUDIT COPY (T3)
const STARTED = EXPOSED ? "exposed-started.json" : "confirm-started.json"; // AUDIT COPY (T3)
const SEG = DRY ? "design" : EXPOSED ? "exposed" : "confirm"; // AUDIT COPY (T3)
const RESULT = DRY ? "confirm-dryrun-design.json" : EXPOSED ? "exposed-results.json" : "confirm-results.json"; // AUDIT COPY (T3)
const frozenFile = L4.agentFrozenFile(AGENT);
// ---------------- guards ----------------
if (!DRY) {
  if (!fs.existsSync(frozenFile)) throw new Error("frozen.json missing: freeze first (09_freeze.mjs)");
  if (fs.existsSync(path.join(OUT, RESULT)) || fs.existsSync(path.join(OUT, STARTED))) throw new Error("confirmation already run (or started): it is run ONCE");
  const fz = JSON.parse(fs.readFileSync(frozenFile, "utf8"));
  const bad = [];
  for (const [f, h] of Object.entries(fz.files)) if (sha256File(path.join(SCRIPTS, "..", "..", "..", "behavior", f)) !== h) bad.push(f); // AUDIT COPY (T3): checks the ORIGINAL frozen scripts
  for (const [f, h] of Object.entries(fz.deps)) if (sha256File(path.join(SCRIPTS, "..", "..", "..", f)) !== h) bad.push(f); // AUDIT COPY (T3): ORIGINAL deps
  for (const [f, h] of Object.entries(fz.outputs)) if (sha256File(path.join(OUT, f)) !== h) bad.push(f);
  const extra = fs.readdirSync(SCRIPTS).filter((f) => f.endsWith(".mjs") && !(f in fz.files));
  if (bad.length) throw new Error(`frozen hash mismatch: ${bad.join(", ")}`);
  writeJson(STARTED, { at: new Date().toISOString(), frozenAt: fz.frozenAt, unfrozenExtraScripts: extra });
}
const t0 = Date.now();
// ---------------- data ----------------
const segs = DRY ? ["design"] : EXPOSED ? ["design", "confirm", "exposed"] : ["design", "confirm"]; // AUDIT COPY (T3)
const P = loadPanel({ agent: AGENT, segments: segs });
const C = loadControls({ agent: AGENT, segments: segs });
const rows = P.rows;
if (DRY && rows.some((r) => r.segment !== "design")) throw new Error("dry run loaded a non-design row");
const segRows = rows.filter((r) => r.segment === SEG);
const M = DRY ? SL.marketFor(L4.DESIGN_END) : SL.marketFor(null);
const byKey = new Map(rows.map((r) => [r.key, r]));
const ctx = prepareContext(rows, { segment: SEG });
const evs = segRows.filter(isPrimaryPurchase);
const out = { builtAt: new Date().toISOString(), mode: DRY ? "DRY RUN on the design segment (code check; not a confirmation)" : EXPOSED ? "EXPOSED-PERIOD AUDIT RUN (auditor; frozen rules unchanged)" : "CONFIRMATION (single run of frozen rules)", segment: SEG,
  counts: { rows: rows.length, segRows: segRows.length, primary: evs.length, issuers: new Set(evs.map((e) => e.cik)).size, persons: new Set(evs.map((e) => e.person)).size, months: [...new Set(evs.map((e) => e.month))].sort() }, strategies: {} };
// ---------------- 1. baselines and candidates ----------------
const tradeRows = [];
for (const rule of ALL_RULES()) {
  const res = runRule({ M, rows: segRows, controls: C, select: (e) => rule.select(e, ctx), label: rule.id });
  out.strategies[rule.id] = { id: rule.id, kind: rule.kind, text: rule.text, events: res.events, skipped: res.skipped, headline: headline(res.metrics), controlHeadline: headline(res.ctlMetrics), metrics: res.metrics, controlMetrics: res.ctlMetrics,
    winnersLosers: winnersLosersDetailed(res.trades, byKey, 12) };
  const ind = new Set(SL.independentTrades(res.trades).map((t) => t.key));
  for (const t of res.trades) tradeRows.push({ rule: rule.id, key: t.key, person: t.person, ticker: t.sym, publishedAt: t.publishedAt, entryDate: t.entryDate, exitDate: t.exitDate, entryPrice: t.entryPrice, exitPrice: t.exitPrice, costBps: t.costBps, net: t.net, spyRet: t.spyRet, xsNet: t.xsNet, independent: ind.has(t.key) ? 1 : 0 });
}
// ---------------- 2. family C on the segment (frozen procedure) ----------------
const cfgName = (src) => Object.entries(CONFIGS).find(([, c]) => c.level === src.level && c.outcome === src.outcome && c.horizon === src.horizon)[0];
const recs = ctx.recs;
const coverage = Object.fromEntries(Object.keys(CONFIGS).map((n) => [n, { ge1: r4(evs.filter((e) => recs.get(e.key)[n].n >= 1).length / evs.length), ge3: r4(evs.filter((e) => recs.get(e.key)[n].n >= 3).length / evs.length) }]));
const rankStat = (rm, es, name, target) => { const a = [], b = []; for (const e of es) { const r = rm.get(e.key)[name]; if (r.n >= 1 && r.est != null && fin(e[target]) != null) { a.push(r.est); b.push(e[target]); } } return { rho: spearman(a, b), n: a.length }; };
const selSets = (rm, es, name, target) => { const sel = [], uns = []; for (const e of es) { if (fin(e[target]) == null) continue; const r = rm.get(e.key)[name]; (r.n >= 1 && r.est != null && r.est > 0 ? sel : uns).push(e); } return { sel, uns }; };
const RPERM = Number(CONFIRM_PLAN.familyCPermutations ?? 200);
const famC = [];
const permRho = Object.fromEntries(C_HYPS.filter((h) => h.kind === "rank").map((h) => [h.id, []]));
const rnd = rng(20260615);
for (let b = 0; b < RPERM; b++) {
  const pr = permuteRows(rows, rnd); const Hb = createHistory(pr); const eb = pr.filter((r) => r.segment === SEG && isPrimaryPurchase(r)); const rb = computeRecords(Hb, eb);
  for (const h of C_HYPS) if (h.kind === "rank") permRho[h.id].push(rankStat(rb, eb, cfgName(h.src), h.target).rho ?? 0);
}
for (const h of C_HYPS) {
  if (h.kind === "rank") { const o = rankStat(recs, evs, cfgName(h.src), h.target); famC.push({ id: h.id, kind: h.kind, n: o.n, rho: r4(o.rho), pPerm: r4((1 + permRho[h.id].filter((x) => x >= o.rho).length) / (RPERM + 1)) }); }
  else if (h.kind === "select") { const s = selSets(recs, evs, cfgName(h.src), h.target); const cm = V.clusteredMean(s.sel.map((e) => ({ issuer: e.cik, x: e[h.target] })), { value: "x", cluster: "issuer" });
    famC.push({ id: h.id, kind: h.kind, n: s.sel.length, issuers: new Set(s.sel.map((e) => e.cik)).size, mean: r6(cm.mean), t: r4(cm.t), p: r4(cm.p), unselMean: r6(mean(s.uns.map((e) => e[h.target]))),
      vsControls30: vsControls(s.sel, { value: (e) => fin(e.B_xsNet30), ctlValues: (e) => C.of(e.key).map((c) => c.B_xsNet30).filter((x) => fin(x) != null) }) }); }
}
// walk-forward over the segment months (frozen: prior = history pool prior at the month start; select EB30 > 0 with >= 1 matured)
const H = ctx.H;
const wfRun = (horizonSrc) => {
  const o = { outcome: "B", metric: "xsNet", horizon: horizonSrc, filter: C_FILTER };
  const fit = (train, c) => { const prior = H.poolPriorAt(`${c.monthStart} 00:00:00`, { ...o, groupBy: "person" }); return Object.freeze({ prior: Object.freeze({ ...prior }), trainN: train.length }); };
  const hist = (m, row) => H.historyAt(row.person, row.decisionAt, { ...o, prior: m.prior, excludeKey: row.key, excludeDupKey: row.dupKey, priorBefore: row.publishedAt });
  const sel = walkForward({ agent: AGENT, rows, segment: SEG, horizon: horizonSrc, outcome: "B", target: (r) => r.B_xsNet30, endField: (r) => r[`B_end${horizonSrc}`], eligible: isPrimaryPurchase, trainFilter: (r) => r.isPrimary === 1 && C_FILTER(r), fit,
    predict: (m, row) => { if (!m.prior.ok) return null; const h = hist(m, row); return h.matured.n >= 1 && h.eb != null && h.eb.estimate > 0; } });
  const num = walkForward({ agent: AGENT, rows, segment: SEG, horizon: horizonSrc, outcome: "B", target: (r) => r.B_xsNet30, endField: (r) => r[`B_end${horizonSrc}`], eligible: isPrimaryPurchase, trainFilter: (r) => r.isPrimary === 1 && C_FILTER(r), fit,
    predict: (m, row) => { if (!m.prior.ok) return null; const h = hist(m, row); return h.matured.n >= 1 && h.eb != null ? h.eb.estimate : null; } });
  const s = sel.predictions.filter((p) => p.prediction === true && p.realized != null), ns = sel.predictions.filter((p) => p.prediction === false && p.realized != null);
  const cm = V.clusteredMean(s.map((p) => ({ issuer: p.issuer, x: p.realized })), { value: "x", cluster: "issuer" });
  return { recordHorizon: horizonSrc, target: "B_xsNet30", months: sel.months.map((m) => ({ month: m.month, warmup: m.warmup, trainN: m.trainN, evalN: m.evalN, scoredN: m.scoredN, selectedN: m.selectedN, selectedMean: r4(m.selectedMean), notSelectedMean: r4(m.notSelectedMean) })),
    numeric: num.months.map((m) => ({ month: m.month, scoredN: m.scoredN, spearman: r4(m.spearman) })), selected: { n: s.length, issuers: new Set(s.map((p) => p.issuer)).size, mean: r6(cm.mean), t: r4(cm.t), p: r4(cm.p), median: r6(median(s.map((p) => p.realized))) }, notSelected: { n: ns.length, mean: r6(mean(ns.map((p) => p.realized))) } };
};
out.familyC = { coverage, results: famC, walkForward30: wfRun(30), walkForward5rec: wfRun(5), permutations: RPERM };
// ---------------- 3. family A replication (descriptive; the same 11 frozen selection rules) ----------------
out.familyA = A_HYPS.map((h) => { const sel = evs.filter((e) => h.sel(e, ctx.profile.get(e.key))); const s = stats(sel, { value: (e) => fin(e.B_xsNet30) });
  return { id: h.id, name: h.name, n: sel.length, n30: s.n, issuers: s.issuers, mean: s.mean, median: s.median, t: s.t, p: s.p, x5: stats(sel, { value: (e) => fin(e.B_xsNet5) }).mean, vsControls30: vsControls(sel.filter((e) => fin(e.B_xsNet30) != null), { value: (e) => fin(e.B_xsNet30), ctlValues: (e) => C.of(e.key).map((c) => c.B_xsNet30).filter((x) => fin(x) != null) }) }; });
// ---------------- 4. descriptive contrasts: first observed purchase vs repeat, purchase rank ----------------
const allPrimSorted = rows.filter(isPrimaryPurchase).sort((a, b) => (a.publishedAt < b.publishedAt ? -1 : 1));
const rankOf = new Map(); const cnt = new Map();
for (const e of allPrimSorted) { const k = cnt.get(e.person) || 0; rankOf.set(e.key, k); cnt.set(e.person, k + 1); }
const bucket = (e) => { const k = rankOf.get(e.key); return k === 0 ? "1st" : k === 1 ? "2nd" : k < 5 ? "3rd-5th" : "6th+"; };
out.contrasts = { note: "descriptive (purchase rank over the person's visible primary purchases since 2025-12-01)", firstEver: {}, rank: {} };
for (const [k, f] of [["pFirstEver=1", (e) => e.pFirstEver === 1], ["pFirstEver=0", (e) => e.pFirstEver === 0]]) { const xs = evs.filter(f); out.contrasts.firstEver[k] = { n: xs.length, B30: stats(xs, { value: (e) => fin(e.B_xsNet30) }), B5: stats(xs, { value: (e) => fin(e.B_xsNet5) }).mean, vsControls30: vsControls(xs.filter((e) => fin(e.B_xsNet30) != null), { value: (e) => fin(e.B_xsNet30), ctlValues: (e) => C.of(e.key).map((c) => c.B_xsNet30).filter((x) => fin(x) != null) }) }; }
for (const b of ["1st", "2nd", "3rd-5th", "6th+"]) { const xs = evs.filter((e) => bucket(e) === b); const s = stats(xs, { value: (e) => fin(e.B_xsNet30) }); out.contrasts.rank[b] = { n: xs.length, n30: s.n, mean: s.mean, median: s.median, t: s.t, B5: stats(xs, { value: (e) => fin(e.B_xsNet5) }).mean }; }
// ---------------- 5. style-consistency replication across periods (features only) ----------------
// For persons with >= 1 episode published BEFORE the segment start, s = share of label L over those earlier episodes; y = L of
// their FIRST episode inside the segment. Pearson r(s, y); null: y permuted within decision month (R = 2000), one-sided.
const segStart = DRY ? "2026-03-16" : EXPOSED ? L4.EXPOSED_START : L4.DESIGN_END; // AUDIT COPY (T3) // dry run: a pseudo split inside the design segment
const th = ctx.th;
const primAll = rows.filter(isPrimaryPurchase).map((r) => ({ ...r, L: labelsOf(r, th) }));
const cons = [];
for (const L of ["DIP", "LOW", "DEEP", "MOM", "CONTRA", "FOLLOW"]) {
  const units = [];
  for (const [person, rs] of group(primAll, (r) => r.person)) {
    rs.sort((a, b) => (a.publishedAt < b.publishedAt ? -1 : 1));
    const eps = episodesOf(rs.map((r) => ({ ...r })));
    const before = eps.filter((ep) => ep.start.slice(0, 10) < segStart), inside = eps.filter((ep) => ep.start.slice(0, 10) >= segStart && (DRY || ep.rows[0].segment === SEG));
    const v = before.map((ep) => ep.rows[0].L[L]).filter((x) => x === 0 || x === 1);
    const y = inside.length ? inside[0].rows[0].L[L] : null;
    if (v.length && (y === 0 || y === 1)) units.push({ s: mean(v), y, month: inside[0].rows[0].month, cross: before.some((ep) => ep.cik === inside[0].cik) ? 0 : 1 });
  }
  const test = (us) => { if (us.length < 5) return { n: us.length }; const s = us.map((u) => u.s), y = us.map((u) => u.y); const r = pearson(s, y); const strata = group(us.map((_, i) => i), (i) => us[i].month); const rr = rng(7); let ge = 0; const perm = new Array(us.length);
    for (let b = 0; b < 2000; b++) { for (const idx of strata.values()) { const ys = shuffleInPlace(idx.map((i) => y[i]), rr); idx.forEach((i, k) => { perm[i] = ys[k]; }); } const rb = pearson(s, perm); if (rb != null && r != null && rb >= r) ge++; }
    return { n: us.length, r: r4(r), p: r4((1 + ge) / 2001), rateY: r4(mean(y)), pYhigh: r4(mean(us.filter((u) => u.s >= 0.5).map((u) => u.y))), pYlow: r4(mean(us.filter((u) => u.s < 0.5).map((u) => u.y))) }; };
  cons.push({ label: L, all: test(units), newIssuer: test(units.filter((u) => u.cross === 1)) });
}
out.styleConsistencyAcrossPeriods = { segStart, note: "features only", tests: cons };
out.elapsedSec = Math.round((Date.now() - t0) / 1000);
writeJson(RESULT, out);
writeCsv(DRY ? "confirm-dryrun-trades.csv" : EXPOSED ? "exposed-trades.csv" : "confirm-trades.csv", tradeRows); // AUDIT COPY (T3)
if (!DRY && !EXPOSED) { // AUDIT COPY (T3): no registry writes from the copy
  for (const x of famC) L4.recordResult(x.id, AGENT, { segment: "confirm", ...x });
  for (const a of out.familyA) L4.recordResult(a.id, AGENT, { segment: "confirm", n30: a.n30, mean: a.mean, t: a.t, p: a.p, vsControls30: a.vsControls30.diff });
  for (const [id, s] of Object.entries(out.strategies)) L4.recordResult(id, AGENT, { segment: "confirm", ...s.headline });
  checkpoint("10_confirm", { segment: SEG, elapsedSec: out.elapsedSec });
}
console.log(JSON.stringify({ mode: out.mode, counts: out.counts, elapsedSec: out.elapsedSec }));
for (const [id, s] of Object.entries(out.strategies)) console.log(id, JSON.stringify(s.headline), "| control:", JSON.stringify({ n: s.controlHeadline.n, meanXsNet: s.controlHeadline.meanXsNet }));
console.log("famC", JSON.stringify(famC));
console.log("WF30", JSON.stringify(out.familyC.walkForward30.selected), JSON.stringify(out.familyC.walkForward30.months));
console.log("WF5rec", JSON.stringify(out.familyC.walkForward5rec.selected));
console.log("famA", JSON.stringify(out.familyA.map((a) => [a.id, a.n30, a.mean, a.t, a.vsControls30.diff])));
console.log("contrasts", JSON.stringify(out.contrasts));
console.log("style", JSON.stringify(cons));
