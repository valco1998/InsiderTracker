// deep2/chart/chartStructure.mjs — TASK 3: pre-signal chart structure of insider winners vs losers.
// Discovery only; interpretable methods (stratified terciles, depth<=3 tree, 6-feature ridge); all tests registered first.
//   node scripts/research/deep2/chart/chartStructure.mjs
//
// Outcome: x5 = buy at the entry-session open (no conditioning on that open), sell at the close 5 sessions later,
// net of the event's per-side cost, minus SPY over the same dates (stage-C h[5].excessNet).
// Populations: all discovery events; stated open-market events (the strongest post-open subset in task 1).
// Generic check: the same feature splits inside the events' matched controls (same cutoffs as "all").
import { setup, matchAll } from "./mcSetup.mjs";
import { featuresAt, clip, usable, companyStats, mean, median, r4, reg, rec, xnetAt, writeOut, toCsv, pct, pValue, myResults, bhQ, DISCOVER_END } from "./common.mjs";

const S = await setup();
const disc = S.ev.filter((r) => r.per === "discover");
const M = matchAll(S, disc, "primary");

const FEATS = [
  { k: "r5", d: "prior 5-session return", num: true },
  { k: "r20", d: "prior 20-session return", num: true },
  { k: "r60", d: "prior 60-session return (path trend)", num: true },
  { k: "pos60", d: "position in the 60-session close range (0 = at low, 1 = at high)", num: true },
  { k: "sma50r", d: "distance of the decision close from its 50-session average", num: true },
  { k: "tight", d: "20-session high/low range divided by 60-session daily vol × √20 (low = consolidation)", num: true },
  { k: "vol10_60", d: "10-session / 60-session volatility (low = range contraction)", num: true },
  { k: "volDry", d: "average volume sessions −20..−6 / 60-session average (low = dry-up)", num: true },
  { k: "volSpike", d: "average volume last 3 sessions / sessions −22..−3 (high = spike)", num: true },
  { k: "breakout20", d: "decision close above the prior 20-session high", num: false },
  { k: "breakout60", d: "decision close above the prior 60-session high", num: false },
  { k: "downRun3", d: "3 or more consecutive down closes into the decision close", num: false },
  { k: "spyAbove50", d: "SPY above its 50-session average at the decision close", num: false },
];
const val = (f, k) => (k === "downRun3" ? (f.downRun == null ? null : f.downRun >= 3) : f[k]);
const POPS = { all: () => true, openMarket: (e) => e.venue === "open_market" };

// ---------- registration ----------
for (const [p] of Object.entries(POPS)) for (const F of FEATS) reg({
  id: `chart-T3-${p}-${F.k}`, family: `chart-T3 chart structure, insider events (${p})`, familySize: FEATS.length,
  statement: `Discovery ${p} insider events: mean x5 net excess of the ${F.num ? "top tercile" : "TRUE group"} of ${F.k} (${F.d}) minus the ${F.num ? "bottom tercile" : "FALSE group"} differs from 0 (tercile cutoffs from discovery).`,
  rationale: "Technical structure (trend, location, consolidation, volume, breakout, market regime) may separate insider winners from losers: e.g. buying into a basing/consolidating chart vs a falling knife.",
});
for (const F of FEATS) reg({
  id: `chart-T3-controls-${F.k}`, family: "chart-T3 chart structure, matched controls (generic check)", familySize: FEATS.length,
  statement: `Discovery matched controls of all events: mean x5 net excess of the ${F.num ? "top tercile" : "TRUE group"} of ${F.k} minus the ${F.num ? "bottom tercile" : "FALSE group"} differs from 0 (same cutoffs as the insider 'all' population).`,
  rationale: "If a chart feature predicts returns equally for ordinary stock-days, it is a generic technical effect, not an insider-specific one.",
});
reg({ id: "chart-T3-tree-walkforward", family: "chart-T3 interpretable models (walk-forward inside discovery)", familySize: 2,
  statement: "A depth-<=3 regression tree (min leaf 80) on 13 chart + 5 insider features, trained on discovery events entering before 2026-04-01 (x5 winsorized 2%), selects leaves with positive training mean; their events entering 2026-04-01..2026-06-14 have mean x5 net excess > 0.",
  rationale: "Tests whether any interpretable combination of chart and filing features generalises forward inside the discovery period." });
reg({ id: "chart-T3-ridge-walkforward", family: "chart-T3 interpretable models (walk-forward inside discovery)", familySize: 2,
  statement: "A 6-feature ridge (r5, r20, pos60, volSpike, sma50r, log filing value; standardized; lambda = n/10), trained on discovery events entering before 2026-04-01, ranks later discovery events (2026-04-01..06-14); the top-quintile score group has mean x5 net excess > 0.",
  rationale: "Linear, few-feature check of the same question; top quintile cutoff from the training scores." });

// ---------- data ----------
const x5 = (r) => (usable(r.e, 5, "discover") ? r.e.h[5].excessNet : null);
const evRows = disc.map((r) => ({ r, issuer: r.e.issuerCik, f: r, y: x5(r) })).filter((x) => x.y != null);
const ctlRows = [];
for (const r of disc) { if (x5(r) == null) continue; for (const c of M.get(r.e.id) || []) { const ser = S.bars.get(c.r.s); const f = featuresAt(ser, c.r.k - 1, S.cal); const y = xnetAt(ser, c.r.k, S.cal, 5, r.e.costBpsPerSide, "open"); if (f && y != null) ctlRows.push({ issuer: c.r.s, f, y }); } }
const cutsOf = (rows, k) => { const xs = rows.map((x) => val(x.f, k)).filter((v) => v != null && Number.isFinite(v)).sort((a, b) => a - b); return [xs[Math.floor((xs.length - 1) / 3)], xs[Math.floor((2 * (xs.length - 1)) / 3)]]; };
const spreadTest = (rows, F, cuts) => {
  let hi, lo;
  if (F.num) { hi = rows.filter((x) => { const v = val(x.f, F.k); return v != null && v > cuts[1]; }); lo = rows.filter((x) => { const v = val(x.f, F.k); return v != null && v <= cuts[0]; }); }
  else { hi = rows.filter((x) => val(x.f, F.k) === true); lo = rows.filter((x) => val(x.f, F.k) === false); }
  const a = companyStats(hi.map((x) => ({ issuer: x.issuer, x: x.y })), { boot: 0 }), b = companyStats(lo.map((x) => ({ issuer: x.issuer, x: x.y })), { boot: 0 });
  const seA = a.t ? Math.abs(a.mean / a.t) : null, seB = b.t ? Math.abs(b.mean / b.t) : null; const t = seA && seB ? (a.mean - b.mean) / Math.sqrt(seA ** 2 + seB ** 2) : null;
  return { hi: { n: a.n, mean: a.mean, wmean: a.wmean, median: a.median, issuerMedianOfMeans: a.issuerMedianOfMeans }, lo: { n: b.n, mean: b.mean, wmean: b.wmean, median: b.median, issuerMedianOfMeans: b.issuerMedianOfMeans }, diff: r4(a.mean - b.mean), wdiff: r4(a.wmean - b.wmean), mdiff: r4(a.median - b.median), t: r4(t), p: pValue(t), cuts: cuts?.map(r4) ?? null };
};
const out = { generatedAt: new Date().toISOString(), populations: {}, controls: {}, models: {} };
const toRecord = [];
const allCuts = Object.fromEntries(FEATS.filter((F) => F.num).map((F) => [F.k, cutsOf(evRows, F.k)]));
for (const [p, f] of Object.entries(POPS)) {
  const rows = evRows.filter((x) => f(x.r.e)); out.populations[p] = { n: rows.length, base: companyStats(rows.map((x) => ({ issuer: x.issuer, x: x.y })), { boot: 0 }), features: {} };
  for (const F of FEATS) { const cuts = F.num ? cutsOf(rows, F.k) : null; const res = spreadTest(rows, F, cuts); out.populations[p].features[F.k] = res; toRecord.push([`chart-T3-${p}-${F.k}`, res]); }
}
out.controls = { n: ctlRows.length, features: {} };
for (const F of FEATS) { const res = spreadTest(ctlRows, F, allCuts[F.k]); out.controls.features[F.k] = res; toRecord.push([`chart-T3-controls-${F.k}`, res]); }

// ---------- tree (depth <= 3) and ridge, walk-forward inside discovery ----------
const SPLIT = "2026-04-01";
const XKEYS = ["r5", "r20", "r60", "pos60", "sma50r", "tight", "vol10_60", "volDry", "volSpike", "breakout20", "breakout60", "downRun3", "spyAbove50", "ceoCfo", "openMarket", "value250k", "lfv", "directOwn"];
const xOf = (x) => ({ ...Object.fromEntries(FEATS.map((F) => [F.k, val(x.f, F.k)])), ceoCfo: x.r.e.isCeo || x.r.e.isCfo, openMarket: x.r.e.venue === "open_market", value250k: x.r.e.filingValue >= 2.5e5, lfv: Math.log(Math.max(1, x.r.e.filingValue)), directOwn: x.r.e.ownership === "D" });
const wins = (ys) => { const s = [...ys].sort((a, b) => a - b); const lo = s[Math.floor(0.02 * (s.length - 1))], hi = s[Math.ceil(0.98 * (s.length - 1))]; return (y) => Math.min(hi, Math.max(lo, y)); };
function growTree(rows, depth, minLeaf, path = []) {
  const ys = rows.map((x) => x.yw), m = mean(ys);
  const node = { n: rows.length, mean: m, path };
  if (depth === 0 || rows.length < 2 * minLeaf) return node;
  let best = null; const sse = (arr) => { const mu = mean(arr); return arr.reduce((a, v) => a + (v - mu) ** 2, 0); }; const base = sse(ys);
  for (const k of XKEYS) {
    const vs = rows.map((x) => x.X[k]).filter((v) => v != null);
    const cands = typeof vs[0] === "boolean" ? [0.5] : [0.2, 0.35, 0.5, 0.65, 0.8].map((q) => { const s = vs.map(Number).sort((a, b) => a - b); return s[Math.floor(q * (s.length - 1))]; });
    for (const c of new Set(cands)) {
      const L = rows.filter((x) => x.X[k] != null && Number(x.X[k]) <= c), R = rows.filter((x) => x.X[k] != null && Number(x.X[k]) > c);
      if (L.length < minLeaf || R.length < minLeaf) continue;
      const gain = base - sse(L.map((x) => x.yw)) - sse(R.map((x) => x.yw)) - sse(rows.filter((x) => x.X[k] == null).map((x) => x.yw));
      if (!best || gain > best.gain) best = { k, c, gain, L, R };
    }
  }
  if (!best) return node;
  node.split = { k: best.k, c: best.c };
  node.left = growTree(best.L, depth - 1, minLeaf, [...path, `${best.k} <= ${typeof best.c === "number" ? r4(best.c) : best.c}`]);
  node.right = growTree(best.R, depth - 1, minLeaf, [...path, `${best.k} > ${typeof best.c === "number" ? r4(best.c) : best.c}`]);
  return node;
}
const leafOf = (node, X) => { while (node.split) { const v = X[node.split.k]; if (v == null) return null; node = Number(v) <= node.split.c ? node.left : node.right; } return node; };
const leaves = (node) => (node.split ? [...leaves(node.left), ...leaves(node.right)] : [node]);
const evX = evRows.map((x) => ({ ...x, X: xOf(x) }));
const train = evX.filter((x) => x.r.e.entryDate < SPLIT), test = evX.filter((x) => x.r.e.entryDate >= SPLIT && x.r.e.entryDate < DISCOVER_END);
{ const w = wins(train.map((x) => x.y)); for (const x of train) x.yw = w(x.y); }
const tree = growTree(train, 3, 80);
const good = new Set(leaves(tree).filter((l) => l.mean > 0).map((l) => l.path.join(" & ")));
const testSel = test.filter((x) => { const l = leafOf(tree, x.X); return l && good.has(l.path.join(" & ")); });
const treeRes = companyStats(testSel.map((x) => ({ issuer: x.issuer, x: x.y })));
out.models.tree = { train: train.length, test: test.length, leaves: leaves(tree).map((l) => ({ path: l.path.join(" & "), n: l.n, trainMeanW: r4(l.mean) })), selectedTest: treeRes, testAll: companyStats(test.map((x) => ({ issuer: x.issuer, x: x.y })), { boot: 0 }) };
toRecord.push(["chart-T3-tree-walkforward", treeRes]);
// ridge
const RK = ["r5", "r20", "pos60", "volSpike", "sma50r", "lfv"];
const rx = (x) => RK.map((k) => (k === "volSpike" ? (x.X.volSpike > 0 ? Math.log(x.X.volSpike) : null) : k === "r5" ? clip(x.X.r5, -0.5, 1) : k === "r20" ? clip(x.X.r20, -0.7, 2) : k === "sma50r" ? clip(x.X.sma50r, -0.8, 2) : x.X[k]));
const trR = train.map((x) => ({ x, v: rx(x) })).filter((o) => o.v.every((v) => v != null && Number.isFinite(v)));
const mu = RK.map((_, i) => mean(trR.map((o) => o.v[i]))), sdv = RK.map((_, i) => Math.sqrt(mean(trR.map((o) => (o.v[i] - mu[i]) ** 2))) || 1);
const Z = (v) => v.map((x, i) => (x - mu[i]) / sdv[i]);
const p = RK.length, lam = trR.length / 10, A = Array.from({ length: p }, () => new Float64Array(p)), b = new Float64Array(p); const ym = mean(trR.map((o) => o.x.yw));
for (const o of trR) { const z = Z(o.v); for (let i = 0; i < p; i++) { b[i] += z[i] * (o.x.yw - ym); for (let j = 0; j < p; j++) A[i][j] += z[i] * z[j]; } }
for (let i = 0; i < p; i++) A[i][i] += lam;
const Mx = A.map((row, i) => [...row, b[i]]); for (let c = 0; c < p; c++) { const d = Mx[c][c]; for (let k = c; k <= p; k++) Mx[c][k] /= d; for (let r = 0; r < p; r++) if (r !== c) { const f = Mx[r][c]; for (let k = c; k <= p; k++) Mx[r][k] -= f * Mx[c][k]; } }
const coef = Mx.map((row) => row[p]);
const score = (v) => Z(v).reduce((a, z, i) => a + z * coef[i], 0);
const trScores = trR.map((o) => score(o.v)).sort((a, b) => a - b); const q80 = trScores[Math.floor(0.8 * (trScores.length - 1))], q20 = trScores[Math.floor(0.2 * (trScores.length - 1))];
const teR = test.map((x) => ({ x, v: rx(x) })).filter((o) => o.v.every((v) => v != null && Number.isFinite(v))).map((o) => ({ ...o, s: score(o.v) }));
const ridgeTop = companyStats(teR.filter((o) => o.s >= q80).map((o) => ({ issuer: o.x.issuer, x: o.x.y })));
const ridgeBot = companyStats(teR.filter((o) => o.s <= q20).map((o) => ({ issuer: o.x.issuer, x: o.x.y })), { boot: 0 });
out.models.ridge = { features: RK, coefStd: Object.fromEntries(RK.map((k, i) => [k, r4(coef[i])])), lambda: lam, trainN: trR.length, testN: teR.length, top: ridgeTop, bottom: ridgeBot };
toRecord.push(["chart-T3-ridge-walkforward", ridgeTop]);
// full-discovery tree, for description only (not a test)
{ const w = wins(evX.map((x) => x.y)); for (const x of evX) x.yw = w(x.y); const full = growTree(evX, 3, 80); out.models.treeFullDiscoveryDescriptive = leaves(full).map((l) => ({ path: l.path.join(" & "), n: l.n, meanW: r4(l.mean) })); }
for (const [id, res] of toRecord) rec(id, res);

// ---------- descriptive winners vs losers (open-market population, quintiles of x5) ----------
const om = evX.filter((x) => x.r.e.venue === "open_market").sort((a, b) => a.y - b.y);
const qn = Math.floor(om.length / 5), losers = om.slice(0, qn), winners = om.slice(-qn);
const desc = (grp) => Object.fromEntries([...FEATS.map((F) => F.k), "dd60", "gapX", "vol20"].map((k) => { const vs = grp.map((x) => (k === "gapX" ? x.r.gapX : k === "dd60" || k === "vol20" ? x.r[k] : val(x.f, k))).filter((v) => v != null).map(Number); return [k, { mean: r4(mean(vs)), median: r4(median(vs)) }]; }));
out.winnersVsLosersOpenMarket = { n: om.length, quintileN: qn, winners: desc(winners), losers: desc(losers), middle: desc(om.slice(qn, -qn)) };

// BH so far
const latest = new Map(); for (const x of myResults()) latest.set(x.id, x.result);
const ids = [...latest.keys()], qs = bhQ(ids.map((k) => latest.get(k)?.p ?? null)); const qOf = new Map(ids.map((k, i) => [k, r4(qs[i])]));
out.q = Object.fromEntries(toRecord.map(([id]) => [id, qOf.get(id)]));
writeOut("structure-results.json", out);
writeOut("structure-events.csv", toCsv(evX.map((x) => ({ id: x.r.e.id, ticker: x.r.e.ticker, issuer: x.issuer, entryDate: x.r.e.entryDate, venue: x.r.e.venue, ceoCfo: x.X.ceoCfo, filingValue: Math.round(x.r.e.filingValue), gapX: x.r.gapX, dd60: x.r.dd60, vol20: x.r.vol20, ...Object.fromEntries(FEATS.map((F) => [F.k, val(x.f, F.k)])), x5: x.y })), ["id", "ticker", "issuer", "entryDate", "venue", "ceoCfo", "filingValue", "gapX", "dd60", "vol20", ...FEATS.map((F) => F.k), "x5"]));

// console
for (const [pName, P] of Object.entries(out.populations)) { console.log(`\n== ${pName}: n ${P.n}, base x5 mean ${pct(P.base.mean)} med ${pct(P.base.median)} ==`); for (const [k, s] of Object.entries(P.features)) console.log(k.padEnd(11), `hi ${pct(s.hi.mean)} (${s.hi.n}, med ${pct(s.hi.median)}) lo ${pct(s.lo.mean)} (${s.lo.n}, med ${pct(s.lo.median)}) diff ${pct(s.diff)} wdiff ${pct(s.wdiff)} mdiff ${pct(s.mdiff)} t ${s.t} q ${out.q[`chart-T3-${pName}-${k}`]} cuts ${JSON.stringify(s.cuts)}`); }
console.log(`\n== matched controls (generic), n ${out.controls.n} ==`); for (const [k, s] of Object.entries(out.controls.features)) console.log(k.padEnd(11), `hi ${pct(s.hi.mean)} (${s.hi.n}) lo ${pct(s.lo.mean)} (${s.lo.n}) diff ${pct(s.diff)} wdiff ${pct(s.wdiff)} mdiff ${pct(s.mdiff)} t ${s.t} q ${out.q[`chart-T3-controls-${k}`]}`);
console.log("\ntree leaves (train):", JSON.stringify(out.models.tree.leaves, null, 0)); console.log("tree selected test:", JSON.stringify(treeRes), "test all mean", out.models.tree.testAll.mean);
console.log("ridge:", JSON.stringify({ coef: out.models.ridge.coefStd, top: { n: ridgeTop.n, mean: ridgeTop.mean, median: ridgeTop.median, t: ridgeTop.t }, bottom: { n: ridgeBot.n, mean: ridgeBot.mean, t: ridgeBot.t } }));
console.log("full-discovery tree (descriptive):", JSON.stringify(out.models.treeFullDiscoveryDescriptive));
console.log("winners vs losers (open market, x5 quintiles):"); for (const k of Object.keys(out.winnersVsLosersOpenMarket.winners)) console.log(k.padEnd(11), "W", JSON.stringify(out.winnersVsLosersOpenMarket.winners[k]), "L", JSON.stringify(out.winnersVsLosersOpenMarket.losers[k]), "M", JSON.stringify(out.winnersVsLosersOpenMarket.middle[k]));
