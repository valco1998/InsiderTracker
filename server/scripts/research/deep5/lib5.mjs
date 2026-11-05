// deep5/lib5.mjs — insider cluster buying and 180-day outcomes. RESEARCH ONLY.
// Cache only: SEC rows (.cache/research/deep2/sec-rows.json, built from the Form 4 history store) and split-adjusted
// Alpaca daily bars (.cache/research/daily-bars.json). No network, no MongoDB, no server code is modified.
//
// Two clocks, never mixed:
//   Clock 1 (hindsight)  : all eligible rows by TRADE DATE, including ones filed later. Completion date d = first trade date on
//                          which the rolling window qualifies. Entry reference = official close of d. Window = sessions (d, d+180].
//   Clock 2 (public)     : rows known at SEC acceptance time T only. T = first acceptance at which the window qualifies using
//                          rows accepted <= T. Decision t = T + 60 s. Entry = official open of the first session whose 09:28 ET
//                          MOO cut-off is >= t. Window = sessions [E, E+180] (the entry day's high/low count; entry is at its open).
//                          "First close" reference = close of the first session whose 15:50 ET MOC cut-off (12:50 early close) is >= t.
// Cluster rules (both clocks): A = >=2 distinct owners on one trade date; B = >=3 within a rolling 2-calendar-day window;
// C = >=5 within a rolling 7-calendar-day window; combined USD of the qualifying purchases strictly > $250,000.
// Repeats: after a cluster of category X fires for an issuer, no new X cluster for that issuer for 30 calendar days.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import * as P4 from "../deep4/panel/panelLib.mjs";

export const { decisionOf, entryDateOf, createMarket, addDays, dnum, isSession, nextSession, previousSession, closeTime, costBpsFor, netOf, symOf, mean, median, quantile, sd, cnt, group, COMPLETE_THROUGH } = P4;

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER = path.join(here, "..", "..", "..");
export const OUT = path.join(SERVER, ".cache", "research", "deep5");
export const STORE_START = "2025-12-01";
export const GAP = { pubFrom: "2025-12-24", pubTo: "2026-01-02", tradeFrom: "2025-12-15" }; // missing SEC days 12-24..12-31
export const HORIZONS = [7, 14, 30, 60, 90, 120, 180];
export const THRESH = [10, 20, 30, 50, 100];
export const MIN_USD = 250000; // strictly greater
export const DEFS = { A: { W: 1, N: 2, label: "2+ insiders, same day" }, B: { W: 2, N: 3, label: "3+ insiders, 2 days" }, C: { W: 7, N: 5, label: "5+ insiders, 7 days" } };
export const COOLDOWN = 30;
export const SIG_DD = 0.15;
export const K_CTRL = 5;
export const FILL_BUFFER = 0.005;
export const PERIODS = { designEnd: "2026-02-28", confirmStart: "2026-03-01" };
export const r6 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1e6) / 1e6);
export const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
export const writeOut = (name, data) => { const f = path.join(OUT, name); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof data === "string" ? data : JSON.stringify(data)); return f; };
export const readOut = (name) => JSON.parse(fs.readFileSync(path.join(OUT, name), "utf8"));
export function toCsv(rows, cols) {
  const esc = (v) => { if (v == null) return ""; const s = typeof v === "object" ? JSON.stringify(v) : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n") + "\n";
}

// ---------------- data ----------------
export function loadSec() { return JSON.parse(fs.readFileSync(path.join(SERVER, ".cache", "research", "deep2", "sec-rows.json"), "utf8")); }
export function loadNames() {
  const j = JSON.parse(fs.readFileSync(path.join(SERVER, ".cache", "company_tickers_exchange.json"), "utf8"));
  const m = new Map(); for (const [cik, name, ticker, exch] of j.data) if (!m.has(cik)) m.set(cik, { name, ticker, exch }); return m;
}

// ---------------- row eligibility (only information inside the filing + the trade-date bar) ----------------
export const SPLIT_FACTORS = [1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20, 25, 30, 35, 40, 50, 60, 75, 80, 100, 150, 200, 250, 300, 500, 1000];
export const OFFERING_RE = /(underwrit|public offering|private placement|registered direct|subscription agreement|securities purchase agreement|rights offering|directed share|initial public offering|\bIPO\b|concurrent (private|offering)|\bPIPE\b|at-the-market|purchase agreement with the (company|issuer)|from the (company|issuer) in)/i;
export function rowEligibility(r, bars) {
  if (r.code !== "P") return { ok: false, reason: "not_code_P" };
  if (!r.tradeDate) return { ok: false, reason: "no_trade_date" };
  if (r.tradeDate < STORE_START) return { ok: false, reason: "trade_before_sec_coverage" };
  if (r.amend === "amends") return { ok: false, reason: "4A_rereport_of_held_original" };
  if (r.priceCheck === "anomaly") return { ok: false, reason: "price_anomaly_flag" };
  if (!(r.price > 0) || !(r.shares > 0) || !(r.value > 0)) return { ok: false, reason: "no_price_or_value" };
  if (r.ctx === "offering_or_private") return { ok: false, reason: "offering_or_private_context" };
  if (OFFERING_RE.test(`${r.fn || ""} ${r.remarks || ""}`)) return { ok: false, reason: "offering_keyword_in_footnote" };
  const flags = [];
  const s = bars.get(symOf(r.ticker));
  if (s && s.arr.length) {
    if (r.tradeDate < s.arr[0].d) return { ok: false, reason: "trade_before_symbol_listed" };
    if (s.arr[0].d > "2025-10-01" && (s.arr[4]?.d ?? "9999") >= r.tradeDate) return { ok: false, reason: "trade_within_5_sessions_of_listing" }; // IPO allocations / concurrent placements
    const i = s.idx.get(r.tradeDate);
    if (i == null) flags.push("no_bar_on_trade_date");
    else {
      const b = s.arr[i], ratio = b.c / r.price;
      if (ratio > 1.8 || ratio < 0.55) {
        // a later split rescales the adjusted bars: accept only if a standard split factor puts the price inside the day's range
        const fit = SPLIT_FACTORS.flatMap((x) => [x, 1 / x]).find((x) => r.price * x >= b.l * 0.97 && r.price * x <= b.h * 1.03);
        if (fit == null) return { ok: false, reason: "price_outside_range_no_split_factor_fits" };
        flags.push("split_factor_applied");
      }
      else if (r.price < b.l * 0.97 || r.price > b.h * 1.03) return { ok: false, reason: "price_outside_trade_date_range" };
    }
  } else flags.push("no_bars");
  if (r.dedupe === "needs_review") flags.push("dedupe_needs_review");
  if (r.amend === "original_not_held") flags.push("4A_original_not_held");
  return { ok: true, flags };
}

// ---------------- owners: point-in-time identity linking within an issuer ----------------
const normName = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
// rows: the rows that may be used for linking (Clock 2: known at T). Returns Map(row.id -> group key).
export function ownerGroups(rows) {
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const add = (x) => { if (!parent.has(x)) parent.set(x, x); };
  const union = (a, b) => { add(a); add(b); const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  const keyOf = (r) => `cik:${r.insiderCik || normName(r.insider)}`;
  const econ = new Map();
  for (const r of rows) {
    const k = keyOf(r); add(k);
    const names = String(r.insider || "").split(";").map(normName).filter(Boolean);
    if (names.length === 1) union(k, `name:${names[0]}`);
    else for (const n of names) union(k, `name:${n}`); // joint filing: all listed owners are one beneficial-owner group
    if (r.own === "I") { // the same indirect transaction reported by two owners = one shared holding
      const ek = `${r.tradeDate}|${r.shares}|${r.price}`;
      if (econ.has(ek)) union(k, econ.get(ek)); else econ.set(ek, k);
    }
  }
  const out = new Map(); for (const r of rows) out.set(r.id, find(keyOf(r))); return out;
}

const inWindow = (r, d, W) => r.tradeDate <= d && dnum(r.tradeDate) > dnum(d) - W;
function qualifies(win, groups, def) {
  const owners = new Set(win.map((r) => groups.get(r.id)));
  const usd = win.reduce((a, r) => a + r.value, 0);
  return { ok: owners.size >= def.N && usd > MIN_USD, owners: owners.size, usd };
}

// Clock 1: by trade date, all eligible rows of the issuer (hindsight).
export function clustersClock1(rows, cat) {
  const def = DEFS[cat], out = [];
  const groups = ownerGroups(rows);
  const dates = [...new Set(rows.map((r) => r.tradeDate))].sort();
  let prev = null;
  for (const d of dates) {
    if (prev && dnum(d) - dnum(prev) < COOLDOWN) continue;
    const win = rows.filter((r) => inWindow(r, d, def.W));
    const q = qualifies(win, groups, def);
    if (!q.ok) continue;
    out.push({ clock: 1, cat, date: d, owners: q.owners, usd: q.usd, rows: win });
    prev = d;
  }
  return out;
}
// Clock 2: walk SEC acceptance stamps; only rows accepted <= T exist.
export function clustersClock2(rows, cat) {
  const def = DEFS[cat], out = [];
  const sorted = [...rows].sort((a, b) => (a.acceptedAt < b.acceptedAt ? -1 : a.acceptedAt > b.acceptedAt ? 1 : 0));
  const stamps = [...new Set(sorted.map((r) => r.acceptedAt))];
  let prevT = null, k = 0;
  for (const T of stamps) {
    while (k < sorted.length && sorted[k].acceptedAt <= T) k++;
    if (prevT && dnum(T) - dnum(prevT) < COOLDOWN) continue;
    const known = sorted.slice(0, k);
    const fresh = known.filter((r) => r.acceptedAt === T);
    const groups = ownerGroups(known);
    // candidate window ends: every trade date d such that the window [d-W+1, d] contains a row accepted at T
    const ends = new Set();
    for (const f of fresh) for (let j = 0; j < def.W; j++) ends.add(addDays(f.tradeDate, j));
    let best = null;
    for (const d of [...ends].sort()) {
      const win = known.filter((r) => inWindow(r, d, def.W));
      if (!win.some((r) => r.acceptedAt === T)) continue;
      const q = qualifies(win, groups, def);
      if (q.ok && (!best || q.usd > best.usd)) best = { d, ...q, win };
    }
    if (!best) continue;
    out.push({ clock: 2, cat, T, windowEnd: best.d, owners: best.owners, usd: best.usd, rows: best.win });
    prevT = T;
  }
  return out;
}

// ---------------- market helpers ----------------
export function makeMarket() {
  const M = createMarket();
  const sIdx = M.idx; // SPY session date -> index
  // series helpers by symbol: sorted bars with dates
  const ser = (sym) => M.bars.get(sym) || null;
  const lastBarOnOrBefore = (s, d) => { const a = s.arr; let lo = 0, hi = a.length - 1, ans = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (a[m].d <= d) { ans = m; lo = m + 1; } else hi = m - 1; } return ans; };
  const firstBarOnOrAfter = (s, d) => { const a = s.arr; let lo = 0, hi = a.length - 1, ans = a.length; while (lo <= hi) { const m = (lo + hi) >> 1; if (a[m].d >= d) { ans = m; hi = m - 1; } else lo = m + 1; } return ans; };
  const sessionsBetween = (a, b) => { const ia = M.firstOnOrAfter(a), ib = M.firstOnOrAfter(b); return ib - ia; };
  return { M, ser, lastBarOnOrBefore, firstBarOnOrAfter, sessionsBetween, sIdx };
}

// Features from bars strictly before `entryDate` (decision information).
export function featuresBefore(K, sym, entryDate) {
  const s = K.ser(sym); if (!s) return null;
  const i = K.lastBarOnOrBefore(s, addDays(entryDate, -1)); if (i < 0) return null;
  const a = s.arr, last = a[i];
  const closeAtOrBefore = (d) => { const j = K.lastBarOnOrBefore(s, d); return j >= 0 ? a[j].c : null; };
  const c30 = closeAtOrBefore(addDays(entryDate, -31)), c60 = closeAtOrBefore(addDays(entryDate, -61));
  const lo20 = Math.max(0, i - 19); let dv = 0, n = 0; for (let j = lo20; j <= i; j++) { dv += a[j].c * a[j].v; n++; }
  const rets = []; for (let j = Math.max(1, i - 39); j <= i; j++) rets.push(Math.log(a[j].c / a[j - 1].c));
  return {
    histBars: i + 1, lastBarDate: last.d, staleDays: dnum(entryDate) - dnum(last.d), price: last.c,
    adv20: n ? dv / n : null, r30: c30 ? last.c / c30 - 1 : null, r60: c60 ? last.c / c60 - 1 : null,
    vol40: rets.length >= 20 ? sd(rets) : null,
  };
}
export function spyAbove50(K, entryDate) {
  const s = K.ser("SPY"); const i = K.lastBarOnOrBefore(s, addDays(entryDate, -1)); if (i < 49) return null;
  let m = 0; for (let j = i - 49; j <= i; j++) m += s.arr[j].c; return s.arr[i].c > m / 50 ? 1 : 0;
}

// 180-day path from a given entry. mode "open": entry = open of bar on entryDate, window bars [entryDate, entryDate+180].
// mode "close": entry = close of bar on entryDate, window bars (entryDate, entryDate+180].
export function pathOutcome(K, sym, entryDate, mode) {
  const s = K.ser(sym); if (!s) return { status: "no_bars" };
  const a = s.arr; const i0 = s.idx.get(entryDate);
  if (i0 == null) return { status: "no_bar_on_entry_date" };
  const entry = mode === "open" ? a[i0].o : a[i0].c;
  if (!(entry > 0)) return { status: "bad_entry_price" };
  const endD = addDays(entryDate, 180);
  const full = endD <= COMPLETE_THROUGH;
  const startI = mode === "open" ? i0 : i0 + 1;
  let maxH = -Infinity, maxHD = null, maxC = -Infinity, maxCD = null, minL = Infinity, minLD = null, peakC = entry, ptdd = 0;
  const touchH = Object.fromEntries(THRESH.map((t) => [t, null])), touchC = Object.fromEntries(THRESH.map((t) => [t, null]));
  let lastI = null, sigDDDate = null;
  for (let j = startI; j < a.length && a[j].d <= endD; j++) {
    const b = a[j]; lastI = j;
    if (b.h > maxH) { maxH = b.h; maxHD = b.d; }
    if (b.c > maxC) { maxC = b.c; maxCD = b.d; }
    if (b.l < minL) { minL = b.l; minLD = b.d; }
    if (!sigDDDate && b.l <= entry * (1 - SIG_DD)) sigDDDate = b.d;
    peakC = Math.max(peakC, b.c); ptdd = Math.min(ptdd, b.c / peakC - 1);
    for (const t of THRESH) { if (!touchH[t] && b.h >= entry * (1 + t / 100)) touchH[t] = b.d; if (!touchC[t] && b.c >= entry * (1 + t / 100)) touchC[t] = b.d; }
  }
  if (lastI == null) return { status: full ? "no_bars_in_window" : "immature_no_bars", entry };
  const lastBarDate = a.at(-1).d;
  const endedEarly = full && lastBarDate < addDays(endD, -7); // series stops inside the window (delisting, halt or ticker change)
  const ret = {};
  for (const D of HORIZONS) {
    const hd = addDays(entryDate, D);
    if (hd > COMPLETE_THROUGH) { ret[D] = null; continue; }
    const j = K.lastBarOnOrBefore(s, hd);
    ret[D] = j >= i0 ? a[j].c / entry - 1 : null; // series that ended inside the window carry their last close (flagged endedEarly)
  }
  const dd = (d) => (d ? dnum(d) - dnum(entryDate) : null);
  return {
    status: full ? (endedEarly ? "full_180d_series_ended" : "full_180d") : "partial",
    entryDate, entry, observedThrough: a[lastI].d, endedEarly,
    maxGain: maxH / entry - 1, maxDate: maxHD, daysToMax: dd(maxHD), sessToMax: K.sessionsBetween(entryDate, maxHD),
    maxCloseGain: maxC / entry - 1, maxCloseDate: maxCD, daysToMaxClose: dd(maxCD),
    minLowRet: minL / entry - 1, minLowDate: minLD, closeDrawdown: ptdd,
    sigDD: sigDDDate ? (maxHD < sigDDDate ? "peak_before_drawdown" : "peak_after_drawdown") : "no_drawdown_15",
    ret, touchH: Object.fromEntries(THRESH.map((t) => [t, dd(touchH[t])])), touchC: Object.fromEntries(THRESH.map((t) => [t, dd(touchC[t])])),
  };
}

// First session whose MOC cut-off (close - 10 min) is >= t.
export function firstCloseDate(t) {
  const cut = (d) => { const ct = closeTime(d); const [h, m] = ct.split(":").map(Number); const mm = h * 60 + m - 10; return `${String(Math.floor(mm / 60)).padStart(2, "0")}:${String(mm % 60).padStart(2, "0")}:00`; };
  return isSession(t.date) && t.time <= cut(t.date) ? t.date : nextSession(t.date);
}

// ---------------- statistics ----------------
export function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// Issuer-clustered bootstrap of a statistic over items with .issuer. Returns { est, lo90, hi90, lo95, hi95, p } (two-sided, H0: 0).
export function clusterBoot(items, stat, { reps = 2000, seed = 11 } = {}) {
  const est = stat(items); if (est == null || !items.length) return { est: null, n: items.length };
  const by = group(items, (x) => x.issuer); const keys = [...by.keys()]; const R = rng(seed); const bs = [];
  for (let b = 0; b < reps; b++) { const smp = []; for (let i = 0; i < keys.length; i++) smp.push(...by.get(keys[Math.floor(R() * keys.length)])); const v = stat(smp); if (v != null && Number.isFinite(v)) bs.push(v); }
  bs.sort((x, y) => x - y); const q = (p) => bs[Math.min(bs.length - 1, Math.max(0, Math.floor(p * bs.length)))];
  const centered = bs.map((v) => v - mean(bs)); const p = Math.min(1, (centered.filter((v) => Math.abs(v) >= Math.abs(est)).length + 1) / (bs.length + 1));
  return { est, n: items.length, issuers: keys.length, lo90: q(0.05), hi90: q(0.95), lo95: q(0.025), hi95: q(0.975), p };
}
export function spearman(xs, ys) {
  const n = xs.length; if (n < 5) return null;
  const rank = (v) => { const o = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]); const r = new Array(n); let i = 0; while (i < n) { let j = i; while (j + 1 < n && o[j + 1][0] === o[i][0]) j++; for (let k = i; k <= j; k++) r[o[k][1]] = (i + j) / 2; i = j + 1; } return r; };
  const rx = rank(xs), ry = rank(ys), mx = mean(rx), my = mean(ry);
  let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { sxy += (rx[i] - mx) * (ry[i] - my); sxx += (rx[i] - mx) ** 2; syy += (ry[i] - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}
export function bh(ps) { const idx = ps.map((p, i) => [p, i]).filter(([p]) => p != null).sort((a, b) => a[0] - b[0]); const m = idx.length; const q = new Array(ps.length).fill(null); let min = 1; for (let k = m - 1; k >= 0; k--) { min = Math.min(min, (idx[k][0] * m) / (k + 1)); q[idx[k][1]] = min; } return q; }
