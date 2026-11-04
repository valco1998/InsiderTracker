// deep2/chart/mcSetup.mjs — builds the control pool, insider event rows and nearest-neighbour matches.
// Shared by matchedControls.mjs (task 1), gapConditioning.mjs (task 2) and chartStructure.mjs (task 3).
import {
  loadBars, loadEvents, calendar, purchaseBlocks, buildPool, prepareVectors, robustScales, indexPool, nearest, eventRows,
  MATCH_FEATURES, GAP_FEATURE, mean, median, sd, smd, r4,
} from "./common.mjs";

export async function setup({ log = console.log } = {}) {
  const t0 = Date.now();
  const bars = loadBars(); const cal = calendar(bars);
  const E = loadEvents();
  const blocks = await purchaseBlocks(cal);
  const pool = buildPool(bars, cal, blocks.blocked, { blocksExt: blocks.blockedExt });
  prepareVectors(pool.rows, MATCH_FEATURES, "fv");
  prepareVectors(pool.rows, [...MATCH_FEATURES, GAP_FEATURE], "gv");
  const scales = robustScales(pool.rows, [...MATCH_FEATURES, GAP_FEATURE]);
  const idx = indexPool(pool.rows);
  const ev = eventRows(E, bars, cal);
  log(`[CHART_SETUP] events ${E.length} → rows with features ${ev.length}; pool rows ${pool.rows.length} (symbols ${pool.syms.length}); ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return { bars, cal, E, blocks, pool, scales, idx, ev };
}

// variant: "primary" (same month, same tier, ±20 sessions without a P filing), "sameDate", "ext" (also no P filing in
// the next 60 sessions), "gap" (primary + the entry-day gap itself as a matching feature).
export function matchAll(S, rows, variant = "primary", K = 10) {
  const nSyms = S.pool.syms.length;
  const opt = variant === "sameDate" ? { sameDate: true } : variant === "ext" ? { ext: true } : variant === "gap" ? { feats: [...MATCH_FEATURES, GAP_FEATURE], key: "gv" } : {};
  const out = new Map();
  for (const r of rows) out.set(r.e.id, nearest(r, S.idx, S.scales, nSyms, { K, ...opt }));
  return out;
}

// Balance table: events vs matched controls vs the same month×tier×period pool (weighted to the event mix).
export function balance(S, rows, matches, feats) {
  const out = [];
  const cellCount = new Map(); for (const r of rows) { const c = `${r.m}|${r.tier}|${r.per}`; cellCount.set(c, (cellCount.get(c) || 0) + 1); }
  for (const F of feats) {
    const evx = [], ctx = [];
    for (const r of rows) { const ms = matches.get(r.e.id) || []; if (!ms.length) continue; const v = F.f(r); if (v == null) continue; evx.push(v); const cv = ms.map((m) => F.f(m.r)).filter((x) => x != null); if (cv.length) ctx.push(mean(cv)); }
    // pool, weighted to event cells
    let pw = 0, ps = 0, ps2 = 0;
    for (const [c, n] of cellCount) { const [m, tier, per] = c.split("|"); const cand = (S.idx.byMT.get(`${m}|${tier}`) || []).filter((x) => x.per === per); const xs = cand.map(F.f).filter((x) => x != null && Number.isFinite(x)); if (!xs.length) continue; const mu = mean(xs), va = sd(xs) ** 2 || 0; ps += n * mu; ps2 += n * (va + mu * mu); pw += n; }
    const poolMean = ps / pw, poolVar = ps2 / pw - poolMean ** 2;
    const evMean = mean(evx), evVar = sd(evx) ** 2;
    out.push({ feature: F.k, events: evx.length, eventMean: r4(evMean), eventMedian: r4(median(evx)), matchedMean: r4(mean(ctx)), matchedMedian: r4(median(ctx)), poolMean: r4(poolMean),
      smdBefore: r4((evMean - poolMean) / Math.sqrt((evVar + poolVar) / 2)), smdAfter: r4(smd(evx, ctx)) });
  }
  return out;
}

export function matchQuality(matches) {
  const first = [], kth = [], counts = [], reuse = new Map();
  for (const ms of matches.values()) { counts.push(ms.length); if (!ms.length) continue; first.push(ms[0].dist); kth.push(ms.at(-1).dist); for (const m of ms) { const key = `${m.r.s}|${m.r.D}`; reuse.set(key, (reuse.get(key) || 0) + 1); } }
  const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return r4(s[Math.floor(p * (s.length - 1))]); };
  const ru = [...reuse.values()];
  return { events: counts.length, withControls: counts.filter((c) => c > 0).length, fullK: counts.filter((c) => c >= 10).length, distFirstMedian: q(first, 0.5), distFirstP90: q(first, 0.9), distKthMedian: q(kth, 0.5), distKthP90: q(kth, 0.9), distinctControlDays: ru.length, controlUses: ru.reduce((a, b) => a + b, 0), maxReuse: Math.max(...ru), meanReuse: r4(mean(ru)) };
}
