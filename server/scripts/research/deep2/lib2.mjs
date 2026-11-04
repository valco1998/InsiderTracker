// Deep study 2 — shared, read-only research layer.
// - Cache only: never fetches prices or SEC data (no network). Daily bars come from .cache/research/daily-bars.json.
// - Leak guard: events published on/after HOLDOUT_START are hidden unless DEEP2_HOLDOUT=1 AND frozen-rules.json exists.
// - Registry: every hypothesis is logged (with its family size) BEFORE its result is computed.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { OUT_DIR, mean, median, clusteredT, pValue, bhQ, r4, pct } from "../lib.mjs";

export { mean, median, clusteredT, pValue, bhQ, r4, pct };
export const DEEP1 = path.join(OUT_DIR, "deep");
export const DEEP2 = path.join(OUT_DIR, "deep2");
fs.mkdirSync(DEEP2, { recursive: true });

// ---- protocol (frozen 2026-11-04, before any deep-2 result was computed) ----
export const DISCOVER_END = "2026-06-15"; // discovery: published < this, exit < this (embargo)
export const HOLDOUT_START = "2026-09-01"; // confirmation: [DISCOVER_END, HOLDOUT_START), exit < HOLDOUT_START
export const FROZEN_FILE = path.join(DEEP2, "frozen-rules.json");
const holdoutUnlocked = () => process.env.DEEP2_HOLDOUT === "1" && fs.existsSync(FROZEN_FILE);

export function periodOf(e) {
  const d = String(e.publishedAt).slice(0, 10);
  return d < DISCOVER_END ? "discover" : d < HOLDOUT_START ? "confirm" : "holdout";
}
// Embargo: an outcome counts in a period only if its exit date is before the next period starts.
export function usable(e, H, period = null) {
  const h = e.h?.[H]; if (!h || h.status !== "ok") return false;
  const p = periodOf(e); if (period && p !== period) return false;
  if (p === "discover") return h.exitDate < DISCOVER_END;
  if (p === "confirm") return h.exitDate < HOLDOUT_START;
  return holdoutUnlocked();
}

// ---- events (deep-1 stage C: one per purchase filing, features from data strictly before entry) ----
let _events = null;
export function loadEvents({ includeUnpriced = false } = {}) {
  if (!_events) _events = JSON.parse(fs.readFileSync(path.join(DEEP1, "stageC.json"), "utf8")).events;
  const unlocked = holdoutUnlocked();
  return _events.filter((e) => (includeUnpriced || e.priceStatus === "ok") && (unlocked || periodOf(e) !== "holdout"));
}

// ---- daily bars (split-adjusted Alpaca SIP), cache only ----
let _bars = null;
export function loadBars() {
  if (_bars) return _bars;
  const raw = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "daily-bars.json"), "utf8"));
  _bars = new Map();
  for (const [s, bs] of Object.entries(raw)) {
    if (s === "__meta" || !bs) continue;
    const arr = bs.map((b) => ({ d: b[0], o: b[1], h: b[2], l: b[3], c: b[4], v: b[5] }));
    const idx = new Map(arr.map((b, i) => [b.d, i]));
    _bars.set(s, { arr, idx });
  }
  return _bars;
}
// Index of the last bar with date < day (strictly before).
export function idxBefore(series, day) {
  const a = series.arr; let lo = 0, hi = a.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (a[m].d < day) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
}

// ---- slim SEC rows (P and S, plus other codes counted) — built once from the history store, read-only ----
const SEC_FILE = path.join(DEEP2, "sec-rows.json");
export async function loadSecRows() {
  if (fs.existsSync(SEC_FILE)) return JSON.parse(fs.readFileSync(SEC_FILE, "utf8"));
  const { loadSec } = await import("../lib.mjs");
  const s = loadSec();
  const rows = s.snap.economic.filter((r) => r.code === "P" || r.code === "S").map((r) => ({
    id: r.id, acc: r.accessionNo, form: r.formType, cik: Number(r.issuerCik), ticker: r.ticker, insiderCik: r.insiderCik, insider: r.insiderName,
    role: r.role, code: r.code, shares: r.shares, price: r.price, value: r.value, after: r.sharesOwnedAfter, own: r.ownership, nature: r.natureOfOwnership || null,
    fn: (r.footnotes || []).map((f) => f?.text || "").join(" | ").slice(0, 700), remarks: String(r.remarks || "").slice(0, 300),
    ctx: r.purchaseContext, plan: !!r.is10b5_1, tradeDate: r.transactionDate, acceptedAt: String(r.acceptedAtET || "").replace(/\s*ET$/, ""),
    dedupe: r.dedupe?.status || r.dedupe || null, priceCheck: r.priceCheck?.status || null, amend: r.amendment?.status || null,
  }));
  fs.writeFileSync(SEC_FILE, JSON.stringify({ builtAt: new Date().toISOString(), days: [s.days[0], s.days.at(-1)], rows }));
  return JSON.parse(fs.readFileSync(SEC_FILE, "utf8"));
}

// ---- statistics ----
export const wmean = (xs, p = 0.02) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const lo = s[Math.floor(p * (s.length - 1))], hi = s[Math.ceil((1 - p) * (s.length - 1))]; return mean(s.map((x) => Math.min(hi, Math.max(lo, x)))); };
// rows: [{ issuer, x }]. Company-aware summary: issuer-clustered t, median, median of issuer means, share positive,
// result without the top-5 issuers by contribution, and a deterministic issuer-block bootstrap CI of the mean.
export function companyStats(rows, { boot = 400, seed = 7 } = {}) {
  const xs = rows.map((r) => r.x).filter(Number.isFinite);
  if (!xs.length) return { n: 0 };
  const byI = new Map(); for (const r of rows) (byI.get(r.issuer) || byI.set(r.issuer, []).get(r.issuer)).push(r.x);
  const issuerMeans = [...byI.values()].map(mean);
  const t = clusteredT(rows.map((r) => ({ issuer: r.issuer, excess: r.x })), "excess");
  const contrib = [...byI.entries()].map(([k, v]) => [k, v.reduce((a, b) => a + b, 0)]).sort((a, b) => b[1] - a[1]);
  const top5 = new Set(contrib.slice(0, 5).map((c) => c[0]));
  const rest = rows.filter((r) => !top5.has(r.issuer)).map((r) => r.x);
  let s = seed; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const groups = [...byI.values()], bm = [];
  for (let b = 0; b < boot; b++) { let sum = 0, n = 0; for (let k = 0; k < groups.length; k++) { const g = groups[Math.floor(rnd() * groups.length)]; for (const x of g) { sum += x; n++; } } bm.push(sum / n); }
  bm.sort((a, b) => a - b);
  return {
    n: xs.length, issuers: byI.size, mean: r4(mean(xs)), wmean: r4(wmean(xs)), median: r4(median(xs)), positive: r4(xs.filter((x) => x > 0).length / xs.length),
    issuerMedianOfMeans: r4(median(issuerMeans)), issuersPositive: r4(issuerMeans.filter((x) => x > 0).length / issuerMeans.length),
    t: t == null ? null : Math.round(t * 100) / 100, p: t == null ? null : pValue(t), meanExTop5Issuers: r4(mean(rest)),
    ci95: [r4(bm[Math.floor(0.025 * boot)]), r4(bm[Math.floor(0.975 * boot)])],
  };
}

// ---- registry: log a hypothesis before computing it ----
export function registerHypothesis(h) {
  const need = ["agent", "id", "family", "familySize", "statement", "rationale"];
  for (const k of need) if (h[k] == null) throw new Error(`registerHypothesis: missing ${k}`);
  fs.appendFileSync(path.join(DEEP2, "registry.jsonl"), JSON.stringify({ ...h, registeredAt: new Date().toISOString() }) + "\n");
}
export function recordResult(id, agent, result) {
  const reg = fs.existsSync(path.join(DEEP2, "registry.jsonl")) ? fs.readFileSync(path.join(DEEP2, "registry.jsonl"), "utf8") : "";
  if (!reg.includes(`"id":${JSON.stringify(id)}`)) throw new Error(`recordResult: ${id} was not registered first`);
  fs.appendFileSync(path.join(DEEP2, "registry-results.jsonl"), JSON.stringify({ id, agent, result, at: new Date().toISOString() }) + "\n");
}

// ---- portfolio simulation (daily, close-to-close marks from daily bars) ----
// trades: [{ issuer, ticker, entryDate, entryPrice, exitDate, exitPrice, costPerSide }]; equal slot sizing,
// at most `slots` concurrent positions (later signals skipped when full). Returns equity curve and drawdown.
export function simulatePortfolio(trades, { slots = 10, bars = loadBars() } = {}) {
  const ts = [...trades].sort((a, b) => (a.entryDate < b.entryDate ? -1 : a.entryDate > b.entryDate ? 1 : 0));
  const spy = bars.get("SPY"); const days = spy.arr.map((b) => b.d);
  const open = []; const taken = []; let skipped = 0;
  for (const t of ts) { const active = open.filter((o) => o.exitDate >= t.entryDate); open.length = 0; open.push(...active); if (active.length >= slots) { skipped++; continue; } open.push(t); taken.push(t); }
  const first = taken[0]?.entryDate, last = taken.reduce((m, t) => (t.exitDate > m ? t.exitDate : m), "");
  let eq = 1, peak = 1, maxDD = 0; const curve = [];
  for (const d of days) {
    if (!first || d < first || d > last) continue;
    let r = 0;
    for (const t of taken) {
      if (d < t.entryDate || d > t.exitDate) continue;
      const s = bars.get(t.ticker); if (!s) continue; const i = s.idx.get(d); if (i == null) continue;
      const prev = d === t.entryDate ? t.entryPrice : s.arr[i - 1]?.c; let px = d === t.exitDate ? t.exitPrice : s.arr[i].c;
      if (!(prev > 0) || !(px > 0)) continue;
      let ret = px / prev - 1; if (d === t.entryDate) ret -= t.costPerSide; if (d === t.exitDate) ret -= t.costPerSide;
      r += ret / slots;
    }
    eq *= 1 + r; peak = Math.max(peak, eq); maxDD = Math.min(maxDD, eq / peak - 1); curve.push([d, r4(eq)]);
  }
  return { trades: taken.length, skipped, totalReturn: r4(eq - 1), maxDrawdown: r4(maxDD), days: curve.length, curve };
}

export function writeJson(name, data) { const f = path.join(DEEP2, name); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(data, null, 1)); return f; }
export const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
