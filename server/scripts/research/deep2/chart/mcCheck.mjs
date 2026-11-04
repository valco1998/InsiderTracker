// deep2/chart/mcCheck.mjs — infrastructure check only (no hypothesis outcome is compared here):
//   1) bar-derived event outcomes reproduce stage-C h[N].excessNet; 2) matching quality and covariate balance.
//   node scripts/research/deep2/chart/mcCheck.mjs
import { setup, matchAll, balance, matchQuality } from "./mcSetup.mjs";
import { MATCH_FEATURES, GAP_FEATURE, clip, writeOut, r4 } from "./common.mjs";

const S = await setup();
// 1) outcome arithmetic vs stage C
let checked = 0, bad = 0; const badEx = [];
for (const r of S.ev) for (const N of [1, 2, 3, 5]) {
  const h = r.e.h?.[N]; if (h?.status !== "ok" || !r.o.x[N]) continue;
  checked++;
  if (Math.abs(r.o.x[N].xnet - h.excessNet) > 6e-5 || r.o.exitDates[N] !== h.exitDate) { bad++; if (badEx.length < 5) badEx.push({ id: r.e.id, N, mine: r4(r.o.x[N].xnet), stageC: h.excessNet, myExit: r.o.exitDates[N], exit: h.exitDate }); }
}
console.log(`[CHECK] outcome arithmetic: ${checked} checked, ${bad} mismatches`, badEx);
// stage-C horizons that exist but my calendar exit has no bar (or vice versa)
let missMine = 0, missStage = 0;
for (const r of S.ev) for (const N of [1, 2, 3, 5]) { const ok = r.e.h?.[N]?.status === "ok"; if (ok && !r.o.x[N]) missMine++; if (!ok && r.o.x[N] && r.e.h?.[N]?.status !== "pending") missStage++; }
console.log(`[CHECK] stage-C ok but no bar outcome: ${missMine}; bar outcome but stage-C not ok: ${missStage}`);
// decision close agreement
let dcBad = 0; for (const r of S.ev) if (r.e.decisionClose && Math.abs(r.price / r.e.decisionClose - 1) > 1e-9) dcBad++;
console.log(`[CHECK] decision close mismatches vs stage C: ${dcBad}`);

// 2) matching quality (discovery events only)
const disc = S.ev.filter((r) => r.per === "discover");
const extra = [
  { k: "r1", f: (r) => clip(r.r1, -0.5, 1) }, { k: "r60", f: (r) => clip(r.r60, -0.9, 3) }, { k: "pos60", f: (r) => r.pos60 },
  { k: "logPrice", f: (r) => (r.price > 0 ? Math.log(r.price) : null) }, { k: "sma50r", f: (r) => clip(r.sma50r, -0.8, 2) },
  { k: "volSpike", f: (r) => (r.volSpike > 0 ? Math.log(r.volSpike) : null) }, { k: "nearLow60", f: (r) => (r.nearLow60 == null ? null : r.nearLow60 ? 1 : 0) },
  { k: "gapX(entry day; not matched)", f: (r) => clip(r.gapX, -0.3, 0.6) },
];
const report = { generatedAt: new Date().toISOString(), poolRows: S.pool.rows.length, poolSymbols: S.pool.syms.length, discoveryEventRows: disc.length, variants: {} };
for (const v of ["primary", "sameDate", "ext"]) {
  const t0 = Date.now();
  const M = matchAll(S, disc, v, 10);
  const q = matchQuality(M);
  const bal = balance(S, disc, M, [...MATCH_FEATURES, ...extra]);
  report.variants[v] = { quality: q, balance: bal, seconds: (Date.now() - t0) / 1000 };
  console.log(`\n[CHECK] variant ${v}: ${JSON.stringify(q)} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  console.table(bal.map((b) => ({ feature: b.feature, evMean: b.eventMean, matched: b.matchedMean, pool: b.poolMean, smdBefore: b.smdBefore, smdAfter: b.smdAfter })));
}
// pool share of rows also passing the extended exclusion
console.log(`[CHECK] pool rows passing extended exclusion (no P filing in next 60 sessions): ${S.pool.rows.filter((r) => r.ext).length}/${S.pool.rows.length}`);
const byTier = {}; for (const r of S.pool.rows) byTier[r.tier] = (byTier[r.tier] || 0) + 1; console.log("[CHECK] pool by tier", byTier);
const evTier = {}; for (const r of disc) evTier[r.tier] = (evTier[r.tier] || 0) + 1; console.log("[CHECK] discovery events by decision tier", evTier);
writeOut("mc-balance.json", report);
