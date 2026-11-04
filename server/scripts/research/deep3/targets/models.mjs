// deep3/targets/models.mjs — interpretable models, fitted on DISCOVERY open-market filings, evaluated ONCE on
// confirmation open-market filings (tests targets-M-* registered by register.mjs before any data was analysed).
//   node scripts/research/deep3/targets/models.mjs
// Logistic (7 features) vs volatility-only logistic (lvol20) for hit10_5 and dd10_5; depth<=3 Gini tree (min leaf 150).
import { rec, isRegistered, writeOut, checkpoint, r4, mean, clip, pValue } from "./common.mjs";
import { loadRows } from "./stats.mjs";

const rows = loadRows().filter((r) => r.cls === "om");
const FEATS = {
  lvol20: (r) => (r.vol20 > 0 ? Math.log(r.vol20) : null), ldv20: (r) => (r.dv20 > 0 ? Math.log(r.dv20) : null), dd60: (r) => clip(r.dd60, -1, 0), r5: (r) => clip(r.r5, -0.5, 1),
  ceoCfo: (r) => (r.isCeo || r.isCfo ? 1 : 0), cluster2: (r) => (r.clu7 >= 2 ? 1 : 0), lvalue: (r) => Math.log(Math.max(1e3, r.filingValue || 0)),
};
const TREE_FEATS = { ...FEATS, r20: (r) => clip(r.r20, -0.7, 2), vr20_60: (r) => clip(r.vr20_60, 0, 4), lvolSpike: (r) => (r.volSpike > 0 ? clip(Math.log(r.volSpike), -2, 3) : null), rs20: (r) => clip(r.rs20, -0.7, 2), pos60: (r) => r.pos60, rep30: (r) => Math.min(r.rep30 ?? 0, 5) };
const SETS = { full: Object.keys(FEATS), vol: ["lvol20"], chart: ["lvol20", "ldv20", "dd60", "r5"] };

function design(rs, names, y, F = FEATS) { const X = [], Y = [], I = []; for (const r of rs) { const v = r.o?.[y]; if (v == null) continue; const x = names.map((n) => F[n](r)); if (x.some((z) => z == null || !Number.isFinite(z))) continue; X.push(x); Y.push(v); I.push(r.issuer); } return { X, Y, I }; }
function standardizer(X) { const k = X[0].length, mu = Array(k).fill(0), sdv = Array(k).fill(0); for (const x of X) x.forEach((v, j) => (mu[j] += v / X.length)); for (const x of X) x.forEach((v, j) => (sdv[j] += (v - mu[j]) ** 2 / (X.length - 1))); return { mu, sd: sdv.map((v) => Math.sqrt(v) || 1) }; }
const std = (x, s) => x.map((v, j) => (v - s.mu[j]) / s.sd[j]);
const sig = (z) => 1 / (1 + Math.exp(-z));
function solve(A, b) { const n = b.length, M = A.map((r, i) => [...r, b[i]]); for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]]; for (let r = 0; r < n; r++) { if (r === c) continue; const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; } } return M.map((r, i) => r[n] / r[i]); }
function logit(X, Y, lam = 1e-4) {
  const k = X[0].length + 1; let b = Array(k).fill(0);
  for (let it = 0; it < 50; it++) {
    const g = Array(k).fill(0), H = Array.from({ length: k }, () => Array(k).fill(0));
    for (let i = 0; i < X.length; i++) { const x = [1, ...X[i]]; const p = sig(x.reduce((a, v, j) => a + v * b[j], 0)); const w = p * (1 - p); for (let j = 0; j < k; j++) { g[j] += (Y[i] - p) * x[j]; for (let l = 0; l < k; l++) H[j][l] += w * x[j] * x[l]; } }
    for (let j = 1; j < k; j++) { g[j] -= lam * b[j]; H[j][j] += lam; }
    const step = solve(H, g); b = b.map((v, j) => v + step[j]); if (Math.max(...step.map(Math.abs)) < 1e-8) break;
  }
  return b;
}
const predict = (b, x) => sig([1, ...x].reduce((a, v, j) => a + v * b[j], 0));
function auc(p, y) { const idx = p.map((v, i) => [v, y[i]]).sort((a, b) => a[0] - b[0]); let rank = 0, sumPos = 0, nPos = 0, i = 0; while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) if (idx[k][1]) { sumPos += avg; nPos++; } i = j + 1; } const nNeg = idx.length - nPos; return nPos && nNeg ? (sumPos - (nPos * (nPos + 1)) / 2) / (nPos * nNeg) : null; }
const logloss = (p, y) => -mean(p.map((v, i) => (y[i] ? Math.log(Math.max(1e-9, v)) : Math.log(Math.max(1e-9, 1 - v)))));
function calib(p, y, bins = 10) { const idx = p.map((v, i) => [v, y[i]]).sort((a, b) => a[0] - b[0]); const out = []; for (let b = 0; b < bins; b++) { const s = idx.slice(Math.floor((b * idx.length) / bins), Math.floor(((b + 1) * idx.length) / bins)); out.push({ bin: b + 1, n: s.length, predicted: r4(mean(s.map((x) => x[0]))), observed: r4(mean(s.map((x) => x[1]))) }); } return out; }
function bootP(stat, I, B = 400, seed = 11) { // issuer bootstrap of stat(indexSet) → two-sided p and CI
  const groups = new Map(); I.forEach((iss, i) => (groups.get(iss) || groups.set(iss, []).get(iss)).push(i)); const G = [...groups.values()];
  let s = seed; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); const vals = [];
  for (let b = 0; b < B; b++) { const ix = []; for (let k = 0; k < G.length; k++) ix.push(...G[Math.floor(rnd() * G.length)]); const v = stat(ix); if (v != null && Number.isFinite(v)) vals.push(v); }
  vals.sort((a, b) => a - b); const below = vals.filter((v) => v <= 0).length / vals.length;
  return { ci95: [r4(vals[Math.floor(0.025 * vals.length)]), r4(vals[Math.floor(0.975 * vals.length)])], p: r4(Math.min(1, 2 * Math.min(below, 1 - below))), B: vals.length };
}
// ---------------- depth<=3 Gini tree ----------------
function tree(X, Y, depth = 3, minLeaf = 150) {
  const gini = (n1, n) => (n ? 1 - (n1 / n) ** 2 - (1 - n1 / n) ** 2 : 0);
  function grow(ix, d) {
    const n = ix.length, n1 = ix.reduce((a, i) => a + Y[i], 0);
    const node = { n, p: n1 / n };
    if (d === depth || n < 2 * minLeaf) return node;
    let best = null;
    for (let j = 0; j < X[0].length; j++) {
      const vs = ix.map((i) => X[i][j]).sort((a, b) => a - b);
      for (let q = 1; q < 10; q++) { const th = vs[Math.floor((q * vs.length) / 10)]; const L = ix.filter((i) => X[i][j] <= th), R = ix.filter((i) => X[i][j] > th); if (L.length < minLeaf || R.length < minLeaf) continue;
        const l1 = L.reduce((a, i) => a + Y[i], 0), r1 = R.reduce((a, i) => a + Y[i], 0); const imp = (L.length * gini(l1, L.length) + R.length * gini(r1, R.length)) / n;
        if (!best || imp < best.imp) best = { j, th, imp, L, R }; }
    }
    if (!best || best.imp >= gini(n1, n) - 1e-6) return node;
    return { ...node, j: best.j, th: best.th, left: grow(best.L, d + 1), right: grow(best.R, d + 1) };
  }
  return grow(X.map((_, i) => i), 0);
}
const leafOf = (t, x, path = "") => (t.left ? (x[t.j] <= t.th ? leafOf(t.left, x, path + "L") : leafOf(t.right, x, path + "R")) : { p: t.p, n: t.n, path: path || "root" });
const describe = (t, names, ind = "") => (t.left ? `${ind}${names[t.j]} <= ${r4(t.th)} (n ${t.n}, p ${r4(t.p)})\n${describe(t.left, names, ind + "  ")}${ind}${names[t.j]} > ${r4(t.th)}\n${describe(t.right, names, ind + "  ")}` : `${ind}leaf n ${t.n} p ${r4(t.p)}\n`);

const out = {};
for (const y of ["hit10_5", "dd10_5"]) {
  const disc = rows.filter((r) => r.per === "discover"), conf = rows.filter((r) => r.per === "confirm");
  const M = {};
  for (const [name, names] of Object.entries(SETS)) {
    const D = design(disc, names, y), C = design(conf, names, y);
    const s = standardizer(D.X); const b = logit(D.X.map((x) => std(x, s)), D.Y);
    M[name] = { names, b, s, coef: Object.fromEntries(["intercept", ...names].map((n, j) => [n, r4(b[j])])), pD: D.X.map((x) => predict(b, std(x, s))), D, C, pC: C.X.map((x) => predict(b, std(x, s))) };
  }
  // align confirmation rows (all three designs use the same rows only if features are present: use the full design's rows)
  const C = M.full.C, Y = C.Y, I = C.I;
  const keyRows = (rs, names) => rs.filter((r) => r.o?.[y] != null && names.every((n) => { const v = FEATS[n](r); return v != null && Number.isFinite(v); }));
  const confRows = keyRows(rows.filter((r) => r.per === "confirm"), SETS.full);
  const pred = (name, rs) => { const m = M[name]; return rs.map((r) => predict(m.b, std(m.names.map((n) => FEATS[n](r)), m.s))); };
  const pFull = pred("full", confRows), pVol = pred("vol", confRows), pChart = pred("chart", confRows);
  const yC = confRows.map((r) => r.o[y]), iC = confRows.map((r) => r.issuer);
  const aucD = { full: r4(auc(M.full.pD, M.full.D.Y)), vol: r4(auc(M.vol.pD, M.vol.D.Y)), chart: r4(auc(M.chart.pD, M.chart.D.Y)) };
  const aucC = { full: r4(auc(pFull, yC)), vol: r4(auc(pVol, yC)), chart: r4(auc(pChart, yC)) };
  const aucLift = bootP((ix) => auc(ix.map((i) => pFull[i]), ix.map((i) => yC[i])) - auc(ix.map((i) => pVol[i]), ix.map((i) => yC[i])), iC);
  // top quintile of the full model: observed minus vol-model predicted; and vs the vol model's own top quintile (descriptive)
  const thr = [...pFull].sort((a, b) => b - a)[Math.floor(0.2 * pFull.length)];
  const top = confRows.map((_, i) => i).filter((i) => pFull[i] >= thr);
  const topQ = { n: top.length, observed: r4(mean(top.map((i) => yC[i]))), volPredicted: r4(mean(top.map((i) => pVol[i]))), fullPredicted: r4(mean(top.map((i) => pFull[i]))) };
  topQ.lift = r4(topQ.observed - topQ.volPredicted);
  const topBoot = bootP((ix) => { const t = ix.filter((i) => pFull[i] >= thr); return t.length ? mean(t.map((i) => yC[i] - pVol[i])) : null; }, iC);
  const thrV = [...pVol].sort((a, b) => b - a)[Math.floor(0.2 * pVol.length)];
  const topV = confRows.map((_, i) => i).filter((i) => pVol[i] >= thrV);
  out[y] = { nDiscovery: M.full.D.Y.length, nConfirm: yC.length, baseRateD: r4(mean(M.full.D.Y)), baseRateC: r4(mean(yC)), coef: { full: M.full.coef, vol: M.vol.coef, chart: M.chart.coef }, aucDiscoveryInSample: aucD, aucConfirm: aucC,
    aucLiftFullMinusVol: { value: r4(aucC.full - aucC.vol), ...aucLift }, logLossConfirm: { full: r4(logloss(pFull, yC)), vol: r4(logloss(pVol, yC)), chart: r4(logloss(pChart, yC)) },
    topQuintile: { ...topQ, ...topBoot, volModelTopQuintileObserved: r4(mean(topV.map((i) => yC[i]))) }, calibrationConfirm: { full: calib(pFull, yC), vol: calib(pVol, yC) } };
  for (const [suf, val] of [["aucLift", { value: out[y].aucLiftFullMinusVol.value, p: aucLift.p, ci95: aucLift.ci95, aucFull: aucC.full, aucVol: aucC.vol, n: yC.length }], ["topQ", { lift: topQ.lift, p: topBoot.p, ci95: topBoot.ci95, observed: topQ.observed, volPredicted: topQ.volPredicted, n: top.length }]]) {
    const id = `targets-M-logit-${y}-${suf}`; if (!isRegistered(id)) throw new Error(id); rec(id, val);
  }
}
// tree for hit10_5
{
  const y = "hit10_5", names = Object.keys(TREE_FEATS);
  const disc = rows.filter((r) => r.per === "discover" && r.o?.[y] != null && names.every((n) => { const v = TREE_FEATS[n](r); return v != null && Number.isFinite(v); }));
  const conf = rows.filter((r) => r.per === "confirm" && r.o?.[y] != null && names.every((n) => { const v = TREE_FEATS[n](r); return v != null && Number.isFinite(v); }));
  const XD = disc.map((r) => names.map((n) => TREE_FEATS[n](r))), YD = disc.map((r) => r.o[y]);
  const T = tree(XD, YD, 3, 150);
  const XC = conf.map((r) => names.map((n) => TREE_FEATS[n](r))), YC = conf.map((r) => r.o[y]), IC = conf.map((r) => r.issuer);
  const pT = XC.map((x) => leafOf(T, x).p);
  // vol-only logistic fitted on the same discovery rows
  const xv = disc.map((r) => [FEATS.lvol20(r)]); const sv = standardizer(xv); const bv = logit(xv.map((x) => std(x, sv)), YD);
  const pV = conf.map((r) => predict(bv, std([FEATS.lvol20(r)], sv)));
  const aucT = auc(pT, YC), aucV = auc(pV, YC);
  const lift = bootP((ix) => auc(ix.map((i) => pT[i]), ix.map((i) => YC[i])) - auc(ix.map((i) => pV[i]), ix.map((i) => YC[i])), IC);
  const leaves = new Map(); disc.forEach((r, i) => { const L = leafOf(T, XD[i]); const c = leaves.get(L.path) || { path: L.path, p: L.p, n: L.n }; leaves.set(L.path, c); });
  const topLeaf = [...leaves.values()].filter((l) => l.n >= 150).sort((a, b) => b.p - a.p)[0];
  const inTop = conf.map((_, i) => i).filter((i) => leafOf(T, XC[i]).path === topLeaf.path);
  const topBoot = bootP((ix) => { const t = ix.filter((i) => leafOf(T, XC[i]).path === topLeaf.path); return t.length ? mean(t.map((i) => YC[i] - pV[i])) : null; }, IC);
  out.tree = { features: names, text: describe(T, names), nDiscovery: disc.length, nConfirm: conf.length, aucConfirm: { tree: r4(aucT), vol: r4(aucV) }, aucLift: { value: r4(aucT - aucV), ...lift },
    topLeaf: { path: topLeaf.path, discoveryN: topLeaf.n, discoveryRate: r4(topLeaf.p), confirmN: inTop.length, confirmObserved: r4(mean(inTop.map((i) => YC[i]))), confirmVolPredicted: r4(mean(inTop.map((i) => pV[i]))), bootstrapP: topBoot.p, ci95: topBoot.ci95, B: topBoot.B },
    leavesDiscovery: [...leaves.values()].map((l) => ({ ...l, p: r4(l.p), confirmN: conf.filter((_, i) => leafOf(T, XC[i]).path === l.path).length, confirmObserved: r4(mean(conf.map((_, i) => i).filter((i) => leafOf(T, XC[i]).path === l.path).map((i) => YC[i]))) })) };
  rec("targets-M-tree-hit10_5-aucLift", { value: out.tree.aucLift.value, p: lift.p, ci95: lift.ci95, aucTree: r4(aucT), aucVol: r4(aucV), n: conf.length });
  rec("targets-M-tree-hit10_5-topLeaf", { lift: r4(out.tree.topLeaf.confirmObserved - out.tree.topLeaf.confirmVolPredicted), p: topBoot.p, ci95: topBoot.ci95, n: inTop.length, path: topLeaf.path });
}
writeOut("models.json", { generatedAt: new Date().toISOString(), note: "Fitted on discovery open-market filings; evaluated once on confirmation. Volatility baseline = logistic on log vol20.", ...out });
checkpoint("interpretable models (discovery fit, single confirmation evaluation)", { file: "models.json" });
for (const y of ["hit10_5", "dd10_5"]) { const m = out[y]; console.log(`\n${y}: base D ${m.baseRateD} C ${m.baseRateC}; coef full ${JSON.stringify(m.coef.full)}`); console.log(`  AUC disc ${JSON.stringify(m.aucDiscoveryInSample)} conf ${JSON.stringify(m.aucConfirm)} lift ${JSON.stringify(m.aucLiftFullMinusVol)}`); console.log(`  topQ ${JSON.stringify(m.topQuintile)}`); console.log(`  logloss ${JSON.stringify(m.logLossConfirm)}`); }
console.log(`\nTREE hit10_5:\n${out.tree.text}AUC conf ${JSON.stringify(out.tree.aucConfirm)} lift ${JSON.stringify(out.tree.aucLift)}\ntopLeaf ${JSON.stringify(out.tree.topLeaf)}`);
