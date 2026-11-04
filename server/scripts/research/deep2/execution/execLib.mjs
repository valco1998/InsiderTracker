// server/scripts/research/deep2/execution/execLib.mjs
//
// Deep study 2 — EXECUTION FRAMEWORK (agent "execution"). Research only.
//   • Cache only: never fetches anything (no Alpaca / SEC / network). Inputs are lib2.loadEvents(),
//     lib2.loadBars() and the deep-1 after-hours cache (ah-trades-cache.json, ah-raw-daily.json).
//   • Holdout-safe: every event comes from lib2.loadEvents() (holdout hidden); the after-hours cache is
//     joined on those ids, so filings published on/after 2026-09-01 are never read beyond the JSON parse.
//   • Fills allowed by BRIEF.md and nothing else: the official OPEN / CLOSE of the split-adjusted daily
//     bars (auction prints → MOO / MOC orders) and cached SIP after-hours trades. No intraday paths,
//     no stops / targets / high-low fills.
//
// Main entry point — accepts ANY event filter:
//   evaluate(events, { track, entry, exitSessions, delaySessions, costModel, costMultiplier,
//                      capacityPct, minPositionUsd, latencyMinutes, period, excludeSuspects,
//                      filter, slots, accountSize, onePerIssuer })
//     → { opts, rows, ok, stats, statusCounts, portfolio? }
//   entry:  "nextOpen"     open of the first session whose 09:30 ET open is ≥ acceptance + 60 s (stage-C entry)
//           "sameDayClose" close of the publication session, only for filings published on a session day
//                          before close − 30 min (15:30 ET; 12:30 on early-close days): observe, then MOC
//           "mooMoc"       Track A: open → close of the stage-C entry session (exitSessions ignored)
//           "ah"           Track A: first eligible after-hours SIP trade ≥ acceptance + latencyMinutes
//                          (cached deep-1 sample only); exitSessions = "nextOpen" | "nextClose"
//   delaySessions: shift the entry session by k sessions (robustness: one-session delay = 1)
//   exitSessions:  Track B N → exit at the CLOSE of the N-th session after the entry session
//   costModel:     "tier" (stage-C costBpsPerSide by 20-day dollar volume) | "spread" (half-spread by
//                  AS-TRADED price level + small-order impact add-on by dollar volume) | number (bps/side)
//   costMultiplier: stress multiplier on the per-side cost (×1, ×2, ×3)
//   capacityPct:   max position = capacityPct × ADV20 (20 SESSIONS strictly before the decision day,
//                  missing bars counted as zero volume); minPositionUsd keeps only events supporting it
//   period:        "discover" | "confirm" | null (both) — embargo by exit date as in lib2.usable
//   slots:         if set, also runs simulatePortfolio2 (cash-accounted, one position per issuer)
//
// Net return per event (same convention as stage-C `net`): net = exit·(1 − cOut) / (entry·(1 + cIn)) − 1;
// excess = gross − SPY over the same fills; excessNet = net − SPY (SPY is never charged costs).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import * as L from "../lib2.mjs";
import { sessionAfter, nextSession, previousSession, isSession } from "../../lib.mjs";
import { closeTime, isEarlyClose } from "../../../../services/backtest/sessionCalendar.js";
import { etToUtcIso } from "../../../../services/backtest/publicationStart.js";

export { L, sessionAfter, nextSession, previousSession, isSession, closeTime, isEarlyClose };
export const AGENT = "execution";
export const OUT = path.join(L.DEEP2, "execution");
fs.mkdirSync(OUT, { recursive: true });
export const HORIZONS_B = [2, 3, 4, 5];
export const r4 = L.r4;
export const r6 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1e6) / 1e6);
export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
export const median = L.median;
const DAY = 86_400_000;

// ---------------------------------------------------------------------------------------------
// Baseline trigger sets (pre-registered by the lead's brief; definitions match deep-1 exactly).
// ---------------------------------------------------------------------------------------------
export const TRIGGERS = {
  T1_all: { label: "All purchase filings (priced)", f: () => true },
  T2_openMarket: { label: "Open market stated (venue = open_market)", f: (e) => e.venue === "open_market" },
  T3_ceoCfoOM250k: { label: "CEO/CFO personal (D) open-market ≥ $250k", f: (e) => (e.isCeo || e.isCfo) && e.ownership === "D" && e.venue === "open_market" && e.filingValue >= 2.5e5 },
  T4_value1M: { label: "Filing value ≥ $1M", f: (e) => e.filingValue >= 1e6 },
  T5_buyers2in30: { label: "≥ 2 distinct buyers in 30 days (incl. this filing)", f: (e) => e.buyers30 >= 2 },
};

// ---------------------------------------------------------------------------------------------
// Market data (cache only).
// ---------------------------------------------------------------------------------------------
export const symOf = (t) => String(t || "").trim().toUpperCase().replace(/-/g, ".");
let _bars = null;
export const bars = () => (_bars ||= L.loadBars());
export const series = (sym) => bars().get(sym) || null;
export function bar(s, d) { if (!s) return null; const i = s.idx.get(d); return i == null ? null : s.arr[i]; }
const STAGE_A = JSON.parse(fs.readFileSync(path.join(L.DEEP1, "stageA.json"), "utf8"));
export const COMPLETE_THROUGH = STAGE_A.completeThrough; // last complete session in the bar cache
export const SUSPECT_SYMBOLS = new Set(STAGE_A.prices.suspectSymbols || []);

// Average daily DOLLAR volume over the 20 SESSIONS strictly before `day` (calendar sessions; a missing
// bar = no trade = 0). Dollar volume (close × volume) is invariant to split adjustment.
const _advMemo = new WeakMap(); // series object → Map(`${day}|${n}` → value)
export function adv20Sessions(s, day, n = 20) {
  if (!s) return null;
  let m = _advMemo.get(s); if (!m) _advMemo.set(s, (m = new Map()));
  const key = `${day}|${n}`;
  if (m.has(key)) return m.get(key);
  let d = previousSession(day), sum = 0, seen = 0;
  for (let k = 0; k < n; k++) { const b = bar(s, d); if (b) { sum += b.c * b.v; seen++; } d = previousSession(d); }
  const v = seen ? sum / n : null;
  m.set(key, v);
  return v;
}

// Split-adjusted bars are in TODAY's share terms. A later reverse split inflates the historical
// adjusted price (e.g. $0.50 traded → "$5.00" adjusted after a 1:10). Price-LEVEL rules (spread
// buckets, "sub-$5") must use the AS-TRADED level. We infer the adjustment factor from the insider's
// reported price (as traded on the trade date): f = adjusted close on the trade date ÷ reported price.
// f within [0.55, 1.8] → no split assumed (premium / discount noise); outside → split inferred.
const _afMemo = new Map();
export function adjFactor(e) {
  if (_afMemo.has(e.id)) return _afMemo.get(e.id);
  const s = series(symOf(e.ticker));
  let v;
  if (!s || !(e.price > 0)) v = { f: 1, inferred: false, ratio: null };
  else {
    let i = s.idx.get(e.tradeDate); if (i == null) i = L.idxBefore(s, e.tradeDate);
    if (i < 0) v = { f: 1, inferred: false, ratio: null };
    else { const ratio = s.arr[i].c / e.price; v = ratio > 1.8 || ratio < 0.55 ? { f: ratio, inferred: true, ratio } : { f: 1, inferred: false, ratio }; }
  }
  _afMemo.set(e.id, v);
  return v;
}

// ---------------------------------------------------------------------------------------------
// Cost models (per side, as a fraction).
// ---------------------------------------------------------------------------------------------
// Explicit half-spread model by AS-TRADED price level (assumption, documented in findings.md):
// typical quoted spreads of US-listed stocks with a $0.01 tick (≥ $1) and sub-penny ticks (< $1).
export const HALF_SPREAD_BPS = [[50, 3], [20, 6], [10, 12], [5, 25], [2, 60], [1, 120], [0, 200]];
// Small-order impact add-on by 20-session dollar volume (position ≤ 1% of ADV20).
export const IMPACT_ADDON_BPS = [[50e6, 0], [5e6, 3], [1e6, 10], [0, 25]];
export function halfSpreadBps(price) { for (const [k, b] of HALF_SPREAD_BPS) if (price >= k) return b; return HALF_SPREAD_BPS.at(-1)[1]; }
export function impactAddonBps(adv) { if (!(adv > 0)) return IMPACT_ADDON_BPS.at(-1)[1]; for (const [k, b] of IMPACT_ADDON_BPS) if (adv >= k) return b; return IMPACT_ADDON_BPS.at(-1)[1]; }
export function sideCost(model, { e, asTradedPrice, adv, mult = 1 }) {
  if (typeof model === "number") return (model * mult) / 1e4;
  if (model === "tier") return (e.costBpsPerSide * mult) / 1e4;
  if (model === "spread") return ((halfSpreadBps(asTradedPrice) + impactAddonBps(adv)) * mult) / 1e4;
  throw new Error(`execLib: unknown cost model ${model}`);
}
export const netOf = (entry, exit, cIn, cOut) => (exit * (1 - cOut)) / (entry * (1 + cIn)) - 1;

// Abdi–Ranaldo (2017) close-high-low effective-spread estimator over the `n` sessions strictly
// before `day` (cross-check of the spread table only; never used to select events).
export function abdiRanaldoSpread(s, day, n = 60) {
  if (!s) return null;
  const i = L.idxBefore(s, day); if (i < n) return null;
  const a = s.arr; let sum = 0, k = 0;
  for (let j = i - n + 1; j < i; j++) {
    const b0 = a[j], b1 = a[j + 1];
    if (!(b0.h > 0 && b0.l > 0 && b0.c > 0 && b1.h > 0 && b1.l > 0)) continue;
    const c = Math.log(b0.c), eta0 = (Math.log(b0.h) + Math.log(b0.l)) / 2, eta1 = (Math.log(b1.h) + Math.log(b1.l)) / 2;
    sum += (c - eta0) * (c - eta1); k++;
  }
  if (k < n / 2) return null;
  return Math.sqrt(Math.max(0, (4 * sum) / k)); // full spread (fraction)
}

// ---------------------------------------------------------------------------------------------
// Timing helpers.
// ---------------------------------------------------------------------------------------------
export const etMs = (d, t) => Date.parse(etToUtcIso(`${d} ${t} ET`));
export const acceptanceMs = (e) => Date.parse(etToUtcIso(`${e.publishedAt} ET`));
const minus30 = (t) => { const [h, m, s] = t.split(":").map(Number); const x = h * 60 + m - 30; return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}`; };
export const mocCutoff = (day) => minus30(closeTime(day)); // observe-then-MOC: published before close − 30 min
// Where in the trading day the filing was published (ET).
export function pubBucket(e) {
  const d = e.publishedAt.slice(0, 10), t = e.publishedAt.slice(11, 19);
  if (!isSession(d)) return "nonSessionDay";
  if (t < "04:00:00") return "overnight_00_04";
  if (t < "09:30:00") return "premarket_04_0930";
  if (t < closeTime(d)) return "regular_0930_close";
  if (t < "20:00:00") return "afterClose_close_20";
  return "overnight_20_24";
}

// ---------------------------------------------------------------------------------------------
// Entries and exits on daily auction prints.
// ---------------------------------------------------------------------------------------------
// mooCutoff (e.g. "09:28:00", the Nasdaq opening-cross MOO cut-off): a same-day open entry for a
// pre-market filing is only achievable if acceptance + 60 s is before the cut-off; otherwise the
// first achievable auction is the NEXT session's open. null = stage-C rule (open ≥ acceptance + 60 s).
export function entryOf(e, { entry = "nextOpen", delaySessions = 0, mooCutoff = null } = {}) {
  const s = series(symOf(e.ticker)), spy = series("SPY");
  if (!s) return { status: "no_bars" };
  const pubDay = e.publishedAt.slice(0, 10), pubTime = e.publishedAt.slice(11, 19);
  if (entry === "nextOpen" || entry === "mooMoc") {
    let d = e.entryDate;
    if (mooCutoff && d === pubDay && acceptanceMs(e) + 60_000 > etMs(pubDay, mooCutoff)) d = nextSession(pubDay);
    for (let k = 0; k < delaySessions; k++) d = nextSession(d);
    if (d > COMPLETE_THROUGH) return { status: "pending", entryDate: d };
    const b = bar(s, d), sb = bar(spy, d);
    if (!b || !sb || !(b.o > 0)) return { status: "no_entry_bar", entryDate: d };
    return { status: "ok", entryDate: d, when: "open", entryPrice: b.o, spyEntry: sb.o, entryMs: etMs(d, "09:30:00"), adv20: adv20Sessions(s, d), entryBar: b };
  }
  if (entry === "sameDayClose") {
    if (!isSession(pubDay)) return { status: "not_session_day" };
    if (!(pubTime < mocCutoff(pubDay))) return { status: "after_moc_cutoff" };
    let d = pubDay; for (let k = 0; k < delaySessions; k++) d = nextSession(d);
    const b = bar(s, d), sb = bar(spy, d);
    if (!b || !sb || !(b.c > 0)) return { status: "no_entry_bar", entryDate: d };
    return { status: "ok", entryDate: d, when: "close", entryPrice: b.c, spyEntry: sb.c, entryMs: etMs(d, closeTime(d)), adv20: adv20Sessions(s, d), entryBar: b };
  }
  throw new Error(`execLib: entryOf does not handle entry=${entry}`);
}
export function exitAtClose(s, spy, entryDate, N) {
  const d = N === 0 ? entryDate : sessionAfter(entryDate, N);
  if (d > COMPLETE_THROUGH) return { status: "pending", exitDate: d };
  const b = bar(s, d), sb = bar(spy, d);
  if (!b || !sb || !(b.c > 0)) return { status: "no_exit_bar", exitDate: d };
  return { status: "ok", exitDate: d, exitPrice: b.c, spyExit: sb.c, exitBar: b };
}

// ---------------------------------------------------------------------------------------------
// After-hours (deep-1 cached SIP trades: eligible, non-odd-lot prints from acceptance + 60 s to 20:00 ET).
// Raw (as-traded) trade prices are put on the split-adjusted basis with the publication-day factor
// rawClose ÷ adjustedClose (exactly as afterHoursStudy.mjs does).
// ---------------------------------------------------------------------------------------------
let _ah = null;
export function loadAh() {
  if (_ah) return _ah;
  const pre = new Set(L.loadEvents().map((e) => e.id)); // lib2 hides the holdout → only pre-holdout ids survive
  const cache = JSON.parse(fs.readFileSync(path.join(L.DEEP1, "ah-trades-cache.json"), "utf8"));
  const trades = new Map();
  for (const [id, c] of Object.entries(cache)) {
    if (!pre.has(id)) continue; // filings published on/after 2026-09-01 are ignored here
    if (c.error) { trades.set(id, { error: c.error }); continue; }
    trades.set(id, { startMs: Date.parse(c.startIso), endMs: Date.parse(c.endIso), truncated: !!c.truncated, trades: c.trades.map(([t, p, s]) => [Date.parse(t), p, s]) });
  }
  const rawJ = JSON.parse(fs.readFileSync(path.join(L.DEEP1, "ah-raw-daily.json"), "utf8"));
  const raw = new Map(Object.entries(rawJ).map(([k, v]) => [k, new Map(v)]));
  _ah = { trades, raw };
  return _ah;
}
// Deep-1 sampling strata (S1 is a census of the after-close pool; S2/S3 are fixed-seed random samples).
export const ahStratum = (e) => ((e.isCeo || e.isCfo) && e.ownership === "D" && e.venue === "open_market" && e.filingValue >= 2.5e5 ? "S1_ceoCfoOM250k" : e.venue === "open_market" ? "S2_otherOM" : "S3_notOM");
export const inAhPool = (e) => !!e.ticker && isSession(e.publishedAt.slice(0, 10)) && e.publishedAt.slice(11) >= "16:00:00" && e.publishedAt.slice(11) < "19:55:00";

export function ahEntry(e, latencyMinutes = 1) {
  const A = loadAh().trades.get(e.id);
  if (!A) return { status: "not_in_ah_sample" };
  if (A.error) return { status: "fetch_error" };
  const acc = acceptanceMs(e), target = acc + latencyMinutes * 60_000;
  if (target >= A.endMs) return { status: "window_closed" };
  const tr = A.trades;
  let k = -1; for (let i = 0; i < tr.length; i++) if (tr[i][0] >= target) { k = i; break; }
  if (k < 0) return { status: A.truncated ? "censored_truncated" : "no_trade" };
  return { status: "ok", entryMs: tr[k][0], rawPrice: tr[k][1], tradeShares: tr[k][2], minutesAfterAcceptance: (tr[k][0] - acc) / 60_000 };
}
// Dollar volume traded in [acceptance + 60 s, acceptance + 60 s + minutes); lowerBound if truncated before the window end.
export function ahWindowDollars(e, minutes) {
  const A = loadAh().trades.get(e.id);
  if (!A || A.error) return null;
  const from = acceptanceMs(e) + 60_000, to = Math.min(from + minutes * 60_000, A.endMs);
  let usd = 0; for (const [t, p, s] of A.trades) if (t >= from && t < to) usd += p * s;
  const lastMs = A.trades.length ? A.trades.at(-1)[0] : null;
  return { usd, lowerBound: A.truncated && lastMs != null && lastMs < to, windowClosedEarly: from + minutes * 60_000 > A.endMs };
}
export function ahDaily(e) {
  const sym = symOf(e.ticker), s = series(sym), spy = series("SPY"), rb = loadAh().raw.get(sym);
  const pubDay = e.publishedAt.slice(0, 10), next = nextSession(pubDay);
  const bPub = bar(s, pubDay), rPub = rb?.get(pubDay), bNext = bar(s, next), sPub = bar(spy, pubDay), sNext = bar(spy, next);
  if (!bPub || !rPub || !bNext || !sPub || !sNext || !(rPub.c > 0) || !(bPub.c > 0)) return { status: "no_daily_bars" };
  const factor = rPub.c / bPub.c; // split-adjusted → raw (publication-day share terms)
  return { status: "ok", factor, pubDay, nextDate: next, closePubRaw: rPub.c, nextOpenAdj: bNext.o, nextCloseAdj: bNext.c, closePubAdj: bPub.c, spyClosePub: sPub.c, spyNextOpen: sNext.o, spyNextClose: sNext.c, nextBar: bNext };
}

// ---------------------------------------------------------------------------------------------
// One event under one execution specification → one row (status !== "ok" rows keep the reason).
// ---------------------------------------------------------------------------------------------
export function evaluateEvent(e, o) {
  const sym = symOf(e.ticker);
  const base = { id: e.id, issuerCik: e.issuerCik, ticker: e.ticker, sym, publishedAt: e.publishedAt, period: L.periodOf(e), pubBucket: pubBucket(e),
    entryType: o.entry + (o.delaySessions ? `+${o.delaySessions}` : ""), suspectSymbol: SUSPECT_SYMBOLS.has(sym), costBpsTier: e.costBpsPerSide };
  const s = series(sym), spy = series("SPY");
  const af = adjFactor(e);
  if (o.entry === "ah") {
    const en = ahEntry(e, o.latencyMinutes);
    if (en.status !== "ok") return { ...base, status: en.status };
    const dd = ahDaily(e);
    if (dd.status !== "ok") return { ...base, status: dd.status };
    const exitWhen = o.exitSessions === "nextClose" ? "close" : "open";
    const entryAdj = en.rawPrice / dd.factor, exitAdj = exitWhen === "open" ? dd.nextOpenAdj : dd.nextCloseAdj;
    const spyExit = exitWhen === "open" ? dd.spyNextOpen : dd.spyNextClose;
    const adv = adv20Sessions(s, dd.nextDate); // the 20 sessions up to and including the publication day
    const cIn = sideCost(o.costModel, { e, asTradedPrice: en.rawPrice, adv, mult: o.costMultiplier });
    const cOut = sideCost(o.costModel, { e, asTradedPrice: exitAdj * dd.factor, adv, mult: o.costMultiplier });
    const gross = exitAdj / entryAdj - 1, spyRet = spyExit / dd.spyClosePub - 1, net = netOf(entryAdj, exitAdj, cIn, cOut);
    const w5 = ahWindowDollars(e, 5), w15 = ahWindowDollars(e, 15);
    return { ...base, status: "ok", ahStratum: ahStratum(e), entryDate: dd.pubDay, entryWhen: "ah", entryMs: en.entryMs, latencyMinutes: o.latencyMinutes,
      minutesAfterAcceptance: en.minutesAfterAcceptance, entryRaw: en.rawPrice, splitFactor: dd.factor, entryPrice: entryAdj, exitDate: dd.nextDate, exitWhen, exitPrice: exitAdj,
      closePubRaw: dd.closePubRaw, entryVsClose: en.rawPrice / dd.closePubRaw - 1, nextOpenVsClose: dd.nextOpenAdj / dd.closePubAdj - 1,
      gross, spyRet, excess: gross - spyRet, costIn: cIn, costOut: cOut, net, excessNet: net - spyRet, adv20: adv, capacityUsd: adv == null ? null : o.capacityPct * adv,
      ahUsd5: w5?.usd ?? null, ahUsd15: w15?.usd ?? null, ahBuyable5: w5 ? 0.1 * w5.usd : null, ahBuyable15: w15 ? 0.1 * w15.usd : null, ahWindowLowerBound: !!(w5?.lowerBound || w15?.lowerBound),
      asTradedEntry: en.rawPrice, adjFactorInferred: af.inferred };
  }
  const en = entryOf(e, { entry: o.entry, delaySessions: o.delaySessions, mooCutoff: o.mooCutoff });
  if (en.status !== "ok") return { ...base, status: en.status, entryDate: en.entryDate ?? null };
  const N = o.entry === "mooMoc" ? 0 : o.exitSessions;
  const ex = exitAtClose(s, spy, en.entryDate, N);
  if (ex.status !== "ok") return { ...base, status: ex.status, entryDate: en.entryDate, exitDate: ex.exitDate ?? null };
  // A zero-volume daily bar has no auction print: its open/close is not an executable price.
  if (o.requireVolume && (!(en.entryBar.v > 0) || !(ex.exitBar.v > 0))) return { ...base, status: "zero_volume_fill", entryDate: en.entryDate, exitDate: ex.exitDate };
  const cIn = sideCost(o.costModel, { e, asTradedPrice: en.entryPrice / af.f, adv: en.adv20, mult: o.costMultiplier });
  const cOut = sideCost(o.costModel, { e, asTradedPrice: ex.exitPrice / af.f, adv: en.adv20, mult: o.costMultiplier });
  const gross = ex.exitPrice / en.entryPrice - 1, spyRet = ex.spyExit / en.spyEntry - 1, net = netOf(en.entryPrice, ex.exitPrice, cIn, cOut);
  return { ...base, status: "ok", entryDate: en.entryDate, entryWhen: en.when, entryMs: en.entryMs, entryPrice: en.entryPrice, exitDate: ex.exitDate, exitWhen: "close", exitPrice: ex.exitPrice, N,
    gross, spyRet, excess: gross - spyRet, costIn: cIn, costOut: cOut, net, excessNet: net - spyRet, adv20: en.adv20, capacityUsd: en.adv20 == null ? null : o.capacityPct * en.adv20,
    asTradedEntry: en.entryPrice / af.f, adjFactorInferred: af.inferred, entryVolume: en.entryBar.v, exitVolume: ex.exitBar.v };
}

// Embargo exactly as lib2.usable, on this row's own exit date. Holdout rows are never usable here.
export function periodOk(row, period = null) {
  const p = row.period;
  if (p === "holdout") return false;
  if (period && p !== period) return false;
  if (p === "discover") return row.exitDate < L.DISCOVER_END;
  if (p === "confirm") return row.exitDate < L.HOLDOUT_START;
  return false;
}

export const DEFAULTS = { track: "B", entry: "nextOpen", exitSessions: 3, delaySessions: 0, costModel: "tier", costMultiplier: 1, capacityPct: 0.01, minPositionUsd: 0,
  latencyMinutes: 1, period: null, excludeSuspects: false, filter: null, slots: null, accountSize: null, onePerIssuer: true, mooCutoff: null, requireVolume: false };

// Company-aware statistics (lib2.companyStats on excessNet) plus gross / SPY / cost context.
export function summarize(rows, key = "excessNet") {
  const cs = L.companyStats(rows.map((r) => ({ issuer: r.issuerCik, x: r[key] })));
  if (!rows.length) return cs;
  return { ...cs, meanGross: r4(mean(rows.map((r) => r.gross))), meanSpy: r4(mean(rows.map((r) => r.spyRet))), meanExcessGross: r4(mean(rows.map((r) => r.excess))),
    medianExcessGross: r4(median(rows.map((r) => r.excess))), meanNet: r4(mean(rows.map((r) => r.net))), meanRoundTripCostBps: Math.round(mean(rows.map((r) => (r.costIn + r.costOut) * 1e4))) };
}

export function evaluate(events, opts = {}) {
  const o = { ...DEFAULTS, ...(opts.track === "A" && !opts.entry ? { entry: "mooMoc" } : {}), ...opts };
  if (o.costModel === "tier" && o.entry === "ah") throw new Error("execLib: after-hours entries need a numeric extended-hours cost (bps per side)");
  let es = events;
  if (o.filter) es = es.filter(o.filter);
  if (o.excludeSuspects) es = es.filter((e) => !SUSPECT_SYMBOLS.has(symOf(e.ticker)));
  const rows = es.map((e) => evaluateEvent(e, o));
  const statusCounts = rows.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});
  const inPeriod = rows.filter((r) => r.status === "ok" && periodOk(r, o.period));
  const ok = inPeriod.filter((r) => (o.minPositionUsd ? (r.capacityUsd ?? 0) >= o.minPositionUsd : true));
  const out = { opts: { ...o, filter: o.filter ? "custom" : null }, rows, ok, statusCounts, embargoedOrOtherPeriod: rows.filter((r) => r.status === "ok").length - inPeriod.length,
    belowCapacity: inPeriod.length - ok.length, stats: summarize(ok) };
  if (o.slots) out.portfolio = simulatePortfolio2(ok.map(toTrade), { slots: o.slots, accountSize: o.accountSize, onePerIssuer: o.onePerIssuer });
  return out;
}

export const toTrade = (r) => ({ id: r.id, issuer: r.issuerCik, sym: r.sym, publishedAt: r.publishedAt, entryDate: r.entryDate, entryWhen: r.entryWhen, entryPrice: r.entryPrice,
  exitDate: r.exitDate, exitWhen: r.exitWhen, exitPrice: r.exitPrice, costIn: r.costIn, costOut: r.costOut, capacityUsd: r.capacityUsd ?? 0 });

// ---------------------------------------------------------------------------------------------
// Portfolio simulator v2 (copy-and-improve of lib2.simulatePortfolio; differences documented in findings.md):
//   • cash accounting: each position buys shares with notional = equity / slots at entry (optionally
//     capped at capacityUsd / accountSize), pays costIn on entry and costOut on exit, is marked at each
//     daily close; idle cash earns 0;
//   • intraday ordering: open exits → open entries → close marks → close exits → MOC entries → AH entries;
//   • deterministic priority when slots are full: entry date, entry time, SEC publication time, id;
//   • one open position per issuer (a second filing on a held issuer is skipped and counted);
//   • reports equity curve, max drawdown, monthly returns (worst month), concurrency, exposure,
//     turnover, CAGR-like annualisation (short history — illustrative), and SPY buy-and-hold over the same days.
// trades: [{ id, issuer, sym, publishedAt, entryDate, entryWhen: open|close|ah, entryPrice, exitDate,
//            exitWhen: open|close, exitPrice, costIn, costOut, capacityUsd }] on the split-adjusted basis.
// ---------------------------------------------------------------------------------------------
//   • with accountSize (capacity-capped sizing) a trade whose capped notional is below minNotionalUsd
//     (default $5,000) is skipped instead of occupying a slot with a trivial position;
//   • concurrency / exposure are measured at their intraday peak (after the open entries, or at the
//     close), so same-session MOO→MOC positions are counted.
const WHEN = { open: 0, close: 1, ah: 2 };
export function simulatePortfolio2(trades, { slots = 20, accountSize = null, minNotionalUsd = 5000, onePerIssuer = true, keepCurve = true } = {}) {
  const ts = trades.filter((t) => t.entryPrice > 0 && t.exitPrice > 0).sort((a, b) => (a.entryDate < b.entryDate ? -1 : a.entryDate > b.entryDate ? 1 : 0)
    || WHEN[a.entryWhen] - WHEN[b.entryWhen] || (a.publishedAt < b.publishedAt ? -1 : a.publishedAt > b.publishedAt ? 1 : 0) || (a.id < b.id ? -1 : 1));
  if (!ts.length) return { signals: 0, trades: 0 };
  const spy = series("SPY");
  const first = ts[0].entryDate, last = ts.reduce((m, t) => (t.exitDate > m ? t.exitDate : m), first);
  const days = spy.arr.map((b) => b.d).filter((d) => d >= first && d <= last);
  const byEntry = new Map(); for (const t of ts) (byEntry.get(t.entryDate) || byEntry.set(t.entryDate, []).get(t.entryDate)).push(t);
  let cash = 1, bought = 0; const pos = [], done = [];
  const skipped = { slotsFull: 0, issuerHeld: 0, noCash: 0, belowMinNotional: 0 };
  const value = () => pos.reduce((a, p) => a + p.shares * p.px, 0);
  const enter = (t) => {
    if (pos.length >= slots) { skipped.slotsFull++; return; }
    if (onePerIssuer && pos.some((p) => p.t.issuer === t.issuer)) { skipped.issuerHeld++; return; }
    const eq = cash + value();
    let notional = Math.min(eq / slots, cash);
    if (accountSize) {
      notional = Math.min(notional, t.capacityUsd / accountSize);
      if (notional * accountSize < minNotionalUsd) { skipped.belowMinNotional++; return; }
    }
    if (!(notional > 0)) { skipped.noCash++; return; }
    cash -= notional; bought += notional;
    pos.push({ t, shares: notional / (t.entryPrice * (1 + t.costIn)), px: t.entryPrice, notional, eqAtEntry: eq });
  };
  const exitAt = (when, d) => { for (let i = pos.length - 1; i >= 0; i--) { const p = pos[i]; if (p.t.exitDate === d && p.t.exitWhen === when) { const proceeds = p.shares * p.t.exitPrice * (1 - p.t.costOut); cash += proceeds; done.push({ ...p.t, notional: p.notional, weight: p.notional / p.eqAtEntry, pnl: proceeds / p.notional - 1 }); pos.splice(i, 1); } } };
  const curve = [];
  for (const d of days) {
    const todays = byEntry.get(d) || [];
    exitAt("open", d);
    for (const t of todays) if (t.entryWhen === "open") enter(t);
    const nOpen = pos.length, vOpen = value(), eqOpen = cash + vOpen; // held through the session
    for (const p of pos) { const b = bar(series(p.t.sym), d); if (b) p.px = b.c; }
    exitAt("close", d);
    for (const t of todays) if (t.entryWhen === "close") enter(t);
    for (const t of todays) if (t.entryWhen === "ah") enter(t);
    const v = value(), eq = cash + v;
    curve.push({ d, eq, n: Math.max(nOpen, pos.length), exposure: Math.max(eqOpen > 0 ? vOpen / eqOpen : 0, eq > 0 ? v / eq : 0) });
  }
  // Anything still open (should not happen: `last` is the last exit date) is closed at its exit price.
  for (const p of [...pos]) { cash += p.shares * p.t.exitPrice * (1 - p.t.costOut); done.push({ ...p.t, notional: p.notional, weight: p.notional / p.eqAtEntry, pnl: null, forcedClose: true }); }
  const eqEnd = curve.at(-1).eq;
  const ddOf = (vals) => { let peak = -Infinity, dd = 0; for (const v of vals) { peak = Math.max(peak, v); dd = Math.min(dd, v / peak - 1); } return dd; };
  const monthly = (pts) => { const out = []; let prev = 1, cur = null, lastV = 1; for (const [d, v] of pts) { const m = d.slice(0, 7); if (cur && m !== cur) { out.push({ month: cur, ret: lastV / prev - 1 }); prev = lastV; } cur = m; lastV = v; } if (cur) out.push({ month: cur, ret: lastV / prev - 1 }); return out; };
  const n = days.length, ann = (tot) => (n > 0 ? Math.pow(1 + tot, 252 / n) - 1 : null);
  const months = monthly(curve.map((c) => [c.d, c.eq]));
  const dayRets = curve.map((c, i) => (i ? c.eq / curve[i - 1].eq - 1 : c.eq - 1));
  // SPY buy-and-hold over the same days: SPY open of the first day → SPY close of each day.
  const spy0 = bar(spy, days[0]).o, spyPts = days.map((d) => [d, bar(spy, d).c / spy0]);
  const spyTot = spyPts.at(-1)[1] - 1, spyMonths = monthly(spyPts);
  // Unconstrained demand: how many valid signals would be open on each day without the slot limit.
  const dIdx = new Map(days.map((d, i) => [d, i])), diff = new Array(n + 1).fill(0);
  for (const t of ts) { const a = dIdx.get(t.entryDate), b = dIdx.get(t.exitDate); if (a == null || b == null) continue; diff[a]++; diff[b + 1]--; }
  const demand = []; for (let i = 0, run = 0; i < n; i++) { run += diff[i]; demand.push(run); }
  const worst = (ms) => ms.reduce((w, m) => (!w || m.ret < w.ret ? m : w), null);
  return {
    signals: ts.length, trades: done.length, skipped, start: days[0], end: days.at(-1), sessions: n,
    totalReturn: r4(eqEnd - 1), cagrLike: r4(ann(eqEnd - 1)), maxDrawdown: r4(ddOf(curve.map((c) => c.eq))),
    worstMonth: worst(months) && { month: worst(months).month, ret: r4(worst(months).ret) }, worstDay: r4(Math.min(...dayRets)), months: months.map((m) => ({ month: m.month, ret: r4(m.ret) })),
    meanConcurrency: r4(mean(curve.map((c) => c.n))), maxConcurrency: Math.max(...curve.map((c) => c.n)), meanExposure: r4(mean(curve.map((c) => c.exposure))),
    demandMeanConcurrency: r4(mean(demand)), demandMaxConcurrency: Math.max(...demand),
    turnoverAnnualOneWay: r4((bought / mean(curve.map((c) => c.eq))) * (252 / n)), meanPositionWeight: r4(mean(done.map((t) => t.weight))),
    tradeWinRate: r4(done.filter((t) => t.pnl > 0).length / done.length), meanTradePnl: r4(mean(done.filter((t) => t.pnl != null).map((t) => t.pnl))),
    spy: { totalReturn: r4(spyTot), cagrLike: r4(ann(spyTot)), maxDrawdown: r4(ddOf([1, ...spyPts.map((p) => p[1])])), worstMonth: worst(spyMonths) && { month: worst(spyMonths).month, ret: r4(worst(spyMonths).ret) } },
    excessVsSpy: r4(eqEnd - 1 - spyTot),
    curve: keepCurve ? curve.map((c, i) => [c.d, r4(c.eq), c.n, r4(spyPts[i][1])]) : undefined,
  };
}

// ---------------------------------------------------------------------------------------------
// Registry helpers (idempotent registration: re-running a script never re-registers an id).
// ---------------------------------------------------------------------------------------------
const REG_FILE = path.join(L.DEEP2, "registry.jsonl");
let _regIds = null;
export function registerOnce(h) {
  if (!_regIds) { _regIds = new Set(); if (fs.existsSync(REG_FILE)) for (const line of fs.readFileSync(REG_FILE, "utf8").split("\n")) { if (!line.trim()) continue; try { _regIds.add(JSON.parse(line).id); } catch { /* other agents' partial line */ } } }
  if (_regIds.has(h.id)) return false;
  L.registerHypothesis({ agent: AGENT, preRegistered: true, ...h });
  _regIds.add(h.id);
  return true;
}
export const record = (id, result) => L.recordResult(id, AGENT, result);

// ---------------------------------------------------------------------------------------------
// Output helpers.
// ---------------------------------------------------------------------------------------------
export function toCsv(rows, cols) {
  const esc = (v) => (v == null ? "" : typeof v === "number" ? String(Number.isInteger(v) ? v : r6(v)) : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}
export const writeOut = (name, data) => { const f = path.join(OUT, name); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof data === "string" ? data : JSON.stringify(data, null, 1)); return f; };
export const sha256File = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
export const pct = (v, d = 2) => (v == null ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(d)}%`);
export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
