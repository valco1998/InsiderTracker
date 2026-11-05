// deep4/learn/models.mjs — models implemented from scratch (no packages): preprocessing, ridge, L2-logistic, elastic net,
// CART tree (depth/leaf/issuer constrained, decile thresholds), metrics (Spearman, AUC, Brier, log-loss) and the
// time-ordered inner CV used to choose lambda inside a training window. Pure functions; no I/O.

// ---------------- helpers ----------------
const isNum = (x) => typeof x === "number" && Number.isFinite(x);
export const mean = (xs) => { let s = 0; for (const x of xs) s += x; return xs.length ? s / xs.length : null; };
export function quantileSorted(s, p) { if (!s.length) return null; const i = p * (s.length - 1), lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); }
export function quantile(xs, p) { return quantileSorted(xs.filter(isNum).sort((a, b) => a - b), p); }

// ---------------- preprocessing (fit on the training window only) ----------------
// X: array of rows, each an array of raw values (null allowed). Per column: winsorise at q01/q99, impute the median, z-score.
// Columns with zero variance after this are kept but set to 0 (sd = 1 guard) so the coefficient is irrelevant.
export function prepFit(X, { winsor = [0.01, 0.99] } = {}) {
  const p = X[0]?.length ?? 0, cols = [];
  for (let j = 0; j < p; j++) {
    const v = []; for (const r of X) if (isNum(r[j])) v.push(r[j]);
    v.sort((a, b) => a - b);
    const lo = v.length ? quantileSorted(v, winsor[0]) : 0, hi = v.length ? quantileSorted(v, winsor[1]) : 0, med = v.length ? quantileSorted(v, 0.5) : 0;
    let s = 0, s2 = 0; const n = X.length;
    for (const r of X) { const x = isNum(r[j]) ? Math.min(hi, Math.max(lo, r[j])) : med; s += x; s2 += x * x; }
    const mu = s / n, va = Math.max(0, s2 / n - mu * mu), sd = va > 1e-12 ? Math.sqrt(va) : 0;
    cols.push({ lo, hi, med, mu, sd });
  }
  return { cols };
}
export function prepApply(P, x) {
  const out = new Float64Array(P.cols.length);
  for (let j = 0; j < P.cols.length; j++) { const c = P.cols[j]; const v = isNum(x[j]) ? Math.min(c.hi, Math.max(c.lo, x[j])) : c.med; out[j] = c.sd > 0 ? (v - c.mu) / c.sd : 0; }
  return out;
}
// winsorised + imputed but NOT z-scored (trees)
export function prepApplyRaw(P, x) {
  const out = new Float64Array(P.cols.length);
  for (let j = 0; j < P.cols.length; j++) { const c = P.cols[j]; out[j] = isNum(x[j]) ? Math.min(c.hi, Math.max(c.lo, x[j])) : c.med; }
  return out;
}
export function winsorY(y, q = [0.01, 0.99]) { const s = y.filter(isNum).sort((a, b) => a - b); const lo = quantileSorted(s, q[0]), hi = quantileSorted(s, q[1]); return { lo, hi, y: y.map((v) => Math.min(hi, Math.max(lo, v))) }; }

// ---------------- linear algebra ----------------
// Solve A b = c for symmetric positive definite A (Cholesky). A: array of Float64Array rows.
export function cholSolve(A, c) {
  const n = c.length, L = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
    let s = A[i][j]; for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
    if (i === j) { if (!(s > 0)) s = 1e-12; L[i][i] = Math.sqrt(s); } else L[i][j] = s / L[j][j];
  }
  const z = new Float64Array(n); for (let i = 0; i < n; i++) { let s = c[i]; for (let k = 0; k < i; k++) s -= L[i][k] * z[k]; z[i] = s / L[i][i]; }
  const b = new Float64Array(n); for (let i = n - 1; i >= 0; i--) { let s = z[i]; for (let k = i + 1; k < n; k++) s -= L[k][i] * b[k]; b[i] = s / L[i][i]; }
  return b;
}

// ---------------- ridge: min (1/2n)||y - b0 - Xb||^2 + (lambda/2)||b||^2 (intercept unpenalised; X z-scored) ----------------
// Gram statistics (independent of lambda; reuse across a lambda grid)
export function ridgeGram(Z, y) {
  const n = Z.length, p = Z[0].length, ym = mean(y);
  const zm = new Float64Array(p); for (const r of Z) for (let j = 0; j < p; j++) zm[j] += r[j] / n;
  const A = Array.from({ length: p }, () => new Float64Array(p)), c = new Float64Array(p);
  const xc = new Float64Array(p);
  for (let i = 0; i < n; i++) { const r = Z[i], yi = y[i] - ym; for (let j = 0; j < p; j++) xc[j] = r[j] - zm[j]; for (let j = 0; j < p; j++) { const xj = xc[j]; c[j] += xj * yi; const Aj = A[j]; for (let k = 0; k <= j; k++) Aj[k] += xj * xc[k]; } }
  for (let j = 0; j < p; j++) { c[j] /= n; for (let k = 0; k <= j; k++) { A[j][k] /= n; A[k][j] = A[j][k]; } }
  return { A, c, zm, ym, p };
}
export function ridgeSolve(G, lambda) {
  const A = G.A.map((row, j) => { const o = Float64Array.from(row); o[j] += lambda; return o; });
  const b = cholSolve(A, G.c);
  let b0 = G.ym; for (let j = 0; j < G.p; j++) b0 -= b[j] * G.zm[j];
  return { type: "ridge", b0, b: Array.from(b), lambda };
}
export const ridgeFit = (Z, y, lambda) => ridgeSolve(ridgeGram(Z, y), lambda);
export const linPredict = (m, z) => { let s = m.b0; for (let j = 0; j < m.b.length; j++) s += m.b[j] * z[j]; return s; };

// ---------------- L2 logistic (Newton / IRLS): min mean logloss + (lambda/2)||b||^2 ----------------
const sigm = (t) => (t >= 0 ? 1 / (1 + Math.exp(-t)) : Math.exp(t) / (1 + Math.exp(t)));
export function logisticFit(Z, y, lambda, { maxIter = 60, tol = 1e-9 } = {}) {
  const n = Z.length, p = Z[0].length, q = p + 1;
  const ybar = Math.min(1 - 1e-6, Math.max(1e-6, mean(y)));
  let w = new Float64Array(q); w[0] = Math.log(ybar / (1 - ybar));
  for (let it = 0; it < maxIter; it++) {
    const H = Array.from({ length: q }, () => new Float64Array(q)), g = new Float64Array(q);
    for (let i = 0; i < n; i++) {
      const r = Z[i]; let t = w[0]; for (let j = 0; j < p; j++) t += w[j + 1] * r[j];
      const pi = sigm(t), d = pi - y[i], wi = Math.max(pi * (1 - pi), 1e-9);
      g[0] += d / n; H[0][0] += wi / n;
      for (let j = 0; j < p; j++) { g[j + 1] += d * r[j] / n; H[j + 1][0] += wi * r[j] / n; for (let k = 0; k <= j; k++) H[j + 1][k + 1] += wi * r[j] * r[k] / n; }
    }
    for (let j = 1; j < q; j++) { g[j] += lambda * w[j]; H[j][j] += lambda; }
    for (let j = 0; j < q; j++) for (let k = 0; k < j; k++) H[k][j] = H[j][k];
    const step = cholSolve(H, g);
    let mx = 0; for (let j = 0; j < q; j++) { w[j] -= step[j]; mx = Math.max(mx, Math.abs(step[j])); }
    if (mx < tol) break;
  }
  return { type: "logistic", b0: w[0], b: Array.from(w.slice(1)), lambda };
}
export const logitPredict = (m, z) => sigm(linPredict(m, z));

// ---------------- elastic net (Gaussian), y standardised inside: min (1/2n)||ys - b0 - Zb||^2 + lambda(alpha|b|_1 + (1-alpha)/2|b|^2) ----------------
export function enetFit(Z, y, lambda, alpha = 0.5, { maxSweeps = 2000, tol = 1e-8 } = {}) {
  const n = Z.length, p = Z[0].length, ym = mean(y);
  let ys = 0; for (const v of y) ys += (v - ym) ** 2; ys = Math.sqrt(ys / n) || 1;
  const t = y.map((v) => (v - ym) / ys);
  const zm = new Float64Array(p), zv = new Float64Array(p);
  for (const r of Z) for (let j = 0; j < p; j++) zm[j] += r[j] / n;
  const Xc = Z.map((r) => { const o = new Float64Array(p); for (let j = 0; j < p; j++) o[j] = r[j] - zm[j]; return o; });
  for (const r of Xc) for (let j = 0; j < p; j++) zv[j] += r[j] * r[j] / n;
  const b = new Float64Array(p), res = Float64Array.from(t);
  const soft = (x, g) => (x > g ? x - g : x < -g ? x + g : 0);
  for (let s = 0; s < maxSweeps; s++) {
    let mx = 0;
    for (let j = 0; j < p; j++) {
      if (!(zv[j] > 1e-12)) continue;
      let rho = 0; for (let i = 0; i < n; i++) rho += Xc[i][j] * res[i]; rho = rho / n + zv[j] * b[j];
      const nb = soft(rho, lambda * alpha) / (zv[j] + lambda * (1 - alpha));
      const d = nb - b[j];
      if (d !== 0) { for (let i = 0; i < n; i++) res[i] -= d * Xc[i][j]; b[j] = nb; mx = Math.max(mx, Math.abs(d)); }
    }
    if (mx < tol) break;
  }
  // back to the y scale: yhat = ym + ys * (b0s + sum b_j (z_j - zm_j))
  const bb = Array.from(b, (v) => v * ys); let b0 = ym; for (let j = 0; j < p; j++) b0 -= bb[j] * zm[j];
  return { type: "enet", b0, b: bb, lambda, alpha, nonZero: bb.filter((v) => v !== 0).length };
}

// ---------------- CART tree (regression on y; for 0/1 y this is the Gini/Brier criterion) ----------------
// X: Float64Array rows (winsorised+imputed raw features); y numbers; issuer ids. Constraints: depth <= maxDepth,
// each child >= minLeaf rows AND >= minIssuers distinct issuers. Thresholds: deciles (10..90%) of the TRAINING window per
// feature (cuts[j] precomputed by the caller, so no unrestricted search). Split = x <= cut goes left.
export function treeFit(X, y, issuers, { maxDepth = 3, minLeaf = 100, minIssuers = 40, cuts, names = null } = {}) {
  const p = X[0].length;
  function leaf(idx, depth) { const m = mean(idx.map((i) => y[i])); return { leaf: true, n: idx.length, issuers: new Set(idx.map((i) => issuers[i])).size, value: m, depth }; }
  function grow(idx, depth) {
    if (depth >= maxDepth || idx.length < 2 * minLeaf) return leaf(idx, depth);
    let S = 0, S2 = 0; for (const i of idx) { S += y[i]; S2 += y[i] * y[i]; }
    const sseP = S2 - (S * S) / idx.length;
    let best = null;
    for (let j = 0; j < p; j++) {
      for (const c of cuts[j]) {
        let nl = 0, sl = 0, sl2 = 0; const il = new Set(), ir = new Set();
        for (const i of idx) { if (X[i][j] <= c) { nl++; sl += y[i]; sl2 += y[i] * y[i]; il.add(issuers[i]); } else ir.add(issuers[i]); }
        const nr = idx.length - nl;
        if (nl < minLeaf || nr < minLeaf || il.size < minIssuers || ir.size < minIssuers) continue;
        const sr = S - sl, sr2 = S2 - sl2;
        const sse = (sl2 - (sl * sl) / nl) + (sr2 - (sr * sr) / nr), gain = sseP - sse;
        if (gain > 1e-12 && (!best || gain > best.gain)) best = { j, c, gain };
      }
    }
    if (!best) return leaf(idx, depth);
    const L = idx.filter((i) => X[i][best.j] <= best.c), R = idx.filter((i) => X[i][best.j] > best.c);
    return { leaf: false, feature: best.j, name: names ? names[best.j] : null, cut: best.c, gain: best.gain, n: idx.length, value: mean(idx.map((i) => y[i])), left: grow(L, depth + 1), right: grow(R, depth + 1) };
  }
  return { type: "tree", root: grow([...X.keys()], 0) };
}
export function treePredict(t, x) { let nd = t.root; while (!nd.leaf) nd = x[nd.feature] <= nd.cut ? nd.left : nd.right; return nd.value; }
export function treeLeaves(t) { const out = []; const walk = (nd, path) => { if (nd.leaf) out.push({ path, n: nd.n, issuers: nd.issuers, value: nd.value }); else { walk(nd.left, [...path, `${nd.name ?? nd.feature} <= ${+nd.cut.toPrecision(5)}`]); walk(nd.right, [...path, `${nd.name ?? nd.feature} > ${+nd.cut.toPrecision(5)}`]); } }; walk(t.root, []); return out; }
export function decileCuts(X) {
  const p = X[0].length, cuts = [];
  for (let j = 0; j < p; j++) { const s = X.map((r) => r[j]).sort((a, b) => a - b); const cs = new Set(); for (let k = 1; k <= 9; k++) cs.add(quantileSorted(s, k / 10)); cs.delete(s[s.length - 1]); cuts.push([...cs].sort((a, b) => a - b)); }
  return cuts;
}

// ---------------- metrics ----------------
export function ranks(a) {
  const n = a.length, idx = a.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]), r = new Float64Array(n);
  let i = 0; while (i < n) { let j = i; while (j + 1 < n && idx[j + 1][0] === idx[i][0]) j++; for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1; i = j + 1; }
  return r;
}
export function pearson(a, b) {
  const n = a.length; if (n < 3) return null; const ma = mean(a), mb = mean(b);
  let num = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : null;
}
export const spearman = (a, b) => (a.length < 5 ? null : pearson(Array.from(ranks(a)), Array.from(ranks(b))));
// AUC = P(score of a positive > score of a negative) with ties counted 1/2 (Mann-Whitney).
export function auc(scores, y) {
  const r = ranks(scores); let np = 0, sp = 0; for (let i = 0; i < y.length; i++) if (y[i] === 1) { np++; sp += r[i]; }
  const nn = y.length - np; if (!np || !nn) return null;
  return (sp - (np * (np + 1)) / 2) / (np * nn);
}
export const brier = (p, y) => mean(p.map((v, i) => (v - y[i]) ** 2));
export const logloss = (p, y) => mean(p.map((v, i) => { const q = Math.min(1 - 1e-12, Math.max(1e-12, v)); return -(y[i] * Math.log(q) + (1 - y[i]) * Math.log(1 - q)); }));
// OLS slope/intercept of y on x (calibration slope)
export function olsLine(x, y) { const mx = mean(x), my = mean(y); let sxy = 0, sxx = 0; for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; } const b = sxx > 0 ? sxy / sxx : null; return { slope: b, intercept: b == null ? null : my - b * mx }; }

// ---------------- time-ordered inner CV for lambda ----------------
// rows: training rows with { month, end, t (decision date) }. folds: for each month start s (strictly inside the window):
// innerTrain = rows with end < s (matured before s), innerVal = rows decided in month(s). Valid if sizes >= minima.
// fitScore(trainIdx, valIdx, lambda) -> score (higher better). Returns { lambda, folds, scores, defaulted }.
export function chooseLambda(rows, grid, fitScore, { defaultLambda, minInnerTrain = 200, minInnerVal = 100, isCounted = () => true } = {}) {
  const months = [...new Set(rows.map((r) => r.month))].sort();
  const folds = [];
  for (const m of months) {
    const s = `${m}-01`;
    const tr = [], va = [];
    rows.forEach((r, i) => { if (r.end < s) tr.push(i); else if (r.month === m) va.push(i); });
    const ntr = tr.filter((i) => isCounted(rows[i])).length, nva = va.filter((i) => isCounted(rows[i])).length;
    if (ntr >= minInnerTrain && nva >= minInnerVal) folds.push({ month: m, tr, va, ntr, nva });
  }
  if (!folds.length) return { lambda: defaultLambda, folds: [], scores: null, defaulted: true };
  const scores = grid.map((lam) => { const v = folds.map((f) => fitScore(f.tr, f.va, lam)).filter((x) => x != null && Number.isFinite(x)); return v.length ? mean(v) : -Infinity; });
  let bi = 0; for (let k = 1; k < grid.length; k++) if (scores[k] > scores[bi] || (scores[k] === scores[bi] && grid[k] > grid[bi])) bi = k;
  // tie-break toward larger lambda: grid is ascending, so ">" keeps the larger lambda only on exact ties via the second clause
  return { lambda: grid[bi], folds: folds.map((f) => ({ month: f.month, ntr: f.ntr, nva: f.nva })), scores, defaulted: false };
}
