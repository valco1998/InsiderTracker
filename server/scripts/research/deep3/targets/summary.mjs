// deep3/targets/summary.mjs — final tables: test counts by family, BH summary, candidates.json, event-level CSVs of the
// promising patterns, and summary.json for the lead's report. No new statistics beyond those recorded.
//   node scripts/research/deep3/targets/summary.mjs
import { myRegistry, myResults, readOut, writeOut, checkpoint, toCsv, r4, TARGETS, HORIZONS } from "./common.mjs";
import { patternList } from "./defs.mjs";
import { loadRows } from "./stats.mjs";

const regs = myRegistry(); const res = new Map(); for (const x of myResults()) res.set(x.id, x.result);
const fam = {}; for (const h of regs) { const f = h.family; fam[f] = fam[f] || { registered: 0, withResult: 0, familySize: h.familySize }; fam[f].registered++; if (res.has(h.id)) fam[f].withResult++; }
const bh = readOut("bh-discovery.json"); const prom = readOut("promising.json"); const conf = readOut("confirmation.json"); const ex = readOut("exec-results.json"); const rob = readOut("robust-discovery.json"); const models = readOut("models.json");
const TH = readOut("thresholds.json"); const PL = patternList(TH);
const rows = loadRows();

// candidates.json: frozen candidate rule (protocol.candidateRule) → none passes
const verdicts = prom.promising.filter((x) => x.promising).map((x) => {
  const c = conf.patterns[x.pattern]; const t = c.tests[x.test];
  const e1 = ex.results[x.pattern].discover.x1.stats, e1c = ex.results[x.pattern].confirm.x1.stats;
  const passConf = t.mean != null && Math.sign(t.mean) === Math.sign(x.mean) && t.p < 0.1 && t.issuerMedianOfMeans > 0;
  return { pattern: x.pattern, promisingTest: x.test, discovery: { n: x.n, mean: x.mean, median: x.median, issuerMedian: x.issuerMedian, t: x.t, q: x.q }, confirmation: { n: t.n, issuers: t.issuers, mean: t.mean, median: t.median, issuerMedian: t.issuerMedianOfMeans, t: t.t, p: r4(t.p), exTop5: t.meanExTop5Issuers },
    executableClose5: { discover: e1, confirm: e1c }, passesConfirmation: passConf, candidate: false,
    reason: passConf ? "other criteria" : `confirmation ${t.mean > 0 ? "same sign but p " + r4(t.p) + " >= 0.10" : "sign flipped"}; discovery robustness: one-session delay ${r4(rob.results[x.pattern][x.test].delay.mean)}, vs within-pattern controls ${r4(rob.results[x.pattern][x.test].vsControls.mean)} (t ${rob.results[x.pattern][x.test].vsControls.t}), SPY<50d ${r4(rob.results[x.pattern][x.test].spyDown.mean)}` };
});
writeOut("candidates.json", []);
writeOut("candidate-verdicts.json", { rule: readOut("protocol.json").candidateRule, verdicts, note: "candidates.json is empty: no promising pattern passed its single confirmation evaluation." });

// event-level CSVs for the promising patterns (discovery + confirmation; every field used)
const cols = ["id", "issuer", "ticker", "publishedAt", "entryDate", "per", "cls", "role", "isCeo", "isCfo", "filingValue", "pubB", "tier", "cost", "entryPrice", "gap", "gapX", "r5", "r20", "rs20", "dd60", "pos60", "vol20", "vr20_60", "nearLow60", "nearPivot", "spyAbove50",
  "clu7", "clu14", "rep30", "posIncrease", "firstPosition", "salesCovered", "othersSold90", "othersSoldAny90", "selfSoldAny90"];
for (const x of prom.promising.filter((y) => y.promising)) {
  const p = PL.find((q) => q.id === x.pattern); const ctl = p.chart || "cm";
  const sel = rows.filter((r) => (p.universe === "om" ? r.cls === "om" : true) && p.f(r));
  const out = sel.map((r) => { const o = {}; for (const c of cols) o[c] = r[c]; for (const k of ["x1", "x2", "x3", "x5", "x10", "hit5_5", "hit10_1", "hit10_2", "hit10_3", "hit10_5", "hit10_10", "hit15_10", "hit20_10", "ttt10", "maeBI10", "mfe5", "mae5", "mfe10", "mae10", "dd10_5", "tp10s10n5", "tp10s10n5_why", "tp10s10n5_t"]) o[`ev_${k}`] = r.o?.[k] ?? null;
    for (const k of ["x5", "hit10_5", "dd10_5", "tp10s10n5"]) { const c = ctl === "cm" ? r.cm : r.cf?.[ctl]; o[`ctl_${k}`] = c ? c[k] ?? null : null; o[`ctlVolRich_${k}`] = r.cv ? r.cv[k] ?? null : null; }
    o.delay_x5 = r.oD?.x5 ?? null; o.delay_tp10s10n5 = r.oD?.tp10s10n5 ?? null; o.nControls = r.ctl.length; return o; });
  writeOut(`pattern-events-${x.pattern}.csv`, toCsv(out, Object.keys(out[0])));
}

// compact pattern table
const ptab = [];
for (const p of PL) { const g = (k) => bh.table.find((t) => t.id === `targets-P-${p.id}-${k}`) || {}; const a = g("hit10_5"), b = g("dd10_5"), c = g("tp10s10n5"), d = g("x5");
  ptab.push({ family: p.family, pattern: p.id, n: a.n, issuers: a.issuers, hit10_5_event: a.event, hit10_5_control: a.control, hit10_5_diff: a.mean, hit10_5_t: a.t, hit10_5_q: a.q, dd10_5_event: b.event, dd10_5_control: b.control, dd10_5_diff: b.mean, dd10_5_t: b.t, dd10_5_q: b.q,
    tp10s10n5_mean: c.mean, tp10s10n5_median: c.median, tp10s10n5_t: c.t, tp10s10n5_q: c.q, x5_mean: d.mean, x5_median: d.median, x5_t: d.t, x5_q: d.q }); }
writeOut("pattern-table-discovery.csv", toCsv(ptab, Object.keys(ptab[0])));
const summary = { generatedAt: new Date().toISOString(), testsRegistered: regs.length, testsWithResult: regs.filter((h) => res.has(h.id)).length, families: fam, discoveryBH: { tests: bh.tests, qLt10: bh.qLt10 },
  promising: prom.promising, verdicts, modelHeadline: { hit10_5: { aucConfirm: models.hit10_5.aucConfirm, lift: models.hit10_5.aucLiftFullMinusVol, coefFull: models.hit10_5.coef.full }, dd10_5: { aucConfirm: models.dd10_5.aucConfirm, lift: models.dd10_5.aucLiftFullMinusVol }, tree: { aucConfirm: models.tree.aucConfirm, lift: models.tree.aucLift, topLeaf: models.tree.topLeaf } } };
writeOut("summary.json", summary);
checkpoint("final summary", { candidates: 0, tests: regs.length });
console.log(JSON.stringify({ tests: regs.length, withResult: summary.testsWithResult, qLt10: bh.qLt10 }));
for (const [f, v] of Object.entries(fam)) console.log(`${f.padEnd(70)} registered ${v.registered} familySize ${v.familySize}`);
console.log(JSON.stringify(verdicts, null, 1));
