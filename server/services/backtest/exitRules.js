// server/services/backtest/exitRules.js
//
// Entry / exit simulation on DAILY bars for the monthly per-buyer study (pure, no I/O).
//
// ENTRY   official open of the first NYSE session whose opening auction can still be
//         joined after the filing became public: availability = SEC acceptance (ET) +
//         latency (default 60 s). Same-day open only when availability ≤ 09:28:00 ET
//         (market-on-open order cut-off); otherwise the next session. Weekends, holidays
//         and DST via sessionCalendar + publicationStart.etToUtcIso. An open that had
//         already happened before publication is never used.
// DAYS    the entry session is day 1 for fixed exits (close of day 1…5) and day 0 for
//         "days to peak / days to target".
// TAKE PROFIT (no stop, baseline). Daily OHLC only, so a target is a THEORETICAL TOUCH:
//         day 1      high ≥ target → sold at the target price
//         day k > 1  open ≥ target → sold at that OPEN (gap model: a resting limit fills
//                    at the opening price, which is at or above the target)
//                    else high ≥ target → sold at the target price
//         not reached by day H → sold at the close of day H.
//         Sensitivity: a touch buffer (high must exceed the target by `buffer`).
// STOP (separate module, never mixed into the baseline): a gap through the stop fills at
//         the open; target and stop both inside one day's range cannot be ordered with
//         daily data → "ambiguous", reported as a conservative (stop first) and an
//         optimistic (target first) result.
// Missing bars are a status with a reason — never filled or interpolated.

import { isSession, nextSession, previousSession } from "./sessionCalendar.js";
import { etToUtcIso } from "./publicationStart.js";
import { etParts } from "./entrySelection.js";

export const MOO_CUTOFF = "09:28:00";
export const HOLD_DAYS = [1, 2, 3, 4, 5];
export const MAX_DAYS = 5;
export const TP_GRID = Array.from({ length: 39 }, (_, i) => Math.round((1 + i * 0.5) * 10) / 1000); // 0.010 … 0.200
export const FOCUS_TARGETS = [0.03, 0.04, 0.05, 0.06, 0.065, 0.07];
export const COST_SCENARIOS_BPS = [0, 10, 25, 50]; // per side; 0 = gross
export const PRICE_SCALE_BAND = [0.5, 2]; // insider price ÷ raw close on the trade date

const r6 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1e6) / 1e6);

// → { availableIso, availableEt, entryDate, sameDay } or null for an invalid stamp.
export function entryDateFor(publishedAtET, { latencySeconds = 60, mooCutoff = MOO_CUTOFF } = {}) {
  const iso = etToUtcIso(publishedAtET);
  if (!iso) return null;
  const availableIso = new Date(Date.parse(iso) + latencySeconds * 1000).toISOString();
  const p = etParts(availableIso);
  const sameDay = isSession(p.date) && p.time <= mooCutoff;
  return { availableIso, availableEt: `${p.date} ${p.time} ET`, entryDate: sameDay ? p.date : nextSession(p.date), sameDay };
}

// bars: Map(date → { o, h, l, c, v }) split-adjusted. cutoff: last session whose close is
// final and included in the study. → path of up to maxDays sessions from the entry date.
//   status ok | pending (entry after cutoff) | no_price_series | no_entry_bar
//   complete = number of consecutive sessions with a bar (≤ maxDays); stopReason when < maxDays
export function pricePath({ bars, entryDate, cutoff, maxDays = MAX_DAYS }) {
  if (!bars || !(bars.size > 0)) return { status: "no_price_series", complete: 0, days: [] };
  if (entryDate > cutoff) return { status: "pending", complete: 0, days: [], stopReason: "entry_after_cutoff" };
  if (!bars.get(entryDate)) return { status: "no_entry_bar", complete: 0, days: [], missingDate: entryDate };
  const days = [];
  let d = entryDate, stopReason = null, missingDate = null;
  for (let k = 1; k <= maxDays; k++) {
    if (k > 1) d = nextSession(d);
    if (d > cutoff) { stopReason = "after_cutoff"; break; }
    const b = bars.get(d);
    if (!b || !(b.o > 0) || !(b.c > 0)) { stopReason = "missing_bar"; missingDate = d; break; }
    days.push({ date: d, ...b });
  }
  return { status: "ok", complete: days.length, days, stopReason, missingDate };
}

export const entryPrice = (path) => (path?.status === "ok" ? path.days[0].o : null);

// Close of day k (entry day = 1) ÷ entry open − 1.
export function closeReturn(path, k) {
  if (path?.status !== "ok" || path.complete < k) return null;
  return r6(path.days[k - 1].c / path.days[0].o - 1);
}

// Take profit at `target` (fraction) or the close of day H.
export function tpExit(path, target, H, { buffer = 0 } = {}) {
  if (path?.status !== "ok" || path.complete < H) return null;
  const entry = path.days[0].o;
  const level = entry * (1 + target);
  const trigger = level * (1 + buffer);
  for (let k = 1; k <= H; k++) {
    const b = path.days[k - 1];
    if (k > 1 && b.o >= trigger) return { ret: r6(b.o / entry - 1), hit: true, exitDay: k, daysToTarget: k - 1, reason: "target_gap_open", exitPrice: b.o, exitDate: b.date };
    if (b.h >= trigger) return { ret: r6(level / entry - 1), hit: true, exitDay: k, daysToTarget: k - 1, reason: "target_touch", exitPrice: level, exitDate: b.date };
  }
  const last = path.days[H - 1];
  return { ret: r6(last.c / entry - 1), hit: false, exitDay: H, daysToTarget: null, reason: `close_day_${H}`, exitPrice: last.c, exitDate: last.date };
}

// Target + stop (separate module). stopSlippage: extra fraction lost on a stop fill inside
// the day (liquidity model; a gap already fills at the open).
export function stopTargetExit(path, target, stop, H, { stopSlippage = 0 } = {}) {
  if (path?.status !== "ok" || path.complete < H) return null;
  const entry = path.days[0].o;
  const tl = entry * (1 + target), sl = entry * (1 - stop);
  const res = (price, k, reason) => ({ ret: r6(price / entry - 1), exitDay: k, reason });
  for (let k = 1; k <= H; k++) {
    const b = path.days[k - 1];
    if (k > 1 && b.o <= sl) { const x = res(b.o, k, "stop_gap_open"); return { status: "ok", conservative: x, optimistic: x }; }
    if (k > 1 && b.o >= tl) { const x = res(b.o, k, "target_gap_open"); return { status: "ok", conservative: x, optimistic: x }; }
    const hitT = b.h >= tl, hitS = b.l <= sl;
    if (hitT && hitS) return { status: "ambiguous", conservative: res(sl * (1 - stopSlippage), k, "stop_assumed_first"), optimistic: res(tl, k, "target_assumed_first") };
    if (hitS) { const x = res(sl * (1 - stopSlippage), k, "stop_touch"); return { status: "ok", conservative: x, optimistic: x }; }
    if (hitT) { const x = res(tl, k, "target_touch"); return { status: "ok", conservative: x, optimistic: x }; }
  }
  const x = res(path.days[H - 1].c, H, `close_day_${H}`);
  return { status: "ok", conservative: x, optimistic: x };
}

// Hindsight excursions over the first n days of the path (entry day = 0 for days to peak).
export function excursions(path, n = Infinity) {
  if (path?.status !== "ok" || !path.complete) return null;
  const entry = path.days[0].o;
  const ds = path.days.slice(0, Math.min(n, path.complete));
  let hi = -Infinity, hiDay = 0, lo = Infinity;
  ds.forEach((b, i) => { if (b.h > hi) { hi = b.h; hiDay = i; } if (b.l < lo) lo = b.l; });
  return { days: ds.length, mfe: r6(hi / entry - 1), daysToPeak: hiDay, peakDate: ds[hiDay].date, mae: r6(lo / entry - 1), lastClose: ds.at(-1).c, lastDate: ds.at(-1).date, toLast: r6(ds.at(-1).c / entry - 1) };
}

// Split factor on a day = raw close ÷ split-adjusted close (1 when no split since).
export function splitFactorOn(rawBars, adjBars, day) {
  const raw = rawBars?.get(day)?.c, adj = adjBars?.get(day)?.c;
  if (!(raw > 0) || !(adj > 0)) return null;
  const f = raw / adj;
  return Math.abs(f - 1) < 1e-3 ? 1 : Math.round(f * 1e4) / 1e4;
}

// The session on/before `day` that has a bar (within `maxBack` sessions).
export function barOnOrBefore(bars, day, maxBack = 5) {
  if (!bars) return null;
  let d = isSession(day) ? day : previousSession(day);
  for (let i = 0; i <= maxBack; i++, d = previousSession(d)) if (bars.get(d)) return { date: d, bar: bars.get(d) };
  return null;
}

// Does the insider's USD price sit on the same scale as the listed series' RAW close on the
// trade date? Outside PRICE_SCALE_BAND → another security / ADR ratio / currency / value error.
export function priceScaleCheck(insiderPriceUsd, rawBars, tradeDate) {
  if (!(insiderPriceUsd > 0)) return { status: "unknown", reason: "no_insider_price" };
  const b = barOnOrBefore(rawBars, tradeDate);
  if (!b) return { status: "unknown", reason: "no_raw_bar_near_trade_date" };
  const ratio = insiderPriceUsd / b.bar.c;
  const ok = ratio >= PRICE_SCALE_BAND[0] && ratio <= PRICE_SCALE_BAND[1];
  return { status: ok ? "ok" : "mismatch", ratio: r6(ratio), rawClose: b.bar.c, date: b.date };
}

export const netReturn = (gross, bpsPerSide) => (gross == null ? null : r6(((1 + gross) * (1 - bpsPerSide / 1e4)) / (1 + bpsPerSide / 1e4) - 1));

// One signal → its evaluation on daily bars. Inputs are Maps (date → bar).
//   bars / rawBars: split-adjusted / raw bars of the signal's symbol; spyBars: benchmark.
//   pathDays: how many sessions to follow for hindsight (to the cutoff).
export function evaluateSignal(sig, { bars, rawBars = null, spyBars = null, cutoff, latencySeconds = 60, pathDays = 60, buffer = 0.005 }) {
  const timing = entryDateFor(sig.publishedAt, { latencySeconds });
  const out = { signalId: sig.id, symbol: sig.symbol || null, timing, status: null, naReason: null, completeDays: 0 };
  if (!timing) return { ...out, status: "na", naReason: "invalid_publication_time" };
  if (sig.securityMatch?.status === "uncertain") { out.securityNote = sig.securityMatch.reasons; }
  if (!sig.symbol) return { ...out, status: "na", naReason: sig.securityMatch?.reasons?.includes("no_ticker") ? "no_ticker" : "no_symbol" };
  const full = pricePath({ bars, entryDate: timing.entryDate, cutoff, maxDays: pathDays });
  if (full.status === "pending") return { ...out, status: "pending", naReason: "entry_after_cutoff" };
  if (full.status !== "ok") return { ...out, status: "na", naReason: full.status, missingDate: full.missingDate || null };
  const path = { ...full, complete: Math.min(full.complete, MAX_DAYS), days: full.days.slice(0, MAX_DAYS) };
  out.entryDate = path.days[0].date;
  out.entryPrice = path.days[0].o;
  out.completeDays = path.complete;
  out.pathStop = path.complete < MAX_DAYS ? (full.stopReason || null) : null;
  out.closes = Object.fromEntries(HOLD_DAYS.map((k) => [k, closeReturn(path, k)]));
  out.exitDates = Object.fromEntries(HOLD_DAYS.map((k) => [k, path.days[k - 1]?.date || null]));
  // Benchmark over the same sessions (entry open → close of day k).
  const spyPath = spyBars ? pricePath({ bars: spyBars, entryDate: timing.entryDate, cutoff, maxDays: MAX_DAYS }) : null;
  out.spy = Object.fromEntries(HOLD_DAYS.map((k) => [k, closeReturn(spyPath, k)]));
  // Take-profit grid: tp[i][H-1] = { ret, hit, day } for target TP_GRID[i] and horizon H.
  out.tp = TP_GRID.map((t) => HOLD_DAYS.map((H) => { const x = tpExit(path, t, H); return x ? [x.ret, x.hit ? 1 : 0, x.daysToTarget, x.reason === "target_gap_open" ? 1 : 0] : null; }));
  out.tpBuffered = TP_GRID.map((t) => HOLD_DAYS.map((H) => { const x = tpExit(path, t, H, { buffer }); return x ? [x.ret, x.hit ? 1 : 0, x.daysToTarget] : null; }));
  out.focus = Object.fromEntries(FOCUS_TARGETS.map((t) => [t, tpExit(path, t, MAX_DAYS)]));
  out.excursion5 = excursions(path, MAX_DAYS);
  out.excursionToCutoff = excursions(full);
  // (a) Insider's hypothetical mark-to-market from the reported price (split-adjusted to the
  // bars' terms), NOT a realised or executable return.
  const tradeDay = sig.tradeDateTo;
  const factor = rawBars ? splitFactorOn(rawBars, bars, barOnOrBefore(bars, tradeDay)?.date) : null;
  const scale = priceScaleCheck(sig.insiderAvgPriceUsd, rawBars, tradeDay);
  out.priceScale = scale;
  if (sig.insiderAvgPriceUsd > 0 && factor) {
    const adj = sig.insiderAvgPriceUsd / factor;
    out.insider = { avgPriceUsd: sig.insiderAvgPriceUsd, splitFactor: factor, adjustedPrice: r6(adj), toEntryOpen: r6(out.entryPrice / adj - 1), toClose: Object.fromEntries(HOLD_DAYS.map((k) => [k, path.days[k - 1] ? r6(path.days[k - 1].c / adj - 1) : null])) };
  } else out.insider = null;
  const securityUncertain = sig.securityMatch?.status === "uncertain" || scale.status === "mismatch";
  out.status = securityUncertain ? "na" : "ok";
  out.naReason = securityUncertain ? (scale.status === "mismatch" ? "price_scale_mismatch" : `security_${(sig.securityMatch.reasons || [])[0] || "uncertain"}`) : null;
  return out;
}

// ---------------- statistics ----------------
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// Deterministic issuer-cluster bootstrap CI of the mean (95 %).
function clusterCi(rows, reps = 1000, seed = 7) {
  const by = new Map();
  for (const r of rows) (by.get(r.issuer) || by.set(r.issuer, []).get(r.issuer)).push(r.ret);
  const groups = [...by.values()];
  if (groups.length < 3) return null;
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
  const means = [];
  for (let i = 0; i < reps; i++) {
    let sum = 0, n = 0;
    for (let j = 0; j < groups.length; j++) { const g = groups[Math.floor(rnd() * groups.length)]; for (const x of g) { sum += x; n++; } }
    means.push(sum / n);
  }
  means.sort((a, b) => a - b);
  return [r6(means[Math.floor(0.025 * reps)]), r6(means[Math.floor(0.975 * reps) - 1])];
}

// rows: [{ ret, issuer, hit?, spy?, mae?, daysToTarget? }] → summary of one rule on one sample.
export function summarizeRule(rows, { costs = COST_SCENARIOS_BPS } = {}) {
  const xs = rows.map((r) => r.ret).filter((x) => x != null);
  if (!xs.length) return { n: 0 };
  const wins = xs.filter((x) => x > 0), losses = xs.filter((x) => x < 0);
  const sorted = [...xs].sort((a, b) => b - a);
  const hits = rows.filter((r) => r.hit != null);
  const spy = rows.filter((r) => r.spy != null);
  const ttt = rows.map((r) => r.daysToTarget).filter((x) => x != null);
  const avgWin = mean(wins), avgLoss = mean(losses);
  return {
    n: xs.length,
    issuers: new Set(rows.map((r) => r.issuer)).size,
    mean: r6(mean(xs)), median: r6(median(xs)),
    pctPositive: r6(wins.length / xs.length),
    hitRate: hits.length ? r6(hits.filter((r) => r.hit).length / hits.length) : null,
    hits: hits.length ? hits.filter((r) => r.hit).length : null,
    avgWin: r6(avgWin), avgLoss: r6(avgLoss),
    payoff: avgWin != null && avgLoss != null && avgLoss !== 0 ? r6(avgWin / -avgLoss) : null,
    best: r6(sorted[0]), worst: r6(sorted.at(-1)),
    meanExTop1: xs.length > 1 ? r6(mean(sorted.slice(1))) : null,
    meanExTop3: xs.length > 3 ? r6(mean(sorted.slice(3))) : null,
    ci95: clusterCi(rows.filter((r) => r.ret != null)),
    spyMean: spy.length ? r6(mean(spy.map((r) => r.spy))) : null,
    excessMean: spy.length ? r6(mean(spy.map((r) => r.ret - r.spy))) : null,
    meanMae: rows.some((r) => r.mae != null) ? r6(mean(rows.map((r) => r.mae).filter((x) => x != null))) : null,
    meanDaysToTarget: ttt.length ? r6(mean(ttt)) : null,
    netMean: Object.fromEntries(costs.map((c) => [c, r6(mean(xs.map((x) => netReturn(x, c))))])),
  };
}

// ---------------- study aggregation ----------------
// items: [{ sig, ev }] (ev = evaluateSignal output). view: "signal" (equal weight per
// signal) | "consolidated" (one row per symbol + entry date — several buyers of one stock
// entering the same day do not inflate the sample). Every rule of horizon H is evaluated
// on the SAME sample: the eligible signals whose first H sessions are complete.
export function gridSummary(items, { view = "signal" } = {}) {
  const counts = { signals: items.length, eligible: 0, pending: 0, na: 0, naReasons: {}, incompleteByHorizon: {} };
  let eligible = [];
  for (const it of items) {
    const st = it.ev?.status;
    if (st === "ok") eligible.push(it);
    else if (st === "pending") counts.pending++;
    else { counts.na++; const k = it.ev?.naReason || "unknown"; counts.naReasons[k] = (counts.naReasons[k] || 0) + 1; }
  }
  if (view === "consolidated") {
    const seen = new Map();
    for (const it of eligible) { const k = `${it.ev.symbol}|${it.ev.entryDate}`; if (!seen.has(k)) seen.set(k, it); }
    counts.mergedDuplicates = eligible.length - seen.size;
    eligible = [...seen.values()];
  }
  counts.eligible = eligible.length;
  const issuerOf = (it) => it.sig.issuerCik;
  const horizons = {};
  for (const H of HOLD_DAYS) {
    const sample = eligible.filter((it) => it.ev.completeDays >= H);
    counts.incompleteByHorizon[H] = eligible.length - sample.length;
    const close = summarizeRule(sample.map((it) => ({ ret: it.ev.closes[H], issuer: issuerOf(it), spy: it.ev.spy?.[H] ?? null, mae: H === MAX_DAYS ? it.ev.excursion5?.mae ?? null : null })));
    const tp = TP_GRID.map((t, i) => ({
      target: t,
      ...summarizeRule(sample.map((it) => { const x = it.ev.tp[i][H - 1]; return { ret: x?.[0] ?? null, hit: x ? x[1] === 1 : null, daysToTarget: x?.[2] ?? null, issuer: issuerOf(it), spy: it.ev.spy?.[H] ?? null }; })),
      buffered: summarizeRule(sample.map((it) => { const x = it.ev.tpBuffered[i][H - 1]; return { ret: x?.[0] ?? null, hit: x ? x[1] === 1 : null, issuer: issuerOf(it) }; }), { costs: [0] }),
    }));
    horizons[H] = { n: sample.length, close, tp };
  }
  // Day 1…5 closes on the one sample that completed all five days (same signals for every day).
  const full = eligible.filter((it) => it.ev.completeDays >= MAX_DAYS);
  const fixedSample5 = Object.fromEntries(HOLD_DAYS.map((k) => [k, summarizeRule(full.map((it) => ({ ret: it.ev.closes[k], issuer: issuerOf(it), spy: it.ev.spy?.[k] ?? null })))]));
  // Hindsight winner of the 195 combinations (reported as such — never a forecast).
  let winner = null;
  for (const H of HOLD_DAYS) horizons[H].tp.forEach((s) => { if (s.n && (!winner || s.mean > winner.mean)) winner = { horizon: H, target: s.target, mean: s.mean, n: s.n, hitRate: s.hitRate, pctPositive: s.pctPositive }; });
  const mfe = eligible.map((it) => it.ev.excursion5).filter((x) => x && x.days >= MAX_DAYS);
  const mfeCut = eligible.map((it) => it.ev.excursionToCutoff).filter(Boolean);
  return {
    view, counts, horizons, fixedSample5, winner,
    combinations: TP_GRID.length * HOLD_DAYS.length,
    hindsight: {
      mfe5: summarizeRule(mfe.map((x, i) => ({ ret: x.mfe, issuer: String(i) })), { costs: [0] }),
      meanDaysToPeak5: mfe.length ? r6(mfe.reduce((a, x) => a + x.daysToPeak, 0) / mfe.length) : null,
      mfeToCutoff: summarizeRule(mfeCut.map((x, i) => ({ ret: x.mfe, issuer: String(i) })), { costs: [0] }),
      meanDaysToPeakToCutoff: mfeCut.length ? r6(mfeCut.reduce((a, x) => a + x.daysToPeak, 0) / mfeCut.length) : null,
    },
    insider: summarizeRule(full.filter((it) => it.ev.insider?.toClose?.[MAX_DAYS] != null).map((it) => ({ ret: it.ev.insider.toClose[MAX_DAYS], issuer: issuerOf(it) })), { costs: [0] }),
    insiderToEntry: summarizeRule(eligible.filter((it) => it.ev.insider?.toEntryOpen != null).map((it) => ({ ret: it.ev.insider.toEntryOpen, issuer: issuerOf(it) })), { costs: [0] }),
  };
}

// The result of ONE named rule ({ kind: "close", horizon } | { kind: "tp", target, horizon })
// for one evaluated signal → { ret, hit } or null (incomplete).
export function ruleResult(ev, rule) {
  if (ev?.status !== "ok" || ev.completeDays < rule.horizon) return null;
  if (rule.kind === "close") return { ret: ev.closes[rule.horizon], hit: null };
  const i = TP_GRID.findIndex((t) => Math.abs(t - rule.target) < 1e-9);
  const x = i >= 0 ? ev.tp[i][rule.horizon - 1] : null;
  return x ? { ret: x[0], hit: x[1] === 1, daysToTarget: x[2] } : null;
}
export const ruleLabel = (rule) => (rule.kind === "close" ? `close of day ${rule.horizon}` : `TP ${(rule.target * 100).toFixed(1)}% or close of day ${rule.horizon}`);
