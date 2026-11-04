// server/scripts/research/deep/features.mjs — point-in-time feature engineering for the deep study.
//
// Every feature is computable at the ENTRY DECISION: SEC filings accepted by T (the event's
// acceptance time) and daily bars strictly BEFORE the entry session (the last close a trader
// has before the next open). Nothing uses the entry bar or later.
import { rowBacktestRoles } from "../../../services/backtest/signals.js";
import { buildIdentities } from "../../../services/edgar/insiderInsights.js";
import { usdOf, entrySessionAfter, previousSession } from "../lib.mjs";

const DAY = 86_400_000;
const dnum = (d) => Math.floor(Date.parse(`${d}T00:00:00Z`) / DAY);
const stamp = (s) => String(s || "").replace(/\s*ET$/, "");
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const sd = (xs) => { if (xs.length < 3) return null; const m = mean(xs); return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1)); };
export const ROLE_RANK = ["CEO", "CFO", "COO", "CTO", "VP", "Other officer", "Director", "10% Owner", "Other"];
export const primaryRole = (roles) => ROLE_RANK.find((r) => roles.includes(r)) || "Other";

// ---------------- Insider behaviour (one event per Form 4 filing with code-P purchases) ----------------
export function buildBehaviorEvents({ itemsByIssuer, acc }) {
  const events = [];
  for (const [cik, items] of itemsByIssuer) {
    const filings = new Map();
    for (const x of items) if (!x.until) { const a = x.r.accessionNo; (filings.get(a) || filings.set(a, []).get(a)).push(x); }
    for (const [accNo, xs] of filings) {
      const T = stamp(acc.get(accNo)) || xs[0].first;
      const valued = xs.filter((x) => usdOf(x.r) != null);
      if (!valued.length) continue;
      const L = [...valued].sort((a, b) => usdOf(b.r) - usdOf(a.r))[0];
      const known = items.filter((x) => x.from <= T && (!x.until || x.until > T) && usdOf(x.r) != null);
      const ids = buildIdentities(known.map((x) => x.r));
      const me = ids.personOf(L.r);
      const tDay = dnum(L.r.transactionDate);
      const win = (days) => known.filter((x) => dnum(x.r.transactionDate) >= tDay - days && x.r.transactionDate <= L.r.transactionDate);
      const w30 = win(30), w90 = win(90);
      const prior30 = w30.filter((x) => x.r.accessionNo !== accNo);
      const history = known.filter((x) => x.r.accessionNo !== accNo && x.r.transactionDate <= L.r.transactionDate);
      const buyers30 = new Set(w30.map((x) => ids.personOf(x.r)).filter(Boolean));
      const priorOthers30 = new Set(prior30.map((x) => ids.personOf(x.r)).filter((p) => p && p !== me));
      const mine = history.filter((x) => ids.personOf(x.r) === me).sort((a, b) => a.r.transactionDate.localeCompare(b.r.transactionDate) || a.first.localeCompare(b.first));
      const mine90 = mine.filter((x) => dnum(x.r.transactionDate) >= tDay - 90);
      const rolesL = rowBacktestRoles(L.r);
      const filingValue = xs.reduce((a, x) => a + (usdOf(x.r) || 0), 0);
      const filingShares = xs.reduce((a, x) => a + (x.r.shares || 0), 0);
      const vwapFiling = filingShares > 0 ? filingValue / filingShares : L.r.price;
      const v30 = w30.reduce((a, x) => a + usdOf(x.r), 0);
      const priorV30 = prior30.reduce((a, x) => a + usdOf(x.r), 0);
      const maxPrior30 = prior30.reduce((a, x) => Math.max(a, usdOf(x.r)), 0);
      // Buying frequency: issuer purchases in the 30 days before vs the 31–180 days before (per 30 days).
      const before = (lo, hi) => history.filter((x) => { const d = tDay - dnum(x.r.transactionDate); return d >= lo && d <= hi; }).length;
      const recent30 = before(0, 30), base150 = before(31, 180) / 5;
      // Same-insider sequence (this filing's L last): size and price trend.
      const seqV = [...mine90.map((x) => usdOf(x.r)), usdOf(L.r)], seqP = [...mine90.map((x) => x.r.price), L.r.price].filter((p) => p > 0);
      const mono = (arr, dir) => arr.length >= 3 && arr.every((v, i) => i === 0 || (dir > 0 ? v > arr[i - 1] : v < arr[i - 1]));
      // Prices paid by different buyers in the window: dispersion (similar prices?).
      const buyerPrices = [...new Map(w30.filter((x) => x.r.price > 0).map((x) => [ids.personOf(x.r), x.r.price])).values()];
      const priceCv = buyerPrices.length >= 2 ? sd(buyerPrices) / mean(buyerPrices) : null;
      // Who bought before L in the window, by role.
      const priorRoles = new Set(prior30.flatMap((x) => rowBacktestRoles(x.r)));
      const priorHasCeo = priorRoles.has("CEO"), priorHasCfo = priorRoles.has("CFO"), priorHasDir = priorRoles.has("Director");
      events.push({
        id: accNo, issuerCik: cik, ticker: L.r.ticker || null, issuerName: L.r.issuerName || null, accessionNo: accNo, formType: L.r.formType || "4",
        publishedAt: T, tradeDate: L.r.transactionDate, filingDelayDays: Math.max(0, dnum(T.slice(0, 10)) - tDay),
        insider: L.r.owners?.[0]?.name || L.r.insiderName || null, role: primaryRole(rolesL), roles: rolesL,
        isCeo: rolesL.includes("CEO"), isCfo: rolesL.includes("CFO"), isOfficer: rolesL.some((r) => ["CEO", "CFO", "COO", "CTO", "VP", "Other officer"].includes(r)),
        isDirectorOnly: rolesL.includes("Director") && !rolesL.some((r) => ["CEO", "CFO", "COO", "CTO", "VP", "Other officer"].includes(r)),
        isTenPct: rolesL.includes("10% Owner") && !rolesL.some((r) => ["CEO", "CFO", "COO", "CTO", "VP", "Other officer", "Director"].includes(r)),
        ownership: L.r.ownership || null, venue: L.r.purchaseContext || "unspecified", is10b5_1: !!L.r.is10b5_1, dedupe: L.r.dedupe?.status || null,
        price: L.r.price ?? null, vwapFiling, filingValue, rowsInFiling: xs.length, largestTxUsd: usdOf(L.r),
        buyers30: buyers30.size, priorOtherBuyers30: priorOthers30.size, priorTx30: prior30.length, value30: v30, priorValue30: priorV30,
        ratioToMaxPrior30: maxPrior30 > 0 ? usdOf(L.r) / maxPrior30 : null, shareOfWindow30: v30 > 0 ? filingValue / v30 : null,
        buyers90: new Set(w90.map((x) => ids.personOf(x.r)).filter(Boolean)).size,
        sameInsiderPrior90: mine90.length, sameInsiderPriorAll: mine.length, firstBuyInHistory: mine.length === 0,
        sizesIncreasing: mono(seqV, +1), sizesDecreasing: mono(seqV, -1), pricesFalling: mono(seqP, -1), pricesRising: mono(seqP, +1),
        sameInsiderSizeRatio: mine90.length ? usdOf(L.r) / Math.max(...mine90.map((x) => usdOf(x.r))) : null,
        buyerPriceCv: priceCv, ceoAfterOthers: rolesL.includes("CEO") && prior30.length > 0 && !priorHasCeo,
        ceoOrCfoAfterDirectors: (rolesL.includes("CEO") || rolesL.includes("CFO")) && priorHasDir, directorsAfterCeoCfo: !rolesL.includes("CEO") && !rolesL.includes("CFO") && (priorHasCeo || priorHasCfo),
        buyingSurge: base150 > 0 ? recent30 / base150 : recent30 > 0 ? null : 0, issuerPurchases30: recent30, issuerPurchasesPrev150: before(31, 180),
        daysSinceIssuerLastBuy: history.length ? tDay - Math.max(...history.map((x) => dnum(x.r.transactionDate))) : null,
      });
    }
  }
  return events.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.id.localeCompare(b.id));
}

// ---------------- Chart features (bars strictly before the entry session) ----------------
// series: { dates: [...], o,h,l,c,v: Float64Array-like arrays, idx: Map(date → i) }
export function toSeries(barsMap) {
  if (!barsMap) return null;
  const dates = [...barsMap.keys()].sort();
  const pick = (k) => dates.map((d) => barsMap.get(d)[k]);
  return { dates, o: pick("o"), h: pick("h"), l: pick("l"), c: pick("c"), v: pick("v"), idx: new Map(dates.map((d, i) => [d, i])) };
}
// Index of the last bar strictly before `date` (binary search) or -1.
export function lastIdxBefore(s, date) {
  let lo = 0, hi = s.dates.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (s.dates[m] < date) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
}
const slice = (arr, i, n) => arr.slice(Math.max(0, i - n + 1), i + 1);
const logret = (c, i, n) => { const xs = []; for (let k = Math.max(1, i - n + 1); k <= i; k++) if (c[k] > 0 && c[k - 1] > 0) xs.push(Math.log(c[k] / c[k - 1])); return xs; };
export function chartFeatures(e, s, spy) {
  const ent = entrySessionAfter(e.publishedAt);
  const i = lastIdxBefore(s, ent); // last close known before the entry open
  if (i < 25) return { chartStatus: i < 0 ? "no_history" : "short_history" };
  const c = s.c, last = c[i];
  const ret = (n) => (i - n >= 0 && c[i - n] > 0 ? last / c[i - n] - 1 : null);
  const hi60 = Math.max(...slice(s.h, i, 60)), lo60 = Math.min(...slice(s.l, i, 60));
  const hi20prev = i >= 21 ? Math.max(...s.h.slice(Math.max(0, i - 60), i)) : null;
  const sma = (n) => (i + 1 >= n ? mean(slice(c, i, n)) : null);
  const vol20 = sd(logret(c, i, 20)), vol60 = sd(logret(c, i, 60)), vol10 = sd(logret(c, i, 10));
  const av = (n, end = i) => mean(slice(s.v, end, n));
  const dv20 = mean(slice(c, i, 20).map((x, k) => x * slice(s.v, i, 20)[k]));
  // Trade-date close and the move between the insider's trade and the decision (already public?).
  const ti = s.idx.get(e.tradeDate) ?? lastIdxBefore(s, e.tradeDate);
  const tradeClose = ti >= 0 && ti <= i ? c[ti] : null;
  // Volume between the trade date and the decision vs the 60-day average before the trade.
  const pre = ti > 0 ? mean(slice(s.v, ti - 1, 60)) : null;
  const postTradeVol = ti >= 0 && ti <= i ? mean(s.v.slice(ti, i + 1)) : null;
  // Gaps in the last 20 sessions (open vs prior close).
  let gaps = 0; for (let k = Math.max(1, i - 19); k <= i; k++) if (c[k - 1] > 0 && Math.abs(s.o[k] / c[k - 1] - 1) > 0.1) gaps++;
  const range20 = Math.max(...slice(s.h, i, 20)) / Math.min(...slice(s.l, i, 20)) - 1;
  // Relative strength vs SPY (same dates).
  const si = spy ? lastIdxBefore(spy, ent) : -1;
  const spyRet = (n) => (si - n >= 0 ? spy.c[si] / spy.c[si - n] - 1 : null);
  const rs = (n) => (ret(n) != null && spyRet(n) != null ? ret(n) - spyRet(n) : null);
  const spySma50 = si >= 49 ? mean(slice(spy.c, si, 50)) : null;
  return {
    chartStatus: "ok", decisionClose: last, decisionDate: s.dates[i],
    ret1: ret(1), ret5: ret(5), ret20: ret(20), ret60: ret(60), rs20: rs(20), rs60: rs(60),
    dd60: last / hi60 - 1, up60: last / lo60 - 1, nearLow60: last <= lo60 * 1.05, atHigh60: hi20prev != null && last >= hi20prev,
    smaRatio20: sma(20) ? last / sma(20) - 1 : null, smaRatio50: sma(50) ? last / sma(50) - 1 : null, above50: sma(50) ? last > sma(50) : null,
    vol20, volRatio10_60: vol10 && vol60 ? vol10 / vol60 : null, range20, consolidation: range20 != null && vol20 != null ? range20 < 0.15 : null,
    volumeSpike5_60: av(5) && av(60) ? av(5) / av(60) : null, dollarVol20: dv20, priceLevel: last, gaps20: gaps,
    postTradeMove: tradeClose ? last / tradeClose - 1 : null, postTradeVolRatio: pre && postTradeVol ? postTradeVol / pre : null,
    insiderPremium: e.vwapFiling > 0 ? last / e.vwapFiling - 1 : null, // stock vs the insider's price at decision time
    priceVsTradePrevClose: (() => { const pi = ti > 0 ? ti - 1 : -1; return pi >= 0 && e.price ? e.price / c[pi] - 1 : null; })(),
    spyRet20: spyRet(20), spyAbove50: spySma50 ? spy.c[si] > spySma50 : null,
  };
}
export { previousSession };
