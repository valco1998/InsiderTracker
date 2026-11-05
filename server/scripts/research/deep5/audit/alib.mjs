// deep5/audit/alib.mjs — INDEPENDENT re-implementation of the deep-5 pipeline for the adversarial audit.
// Imports nothing from deep5 (or deep2-4) code. Reads only cached files. RESEARCH ONLY.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER = path.resolve(here, "..", "..", "..", "..");
export const OUT = path.join(SERVER, ".cache", "research", "deep5", "audit");
export const D5 = path.join(SERVER, ".cache", "research", "deep5");
fs.mkdirSync(OUT, { recursive: true });
export const COMPLETE = "2026-11-03";
export const STORE_START = "2025-12-01";
export const DEFS = { A: { W: 1, N: 2 }, B: { W: 2, N: 3 }, C: { W: 7, N: 5 } };
export const HOR = [7, 14, 30, 60, 90, 120, 180];
export const TH = [10, 20, 30, 50, 100];

// ---------- small utils ----------
const DAY = 86400000;
export const dn = (s) => Math.round(Date.parse(String(s).slice(0, 10) + "T00:00:00Z") / DAY);
export const add = (d, n) => new Date((dn(d) + n) * DAY).toISOString().slice(0, 10);
export const avg = (a) => { const v = a.filter((x) => x != null && Number.isFinite(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
export const med = (a) => { const v = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); if (!v.length) return null; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
export const qtl = (a, p) => { const v = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); if (!v.length) return null; const i = p * (v.length - 1), lo = Math.floor(i), hi = Math.ceil(i); return v[lo] + (v[hi] - v[lo]) * (i - lo); };
export const sdev = (a) => { if (a.length < 3) return null; const m = avg(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
export const sym = (t) => String(t || "").trim().toUpperCase().replace(/-/g, ".");
export const byKey = (a, f) => { const m = new Map(); for (const x of a) { const k = f(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; };
export function csv(rows, cols) {
  cols = cols || [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const e = (v) => { if (v == null) return ""; if (typeof v === "number") return Number.isFinite(v) ? String(Math.round(v * 1e6) / 1e6) : ""; const s = typeof v === "object" ? JSON.stringify(v) : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => e(r[c])).join(","))].join("\n") + "\n";
}
export const save = (name, data) => { const f = path.join(OUT, name); fs.writeFileSync(f, typeof data === "string" ? data : JSON.stringify(data, null, 1)); return f; };
export function rand(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
export function sampleK(arr, k, seed) { const R = rand(seed), a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, k); }

// ---------- data ----------
export function loadRows() { return JSON.parse(fs.readFileSync(path.join(SERVER, ".cache", "research", "deep2", "sec-rows.json"), "utf8")).rows; }
export function loadRawBars() { return JSON.parse(fs.readFileSync(path.join(SERVER, ".cache", "research", "daily-bars.json"), "utf8")); }
export function market(raw = loadRawBars()) {
  const S = new Map();
  for (const [k, a] of Object.entries(raw)) { if (k === "__meta" || !Array.isArray(a) || !a.length) continue; S.set(k, { a, D: a.map((b) => b[0]), ix: new Map(a.map((b, i) => [b[0], i])) }); }
  const cal = S.get("SPY").D, cix = new Map(cal.map((d, i) => [d, i]));
  const isSess = (d) => cix.has(d);
  const nextSess = (d) => { for (const x of cal) if (x > d) return x; return null; };
  // last index with date <= d (binary search)
  const le = (s, d) => { let lo = 0, hi = s.D.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (s.D[m] <= d) { r = m; lo = m + 1; } else hi = m - 1; } return r; };
  const ge = (s, d) => { let lo = 0, hi = s.D.length - 1, r = s.D.length; while (lo <= hi) { const m = (lo + hi) >> 1; if (s.D[m] >= d) { r = m; hi = m - 1; } else lo = m + 1; } return r; };
  return { raw, S, cal, cix, isSess, nextSess, le, ge };
}

// ---------- eligibility ----------
const SPLITS = [1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20, 25, 30, 35, 40, 50, 60, 75, 80, 100, 150, 200, 250, 300, 500, 1000];
const OFFER = /(underwrit|public offering|private placement|registered direct|subscription agreement|securities purchase agreement|rights offering|directed share|initial public offering|\bIPO\b|concurrent (private|offering)|\bPIPE\b|at-the-market|purchase agreement with the (company|issuer)|from the (company|issuer) in)/i;
// opt: { priceRange: true, listing: true, amendReplace: false }
export function eligible(r, K, opt = {}) {
  const o = { priceRange: true, listing: true, amendReplace: false, ...opt };
  if (r.code !== "P" || !r.tradeDate) return "x_basic";
  if (r.tradeDate < STORE_START) return "x_before_store";
  if (!o.amendReplace && r.amend === "amends") return "x_4A_amends";
  if (o.amendReplace && r.amend === "superseded") return "x_superseded_original";
  if (r.priceCheck === "anomaly") return "x_anomaly";
  if (!(r.price > 0 && r.shares > 0 && r.value > 0)) return "x_noprice";
  if (r.ctx === "offering_or_private") return "x_offering_ctx";
  if (OFFER.test((r.fn || "") + " " + (r.remarks || ""))) return "x_offering_kw";
  const s = K.S.get(sym(r.ticker));
  if (s) {
    if (r.tradeDate < s.D[0]) return "x_before_listed";
    if (o.listing && s.D[0] > "2025-10-01" && (s.D[4] || "9999") >= r.tradeDate) return "x_listing5";
    const i = s.ix.get(r.tradeDate);
    if (i != null && o.priceRange) {
      const [, , h, l, c] = s.a[i]; const ratio = c / r.price;
      if (ratio > 1.8 || ratio < 0.55) { if (!SPLITS.flatMap((x) => [x, 1 / x]).some((x) => r.price * x >= l * 0.97 && r.price * x <= h * 1.03)) return "x_price_split"; }
      else if (r.price < l * 0.97 || r.price > h * 1.03) return "x_price_range";
    }
  }
  return "ok";
}
export function eligibleRows(rows, K, opt = {}) {
  const seen = new Set(), out = [], why = {};
  for (const r of rows) {
    if (r.code !== "P") continue;
    const k = `${r.acc}|${r.tradeDate}|${r.shares}|${r.price}|${r.own}|${r.nature}|${r.after}`;
    if (seen.has(k)) { why.x_dup = (why.x_dup || 0) + 1; continue; }
    seen.add(k);
    const e = eligible(r, K, opt); why[e] = (why[e] || 0) + 1;
    if (e === "ok") out.push(r);
  }
  return { rows: out, why };
}

// ---------- owners ----------
const nn = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
export function owners(rows, mode = "linked") {
  const m = new Map();
  if (mode === "cik") { for (const r of rows) m.set(r.id, r.insiderCik || nn(r.insider)); return m; }
  const P = new Map(); const f = (x) => { if (!P.has(x)) P.set(x, x); while (P.get(x) !== x) x = P.get(x); return x; };
  const u = (a, b) => { const A = f(a), B = f(b); if (A !== B) P.set(A, B); };
  const seenI = new Map();
  for (const r of rows) {
    const k = "C" + (r.insiderCik || nn(r.insider)); f(k);
    for (const n of String(r.insider || "").split(";").map(nn).filter(Boolean)) u(k, "N" + n);
    if (r.own === "I") { const e = `${r.tradeDate}|${r.shares}|${r.price}`; if (seenI.has(e)) u(k, seenI.get(e)); else seenI.set(e, k); }
  }
  for (const r of rows) m.set(r.id, f("C" + (r.insiderCik || nn(r.insider))));
  return m;
}
function evalWin(rows, end, W, N, G) { const w = rows.filter((r) => r.tradeDate <= end && dn(r.tradeDate) > dn(end) - W); const ow = new Set(w.map((r) => G.get(r.id))).size; const usd = w.reduce((s, r) => s + r.value, 0); return { w, ow, usd, ok: ow >= N && usd > 250000 }; }
export function clock1(rows, cat, mode) {
  const { W, N } = DEFS[cat]; const G = owners(rows, mode); const out = [];
  const dates = [...new Set(rows.map((r) => r.tradeDate))].sort(); let last = null;
  for (const d of dates) { if (last && dn(d) - dn(last) < 30) continue; const q = evalWin(rows, d, W, N, G); if (q.ok) { out.push({ clock: 1, cat, date: d, owners: q.ow, usd: q.usd, rows: q.w }); last = d; } }
  return out;
}
export function clock2(rows, cat, mode) {
  const { W, N } = DEFS[cat]; const out = [];
  const stamps = [...new Set(rows.map((r) => r.acceptedAt))].sort(); let last = null;
  for (const T of stamps) {
    if (last && dn(T) - dn(last) < 30) continue;
    const known = rows.filter((r) => r.acceptedAt <= T); const G = owners(known, mode);
    const fresh = known.filter((r) => r.acceptedAt === T); let best = null;
    const ends = new Set(); for (const r of fresh) for (let j = 0; j < W; j++) ends.add(add(r.tradeDate, j));
    for (const e of [...ends].sort()) { const q = evalWin(known, e, W, N, G); if (!q.w.some((r) => r.acceptedAt === T) || !q.ok) continue; if (!best || q.usd > best.usd) best = { e, ...q }; }
    if (best) { out.push({ clock: 2, cat, T, windowEnd: best.e, owners: best.ow, usd: best.usd, rows: best.w }); last = T; }
  }
  return out;
}
// all clusters for a set of eligible rows
export function allClusters(rows, mode = "linked") {
  const out = [];
  for (const [cik, rs] of byKey(rows, (r) => r.cik)) for (const cat of ["A", "B", "C"]) { for (const c of clock1(rs, cat, mode)) out.push({ ...c, cik }); for (const c of clock2(rs, cat, mode)) out.push({ ...c, cik }); }
  for (const c of out) {
    c.id = c.clock === 1 ? `c1:${c.cat}:${c.cik}:${c.date}` : `c2:${c.cat}:${c.cik}:${c.T}`;
    const tc = {}; for (const r of c.rows) if (r.ticker) tc[r.ticker] = (tc[r.ticker] || 0) + 1;
    c.ticker = sym(Object.entries(tc).sort((a, b) => b[1] - a[1])[0]?.[0] || "");
    const ds = c.rows.map((r) => r.tradeDate).sort(); c.windowStart = ds[0]; c.windowEnd2 = ds.at(-1);
    c.gap = c.clock === 1 ? (c.date >= "2025-12-15" && c.date <= "2026-01-02" ? 1 : 0) : ((c.T.slice(0, 10) >= "2025-12-24" && c.T.slice(0, 10) <= "2026-01-02") || (c.windowStart <= "2025-12-31" && c.windowEnd2 >= "2025-12-15") ? 1 : 0);
  }
  return out;
}

// ---------- entry ----------
export function decision(T) { const t = new Date(Date.parse(T.replace(" ", "T") + "Z") + 60000).toISOString(); return { date: t.slice(0, 10), time: t.slice(11, 19) }; }
export function entryOf(c, K) {
  if (!c.ticker) return { st: "no_ticker" };
  const s = K.S.get(c.ticker); if (!s) return { st: "no_bars" };
  if (c.clock === 1) { const i = K.le(s, c.date); if (i < 0) return { st: "no_bar_before" }; return { st: "ok", E: s.D[i], mode: "close" }; }
  const t = decision(c.T); const E = K.isSess(t.date) && t.time <= "09:28:00" ? t.date : K.nextSess(t.date);
  if (!E) return { st: "future" };
  const j = K.ge(s, E); if (j >= s.D.length || dn(s.D[j]) - dn(E) > 5) return { st: "no_bar_near_entry", sched: E };
  return { st: "ok", E: s.D[j], mode: "open", sched: E };
}

// ---------- outcome path ----------
export function path180(K, sy, E, mode) {
  const s = K.S.get(sy); if (!s) return null; const i0 = s.ix.get(E); if (i0 == null) return null;
  const a = s.a; const entry = mode === "open" ? a[i0][1] : a[i0][4]; if (!(entry > 0)) return null;
  const end = add(E, 180); const full = end <= COMPLETE;
  let mH = -1, mHd = null, mC = -1, mCd = null, mL = Infinity; const hit = {}; for (const t of TH) hit[t] = null;
  let n = 0;
  for (let j = mode === "open" ? i0 : i0 + 1; j < a.length && a[j][0] <= end; j++) {
    const [d, , h, l, c] = a[j]; n++;
    if (h > mH) { mH = h; mHd = d; } if (c > mC) { mC = c; mCd = d; } if (l < mL) mL = l;
    for (const t of TH) if (hit[t] == null && h >= entry * (1 + t / 100)) hit[t] = dn(d) - dn(E);
  }
  if (!n) return { entry, full, empty: true };
  const ret = {};
  for (const D of HOR) { const hd = add(E, D); if (hd > COMPLETE) { ret[D] = null; continue; } const j = K.le(s, hd); ret[D] = j >= i0 ? a[j][4] / entry - 1 : null; }
  const endedEarly = full && s.D.at(-1) < add(end, -7);
  return { entry, full, endedEarly, maxGain: mH / entry - 1, maxDate: mHd, daysToMax: dn(mHd) - dn(E), sessToMax: K.cix.get(mHd) - K.cix.get(E), maxCloseGain: mC / entry - 1, maxCloseDate: mCd, minLowRet: mL / entry - 1, ret, hit, nBars: n };
}
// features strictly before E
export function feats(K, sy, E) {
  const s = K.S.get(sy); if (!s) return null; const i = K.le(s, add(E, -1)); if (i < 0) return null; const a = s.a;
  const cAt = (d) => { const j = K.le(s, d); return j >= 0 ? a[j][4] : null; };
  const c30 = cAt(add(E, -31)), c60 = cAt(add(E, -61));
  let dv = 0, n = 0; for (let j = Math.max(0, i - 19); j <= i; j++) { dv += a[j][4] * a[j][5]; n++; }
  const lr = []; for (let j = Math.max(1, i - 39); j <= i; j++) lr.push(Math.log(a[j][4] / a[j - 1][4]));
  return { hist: i + 1, stale: dn(E) - dn(a[i][0]), price: a[i][4], adv: dv / n, r30: c30 ? a[i][4] / c30 - 1 : null, r60: c60 ? a[i][4] / c60 - 1 : null, vol: lr.length >= 20 ? sdev(lr) : null };
}
export const costOf = (adv) => (!(adv > 0) ? 100 : adv >= 50e6 ? 5 : adv >= 5e6 ? 15 : adv >= 1e6 ? 35 : 75) / 1e4;
export const net = (g, c) => (g == null ? null : ((1 + g) * (1 - c)) / (1 + c) - 1);
export const featOk = (f, checkStale = true) => f && f.hist >= 30 && (!checkStale || f.stale <= 7) && f.adv > 0 && f.vol > 0 && f.r30 != null && f.r60 != null && f.price > 0;
export const vecOf = (f) => [Math.log(f.adv), f.r30, f.r60, Math.log(f.vol), Math.log(f.price)];

// ---------- full pipeline ----------
// returns { clusters, unions:{1:[],2:[]}, main } with outcomes and controls (mean of up to 5 nearest point-in-time pool symbols)
export function pipeline(K, elig, { mode = "linked", allP, withControls = true } = {}) {
  const clusters = allClusters(elig, mode);
  const pMemo = new Map(), fMemo = new Map();
  const P = (sy, E, m) => { const k = `${sy}|${E}|${m}`; if (!pMemo.has(k)) pMemo.set(k, path180(K, sy, E, m)); return pMemo.get(k); };
  const F = (sy, E) => { const k = `${sy}|${E}`; if (!fMemo.has(k)) fMemo.set(k, feats(K, sy, E)); return fMemo.get(k); };
  for (const c of clusters) {
    const en = entryOf(c, K); c.entrySt = en.st; if (en.st !== "ok") continue;
    c.E = en.E; c.mode = en.mode; c.f = F(c.ticker, c.E); c.cost = costOf(c.f?.adv);
    const o = P(c.ticker, c.E, c.mode); c.o = o; if (!o || o.empty) continue;
    const spy = P("SPY", c.E, c.mode); c.spy = spy;
    c.full180 = o.full ? 1 : 0;
    c.r180 = o.ret[180]; c.n180 = net(o.ret[180], c.cost); c.x180 = c.n180 != null && spy.ret[180] != null ? c.n180 - spy.ret[180] : null;
    c.maxGain = o.maxGain; c.hit20 = o.hit[20] != null ? 1 : 0;
  }
  // unions
  const unions = { 1: [], 2: [] };
  const tOf = (c) => (c.clock === 1 ? c.date : c.T);
  for (const clock of [1, 2]) for (const [, cs] of byKey(clusters.filter((c) => c.clock === clock), (c) => c.cik)) {
    cs.sort((a, b) => (tOf(a) < tOf(b) ? -1 : tOf(a) > tOf(b) ? 1 : 0)); let cur = null;
    for (const c of cs) { if (cur && dn(tOf(c)) - dn(tOf(cur.rep)) < 30) { cur.cats.add(c.cat); continue; } cur = { rep: c, cats: new Set([c.cat]) }; unions[clock].push(cur); }
  }
  // clock-1 link for clock-2 unions
  for (const u of unions[2]) { const v = unions[1].filter((x) => x.rep.cik === u.rep.cik && x.rep.date <= u.rep.T.slice(0, 10) && dn(u.rep.T) - dn(x.rep.date) <= 60).sort((a, b) => (a.rep.date < b.rep.date ? 1 : -1))[0]; u.c1 = v?.rep || null; }
  if (withControls) controls(K, clusters, allP, P, F);
  const main = unions[2].filter((u) => u.rep.full180 && !u.rep.gap).map((u) => ({ ...u.rep, cats: [...u.cats].sort().join(""), c1: u.c1 }));
  return { clusters, unions, main, P, F };
}
export function firstPOf(allRows) { const m = new Map(); for (const r of allRows) { if (r.code !== "P" || !r.acceptedAt) continue; const s = sym(r.ticker); if (!s) continue; if (!m.has(s) || r.acceptedAt < m.get(s)) m.set(s, r.acceptedAt); } return m; }
export function controls(K, clusters, allP, P, F) {
  const fp = firstPOf(allP);
  const ev = clusters.filter((c) => c.entrySt === "ok" && featOk(c.f, false)).map((c) => vecOf(c.f));
  const sc = [0, 1, 2, 3, 4].map((k) => Math.max(1e-6, (qtl(ev.map((v) => v[k]), 0.75) - qtl(ev.map((v) => v[k]), 0.25)) / 1.349));
  const tl = byKey(clusters, (c) => `${c.clock}|${c.ticker}`);
  const syms = [...K.S.keys()].filter((s) => s !== "SPY");
  const poolMemo = new Map();
  for (const c of clusters) {
    if (c.entrySt !== "ok" || !c.o || c.o.empty) continue;
    if (!featOk(c.f, false)) { c.ctrlSt = "event_features_missing"; continue; }
    const cut = c.clock === 1 ? `${c.date} 23:59:59` : c.T, from = add(c.E, -30);
    const key = `${c.clock}|${c.E}|${cut}`;
    if (!poolMemo.has(key)) {
      const pool = [];
      for (const s of syms) {
        const f0 = fp.get(s); if (!f0 || f0 > cut) continue;
        if (!K.S.get(s).ix.has(c.E)) continue;
        const f = F(s, c.E); if (!featOk(f)) continue;
        if ((tl.get(`${c.clock}|${s}`) || []).some((x) => { const t = x.clock === 1 ? x.date : x.T; return t <= cut && t.slice(0, 10) >= from; })) continue;
        pool.push({ s, f, v: vecOf(f) });
      }
      poolMemo.set(key, pool);
    }
    const pool = poolMemo.get(key).filter((p) => p.s !== c.ticker); c.poolN = pool.length; c.pool = pool;
    if (pool.length < 20) { c.ctrlSt = "pool_too_small"; continue; }
    const e = vecOf(c.f);
    const nb = pool.map((p) => ({ p, d: Math.sqrt(p.v.reduce((s, x, k) => s + ((x - e[k]) / sc[k]) ** 2, 0)) })).sort((a, b) => a.d - b.d).slice(0, 5);
    const outs = nb.map(({ p }) => ({ s: p.s, o: P(p.s, c.E, c.mode), cost: costOf(p.f.adv) })).filter((x) => x.o && !x.o.empty);
    if (outs.length < 3) { c.ctrlSt = "controls_without_outcomes"; continue; }
    c.ctrlSt = "ok"; c.ctrl = outs;
    c.ctl_n180 = avg(outs.map((x) => net(x.o.ret[180], x.cost))); c.ctl_maxGain = avg(outs.map((x) => x.o.maxGain)); c.ctl_hit20 = avg(outs.map((x) => (x.o.hit[20] != null ? 1 : 0)));
    c.ctl_daysToMax = avg(outs.map((x) => x.o.daysToMax));
  }
  return sc;
}

// ---------- statistics ----------
export function boot(items, stat, { reps = 4000, seed = 7, key = (x) => x.cik } = {}) {
  const est = stat(items); const g = [...byKey(items, key).values()]; const R = rand(seed); const bs = [];
  for (let b = 0; b < reps; b++) { const s = []; for (let i = 0; i < g.length; i++) s.push(...g[Math.floor(R() * g.length)]); const v = stat(s); if (v != null && Number.isFinite(v)) bs.push(v); }
  bs.sort((x, y) => x - y); const m = avg(bs);
  const p = (bs.filter((v) => Math.abs(v - m) >= Math.abs(est)).length + 1) / (bs.length + 1);
  return { est, n: items.length, groups: g.length, lo95: bs[Math.floor(0.025 * bs.length)], hi95: bs[Math.floor(0.975 * bs.length)], lo90: bs[Math.floor(0.05 * bs.length)], hi90: bs[Math.floor(0.95 * bs.length)], p, se: sdev(bs) };
}
export function bhq(ps) { const o = ps.map((p, i) => [p, i]).filter(([p]) => p != null).sort((a, b) => a[0] - b[0]); const m = o.length, q = Array(ps.length).fill(null); let mn = 1; for (let k = m - 1; k >= 0; k--) { mn = Math.min(mn, (o[k][0] * m) / (k + 1)); q[o[k][1]] = mn; } return q; }
