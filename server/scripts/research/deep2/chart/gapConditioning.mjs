// deep2/chart/gapConditioning.mjs — TASK 2: does the size of the opening gap (relative to what that filing type
// usually gaps) predict continuation or reversal after the open? Discovery only; all tests registered first.
//   node scripts/research/deep2/chart/gapConditioning.mjs
//
// Expected gap: OLS on discovery events (gapX winsorized to [-20%, +30%]) with dummies for CEO/CFO, stated open
// market, filing value >= $250k, direct ownership, publication bucket (regular hours / 16-20 ET / overnight-premarket),
// liquidity tier, plus log 20-session volatility. z = (gapX - expected) / vol20 (gap surprise in daily-vol units).
// Fills: OPEN fill (observe the open, buy at that same open: OPTIMISTIC, flagged) and MOC fill (observe the open,
// buy at the same day's closing auction; exits at the close N sessions later). Costs: the event's per-side tier.
import { setup, matchAll, balance, matchQuality } from "./mcSetup.mjs";
import {
  MATCH_FEATURES, GAP_FEATURE, clip, usable, usableN, companyStats, mean, median, r4, reg, rec, xnetAt, writeOut, toCsv, pct, pValue, DISCOVER_END, pubBucket, myResults, bhQ,
} from "./common.mjs";

const S = await setup();
const disc = S.ev.filter((r) => r.per === "discover" && r.e.entryDate < DISCOVER_END);

// ---------- definitions (fixed before any outcome is computed) ----------
const strong = (e) => (e.isCeo || e.isCfo || e.venue === "open_market") && e.filingValue >= 2.5e5;
const design = (r) => {
  const e = r.e, pb = pubBucket(e.publishedAt.slice(11));
  return [1, e.isCeo || e.isCfo ? 1 : 0, e.venue === "open_market" ? 1 : 0, e.filingValue >= 2.5e5 ? 1 : 0, e.ownership === "D" ? 1 : 0,
    pb === "ah" ? 1 : 0, pb === "overnight" ? 1 : 0, r.tier === 15 ? 1 : 0, r.tier === 35 ? 1 : 0, r.tier === 75 ? 1 : 0, Math.log(Math.max(r.vol20, 1e-3))];
};
const DESIGN_NAMES = ["intercept", "ceoCfo", "openMarket", "value250k", "directOwn", "pubAfterClose", "pubOvernight", "tier15", "tier35", "tier75", "logVol20"];
function ols(X, y) { // normal equations with a tiny ridge for stability
  const p = X[0].length, A = Array.from({ length: p }, () => new Float64Array(p)), b = new Float64Array(p);
  for (let i = 0; i < X.length; i++) for (let a = 0; a < p; a++) { b[a] += X[i][a] * y[i]; for (let c = 0; c < p; c++) A[a][c] += X[i][a] * X[i][c]; }
  for (let a = 1; a < p; a++) A[a][a] += 1e-6 * X.length;
  // Gauss-Jordan
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < p; c++) { let piv = c; for (let r = c + 1; r < p; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r; [M[c], M[piv]] = [M[piv], M[c]]; const d = M[c][c]; for (let k = c; k <= p; k++) M[c][k] /= d; for (let r = 0; r < p; r++) if (r !== c) { const f = M[r][c]; for (let k = c; k <= p; k++) M[r][k] -= f * M[c][k]; } }
  return M.map((row) => row[p]);
}
const fitRows = disc.filter((r) => r.vol20 > 0 && Number.isFinite(r.gapX));
const beta = ols(fitRows.map(design), fitRows.map((r) => clip(r.gapX, -0.2, 0.3)));
const expGap = (r) => design(r).reduce((a, x, i) => a + x * beta[i], 0);
for (const r of S.ev) if (r.vol20 > 0) { r.expGap = expGap(r); r.z = (r.gapX - r.expGap) / r.vol20; }
const zs = disc.map((r) => r.z).filter(Number.isFinite).sort((a, b) => a - b);
const qz = (p) => zs[Math.floor(p * (zs.length - 1))];
const CUT = { t1: qz(1 / 3), t2: qz(2 / 3), d9: qz(0.9) };
const terc = (r) => (r.z == null ? null : r.z <= CUT.t1 ? 1 : r.z <= CUT.t2 ? 2 : 3);

const OPEN_H = [0, 1, 2, 3, 4, 5], MOC_H = [1, 2, 3, 4, 5];
const outs = [...OPEN_H.map((N) => `open${N}`), ...MOC_H.map((N) => `moc${N}`)];
const outDesc = (o) => (o.startsWith("open") ? `buy at the entry-session open (conditioning on that open: OPTIMISTIC), sell at the close ${o.slice(4)} sessions later` : `observe the open, buy at that session's close (MOC), sell at the close ${o.slice(3)} sessions later`);

// ---------- registration ----------
reg({ id: "chart-T2-G1-ctrlpool-gapslope", family: "chart-T2 generic gap behaviour (control pool)", familySize: 1,
  statement: "Among discovery control stock-days (no P filing ±20 sessions), the open→same-day-close excess return of the top gapX decile minus the bottom gapX decile differs from 0.",
  rationale: "Context: ordinary small-cap gaps are known to partly reverse intraday; insider-gap tests below must be read against this baseline." });
for (const o of outs) reg({ id: `chart-T2-G1-surpriseTercile-${o}`, family: "chart-T2 gap surprise terciles (all events)", familySize: outs.length,
  statement: `Discovery events: mean net excess (${outDesc(o)}) of the top z-surprise tercile minus the bottom tercile differs from 0 (z = (gapX − expected gap for the filing type)/vol20; tercile cutoffs from discovery).`,
  rationale: "Negative spread = overreaction/underreaction (big gaps fade, small gaps drift); positive = information-driven continuation (gap-and-go)." });
for (const o of outs) reg({ id: `chart-T2-G2-strongNoGap-${o}`, family: "chart-T2 strong filing with no gap", familySize: outs.length,
  statement: `Discovery events with a strong filing [(CEO or CFO or stated open market) and filing value >= $250k] and gapX <= 0: mean net excess vs SPY (${outDesc(o)}) > 0.`,
  rationale: "Underreaction: if the market has not reacted to a strong insider purchase by the open, the information may be incorporated over the next sessions." });
for (const o of outs) reg({ id: `chart-T2-G3-hugeSurprise-${o}`, family: "chart-T2 huge gap surprise", familySize: outs.length,
  statement: `Discovery events with z-surprise in the top decile (cutoff from discovery): mean net excess vs SPY (${outDesc(o)}) differs from 0 (fade if < 0).`,
  rationale: "Overreaction: an opening jump far above what the filing type usually earns may be retail chasing that fades; or real news that continues." });
for (const [g, lab] of [["all", "all events"], ["G2", "strong filing & gapX <= 0"], ["G3", "top-decile z-surprise"]]) for (const N of [0, 1, 5]) reg({
  id: `chart-T2-G4-gapMatched-${g}-open${N}`, family: "chart-T2 insider gap vs ordinary gap of the same size (gap-matched controls)", familySize: 9,
  statement: `Discovery, ${lab}: event net excess (open fill, close ${N} sessions later) minus the mean of 10 controls matched on the same chart features AND the entry-day gapX differs from 0.`,
  rationale: "Separates insider-specific post-gap behaviour from generic behaviour of stocks that gap by the same amount on other news." });

// ---------- outcomes ----------
const evO = (r, o) => {
  if (o.startsWith("open")) { const N = Number(o.slice(4)); if ([1, 2, 3, 5].includes(N)) return usable(r.e, N, "discover") ? r.e.h[N].excessNet : null; return usableN(r, N) ? r.o.x[N].xnet : null; }
  const N = Number(o.slice(3)); return usableN(r, N) && r.o.moc[N] ? r.o.moc[N].xnet : null;
};
const stats = (rows, o) => companyStats(rows.map((r) => ({ issuer: r.e.issuerCik, x: evO(r, o) })).filter((x) => x.x != null));
const spread = (a, b) => { const seA = a.t ? Math.abs(a.mean / a.t) : null, seB = b.t ? Math.abs(b.mean / b.t) : null; const t = seA && seB ? (a.mean - b.mean) / Math.sqrt(seA ** 2 + seB ** 2) : null; return { diff: r4(a.mean - b.mean), t: r4(t), p: pValue(t), wdiff: r4(a.wmean - b.wmean), mdiff: r4(a.median - b.median) }; };
const toRecord = [];
const out = { generatedAt: new Date().toISOString(), beta: Object.fromEntries(DESIGN_NAMES.map((k, i) => [k, r4(beta[i])])), cutoffs: Object.fromEntries(Object.entries(CUT).map(([k, v]) => [k, r4(v)])), fitN: fitRows.length };

// G1 control pool context: x0 by gapX decile among discovery pool rows (open fill, cost by the row's own tier)
{
  const rows = S.pool.rows.filter((r) => r.per === "discover");
  const g = rows.map((r) => r.gapX).sort((a, b) => a - b); const d1 = g[Math.floor(0.1 * (g.length - 1))], d9 = g[Math.floor(0.9 * (g.length - 1))];
  const costOf = (r) => ({ 5: 5, 15: 15, 35: 35, 75: 75 }[r.tier]);
  const x0 = (r) => xnetAt(S.bars.get(r.s), r.k, S.cal, 0, costOf(r), "open");
  const top = companyStats(rows.filter((r) => r.gapX >= d9).map((r) => ({ issuer: r.s, x: x0(r) })).filter((x) => x.x != null), { boot: 0 });
  const bot = companyStats(rows.filter((r) => r.gapX <= d1).map((r) => ({ issuer: r.s, x: x0(r) })).filter((x) => x.x != null), { boot: 0 });
  const mid = companyStats(rows.filter((r) => r.gapX > d1 && r.gapX < d9).map((r) => ({ issuer: r.s, x: x0(r) })).filter((x) => x.x != null), { boot: 0 });
  out.ctrlPool = { gapDecileCutoffs: [r4(d1), r4(d9)], topDecile: top, middle: mid, bottomDecile: bot, spread: spread(top, bot) };
  toRecord.push(["chart-T2-G1-ctrlpool-gapslope", { ...out.ctrlPool.spread, top: top.mean, bottom: bot.mean, n: top.n + bot.n }]);
}
// G1 terciles
out.G1 = {};
for (const o of outs) {
  const T = [1, 2, 3].map((k) => stats(disc.filter((r) => terc(r) === k), o));
  out.G1[o] = { bottom: T[0], middle: T[1], top: T[2], spread: spread(T[2], T[0]) };
  toRecord.push([`chart-T2-G1-surpriseTercile-${o}`, { ...out.G1[o].spread, n: T[0].n + T[2].n, topMean: T[2].mean, bottomMean: T[0].mean }]);
}
// G2 / G3
const G2rows = disc.filter((r) => strong(r.e) && r.gapX <= 0), G3rows = disc.filter((r) => r.z != null && r.z >= CUT.d9);
out.G2 = {}; out.G3 = {};
for (const o of outs) { out.G2[o] = stats(G2rows, o); toRecord.push([`chart-T2-G2-strongNoGap-${o}`, { ...out.G2[o] }]); }
for (const o of outs) { out.G3[o] = stats(G3rows, o); toRecord.push([`chart-T2-G3-hugeSurprise-${o}`, { ...out.G3[o] }]); }
// G4 gap-matched controls
const MG = matchAll(S, disc, "gap");
out.gapMatchQuality = matchQuality(MG);
out.gapMatchBalance = balance(S, disc, MG, [...MATCH_FEATURES, GAP_FEATURE]);
out.gapMatchBalanceG3 = balance(S, G3rows, MG, [GAP_FEATURE]);
out.G4 = {};
for (const [g, rows] of [["all", disc], ["G2", G2rows], ["G3", G3rows]]) for (const N of [0, 1, 5]) {
  const d = [];
  for (const r of rows) { const x = evO(r, `open${N}`); if (x == null) continue; const cs = (MG.get(r.e.id) || []).map((c) => xnetAt(S.bars.get(c.r.s), c.r.k, S.cal, N, r.e.costBpsPerSide, "open")).filter((v) => v != null); if (!cs.length) continue; d.push({ issuer: r.e.issuerCik, x: x - mean(cs), ctl: mean(cs) }); }
  const st = companyStats(d); out.G4[`${g}-open${N}`] = { ...st, controlMean: r4(mean(d.map((x) => x.ctl))) };
  toRecord.push([`chart-T2-G4-gapMatched-${g}-open${N}`, out.G4[`${g}-open${N}`]]);
}
for (const [id, res] of toRecord) rec(id, res);

// BH over this agent's results so far
const latest = new Map(); for (const x of myResults()) latest.set(x.id, x.result);
const ids = [...latest.keys()], qs = bhQ(ids.map((k) => latest.get(k)?.p ?? null)); const qOf = new Map(ids.map((k, i) => [k, r4(qs[i])]));
out.q = Object.fromEntries(toRecord.map(([id]) => [id, qOf.get(id)]));
writeOut("gap-results.json", out);

// event-level CSV (discovery)
const cols = ["id", "ticker", "issuer", "publishedAt", "pub", "entryDate", "strong", "ceoCfo", "venue", "filingValue", "tier", "costBps", "vol20", "gapX", "expGap", "z", "tercile", "G2", "G3", ...outs];
writeOut("gap-events.csv", toCsv(disc.map((r) => ({ id: r.e.id, ticker: r.e.ticker, issuer: r.e.issuerCik, publishedAt: r.e.publishedAt, pub: pubBucket(r.e.publishedAt.slice(11)), entryDate: r.e.entryDate, strong: strong(r.e), ceoCfo: !!(r.e.isCeo || r.e.isCfo), venue: r.e.venue, filingValue: Math.round(r.e.filingValue), tier: r.tier, costBps: r.e.costBpsPerSide, vol20: r.vol20, gapX: r.gapX, expGap: r.expGap, z: r.z, tercile: terc(r), G2: G2rows.includes(r), G3: G3rows.includes(r), ...Object.fromEntries(outs.map((o) => [o, evO(r, o)])) })), cols));

// console
console.log("beta", out.beta, "cutoffs", out.cutoffs);
console.log("ctrl pool x0 by gap decile: top", pct(out.ctrlPool.topDecile.mean), "mid", pct(out.ctrlPool.middle.mean), "bottom", pct(out.ctrlPool.bottomDecile.mean), "spread", out.ctrlPool.spread);
const L = (s) => `n ${s.n} iss ${s.issuers} mean ${pct(s.mean)} wmean ${pct(s.wmean)} med ${pct(s.median)} t ${s.t} p ${r4(s.p)} issMed ${pct(s.issuerMedianOfMeans)} exTop5 ${pct(s.meanExTop5Issuers)}`;
console.log("\nG1 surprise terciles (bottom | middle | top | spread top-bottom):");
for (const o of outs) console.log(o.padEnd(6), `B ${pct(out.G1[o].bottom.mean)} (${out.G1[o].bottom.n}) | M ${pct(out.G1[o].middle.mean)} | T ${pct(out.G1[o].top.mean)} (${out.G1[o].top.n}) | spread ${pct(out.G1[o].spread.diff)} t ${out.G1[o].spread.t} wdiff ${pct(out.G1[o].spread.wdiff)} mdiff ${pct(out.G1[o].spread.mdiff)} q ${out.q[`chart-T2-G1-surpriseTercile-${o}`]}`);
console.log("\nG2 strong & no gap:"); for (const o of outs) console.log(o.padEnd(6), L(out.G2[o]), "q", out.q[`chart-T2-G2-strongNoGap-${o}`]);
console.log("\nG3 huge surprise:"); for (const o of outs) console.log(o.padEnd(6), L(out.G3[o]), "q", out.q[`chart-T2-G3-hugeSurprise-${o}`]);
console.log("\ngap-match quality", out.gapMatchQuality); console.table(out.gapMatchBalance.map((b) => ({ f: b.feature, ev: b.eventMean, m: b.matchedMean, smdB: b.smdBefore, smdA: b.smdAfter }))); console.log("G3 gap balance", out.gapMatchBalanceG3);
console.log("\nG4 gap-matched differences:"); for (const [k, s] of Object.entries(out.G4)) console.log(k.padEnd(10), L(s), "ctl", pct(s.controlMean), "q", out.q[`chart-T2-G4-gapMatched-${k}`]);
