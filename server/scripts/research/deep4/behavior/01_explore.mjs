// deep4/behavior/01_explore.mjs — FEATURES ONLY (no outcome field is read): universe counts, repeat-buyer structure and
// the design-segment distributions that the style rules (02_styleRules.mjs) will be declared from.
//   node --max-old-space-size=6144 scripts/research/deep4/behavior/01_explore.mjs
import { loadDesign, isPrimaryPurchase, quantile, mean, median, group, writeJson, checkpoint, r4 } from "./common.mjs";

const { rows } = loadDesign();
const prim = rows.filter(isPrimaryPurchase);
const out = { builtAt: new Date().toISOString(), note: "features only; no outcome (A_*, B_*, C_*) field read", counts: {} };
out.counts.designRows = rows.length;
out.counts.primary = prim.length;
out.counts.primaryIssuers = new Set(prim.map((r) => r.cik)).size;
const byP = group(prim, (r) => r.person);
out.counts.persons = byP.size;
const nDist = {}; for (const xs of byP.values()) { const k = xs.length >= 10 ? "10+" : xs.length >= 5 ? "5-9" : String(xs.length); nDist[k] = (nDist[k] || 0) + 1; }
out.counts.personsByPrimaryPurchases = nDist;
out.counts.personsGe2 = [...byP.values()].filter((x) => x.length >= 2).length;
out.counts.personsGe3 = [...byP.values()].filter((x) => x.length >= 3).length;
out.counts.personsGe5 = [...byP.values()].filter((x) => x.length >= 5).length;
out.counts.eventsOfPersonsGe2 = [...byP.values()].filter((x) => x.length >= 2).reduce((a, x) => a + x.length, 0);
const multiIss = [...byP.values()].filter((x) => x.length >= 2).map((x) => new Set(x.map((r) => r.cik)).size);
out.counts.repeatPersonsMultiIssuer = multiIss.filter((k) => k >= 2).length;
// within-person gaps (calendar days between consecutive primary purchases, by acceptance date) and same-issuer share
const gaps = [], sameIss = [];
for (const xs of byP.values()) for (let i = 1; i < xs.length; i++) { gaps.push((Date.parse(xs[i].publishedAt.slice(0, 10)) - Date.parse(xs[i - 1].publishedAt.slice(0, 10))) / 864e5); sameIss.push(xs[i].cik === xs[i - 1].cik ? 1 : 0); }
out.repeatGaps = { n: gaps.length, p10: quantile(gaps, 0.1), p25: quantile(gaps, 0.25), median: median(gaps), p75: quantile(gaps, 0.75), p90: quantile(gaps, 0.9), shareLe3d: r4(gaps.filter((g) => g <= 3).length / gaps.length), shareLe30d: r4(gaps.filter((g) => g <= 30).length / gaps.length), sameIssuerShare: r4(mean(sameIss)) };
// feature distributions (primary purchases)
const F = ["r1", "r5", "r10", "r20", "r60", "dHi30", "dLo30", "dHi60", "dLo60", "dHi252", "dLo252", "mdd60", "vol20", "vol60", "dv20", "sma50r", "gapPrev", "volSurge", "volSurge1",
  "usd", "pctHold", "pPrior", "pPriorCo", "pPriorOm", "pCompanies", "pDaysSincePrev", "pDaysSincePrevCo", "pUsdRatioMax", "pUsdRatioMed", "pUsdRatioMaxCo", "avgDownPct", "chgSincePrevBuy",
  "oBuyers30", "oBuyers30Om", "oBuyersPrior", "iBuysPrior", "iDaysSincePrevBuy", "sellers30np", "lagDays", "retTdToDec", "td_r20", "td_dLo60", "td_mdd60", "spyR20", "breadth50", "histSessions", "pObsDays"];
out.dist = {};
for (const f of F) { const v = prim.map((r) => r[f]).filter((x) => typeof x === "number" && Number.isFinite(x)); out.dist[f] = { n: v.length, nullShare: r4(1 - v.length / prim.length), p05: quantile(v, 0.05), p10: quantile(v, 0.1), p20: quantile(v, 0.2), p25: quantile(v, 0.25), p33: quantile(v, 1 / 3), median: quantile(v, 0.5), p67: quantile(v, 2 / 3), p75: quantile(v, 0.75), p80: quantile(v, 0.8), p90: quantile(v, 0.9), p95: quantile(v, 0.95), mean: mean(v) }; }
const B = ["bo20", "avgDown", "repeatIntoFalling", "firstPosition", "pFirstEver", "plan10b5", "isCEO", "isCFO", "isDirector", "isTenPct", "isOfficer", "ownD", "ownI", "featOk", "selfSold30", "selfSoldPrior", "ctxTrunc30", "commonLike", "spyAbove50", "tdAfterDecision"];
out.binary = {};
for (const f of B) { const v = prim.map((r) => r[f]); out.binary[f] = { n1: v.filter((x) => x === 1 || x === true).length, n0: v.filter((x) => x === 0 || x === false).length, nNull: v.filter((x) => x == null).length }; }
const cat = (f) => prim.reduce((m, r) => { const k = String(r[f]); m[k] = (m[k] || 0) + 1; return m; }, {});
out.categorical = { primaryRole: cat("primaryRole"), window: cat("window"), regime: cat("regime"), tier: cat("tier"), month: cat("month"), ownership: cat("ownership") };
// repeat-buy subset distributions
const rep = prim.filter((r) => r.pPriorCo >= 1);
out.repeatSameIssuer = { n: rep.length, avgDown1: rep.filter((r) => r.avgDown === 1).length, avgDownNull: rep.filter((r) => r.avgDown == null).length, chgSincePrevBuy: { p10: quantile(rep.map((r) => r.chgSincePrevBuy), 0.1), p25: quantile(rep.map((r) => r.chgSincePrevBuy), 0.25), median: quantile(rep.map((r) => r.chgSincePrevBuy), 0.5), p75: quantile(rep.map((r) => r.chgSincePrevBuy), 0.75), p90: quantile(rep.map((r) => r.chgSincePrevBuy), 0.9) },
  absChg: { p20: quantile(rep.map((r) => Math.abs(r.chgSincePrevBuy ?? NaN)), 0.2), p33: quantile(rep.map((r) => Math.abs(r.chgSincePrevBuy ?? NaN)), 1 / 3), median: quantile(rep.map((r) => Math.abs(r.chgSincePrevBuy ?? NaN)), 0.5) },
  daysSincePrevCo: { p25: quantile(rep.map((r) => r.pDaysSincePrevCo), 0.25), median: quantile(rep.map((r) => r.pDaysSincePrevCo), 0.5), p75: quantile(rep.map((r) => r.pDaysSincePrevCo), 0.75) } };
// sample of one heavy repeat buyer (ids + features only)
const heavy = [...byP.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 15).map(([p, xs]) => ({ person: p, n: xs.length, issuers: new Set(xs.map((r) => r.cik)).size, tickers: [...new Set(xs.map((r) => r.sym))].slice(0, 6), role: xs[0].primaryRole, first: xs[0].publishedAt.slice(0, 10), last: xs.at(-1).publishedAt.slice(0, 10) }));
out.heavyBuyers = heavy;
writeJson("explore.json", out);
checkpoint("01_explore", { primary: prim.length, persons: byP.size, personsGe2: out.counts.personsGe2 });
console.log(JSON.stringify({ counts: out.counts, repeatGaps: out.repeatGaps, repeatSameIssuer: out.repeatSameIssuer, categorical: out.categorical, binary: out.binary }, null, 1));
for (const f of F) { const d = out.dist[f]; console.log(f.padEnd(18), `n ${d.n} null ${d.nullShare} | p10 ${r4(d.p10)} p20 ${r4(d.p20)} p33 ${r4(d.p33)} med ${r4(d.median)} p67 ${r4(d.p67)} p80 ${r4(d.p80)} p90 ${r4(d.p90)}`); }
console.log(JSON.stringify(heavy));
