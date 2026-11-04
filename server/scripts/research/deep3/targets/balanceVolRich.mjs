// deep3/targets/balanceVolRich.mjs — balance check of the volRich control variant (features only; no outcomes).
import { loadBars, calendar, purchaseBlocks, buildPool, MATCH_FEATURES, robustScales, indexPool, prepareVectors, nearest, readOut, writeOut, mean, smd, r4, GAP_FEATURE } from "./common.mjs";
const bars = loadBars(); const cal = calendar(bars);
const ev = readOut("events.json").rows;
const blocks = await purchaseBlocks(cal); const pool = buildPool(bars, cal, blocks.blocked);
const VOLRICH = [...MATCH_FEATURES, { k: "lvol60", w: 1, f: (x) => (x.vol60 > 0 ? Math.log(Math.max(x.vol60, 1e-3)) : null) }, { k: "lvolSpike", w: 0.5, f: (x) => (x.volSpike > 0 ? Math.min(3, Math.max(-2, Math.log(x.volSpike))) : null) }];
prepareVectors(pool.rows, VOLRICH, "vv");
const scales = robustScales(pool.rows, [...MATCH_FEATURES, GAP_FEATURE, ...VOLRICH.slice(MATCH_FEATURES.length)]);
const idx = indexPool(pool.rows);
const feats = [...VOLRICH, GAP_FEATURE, { k: "vr20_60", f: (x) => x.vr20_60 }];
const out = [];
for (const per of ["discover", "confirm"]) {
  const E = ev.filter((r) => r.per === per);
  const acc = feats.map(() => ({ e: [], c: [] }));
  for (const r of E) { const ms = nearest(r, idx, scales, pool.syms.length, { K: 10, feats: VOLRICH, key: "vv" }); if (!ms.length) continue;
    feats.forEach((F, q) => { const v = F.f(r); if (v == null || !Number.isFinite(v)) return; const cv = ms.map((m) => F.f(m.r)).filter((x) => x != null && Number.isFinite(x)); if (!cv.length) return; acc[q].e.push(v); acc[q].c.push(mean(cv)); }); }
  feats.forEach((F, q) => out.push({ per, feature: F.k, n: acc[q].e.length, eventMean: r4(mean(acc[q].e)), controlMean: r4(mean(acc[q].c)), smd: r4(smd(acc[q].e, acc[q].c)) }));
}
writeOut("balance-volrich.json", out);
for (const b of out) console.log(b.per.padEnd(9), b.feature.padEnd(10), b.n, b.eventMean, b.controlMean, "smd", b.smd);
