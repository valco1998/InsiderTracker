// deep2/audit/finalSummary.mjs — auditor, after the single holdout run: pooled out-of-sample evidence (confirmation +
// holdout) for F1/F2/F3, the power the holdout actually had, and forward sample sizes. Holdout rows are read from
// holdout-events.csv (written once by holdout.mjs); discovery/confirmation rows are recomputed with the auditor's own
// F1/F2 code (same as recompute.mjs) and execLib for F3. Writes audit-summary.json.
//   node scripts/research/deep2/audit/finalSummary.mjs        (holdout stays locked)
import fs from "node:fs";
import path from "node:path";
import * as L from "../lib2.mjs";
import { OUT, readOut, writeOut, readCsv, num, mean, median, sd, r4, clusterT, normInv, pT } from "./auditLib.mjs";

if (process.env.DEEP2_HOLDOUT) throw new Error("run with the holdout locked");
if (!fs.existsSync(path.join(OUT, "holdout.json"))) throw new Error("run holdout.mjs first");
const sym = (t) => String(t || "").trim().toUpperCase().replace(/-/g, ".");
const T3 = (e) => (e.isCeo || e.isCfo) && e.ownership === "D" && e.venue === "open_market" && e.filingValue >= 2.5e5;
const E = L.loadEvents(), bars = L.loadBars(), SPY = bars.get("SPY");
const DAYS = SPY.arr.map((b) => b.d), DIDX = new Map(DAYS.map((d, i) => [d, i]));
const stageA = JSON.parse(fs.readFileSync(path.join(L.DEEP1, "stageA.json"), "utf8"));
const SUSPECT = new Set(stageA.prices.suspectSymbols || []), COMPLETE = stageA.completeThrough;
const END = { discover: L.DISCOVER_END, confirm: L.HOLDOUT_START };
const firstAfter = (d) => { let lo = 0, hi = DAYS.length - 1, ans = DAYS.length; while (lo <= hi) { const m = (lo + hi) >> 1; if (DAYS[m] > d) { ans = m; hi = m - 1; } else lo = m + 1; } return ans; };
function ownX(e, N) { // identical to recompute.mjs ownTrade (traps on, tier x1)
  const s = bars.get(sym(e.ticker)); if (!s || SUSPECT.has(sym(e.ticker))) return null;
  let d = e.entryDate; if (d === e.publishedAt.slice(0, 10) && e.publishedAt.slice(11, 19) > "09:27:00") d = DAYS[firstAfter(d)];
  const i = DIDX.get(d); const xd = DAYS[i + N]; if (!xd || xd > COMPLETE) return null;
  const eb = s.arr[s.idx.get(d)], xb = s.arr[s.idx.get(xd)]; if (!eb || !xb || !(eb.v > 0) || !(xb.v > 0)) return null;
  const c = e.costBpsPerSide / 1e4; return { exitDate: xd, x: (xb.c * (1 - c)) / (eb.o * (1 + c)) - 1 - (SPY.arr[i + N].c / SPY.arr[i].o - 1) };
}
const rowsFor = (N, per) => E.filter((e) => T3(e) && L.periodOf(e) === per).map((e) => ({ e, t: ownX(e, N) })).filter(({ t }) => t && t.exitDate < END[per]).map(({ e, t }) => ({ issuer: e.issuerCik, ticker: e.ticker, x: t.x }));
const HC = readCsv(path.join(OUT, "holdout-events.csv"));
const hold = (k) => HC.filter((r) => r[`${k}_status`] === "ok").map((r) => ({ issuer: r.issuerCik, ticker: r.ticker, x: num(r[`${k}_excessNet_x1`]) }));
const holdF3 = HC.filter((r) => r.F3_usable === "1").map((r) => ({ issuer: r.issuerCik, ticker: r.ticker, x: num(r.F3_excessNet_25) }));
const cs = (rows) => { const s = L.companyStats(rows); const ct = clusterT(rows); return { n: s.n, issuers: s.issuers, mean: s.mean, median: s.median, issuerMedianOfMeans: s.issuerMedianOfMeans, t: s.t, p: s.p == null ? null : r4(s.p), pT_Gminus1: ct.t == null ? null : r4(pT(ct.t, ct.G - 1)), meanExTop5Issuers: s.meanExTop5Issuers, ci95: s.ci95 }; };

const F = {};
for (const [k, N] of [["F1", 3], ["F2", 5]]) {
  const d = rowsFor(N, "discover"), c = rowsFor(N, "confirm"), h = hold(k);
  const noTop = (rows) => { const top = [...rows].sort((a, b) => b.x - a.x)[0]; return { droppedEvent: top ? `${top.ticker} ${r4(top.x)}` : null, ...cs(rows.filter((r) => r !== top)) }; };
  F[k] = { discovery: cs(d), confirmation: cs(c), holdout: cs(h), outOfSample_confirmPlusHoldout: cs([...c, ...h]), outOfSample_withoutLargestWinner: noTop([...c, ...h]), allPeriods: cs([...d, ...c, ...h]) };
}
const ce = readOut("code-audit-evidence.json");
F.F3 = { discovery: ce.f3BuyableFilter.discover.buyableGe5k_25bps, confirmation: ce.f3BuyableFilter.confirm.buyableGe5k_25bps, holdout: cs(holdF3) };

// Power the holdout had to detect the discovery effect (two-sided alpha 0.10, as in the pre-declared check), and
// forward sample sizes at the claimed and at half the claimed effect (one-sided alpha 0.05, 80% power).
const rc = readOut("recompute.json");
const powerAt = (mu, s, de, n, zA) => { const se = (s * Math.sqrt(de)) / Math.sqrt(n); const z = mu / se - zA; return r4(0.5 * (1 + Math.sign(z) * (1 - Math.exp((-2 * z * z) / Math.PI)) ** 0.5)); }; // normal CDF approx
const ncdf = (z) => { const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = Math.exp((-z * z) / 2) / Math.sqrt(2 * Math.PI); const p = 1 - d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429)))); return z >= 0 ? p : 1 - p; };
const power = (mu, s, de, n, zA) => r4(ncdf(mu / ((s * Math.sqrt(de)) / Math.sqrt(n)) - zA));
const need = (mu, s, de, zA) => Math.ceil(((zA + normInv(0.8)) ** 2 * s * s * de) / (mu * mu));
const pw = rc.power.estimates;
const f1 = pw.find((p) => /F1 at its discovery/.test(p.label)), f2 = pw.find((p) => /F2 at its discovery/.test(p.label));
const h = readOut("holdout.json");
const f3rows = [...holdF3]; // F3 SD from discovery+confirmation is not stored per event; use the AH CSV of execution (25 bps net)
const ahCsv = readCsv(path.join(L.DEEP2, "execution", "events-trackA-afterHours-confirm.csv")).filter((r) => r.stratum === "S1_ceoCfoOM250k" && r.status_L1 === "ok" && num(r.ahBuyable15) >= 5000);
const f3sd = sd(ahCsv.map((r) => num(r.excessToOpen_L1)));
const rate = rc.power.eventRate.perMonth;
const f3rate = (() => { const n = ahCsv.length; const months = new Set(ahCsv.map((r) => r.publishedAt.slice(0, 7))).size; return r4(n / months); })();
const out = {
  generatedAt: new Date().toISOString(),
  pooled: F,
  holdoutPower: {
    F1: { claimedEffect: f1.effect, n: h.rules.F1.tier1.n, powerTwoSided10: power(f1.effect, f1.sdPerEvent, f1.designEffectClustering, h.rules.F1.tier1.n, normInv(0.95)) },
    F2: { claimedEffect: f2.effect, n: h.rules.F2.tier1.n, powerTwoSided10: power(f2.effect, f2.sdPerEvent, f2.designEffectClustering, h.rules.F2.tier1.n, normInv(0.95)) },
  },
  forwardSampleNeeded: {
    note: "one-sided alpha 0.05, 80% power, per-event SD and issuer-clustering design effect from discovery; months at the pre-holdout T3 rate (~15.4/month) or the F3-eligible rate",
    F1: { atClaimed: { effect: f1.effect, events: f1.nFor80pctPower_oneSided05, months: r4(f1.nFor80pctPower_oneSided05 / rate) }, atHalf: { effect: r4(f1.effect / 2), events: f1.nFor80pctPower_oneSided05_halfEffect, months: r4(f1.nFor80pctPower_oneSided05_halfEffect / rate) },
      atOutOfSampleMean: (() => { const mu = F.F1.outOfSample_confirmPlusHoldout.mean; return mu > 0 ? { effect: mu, events: need(mu, f1.sdPerEvent, f1.designEffectClustering, normInv(0.95)), months: r4(need(mu, f1.sdPerEvent, f1.designEffectClustering, normInv(0.95)) / rate) } : { effect: mu, events: "not detectable (non-positive)" }; })() },
    F2: { atClaimed: { effect: f2.effect, events: f2.nFor80pctPower_oneSided05, months: r4(f2.nFor80pctPower_oneSided05 / rate) } },
    F3: (() => { const mu = 0.003; const n = need(mu, f3sd, 1.1, normInv(0.95)); return { assumedEffect: mu, basis: "best F3-like discovery mean (+0.30%, unfiltered, 25 bps); F3 as frozen had +0.01%", sdPerEvent: r4(f3sd), events: n, eligibleEventsPerMonth: f3rate, months: r4(n / f3rate) }; })(),
  },
};
writeOut("audit-summary.json", out);
console.log(JSON.stringify(out, null, 1));
