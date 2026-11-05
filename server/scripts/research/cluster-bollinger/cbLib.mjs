// cluster-bollinger/cbLib.mjs — signals, Bollinger bands and trade simulation. RESEARCH ONLY, cache only.
// Rules: spec.json in this folder (hash logged in .cache/research/cluster-bollinger/spec.log before any computation).
import fs from "node:fs";
import path from "node:path";
import * as L from "../deep5/lib5.mjs";
export { L };
const { addDays, dnum, symOf, group, mean, median } = L;

export const OUT = path.join(L.SERVER, ".cache", "research", "cluster-bollinger");
export const writeOut = (name, data) => { const f = path.join(OUT, name); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof data === "string" ? data : JSON.stringify(data)); return f; };
export const readOut = (name) => JSON.parse(fs.readFileSync(path.join(OUT, name), "utf8"));

export const SPAC_RE = /acquisition (corp|co\b|company|inc|ltd|holdings)|blank check|\bspac\b|merger corp/i;
export const OFFICER_RE = /chief|\bceo\b|\bcfo\b|\bcoo\b|\bcto\b|president|\bvp\b|vice president|treasurer|secretary|general counsel|officer|controller/i;
export const TEST_START = "2026-06-01";
export const BB_N = 20, BB_K = 2.5, STOP_MULT = 0.98, TIME_STOP = 45, FIXED_HOLD = 20, CHASE = 1.07, STOP_SLIP = 0.0025;

// ---------- row eligibility (deep5 rules + 424B4 + SPAC + exact duplicates) ----------
export function eligibleRows(sec, bars, names) {
  const ipo = JSON.parse(fs.readFileSync(path.join(L.SERVER, ".cache", "ipo-context.v1.json"), "utf8")).issuers || {};
  const excl = {}, out = [], seen = new Set();
  const bump = (k) => { excl[k] = (excl[k] || 0) + 1; };
  for (const r of sec.rows) {
    if (r.code !== "P") continue;
    const dk = [r.acc, r.tradeDate, r.shares, r.price, r.own, r.nature, r.after].join("|");
    if (seen.has(dk)) { bump("exact_duplicate_row_in_filing"); continue; }
    seen.add(dk);
    const e = L.rowEligibility(r, bars);
    if (!e.ok) { bump(e.reason); continue; }
    const nm = names.get(r.cik)?.name || "";
    if (SPAC_RE.test(nm)) { bump("spac_or_blank_check_name"); continue; }
    const pros = ipo[String(r.cik)]?.prospectuses || [];
    if (pros.some((p) => p.form === "424B4" && p.filingDate <= r.tradeDate && p.filingDate >= addDays(r.tradeDate, -30))) { bump("424B4_prospectus_within_30d"); continue; }
    out.push({ ...r, flags: e.flags });
  }
  return { rows: out, excl };
}

// split factor that maps an as-reported price onto the split-adjusted bar scale
export function splitFactor(K, r) {
  const s = K.ser(symOf(r.ticker)); if (!s) return 1;
  const i = K.lastBarOnOrBefore(s, r.tradeDate); if (i < 0) return 1;
  const ratio = s.arr[i].c / r.price;
  if (ratio >= 0.55 && ratio <= 1.8) return 1;
  let best = 1, bd = Infinity;
  for (const x of L.SPLIT_FACTORS.flatMap((x) => [x, 1 / x])) { const d = Math.abs(Math.log((r.price * x) / s.arr[i].c)); if (d < bd) { bd = d; best = x; } }
  return best;
}

// ---------- cluster evaluation at acceptance time T ----------
// known: eligible rows of the issuer accepted <= T. Returns the attributes needed by every rule set.
export function evaluateAt(known, T, K) {
  const dT = T.slice(0, 10), lo = addDays(dT, -5);
  const groups = L.ownerGroups(known);
  const win = known.filter((r) => r.tradeDate >= lo && r.tradeDate <= dT);
  const byOwner = group(win, (r) => groups.get(r.id));
  const owners = [], dropped5 = [];
  for (const [g, rs] of byOwner) {
    const sh = rs.reduce((a, r) => a + r.shares, 0), val = rs.reduce((a, r) => a + r.value, 0);
    const o = { g, rows: rs, value: val, shares: sh, avgPrice: val / sh, names: [...new Set(rs.map((r) => r.insider))].join("; "), roles: [...new Set(rs.map((r) => r.role || ""))].join("; "), officer: rs.some((r) => OFFICER_RE.test(r.role || "")) };
    // dOwn per ownership line: pre = min(after - shares) over the line's rows (= holding before the earliest purchase for pure-buy sequences)
    const lines = group(rs, (r) => `${r.own}|${r.nature || ""}`);
    o.lines = [...lines.entries()].map(([k, lr]) => {
      const bought = lr.reduce((a, r) => a + r.shares, 0);
      const pres = lr.map((r) => (r.after > 0 ? r.after - r.shares : null));
      const pre = pres.some((p) => p == null) ? null : Math.min(...pres);
      return { line: k, bought, pre, dOwn: pre > 0 ? bought / pre : null };
    });
    const valid = o.lines.filter((l) => l.dOwn != null);
    o.dOwn = valid.length ? valid.reduce((a, l) => a + l.bought, 0) / valid.reduce((a, l) => a + l.pre, 0) : null;
    if (o.avgPrice >= 5) owners.push(o); else dropped5.push(o);
  }
  const value = owners.reduce((a, o) => a + o.value, 0);
  const vl = owners.flatMap((o) => o.lines.filter((l) => l.dOwn != null));
  const dOwn = vl.length ? vl.reduce((a, l) => a + l.bought, 0) / vl.reduce((a, l) => a + l.pre, 0) : null;
  const rows = owners.flatMap((o) => o.rows);
  const vwapAdj = rows.length ? rows.reduce((a, r) => a + r.value, 0) / rows.reduce((a, r) => a + r.shares / splitFactor(K, r), 0) : null;
  const tier = value >= 1.5e6 ? (owners.length >= 2 && dOwn >= 0.03 ? "T1" : null) : value >= 5e5 ? (owners.length >= 2 && dOwn >= 0.06 ? "T2" : null) : value >= 2.5e5 ? (owners.length >= 3 && dOwn >= 0.10 ? "T3" : null) : null;
  const band = value >= 1.5e6 ? "T1" : value >= 5e5 ? "T2" : value >= 2.5e5 ? "T3" : "below";
  const base = owners.length >= 2 && owners.some((o) => o.officer) && value >= 2.5e5 && dOwn != null;
  let fail = null;
  if (win.length && new Set(win.map((r) => groups.get(r.id))).size < 2) fail = "fewer_than_2_owners";
  else if (owners.length < 2) fail = "fewer_than_2_owners_after_$5_price_rule";
  else if (!owners.some((o) => o.officer)) fail = "no_officer";
  else if (value < 2.5e5) fail = "value_below_250k";
  else if (dOwn == null) fail = "no_valid_dOwn";
  return { T, owners, dropped5, value, dOwn, vwapAdj, tier, band, base, tiered: base && !!tier, fail: fail || (base && !tier ? `tier_${band}_failed` : null), rows, hasFresh: win.some((r) => r.acceptedAt === T) };
}

// Signals for one issuer. ruleKey: "base" (A, C) or "tiered" (B, D). Episodes start at the first T with >= 2 distinct owners in
// the 5-day window and last 30 days; the signal fires at the first T in the episode meeting the rule. 30-day cooldown after a signal.
export function issuerSignals(rows, K) {
  const sorted = [...rows].sort((a, b) => (a.acceptedAt < b.acceptedAt ? -1 : a.acceptedAt > b.acceptedAt ? 1 : 0));
  const stamps = [...new Set(sorted.map((r) => r.acceptedAt))];
  const episodes = []; let ep = null, k = 0;
  for (const T of stamps) {
    while (k < sorted.length && sorted[k].acceptedAt <= T) k++;
    if (ep && dnum(T) - dnum(ep.start) >= 30) { episodes.push(ep); ep = null; }
    const ev = evaluateAt(sorted.slice(0, k), T, K);
    if (!ep) { if (ev.fail === "fewer_than_2_owners" || !ev.hasFresh) continue; const nOwn = ev.owners.length + ev.dropped5.length; if (nOwn < 2) continue; ep = { start: T, evals: [] }; }
    if (ev.hasFresh) ep.evals.push(ev);
  }
  if (ep) episodes.push(ep);
  return episodes.map((e) => ({ start: e.start, base: e.evals.find((v) => v.base) || null, tiered: e.evals.find((v) => v.tiered) || null, last: e.evals.reduce((b, v) => (!b || v.value > b.value ? v : b), null) }));
}

// ---------- bands ----------
const bandMemo = new Map();
export function bands(K, sym) {
  if (bandMemo.has(sym)) return bandMemo.get(sym);
  const a = K.ser(sym)?.arr; if (!a) return null;
  const up = new Float64Array(a.length).fill(NaN), lo = new Float64Array(a.length).fill(NaN), mid = new Float64Array(a.length).fill(NaN);
  for (let i = BB_N - 1; i < a.length; i++) {
    let s = 0; for (let j = i - BB_N + 1; j <= i; j++) s += a[j].c; const m = s / BB_N;
    let v = 0; for (let j = i - BB_N + 1; j <= i; j++) v += (a[j].c - m) ** 2; const sd = Math.sqrt(v / BB_N);
    mid[i] = m; up[i] = m + BB_K * sd; lo[i] = m - BB_K * sd;
  }
  const b = { up, lo, mid }; bandMemo.set(sym, b); return b;
}

// ---------- trade simulation for one entry (independent of portfolio size) ----------
// mode "fixed": exit at close of session FIXED_HOLD. mode "bb": Bollinger exits (+ time stop unless timeStop=false).
export function simulate(K, sym, entryDate, { mode, timeStop = true, vwapAdj = null, chase = false }) {
  const s = K.ser(sym); if (!s) return { status: "no_bars" };
  const a = s.arr; const iE = s.idx.get(entryDate);
  if (iE == null) return { status: "no_bar_on_entry_date" };
  if (iE < 40) return { status: "fewer_than_40_bars" };
  const entry = a[iE].o; if (!(entry > 0)) return { status: "bad_entry_price" };
  if (chase && vwapAdj && entry > vwapAdj * CHASE) return { status: "cancelled_chase_7pct", entry, vwapAdj };
  let dv = 0; for (let j = iE - 20; j < iE; j++) dv += a[j].c * a[j].v; const adv20 = dv / 20;
  const cost = L.costBpsFor(adv20) / 1e4;
  const B = bands(K, sym); const lowerAtEntry = B.lo[iE - 1], upperAtEntry = B.up[iE - 1];
  const stop = mode === "bb" ? lowerAtEntry * STOP_MULT : null;
  if (mode === "bb" && !(entry > stop)) return { status: "invalid_stop_distance", entry, stop };
  const sessIdx = (d) => K.M.firstOnOrAfter(d);
  const s0 = sessIdx(entryDate);
  const lastComplete = L.COMPLETE_THROUGH;
  let pendingDyn = false;
  for (let j = iE; j < a.length; j++) {
    const b = a[j]; if (b.d > lastComplete) break;
    const k = sessIdx(b.d) - s0 + 1;
    const done = (px, reason, slip = 0) => ({ status: "closed", entryDate, entry, exitDate: b.d, exit: px, reason, sessions: k, cost, stop, lowerAtEntry, upperAtEntry, adv20,
      gross: px / entry - 1, net: (px * (1 - cost - slip)) / (entry * (1 + cost)) - 1 });
    if (mode === "fixed") { if (k >= FIXED_HOLD) return done(b.c, "fixed_20_sessions"); }
    else {
      if (pendingDyn && j > iE) return done(b.o, "dynamic_stop_close_below_lower");
      if (b.o <= stop && j > iE) return done(b.o, "hard_stop_gap", STOP_SLIP);
      if (b.l <= stop) return done(stop, "hard_stop", STOP_SLIP);
      const lim = B.up[j - 1];
      if (j > iE && b.o >= lim) return done(b.o, "take_profit_gap");
      if (b.h >= lim) return done(Math.max(lim, j === iE ? entry : lim), "take_profit");
      if (b.c < B.lo[j]) pendingDyn = true;
      if (timeStop && k >= TIME_STOP) return done(b.c, "time_stop_45");
    }
    if (j === a.length - 1 && b.d < addDays(lastComplete, -7)) return { ...done(b.c, "delisted_last_close"), delisted: true };
  }
  const j = a.findLastIndex((b) => b.d <= lastComplete);
  return { status: "open_at_data_end", entryDate, entry, lastDate: a[j].d, lastClose: a[j].c, cost, stop, lowerAtEntry, upperAtEntry, adv20, gross: a[j].c / entry - 1, net: (a[j].c * (1 - cost)) / (entry * (1 + cost)) - 1, sessions: sessIdx(a[j].d) - s0 + 1 };
}

// path of daily closes for marking positions to market
export function closeOn(K, sym, d) { const s = K.ser(sym); const i = K.lastBarOnOrBefore(s, d); return i >= 0 ? s.arr[i].c : null; }
