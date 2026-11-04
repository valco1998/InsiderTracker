// server/scripts/research/lib.mjs — shared code for the insider-buying research scripts.
//
// RESEARCH ONLY: read-only on SEC data (server/.cache/backfill) and on market data (Alpaca SIP
// daily bars, cached in server/.cache/research). Nothing here touches MongoDB, alerts, FCM or the
// running server. Outputs go to server/.cache/research (git-ignored: price-derived data whose
// redistribution licence is unverified).
//
// NO LOOK-AHEAD — every rule below uses only what was public at T = the SEC acceptance time:
//   • purchases known at T: point-in-time duplicate-group versions (signals.groupVersions);
//   • identities from the rows known at T (insiderInsights.buildIdentities);
//   • price features from closes STRICTLY BEFORE the transaction date (which is ≤ T);
//   • entry: OPEN of the first NYSE session whose 09:30 ET open is ≥ T + latency;
//   • exits: CLOSE of the N-th session after the entry session; never filled when missing.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import dotenv from "dotenv";
import { loadHistoryStore, buildHistoryDataset, DEFAULT_STORE_DIR, historyCoverage } from "../../services/backtest/form4History.js";
import { buildSnapshot } from "../../services/edgar/insiderSnapshot.js";
import { knownAtOf, groupVersions } from "../../services/backtest/signals.js";
import { buildIdentities } from "../../services/edgar/insiderInsights.js";
import { isSession, nextSession, previousSession } from "../../services/backtest/sessionCalendar.js";
import { sessionAfter } from "../../services/backtest/horizonReturns.js";
import { etToUtcIso } from "../../services/backtest/publicationStart.js";
import { etParts } from "../../services/backtest/entrySelection.js";
import { alpacaCredentials, createAlpacaClient } from "../../services/stockData/alpacaClient.js";

export const SERVER_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const OUT_DIR = path.join(SERVER_DIR, ".cache", "research");
dotenv.config({ path: path.join(SERVER_DIR, ".env"), quiet: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

export const HORIZONS = [1, 5, 10, 20, 30, 60];
export const LATENCY_SECONDS = 60;
export const r4 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1e4) / 1e4);
const stamp = (s) => String(s || "").replace(/\s*ET$/, "");
const DAY = 86_400_000;
const dnum = (d) => Math.floor(Date.parse(`${d}T00:00:00Z`) / DAY);

// ---------------- SEC data (point in time) ----------------
export function loadSec() {
  const store = loadHistoryStore(DEFAULT_STORE_DIR);
  const ds = buildHistoryDataset({ store, live: null });
  const snap = buildSnapshot({ transactions: ds.transactions, amendmentFilings: ds.amendmentFilings });
  const days = [...store.days.keys()].sort();
  const coverage = historyCoverage({ from: days[0], to: days.at(-1), store, live: null, today: days.at(-1) });
  return { store, ds, snap, acc: ds.acceptedAtByAccession, days, coverage };
}

// Code-P items per issuer, each valid in [from, until) — exactly as the signal engine sees them.
export function purchaseItemsByIssuer({ snap, acc }) {
  const by = new Map();
  for (const r of snap.economic) {
    if (r.code !== "P" || !/^\d{4}-\d{2}-\d{2}$/.test(r.transactionDate || "")) continue;
    const k = Number(r.issuerCik); if (!k) continue;
    const knownAt = knownAtOf(r, acc); if (!knownAt) continue;
    const amendUntil = r.amendment?.status === "superseded" ? stamp(r.amendment.amendmentFiledAt) : null;
    const push = (it) => (by.get(k) || by.set(k, []).get(k)).push(it);
    const versions = groupVersions(r, acc, (id) => snap.rawById.get(id));
    if (!versions) { push({ r, from: knownAt, until: amendUntil, first: knownAt }); continue; }
    for (const v of versions) for (const vr of v.rows) {
      if (vr.code !== "P") continue;
      const until = v.until && amendUntil ? (v.until < amendUntil ? v.until : amendUntil) : v.until || amendUntil;
      push({ r: vr, from: v.from, until, first: knownAtOf(vr, acc) || v.from });
    }
  }
  return by;
}
export const usdOf = (r) => (r.priceCheck?.status === "anomaly" || !(r.value > 0) ? null : r.value);

// One event per Form 4 filing with code-P purchases, evaluated at T (its acceptance).
export function buildEvents({ itemsByIssuer, acc, windowDays = 30 }) {
  const events = [];
  for (const [cik, items] of itemsByIssuer) {
    const filings = new Map();
    for (const x of items) if (!x.until) { const a = x.r.accessionNo; (filings.get(a) || filings.set(a, []).get(a)).push(x); }
    for (const [accNo, xs] of filings) {
      const T = stamp(acc.get(accNo)) || xs[0].first;
      const L = xs.filter((x) => usdOf(x.r) != null).sort((a, b) => usdOf(b.r) - usdOf(a.r))[0];
      if (!L) continue;
      const known = items.filter((x) => x.from <= T && (!x.until || x.until > T));
      const ids = buildIdentities(known.map((x) => x.r));
      const me = ids.personOf(L.r);
      const lo = dnum(L.r.transactionDate) - windowDays;
      const inWin = known.filter((x) => usdOf(x.r) != null && dnum(x.r.transactionDate) >= lo && x.r.transactionDate <= L.r.transactionDate);
      const prior = inWin.filter((x) => x.r.accessionNo !== accNo);
      const buyersInWindow = new Set(inWin.map((x) => ids.personOf(x.r)).filter(Boolean));
      const priorOthers = new Set(prior.map((x) => ids.personOf(x.r)).filter((p) => p && p !== me));
      const mine = prior.filter((x) => ids.personOf(x.r) === me).sort((a, b) => a.r.transactionDate.localeCompare(b.r.transactionDate) || a.first.localeCompare(b.first));
      const vL = usdOf(L.r), filingValue = xs.reduce((a, x) => a + (usdOf(x.r) || 0), 0);
      const priorValue = prior.reduce((a, x) => a + usdOf(x.r), 0), maxPrior = prior.reduce((a, x) => Math.max(a, usdOf(x.r)), 0);
      const seq = [...mine.map((x) => usdOf(x.r)), vL];
      events.push({
        issuerCik: cik, ticker: L.r.ticker || null, issuerName: L.r.issuerName || null, accessionNo: accNo, publishedAt: T, tradeDate: L.r.transactionDate,
        insider: L.r.owners?.[0]?.name || L.r.insiderName || null, role: L.r.role || null, ownership: L.r.ownership || null,
        venue: L.r.purchaseContext || "unspecified", is10b5_1: !!L.r.is10b5_1, price: L.r.price ?? null, largestTxUsd: vL, filingValue, rowsInFiling: xs.length,
        buyersInWindow: buyersInWindow.size, priorOtherBuyers: priorOthers.size, priorTx: prior.length, priorValue, maxPrior,
        ratioToMaxPrior: maxPrior > 0 ? vL / maxPrior : null,
        sameInsiderPriorTx: mine.length, sameInsiderRatio: mine.length ? vL / Math.max(...mine.map((x) => usdOf(x.r))) : null,
        progressive: seq.length >= 3 && seq.every((v, i) => i === 0 || v > seq[i - 1]),
        windowShare: filingValue / (filingValue + priorValue),
        filingDelayDays: Math.max(0, dnum(T.slice(0, 10)) - dnum(L.r.transactionDate)),
      });
    }
  }
  return events.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
}

// ---------------- Prices ----------------
export const sym = (t) => String(t || "").trim().toUpperCase().replace(/-/g, ".");
const BARS_FILE = path.join(OUT_DIR, "daily-bars.json");
// → Map(symbol → Map(date → {o,h,l,c,v}) | null). Fetches missing symbols (Alpaca SIP, split-adjusted).
export async function loadDailyBars(symbols, { from = "2025-10-01", log = console } = {}) {
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(BARS_FILE, "utf8")); } catch { cache = {}; }
  const today = etParts(new Date().toISOString()).date;
  const fresh = cache.__meta?.fetchedDay === today && cache.__meta?.from <= from;
  if (!fresh) cache = { __meta: { fetchedDay: today, from, source: "Alpaca SIP daily bars, adjustment=split" } };
  const want = [...new Set(symbols.map(sym).filter((s) => /^[A-Z.]{1,7}$/.test(s)))].filter((s) => !(s in cache));
  if (want.length) {
    const creds = alpacaCredentials();
    if (!creds) throw new Error("ALPACA_API_KEY_ID / ALPACA_API_SECRET_KEY are required in server/.env");
    const client = createAlpacaClient({ ...creds, perMinute: 150 });
    const end = new Date(Date.now() - 16 * 60_000).toISOString();
    for (let i = 0; i < want.length; i += 100) {
      let chunk = want.slice(i, i + 100);
      for (let attempt = 0; attempt < 15 && chunk.length; attempt++) {
        try {
          const got = Object.fromEntries(chunk.map((s) => [s, []]));
          let token = null;
          do {
            const r = await client.barsMultiPage(chunk, { start: `${from}T00:00:00Z`, end, timeframe: "1Day", adjustment: "split", pageToken: token });
            for (const [s, bs] of Object.entries(r.bars || {})) for (const b of bs) got[s]?.push([etParts(b.t).date, b.o, b.h, b.l, b.c, b.v]);
            token = r.next;
          } while (token);
          Object.assign(cache, got);
          break;
        } catch (err) {
          const m = /invalid symbol:\s*([A-Za-z0-9.\-/]+)/i.exec(String(err?.message || ""));
          if (!m) { log.warn?.(`[RESEARCH_BARS] chunk failed: ${String(err.message).slice(0, 120)}`); break; }
          cache[m[1].toUpperCase()] = null; chunk = chunk.filter((s) => s !== m[1].toUpperCase());
        }
      }
      log.log?.(`[RESEARCH_BARS] ${Math.min(i + 100, want.length)}/${want.length} symbols`);
    }
    fs.writeFileSync(BARS_FILE, JSON.stringify(cache));
  }
  const out = new Map();
  for (const [s, bs] of Object.entries(cache)) if (s !== "__meta") out.set(s, bs ? new Map(bs.map((b) => [b[0], { o: b[1], h: b[2], l: b[3], c: b[4], v: b[5] }])) : null);
  return out;
}
// Alpaca SIP trades (exact timestamps, conditions) for one symbol in [startIso, endIso). Research only.
let tradeClient = null;
export async function fetchTrades(symbol, startIso, endIso, { maxPages = 3 } = {}) {
  if (!tradeClient) { const creds = alpacaCredentials(); if (!creds) throw new Error("Alpaca credentials missing"); tradeClient = createAlpacaClient({ ...creds, perMinute: 150 }); }
  const out = []; let token = null, pages = 0;
  do { const r = await tradeClient.tradesPage(symbol, { start: startIso, end: endIso, limit: 1000, pageToken: token }); out.push(...(r.trades || [])); token = r.next; pages++; } while (token && pages < maxPages);
  return { trades: out, truncated: !!token };
}

// RAW (unadjusted) daily bars for a set of symbols — needed to compare raw trade prices with
// daily bars on the same basis. → { SYMBOL: Map(date → {o,c}) }. Research only.
export async function fetchRawDaily(symbols, fromDay, toDay) {
  if (!tradeClient) { const creds = alpacaCredentials(); if (!creds) throw new Error("Alpaca credentials missing"); tradeClient = createAlpacaClient({ ...creds, perMinute: 150 }); }
  const out = {};
  const list = [...new Set(symbols.map(sym))];
  for (let i = 0; i < list.length; i += 100) {
    let chunk = list.slice(i, i + 100);
    for (let attempt = 0; attempt < 10 && chunk.length; attempt++) {
      try {
        let token = null;
        do {
          const r = await tradeClient.barsMultiPage(chunk, { start: `${fromDay}T00:00:00Z`, end: `${toDay}T23:59:59Z`, timeframe: "1Day", adjustment: "raw", pageToken: token });
          for (const [s, bs] of Object.entries(r.bars || {})) { const m = out[s] || (out[s] = new Map()); for (const b of bs) m.set(etParts(b.t).date, { o: b.o, c: b.c }); }
          token = r.next;
        } while (token);
        break;
      } catch (err) {
        const m = /invalid symbol:\s*([A-Za-z0-9.\-/]+)/i.exec(String(err?.message || ""));
        if (!m) throw err;
        chunk = chunk.filter((s) => s !== m[1].toUpperCase());
      }
    }
  }
  return out;
}

// Last session whose close is final (today's session counts only after 16:15 ET).
export function lastCompleteSession(nowIso = new Date().toISOString()) {
  const { date, time } = etParts(nowIso);
  if (isSession(date) && time >= "16:20:00") return date;
  return previousSession(date);
}

// First session whose 09:30 ET open is at or after T + latency (T = "YYYY-MM-DD HH:MM:SS", ET).
export function entrySessionAfter(T, latencySeconds = LATENCY_SECONDS) {
  const iso = new Date(Date.parse(etToUtcIso(`${T} ET`)) + latencySeconds * 1000).toISOString();
  const { date, time } = etParts(iso);
  return isSession(date) && time <= "09:30:00" ? date : nextSession(date);
}

// Per-side cost by liquidity (average daily dollar volume over the 20 sessions before the trade
// date): spread + impact assumption for a small retail-size order. Documented, not fitted.
export function costBpsFor(avgDollarVol) {
  if (!(avgDollarVol > 0)) return 100;
  if (avgDollarVol >= 50e6) return 5;
  if (avgDollarVol >= 5e6) return 15;
  if (avgDollarVol >= 1e6) return 35;
  return 75;
}

// Fills price features and returns for one event (mutates and returns it).
export function priceEvent(e, { bars, spy, iwm = null, completeThrough, horizons = HORIZONS, latencySeconds = LATENCY_SECONDS, entryOverride = null }) {
  const b = bars;
  if (!e.ticker) return Object.assign(e, { priceStatus: "no_ticker" });
  if (b === null) return Object.assign(e, { priceStatus: "unsupported_symbol" });
  if (!b) return Object.assign(e, { priceStatus: "no_price_data" });
  // Features known before the trade date.
  const closes = []; let d = previousSession(e.tradeDate);
  for (let i = 0; i < 40 && closes.length < 21; i++) { const x = b.get(d); if (x) closes.push(x.c); d = previousSession(d); }
  e.prevClose = closes[0] ?? null;
  e.priceVsPrevClose = e.prevClose && e.price ? e.price / e.prevClose - 1 : null;
  e.ret5 = closes.length > 5 ? closes[0] / closes[5] - 1 : null;
  e.ret10 = closes.length > 10 ? closes[0] / closes[10] - 1 : null;
  e.ret20 = closes.length > 20 ? closes[0] / closes[20] - 1 : null;
  let dv = 0, nd = 0; d = previousSession(e.tradeDate);
  for (let i = 0; i < 20; i++) { const x = b.get(d); if (x) { dv += x.c * x.v; nd++; } d = previousSession(d); }
  e.avgDollarVol20 = nd ? dv / nd : null;
  e.costBpsPerSide = costBpsFor(e.avgDollarVol20);
  // Entry after public availability.
  const ent = entryOverride?.date || entrySessionAfter(e.publishedAt, latencySeconds);
  e.entryDate = ent;
  if (ent > completeThrough) return Object.assign(e, { priceStatus: "entry_pending" });
  const eb = b.get(ent), sb = spy.get(ent);
  if (!eb || !sb) return Object.assign(e, { priceStatus: "no_entry_bar" });
  e.entryPrice = entryOverride?.price ?? eb.o;
  e.spyEntry = sb.o;
  e.priceStatus = "ok";
  e.h = {};
  const c = e.costBpsPerSide / 1e4;
  for (const N of horizons) {
    const x = sessionAfter(ent, N);
    if (x > completeThrough) { e.h[N] = { status: "pending", exitDate: x }; continue; }
    const xb = b.get(x), xs = spy.get(x);
    if (!xb || !xs) { e.h[N] = { status: "no_exit_bar", exitDate: x }; continue; }
    // Path from entry session through the exit session (daily highs / lows).
    let lo = eb.l, hi = eb.h; let dd = ent;
    while (dd < x) { dd = nextSession(dd); const y = b.get(dd); if (y) { lo = Math.min(lo, y.l); hi = Math.max(hi, y.h); } }
    const gross = xb.c / e.entryPrice - 1, spyR = xs.c / sb.o - 1;
    // Second benchmark: IWM (Russell 2000 small caps) over the same entry open → exit close.
    const ib = iwm?.get(ent), ix = iwm?.get(x);
    const iwmR = ib && ix ? ix.c / ib.o - 1 : null;
    const net = (xb.c * (1 - c)) / (e.entryPrice * (1 + c)) - 1;
    e.h[N] = { status: "ok", exitDate: x, exitPrice: xb.c, gross: r4(gross), net: r4(net), spy: r4(spyR), excess: r4(gross - spyR), excessNet: r4(net - spyR),
      maxDrawdown: r4(Math.min(0, lo / e.entryPrice - 1)), maxFavorable: r4(Math.max(0, hi / e.entryPrice - 1)),
      iwm: r4(iwmR), excessIwmNet: iwmR == null ? null : r4(net - iwmR) };
  }
  return e;
}

// ---------------- Statistics ----------------
export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
export const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
// t-statistic of the mean with standard errors CLUSTERED BY ISSUER (events of one company are not independent).
export function clusteredT(rows, key = "excess") {
  const xs = rows.map((r) => r[key]);
  const n = xs.length; if (n < 5) return null;
  const m = mean(xs);
  const g = new Map();
  for (const r of rows) g.set(r.issuer, (g.get(r.issuer) || 0) + (r[key] - m));
  const G = g.size; if (G < 5) return null;
  const v = [...g.values()].reduce((a, s) => a + s * s, 0) / (n * n) * (G / (G - 1));
  return v > 0 ? m / Math.sqrt(v) : null;
}
// Two-sided p-value from a t-like statistic (normal approximation; conservative enough at n ≥ 30).
export function pValue(t) {
  if (t == null) return null;
  const z = Math.abs(t), k = 1 / (1 + 0.2316419 * z);
  const tail = (Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI)) * k * (0.319381530 + k * (-0.356563782 + k * (1.781477937 + k * (-1.821255978 + k * 1.330274429))));
  return 2 * tail;
}
// Benjamini–Hochberg q-values (false-discovery rate) for an array of p-values (nulls kept null).
export function bhQ(ps) {
  const idx = ps.map((p, i) => [p, i]).filter(([p]) => p != null).sort((a, b) => a[0] - b[0]);
  const m = idx.length, q = new Array(ps.length).fill(null);
  let min = 1;
  for (let k = m - 1; k >= 0; k--) { const [p, i] = idx[k]; min = Math.min(min, (p * m) / (k + 1)); q[i] = min; }
  return q;
}
export function summarize(events, N) {
  const rows = events.filter((e) => e.h?.[N]?.status === "ok").map((e) => ({ issuer: e.issuerCik, ...e.h[N] }));
  const pending = events.filter((e) => e.h?.[N]?.status === "pending" || e.priceStatus === "entry_pending").length;
  const g = rows.map((r) => r.gross), x = rows.map((r) => r.excess), xn = rows.map((r) => r.excessNet), nt = rows.map((r) => r.net);
  const t = clusteredT(rows, "excess"), tn = clusteredT(rows, "excessNet");
  return {
    n: rows.length, issuers: new Set(rows.map((r) => r.issuer)).size, pending,
    meanGross: r4(mean(g)), medianGross: r4(median(g)), winRate: rows.length ? r4(g.filter((v) => v > 0).length / rows.length) : null,
    meanNet: r4(mean(nt)), meanSpy: r4(mean(rows.map((r) => r.spy))),
    meanExcess: r4(mean(x)), medianExcess: r4(median(x)), beatSpy: rows.length ? r4(x.filter((v) => v > 0).length / rows.length) : null,
    meanExcessNet: r4(mean(xn)), tExcess: r4(t), pExcess: r4(pValue(t)), tExcessNet: r4(tn), pExcessNet: r4(pValue(tn)),
    meanIwm: r4(mean(rows.map((r) => r.iwm).filter((v) => v != null))),
    meanExcessIwmNet: r4(mean(rows.map((r) => r.excessIwmNet).filter((v) => v != null))),
    tExcessIwmNet: r4(clusteredT(rows.filter((r) => r.excessIwmNet != null), "excessIwmNet")),
    pExcessIwmNet: r4(pValue(clusteredT(rows.filter((r) => r.excessIwmNet != null), "excessIwmNet"))),
    medianMaxDrawdown: r4(median(rows.map((r) => r.maxDrawdown))), medianMaxFavorable: r4(median(rows.map((r) => r.maxFavorable))),
  };
}

export function writeOut(name, data) {
  const f = path.join(OUT_DIR, name);
  fs.writeFileSync(f, typeof data === "string" ? data : JSON.stringify(data, null, 1));
  return f;
}
export function toCsv(rows, cols) {
  const esc = (v) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(typeof c === "function" ? c(r) : r[c])).join(","))].join("\n");
}
export const pct = (v, d = 1) => (v == null ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(d)}%`);
export { etParts, sessionAfter, nextSession, previousSession, isSession, pathToFileURL };
