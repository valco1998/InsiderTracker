// deep4/learn/wfLib.mjs — model runners (fit/predict callbacks) for panel/walkforward.mjs, exactly as declared in spec.json.
// Every fit sees only the training rows the engine passes (outcome window ended before the month start); preprocessing,
// lambda (time-ordered inner CV) and the executable threshold are all computed inside that window and frozen.
import * as Mo from "./models.mjs";
import { FEATURE_NAMES, SETS } from "./features.mjs";

export const keyOf = (r) => r.ctlKey ?? r.key;
export const isCtl = (r) => r.ctlKey != null;
export const monthOf = (r) => (r.ctlKey != null ? r.entryMonth : r.month);
export const issuerOf = (r) => (r.ctlKey != null ? r.sym : r.cik);
const IDX = new Map(FEATURE_NAMES.map((n, i) => [n, i]));
export const colsIdx = (names) => names.map((n) => { const i = IDX.get(n); if (i == null) throw new Error(`unknown feature ${n}`); return i; });
const pick = (raw, idx) => idx.map((i) => raw[i]);
const MIN_D2_SIDE = 150;

// ---------- generic penalised learner with time-ordered inner CV (rows of one domain: events OR controls) ----------
// Xraw: raw feature arrays; y: labels; meta: [{ month, end }]; cont: continuous target; method: ridge | logistic | enet
export function learnLinear(Xraw, y, meta, { cont, method, hp }) {
  const grid = method === "enet" ? hp.enet.grid : cont ? hp.ridge.grid : hp.logistic.grid;
  const def = method === "enet" ? hp.enet.default : cont ? hp.ridge.default : hp.logistic.default;
  const cache = new Map();
  const fitScore = (tr, va, lam) => {
    let c = cache.get(tr);
    if (!c) {
      const P = Mo.prepFit(tr.map((i) => Xraw[i]));
      const Ztr = tr.map((i) => Mo.prepApply(P, Xraw[i])), y0 = tr.map((i) => y[i]);
      const ytr = cont ? Mo.winsorY(y0).y : y0;
      c = { Ztr, ytr, Zva: va.map((i) => Mo.prepApply(P, Xraw[i])), yva: va.map((i) => y[i]), G: cont && method === "ridge" ? Mo.ridgeGram(Ztr, ytr) : null };
      cache.set(tr, c);
    }
    if (cont) { const m = method === "enet" ? Mo.enetFit(c.Ztr, c.ytr, lam, hp.enet.alpha) : Mo.ridgeSolve(c.G, lam); return Mo.spearman(c.Zva.map((z) => Mo.linPredict(m, z)), c.yva); }
    const m = Mo.logisticFit(c.Ztr, c.ytr, lam); return -Mo.logloss(c.Zva.map((z) => Mo.logitPredict(m, z)), c.yva);
  };
  const cv = Mo.chooseLambda(meta, grid, fitScore, { defaultLambda: def, minInnerTrain: 200, minInnerVal: 100 });
  const P = Mo.prepFit(Xraw), Z = Xraw.map((x) => Mo.prepApply(P, x));
  const yw = cont ? Mo.winsorY(y).y : y;
  const m = cont ? (method === "enet" ? Mo.enetFit(Z, yw, cv.lambda, hp.enet.alpha) : Mo.ridgeFit(Z, yw, cv.lambda)) : Mo.logisticFit(Z, yw, cv.lambda);
  return { prep: P, coef: m, lambda: cv.lambda, cv, cont, method };
}
export const predLinear = (L, rawSel) => { const z = Mo.prepApply(L.prep, rawSel); return L.cont ? Mo.linPredict(L.coef, z) : Mo.logitPredict(L.coef, z); };

// ---------- pooled events + controls (M3p, M5) ----------
function pooledDesign(base, ins, interactions) {
  return (Pb, Pi, raw, ctl) => {
    const zb = Mo.prepApply(Pb, pick(raw, base)), I = ctl ? 0 : 1, row = [...zb, I];
    if (interactions) { for (const v of zb) row.push(I * v); const zi = ctl ? new Float64Array(ins.length) : Mo.prepApply(Pi, pick(raw, ins)); for (const v of zi) row.push(I * v); }
    return row;
  };
}
function learnPooled(rowsT, store, y, meta, { cont, hp, base, ins, interactions }) {
  const grid = cont ? hp.ridge.grid : hp.logistic.grid, def = cont ? hp.ridge.default : hp.logistic.default;
  const D = pooledDesign(base, ins, interactions);
  const build = (idx) => {
    const ctl = idx.map((i) => isCtl(rowsT[i])), raws = idx.map((i) => store.get(keyOf(rowsT[i])));
    const Pb = Mo.prepFit(raws.map((r) => pick(r, base)));
    const evRaws = raws.filter((_, k) => !ctl[k]);
    const Pi = interactions && evRaws.length ? Mo.prepFit(evRaws.map((r) => pick(r, ins))) : null;
    const rowsD = raws.map((r, k) => D(Pb, Pi, r, ctl[k]));
    const P2 = Mo.prepFit(rowsD, { winsor: [0, 1] });
    return { Pb, Pi, P2, Z: rowsD.map((d) => Mo.prepApply(P2, d)) };
  };
  const zOf = (B, raw, ctl) => Mo.prepApply(B.P2, D(B.Pb, B.Pi, raw, ctl));
  const cache = new Map();
  const fitScore = (tr, va, lam) => {
    let c = cache.get(tr);
    if (!c) {
      const B = build(tr), y0 = tr.map((i) => y[i]), ytr = cont ? Mo.winsorY(y0).y : y0;
      const vaE = va.filter((i) => !isCtl(rowsT[i]));
      c = { Z: B.Z, ytr, Zva: vaE.map((i) => zOf(B, store.get(keyOf(rowsT[i])), false)), yva: vaE.map((i) => y[i]), G: cont ? Mo.ridgeGram(B.Z, ytr) : null };
      cache.set(tr, c);
    }
    if (c.yva.length < 5) return null;
    if (cont) { const m = Mo.ridgeSolve(c.G, lam); return Mo.spearman(c.Zva.map((z) => Mo.linPredict(m, z)), c.yva); }
    const m = Mo.logisticFit(c.Z, c.ytr, lam); return -Mo.logloss(c.Zva.map((z) => Mo.logitPredict(m, z)), c.yva);
  };
  const metaC = meta.map((m, i) => ({ ...m, counted: !isCtl(rowsT[i]) }));
  const cv = Mo.chooseLambda(metaC, grid, fitScore, { defaultLambda: def, minInnerTrain: 200, minInnerVal: 100, isCounted: (m) => m.counted });
  const all = [...rowsT.keys()], B = build(all), yw = cont ? Mo.winsorY(y).y : y;
  const m = cont ? Mo.ridgeFit(B.Z, yw, cv.lambda) : Mo.logisticFit(B.Z, yw, cv.lambda);
  delete B.Z; // only needed for the fit (keeps the frozen model small)
  return { B, zOf, coef: m, lambda: cv.lambda, cv, cont };
}

// ---------- runner factory ----------
// cfg: { id, kind: M0|linear|controls|pooled|tree|enet|split, cols, interactions, splitBy }
// target: { field, type, end }; returns { fit, predict, models: [] } (models = frozen month models, for interpretation)
export function makeRunner(cfg, target, { store, hp, minTrainEvents = 300 }) {
  const cont = target.type === "continuous", models = [];
  const lab = (r) => r[target.field];
  const metaOf = (r) => ({ month: monthOf(r), end: r[target.end] });
  const base = colsIdx(cfg.cols || SETS.M3), ins = colsIdx(SETS.M2);
  function predictRaw(M, raw, ctl) {
    if (!M) return null;
    switch (M.kind) {
      case "M0": return M.value;
      case "linear": case "controls": case "enet": return predLinear(M.L, pick(raw, M.idx));
      case "pooled": { const z = M.P.zOf(M.P.B, raw, ctl); return M.P.cont ? Mo.linPredict(M.P.coef, z) : Mo.logitPredict(M.P.coef, z); }
      case "tree": return Mo.treePredict(M.T, Mo.prepApplyRaw(M.prep, pick(raw, M.idx)));
      case "split": { const v = raw[M.splitIdx]; const hi = cfg.splitBy === "lvol20" ? (v == null || !Number.isFinite(v) ? M.splitMed : v) > M.splitMed : (v ?? 0) > 0; return predLinear(hi ? M.hi : M.lo, pick(raw, M.idx)); }
      default: throw new Error(`unknown kind ${M.kind}`);
    }
  }
  function fit(trainAll, ctx) {
    const ev = trainAll.filter((r) => !isCtl(r)), ct = trainAll.filter(isCtl);
    if (ev.length < minTrainEvents) { models.push({ month: ctx.month, skipped: true, trainEvents: ev.length }); return null; }
    const idx = colsIdx(cfg.cols || []);
    let M;
    if (cfg.kind === "M0") M = { kind: "M0", value: Mo.mean(ev.map(lab)) };
    else if (cfg.kind === "linear" || cfg.kind === "enet") {
      M = { kind: cfg.kind, idx, L: learnLinear(ev.map((r) => pick(store.get(r.key), idx)), ev.map(lab), ev.map(metaOf), { cont, method: cfg.kind === "enet" ? "enet" : cont ? "ridge" : "logistic", hp }) };
    } else if (cfg.kind === "controls") {
      M = { kind: "controls", idx, L: learnLinear(ct.map((r) => pick(store.get(r.ctlKey), idx)), ct.map(lab), ct.map(metaOf), { cont, method: cont ? "ridge" : "logistic", hp }), trainControls: ct.length };
    } else if (cfg.kind === "pooled") {
      const rowsT = ev.concat(ct);
      M = { kind: "pooled", P: learnPooled(rowsT, store, rowsT.map(lab), rowsT.map(metaOf), { cont, hp, base, ins, interactions: !!cfg.interactions }), trainControls: ct.length };
    } else if (cfg.kind === "tree") {
      const Xr = ev.map((r) => pick(store.get(r.key), idx)), prep = Mo.prepFit(Xr), X = Xr.map((x) => Mo.prepApplyRaw(prep, x));
      const y0 = ev.map(lab), y = cont ? Mo.winsorY(y0).y : y0;
      M = { kind: "tree", idx, prep, T: Mo.treeFit(X, y, ev.map((r) => r.cik), { maxDepth: 3, minLeaf: 100, minIssuers: 40, cuts: Mo.decileCuts(X), names: cfg.cols }) };
    } else if (cfg.kind === "split") {
      const sIdx = IDX.get(cfg.splitBy);
      const sv = ev.map((r) => store.get(r.key)[sIdx]);
      const med = cfg.splitBy === "lvol20" ? Mo.quantile(sv, 0.5) : 0;
      const isHi = (v) => (cfg.splitBy === "lvol20" ? (v == null || !Number.isFinite(v) ? med : v) > med : (v ?? 0) > 0);
      const loR = ev.filter((_, k) => !isHi(sv[k])), hiR = ev.filter((_, k) => isHi(sv[k]));
      const learn = (rs) => learnLinear(rs.map((r) => pick(store.get(r.key), idx)), rs.map(lab), rs.map(metaOf), { cont, method: cont ? "ridge" : "logistic", hp });
      let full = null; const getFull = () => (full ||= learn(ev));
      const lo = cfg.splitBy === "spyR20" && loR.length < MIN_D2_SIDE ? getFull() : learn(loR);
      const hi = cfg.splitBy === "spyR20" && hiR.length < MIN_D2_SIDE ? getFull() : learn(hiR);
      M = { kind: "split", idx, splitIdx: sIdx, splitMed: med, lo, hi, nLo: loR.length, nHi: hiR.length, fallback: !!full };
    } else throw new Error(`unknown kind ${cfg.kind}`);
    // executable threshold: q80 of the in-sample predictions on the training EVENTS; base rate for the Brier reference
    const ins0 = ev.map((r) => predictRaw(M, store.get(r.key), false));
    M.thr = Mo.quantile(ins0, 0.8); M.baseRate = Mo.mean(ev.map(lab)); M.trainEvents = ev.length; M.trainControls = ct.length; M.month = ctx.month;
    M.lambda = M.L?.lambda ?? M.P?.lambda ?? (M.lo ? [M.lo.lambda, M.hi.lambda] : null);
    models.push(M);
    return M;
  }
  const predict = (M, row) => predictRaw(M, store.get(keyOf(row)), isCtl(row));
  return { fit, predict, predictRaw, models };
}
