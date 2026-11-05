// deep4/behavior/stratLib.mjs — exact strategy rules (phase 6) and their evaluation with panel/strategyLib.mjs (phase 7).
// Used unchanged by the design run (08_strategies.mjs) and the single confirmation run (10_confirm.mjs).
//
// Common execution rules (all strategies, baselines and controls):
//   entry   = official OPEN of the first MOO-eligible session after decision time t = acceptance + 60 s (panel entryDate);
//   exit    = official CLOSE of the last session <= entry date + 30 calendar days (strategyLib exits.calendar(30));
//   costs   = liquidity tier per side (5/15/35/75/100 bps from dv20 before entry) x1; sensitivity x0..x3;
//   sizing  = equal slots (20), at most 1 open position per issuer (per-company cap 1); later signals skipped when full;
//   metrics = strategyLib.strategyMetrics: independent trades (overlapping same-issuer trades = one bet), net, vs SPY, PF,
//             portfolio max DD, exposure, time in market, months, issuers, cost sensitivity, bootstrap CI, vs matched controls.
import * as SL from "../panel/strategyLib.mjs";
import { mean, median, r4, r6, fin, group, V } from "./common.mjs";

export const EXIT = SL.exits.calendar(30);
export const SLOTS = 20;
export const PER_COMPANY_CAP = 1;
export const isPrimaryPurchase = (r) => r.primary === 1 && r.isPrimary === 1;

// Run one rule: rows = segment rows (panel), select(e) → boolean; returns trades, control trades, metrics, nearest-control strategy.
export function runRule({ M, rows, controls, select, label, costMult = 1, exit = EXIT, B = 2000 }) {
  const evs = rows.filter((r) => isPrimaryPurchase(r) && select(r));
  const { trades, skipped } = SL.tradesForEvents(M, evs, exit, { costMult });
  const ctl = SL.controlTradesFor(M, evs, controls, exit, { costMult });
  const metrics = SL.strategyMetrics(trades, { controlTrades: ctl, slots: SLOTS, perCompanyCap: PER_COMPANY_CAP, market: M, B, label });
  // no-insider control strategy: the NEAREST matched control of each event (smallest matching distance), same rule
  const nearest = [];
  for (const e of evs) { const cs = controls.of(e.key).filter((c) => c.sym && c.entryDate).sort((a, b) => a.dist - b.dist); const pick = cs[0]; if (!pick) continue;
    const ts = ctl.get(e.key) || []; const t = ts.find((x) => x.key === pick.ctlKey); if (t) nearest.push({ ...t, issuer: `${t.sym}`, ticker: t.sym, segment: e.segment, month: t.entryDate.slice(0, 7), publishedAt: e.publishedAt, person: null, costMult, costPerSide: (t.costBps * costMult) / 1e4, eventKey: e.key }); }
  const ctlMetrics = nearest.length ? SL.strategyMetrics(nearest, { slots: SLOTS, perCompanyCap: PER_COMPANY_CAP, market: M, B, label: `${label} — nearest matched control (no insider)` }) : { n: 0 };
  return { label, events: evs.length, skipped, trades, ctl, metrics, ctlMetrics };
}
// compact headline of strategyMetrics
export function headline(m) {
  if (!m || !m.n) return { n: 0 };
  return { n: m.n, nAll: m.nAll, issuers: m.issuers, months: m.months, winRateNet: m.winRateNet, winRateVsSpy: m.winRateVsSpy, meanNet: m.meanNet, medianNet: m.medianNet, meanXsNet: m.meanXsNet, medianXsNet: m.medianXsNet,
    meanSpy: m.meanSpy, profitFactorNet: m.profitFactorNet, profitFactorVsSpy: m.profitFactorVsSpy, t: m.companyStats?.t, p: m.companyStats?.p, ci95: m.companyStats?.ci95, exTop5: m.companyStats?.meanExTop5Issuers,
    worstTrade: m.worstTrade, vsControls: m.vsControls ? { n: m.vsControls.n, diff: m.vsControls.diff?.mean, t: m.vsControls.diff?.t, p: m.vsControls.diff?.p, controlMean: m.vsControls.controlMean } : null,
    costs: m.costSensitivity?.map((c) => `${c.mult}x:${r4(c.meanXsNet)}`).join(" "), pfMaxDD: m.portfolio?.cash?.maxDrawdown ?? m.portfolio?.simple?.maxDD ?? null, pfReturn: m.portfolio?.cash?.totalReturn ?? m.portfolio?.simple?.totalReturn ?? null,
    pfSpy: m.portfolio?.cash?.spy?.totalReturn ?? null, pfExcessVsSpy: m.portfolio?.cash?.excessVsSpy ?? null, pfWorstMonth: m.portfolio?.cash?.worstMonth ?? null, exposure: m.portfolio?.exposureMean, timeInMarket: m.portfolio?.timeInMarket, monthsPositive: m.monthTable?.filter((x) => x.mean > 0).length, monthTable: m.monthTable?.map((x) => `${x.month}:${r4(x.mean)}(${x.n})`).join(" ") };
}
// winners / losers with context and path (>= 10 each)
export function winnersLosersDetailed(trades, rowsByKey, k = 12) {
  const s = [...trades].sort((a, b) => b.xsNet - a.xsNet);
  const pick = (t) => { const r = rowsByKey.get(t.key) || {}; return { ticker: t.sym, insider: r.ownerName, person: r.person, role: r.primaryRole, published: r.publishedAt, tradeDate: r.tradeDate, entryDate: t.entryDate, exitDate: t.exitDate,
    usd: r.usd, tier: r.tier, context: { r20: r4(r.r20), r60: r4(r.r60), dLo60: r4(r.dLo60), dHi60: r4(r.dHi60), bo20: r.bo20, vol20: r4(r.vol20), pPriorCo: r.pPriorCo, oBuyers30Om: r.oBuyers30Om },
    path: { gapEntry: r4(r.gapEntry), xs5: r4(r.B_xsNet5), xs10: r4(r.B_xsNet10), xs20: r4(r.B_xsNet20), mfe30: r4(r.B_mfe30), mae30: r4(r.B_mae30), hit10_30: r.B_hit10_30 }, net: r4(t.net), xsNet: r4(t.xsNet) }; };
  return { winners: s.slice(0, k).map(pick), losers: s.slice(-k).reverse().map(pick) };
}
