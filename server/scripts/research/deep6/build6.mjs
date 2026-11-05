// deep6/build6.mjs — GENERATED COPY of deep5/build.mjs with deep6 inputs (see lib6.mjs); logic unchanged except: SEC start 2025-11-03,
// extended bars, no Dec gap flag, outputs in .cache/research/deep6/build/.
// deep5/build.mjs — eligible rows -> clusters (both clocks) -> 180-day outcomes -> point-in-time matched controls.
//   node --max-old-space-size=6144 scripts/research/deep5/build.mjs
// Outputs (.cache/research/deep5/): rows-exclusions.json, clusters.json, events.csv, union-*.csv, build-summary.json
import * as L from "../deep5/lib5.mjs";
import * as D6 from "./lib6.mjs";
const { addDays, dnum, symOf, mean, median, cnt, group } = L;

const t0 = Date.now();
const sec = D6.loadSec6();
const K = D6.makeMarket6();
const bars = K.M.bars;
const names = L.loadNames();

// ---------- 1. row eligibility ----------
const P = sec.rows.filter((r) => r.code === "P");
const excl = {}, flagsCount = {}, elig = [];
const seenRow = new Set();
for (const r of P) {
  const dk = [r.acc, r.tradeDate, r.shares, r.price, r.own, r.nature, r.after].join("|");
  if (seenRow.has(dk)) { excl.exact_duplicate_row_in_filing = (excl.exact_duplicate_row_in_filing || 0) + 1; continue; }
  seenRow.add(dk);
  const e = L.rowEligibility(r, bars, { storeStart: D6.STORE_START6, barsFrom: D6.BARS_FROM6 });
  if (!e.ok) { excl[e.reason] = (excl[e.reason] || 0) + 1; continue; }
  for (const f of e.flags) flagsCount[f] = (flagsCount[f] || 0) + 1;
  elig.push({ ...r, flags: e.flags });
}
// first P acceptance per symbol (any P row: "the issuer had disclosed insider buying before") — control-pool membership
const firstP = new Map();
for (const r of P) { const s = symOf(r.ticker); if (!s || !r.acceptedAt) continue; if (!firstP.has(s) || r.acceptedAt < firstP.get(s)) firstP.set(s, r.acceptedAt); }

// ---------- 2. clusters ----------
const byIssuer = group(elig, (r) => r.cik);
const raw = [];
for (const [cik, rows] of byIssuer) for (const cat of ["A", "B", "C"]) {
  for (const c of L.clustersClock1(rows, cat)) raw.push({ ...c, cik });
  for (const c of L.clustersClock2(rows, cat)) raw.push({ ...c, cik });
}

const FUND_RE = /\b(FUND|TRUST|INCOME|BDC|CAPITAL CORP)\b/i;
const mostCommon = (xs) => Object.entries(cnt(xs, (x) => x)).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
function describe(c) {
  const rows = c.rows;
  const sym = symOf(mostCommon(rows.map((r) => r.ticker).filter(Boolean)));
  const nm = names.get(c.cik);
  const roles = rows.map((r) => r.role || "").join(" | ");
  const dates = [...new Set(rows.map((r) => r.tradeDate))].sort();
  const accepted = rows.map((r) => r.acceptedAt).sort();
  const d = {
    id: c.clock === 1 ? `c1:${c.cat}:${c.cik}:${c.date}` : `c2:${c.cat}:${c.cik}:${c.T}`,
    clock: c.clock, cat: c.cat, cik: c.cik, issuer: nm?.name || "", exch: nm?.exch || "", ticker: sym,
    owners: c.owners, usd: Math.round(c.usd), nRows: rows.length, nTradeDates: dates.length, windowStart: dates[0], windowEnd: dates.at(-1),
    firstAccepted: accepted[0], lastAccepted: accepted.at(-1),
    ceoCfo: /chief executive|\bceo\b|chief financial|\bcfo\b/i.test(roles) ? 1 : 0, tenPct: /10% owner/i.test(roles) ? 1 : 0,
    director: /director/i.test(roles) ? 1 : 0, officer: /chief|president|\bceo\b|\bcfo\b|\bcoo\b|\bvp\b|officer/i.test(roles) ? 1 : 0,
    indirectShare: rows.filter((r) => r.own === "I").length / rows.length, plan: rows.some((r) => r.plan) ? 1 : 0,
    fundLike: FUND_RE.test(nm?.name || "") || /portfolio manager|trustee/i.test(roles) ? 1 : 0,
    flags: [...new Set(rows.flatMap((r) => r.flags))],
    buyers: [...new Set(rows.map((r) => `${r.insider} (${r.role || "?"})`))].slice(0, 12),
    purchases: rows.map((r) => ({ insider: r.insider, role: r.role, tradeDate: r.tradeDate, acceptedAt: r.acceptedAt, shares: r.shares, price: r.price, usd: Math.round(r.value), acc: r.acc, own: r.own, plan: r.plan ? 1 : 0 })),
  };
  // ownership increase: shares bought / shares held before (sharesOwnedAfter - shares), median over rows with data
  const inc = rows.map((r) => (r.after > r.shares ? r.shares / (r.after - r.shares) : null)).filter((x) => x != null);
  d.medOwnIncrease = inc.length ? median(inc) : null;
  if (c.clock === 1) {
    d.completionDate = c.date;
    d.gap = 0; // deep6: no SEC gap (24 and 26 Dec 2025 were SEC closures; 6 filings removed from EDGAR)
  } else {
    d.T = c.T; d.windowEnd = c.windowEnd;
    d.staleDays = dnum(c.T) - dnum(c.windowEnd);
    d.gap = 0;
  }
  d.leftEdge = d.windowStart < addDays(D6.STORE_START6, 7) ? 1 : 0;
  return d;
}
const clusters = raw.map(describe);

// ---------- 3. entries and outcomes ----------
const memoPath = new Map();
const pathOf = (sym, date, mode) => { const k = `${sym}|${date}|${mode}`; if (!memoPath.has(k)) memoPath.set(k, L.pathOutcome(K, sym, date, mode)); return memoPath.get(k); };
const memoFeat = new Map();
const featOf = (sym, date) => { const k = `${sym}|${date}`; if (!memoFeat.has(k)) memoFeat.set(k, L.featuresBefore(K, sym, date)); return memoFeat.get(k); };

function entryFor(c) {
  if (!c.ticker) return { status: "no_ticker" };
  const s = K.ser(c.ticker); if (!s || !s.arr.length) return { status: "no_bars_for_symbol" };
  if (c.clock === 1) {
    const i = K.lastBarOnOrBefore(s, c.completionDate); if (i < 0) return { status: "no_bar_before_completion" };
    return { status: "ok", entryDate: s.arr[i].d, mode: "close", delayed: s.arr[i].d !== c.completionDate ? 1 : 0 };
  }
  const t = L.decisionOf(c.T); const E = L.entryDateOf(c.T);
  const j = K.firstBarOnOrAfter(s, E); if (j >= s.arr.length || dnum(s.arr[j].d) - dnum(E) > 5) return { status: "no_bar_near_entry", decision: t.at, scheduledEntry: E };
  const fc = L.firstCloseDate(t); const jc = K.firstBarOnOrAfter(s, fc);
  return { status: "ok", entryDate: s.arr[j].d, mode: "open", delayed: s.arr[j].d !== E ? 1 : 0, decision: t.at, scheduledEntry: E, firstCloseDate: jc < s.arr.length ? s.arr[jc].d : null };
}
const tier = (adv) => L.costBpsFor(adv) / 1e4;
function outcomeFields(o, cost, spy) {
  if (!o || !o.ret) return {};
  const f = { status: o.status, entry: o.entry, observedThrough: o.observedThrough, endedEarly: o.endedEarly ? 1 : 0, maxGain: o.maxGain, maxDate: o.maxDate, daysToMax: o.daysToMax, sessToMax: o.sessToMax,
    maxCloseGain: o.maxCloseGain, daysToMaxClose: o.daysToMaxClose, minLowRet: o.minLowRet, closeDrawdown: o.closeDrawdown, sigDD: o.sigDD };
  for (const D of L.HORIZONS) {
    const g = o.ret[D]; f[`r${D}`] = g;
    f[`n${D}`] = g == null ? null : L.netOf(o.entry, o.entry * (1 + g), cost, cost);
    f[`spy${D}`] = spy?.ret?.[D] ?? null;
    f[`x${D}`] = f[`n${D}`] != null && f[`spy${D}`] != null ? f[`n${D}`] - f[`spy${D}`] : null;
  }
  f.spyMaxGain = spy?.maxGain ?? null;
  for (const t of L.THRESH) { f[`hit${t}`] = o.touchH[t] != null ? 1 : 0; f[`dHit${t}`] = o.touchH[t]; f[`hitC${t}`] = o.touchC[t] != null ? 1 : 0; f[`dHitC${t}`] = o.touchC[t]; }
  // pre-registered S4: limit sell at +20% (fill needs high >= target*1.005; a gap above the target fills at that day's open)
  f.tp20 = null;
  return f;
}
// S4 exit simulation needs the bars, done here per path
function tp20(sym, entryDate, mode, entry, cost) {
  const s = K.ser(sym); const a = s.arr; const i0 = s.idx.get(entryDate); const endD = addDays(entryDate, 180);
  if (endD > L.COMPLETE_THROUGH) return null;
  const tgt = entry * 1.2;
  for (let j = mode === "open" ? i0 : i0 + 1; j < a.length && a[j].d <= endD; j++) {
    const b = a[j];
    if (b.h >= tgt * (1 + L.FILL_BUFFER)) { const px = j > i0 && b.o > tgt ? b.o : tgt; return { exitDate: b.d, net: L.netOf(entry, px, cost, cost), how: "target" }; }
  }
  const k = K.lastBarOnOrBefore(s, endD); return { exitDate: a[k].d, net: L.netOf(entry, a[k].c, cost, cost), how: "time" };
}

for (const c of clusters) {
  const en = entryFor(c); c.entryStatus = en.status;
  if (en.status !== "ok") continue;
  Object.assign(c, { entryDate: en.entryDate, entryMode: en.mode, entryDelayed: en.delayed, decision: en.decision || null, scheduledEntry: en.scheduledEntry || null, firstCloseDate: en.firstCloseDate || null });
  const f = featOf(c.ticker, c.entryDate) || {};
  Object.assign(c, { histBars: f.histBars ?? null, price: f.price ?? null, adv20: f.adv20 ?? null, pr30: f.r30 ?? null, pr60: f.r60 ?? null, vol40: f.vol40 ?? null, spyAbove50: L.spyAbove50(K, c.entryDate) });
  c.usdToAdv = c.adv20 ? c.usd / c.adv20 : null;
  c.costPerSide = tier(c.adv20);
  const o = pathOf(c.ticker, c.entryDate, en.mode);
  const spy = pathOf("SPY", c.entryDate, en.mode);
  c.outcomeStatus = o.status;
  Object.assign(c, outcomeFields(o, c.costPerSide, spy));
  if (o.ret) { const tp = tp20(c.ticker, c.entryDate, en.mode, o.entry, c.costPerSide); c.tp20 = tp?.net ?? null; c.tp20How = tp?.how ?? null; c.tp20Exit = tp?.exitDate ?? null; }
  if (c.clock === 2 && c.firstCloseDate) {
    const fc = pathOf(c.ticker, c.firstCloseDate, "close");
    c.fc_entry = fc.entry ?? null; c.fc_r180 = fc.ret?.[180] ?? null; c.fc_maxGain = fc.maxGain ?? null;
  }
  c.full180 = c.outcomeStatus === "full_180d" || c.outcomeStatus === "full_180d_series_ended" ? 1 : 0;
}

// ---------- 4. union events per clock (dedupe across categories, 30-day grouping) ----------
const timeOf = (c) => (c.clock === 1 ? c.completionDate : c.T);
const unions = { 1: [], 2: [] };
for (const clock of [1, 2]) {
  const by = group(clusters.filter((c) => c.clock === clock), (c) => c.cik);
  for (const [cik, cs] of by) {
    cs.sort((a, b) => (timeOf(a) < timeOf(b) ? -1 : 1));
    let cur = null;
    for (const c of cs) {
      if (cur && dnum(timeOf(c)) - dnum(timeOf(cur.rep)) < L.COOLDOWN) { cur.cats.add(c.cat); c.unionId = cur.id; continue; }
      cur = { id: `u${clock}:${cik}:${timeOf(c)}`, rep: c, cats: new Set([c.cat]) }; c.unionId = cur.id; unions[clock].push(cur);
    }
  }
}
const unionRows = { 1: [], 2: [] };
for (const clock of [1, 2]) for (const u of unions[clock]) unionRows[clock].push({ ...u.rep, id: u.id, repId: u.rep.id, cats: [...u.cats].sort().join(""), cat: "U" });
// link clock 2 union events to the clock-1 union event of the same issuer (completion within 60 days before disclosure)
for (const u of unionRows[2]) {
  const cands = unionRows[1].filter((v) => v.cik === u.cik && v.completionDate <= u.T.slice(0, 10) && dnum(u.T) - dnum(v.completionDate) <= 60);
  const v = cands.sort((a, b) => (a.completionDate < b.completionDate ? 1 : -1))[0];
  u.c1Id = v?.id || null; u.c1Completion = v?.completionDate || null; u.c1r180 = v?.r180 ?? null; u.c1MaxGain = v?.maxGain ?? null;
  u.disclosureLagDays = v ? dnum(u.T) - dnum(v.completionDate) : null;
}

// ---------- 5. point-in-time matched controls ----------
// Pool on entry date E: symbols whose first insider-purchase filing was accepted before the decision (clock 2) / before the end
// of the completion date (clock 1); not the event's symbol; no qualifying cluster (any category, same clock) known in the prior 30
// days; >= 30 bars of history, last bar within 7 days, a bar on E. Matching: 5 nearest on robust-scaled
// [log dollar volume, 30d return, 60d return, log 40-session volatility, log price]. Future insider activity is never used.
const allSyms = [...bars.keys()].filter((s) => s !== "SPY");
const clusterTimes = group(clusters, (c) => `${c.clock}|${c.ticker}`);
function recentCluster(clock, sym, cutoffStamp, fromDate) {
  const cs = clusterTimes.get(`${clock}|${sym}`) || [];
  return cs.some((c) => { const tt = clock === 1 ? c.completionDate : c.T; return tt <= cutoffStamp && tt.slice(0, 10) >= fromDate; });
}
const vec = (f) => [Math.log(f.adv20), f.r30, f.r60, Math.log(f.vol40), Math.log(f.price)];
const okFeat = (f) => f && f.histBars >= 30 && f.staleDays <= 7 && f.adv20 > 0 && f.vol40 > 0 && f.r30 != null && f.r60 != null && f.price > 0;
// global robust scales from event features
const evF = clusters.filter((c) => c.entryStatus === "ok" && okFeat({ histBars: c.histBars, staleDays: 0, adv20: c.adv20, vol40: c.vol40, r30: c.pr30, r60: c.pr60, price: c.price })).map((c) => vec({ adv20: c.adv20, r30: c.pr30, r60: c.pr60, vol40: c.vol40, price: c.price }));
const scales = [0, 1, 2, 3, 4].map((k) => { const v = evF.map((x) => x[k]); return Math.max(1e-6, (L.quantile(v, 0.75) - L.quantile(v, 0.25)) / 1.349); });
const poolMemo = new Map();
function poolFor(clock, entryDate, cutoffStamp) {
  const key = `${clock}|${entryDate}|${cutoffStamp}`; if (poolMemo.has(key)) return poolMemo.get(key);
  const from = addDays(entryDate, -30), out = [];
  for (const s of allSyms) {
    const fp = firstP.get(s); if (!fp || fp > cutoffStamp) continue;
    const ser = K.ser(s); if (!ser || ser.idx.get(entryDate) == null) continue;
    const f = featOf(s, entryDate); if (!okFeat(f)) continue;
    if (recentCluster(clock, s, cutoffStamp, from)) continue;
    out.push({ s, v: vec(f), f });
  }
  poolMemo.set(key, out); return out;
}
let matched = 0;
for (const c of clusters) {
  if (c.entryStatus !== "ok" || !c.status) continue;
  const fe = { histBars: c.histBars, staleDays: 0, adv20: c.adv20, vol40: c.vol40, r30: c.pr30, r60: c.pr60, price: c.price };
  if (!okFeat(fe)) { c.ctrlStatus = "event_features_missing"; continue; }
  const cutoff = c.clock === 1 ? `${c.completionDate} 23:59:59` : c.T;
  const pool = poolFor(c.clock, c.entryDate, cutoff).filter((p) => p.s !== c.ticker);
  c.poolSize = pool.length;
  if (pool.length < 20) { c.ctrlStatus = "pool_too_small"; continue; }
  const ev = vec(fe);
  const dist = pool.map((p) => ({ p, d: Math.sqrt(p.v.reduce((a, x, k) => a + ((x - ev[k]) / scales[k]) ** 2, 0)) })).sort((a, b) => a.d - b.d).slice(0, L.K_CTRL);
  const spy = pathOf("SPY", c.entryDate, c.entryMode);
  const outs = dist.map(({ p, d }) => { const o = pathOf(p.s, c.entryDate, c.entryMode); const cost = tier(p.f.adv20); return { sym: p.s, dist: d, ...outcomeFields(o, cost, spy), tp20: o.ret ? tp20(p.s, c.entryDate, c.entryMode, o.entry, cost)?.net ?? null : null }; }).filter((o) => o.status);
  if (outs.length < 3) { c.ctrlStatus = "controls_without_outcomes"; continue; }
  c.ctrlStatus = "ok"; matched++;
  c.ctrlSyms = outs.map((o) => o.sym).join(" ");
  c.ctrlDist = mean(outs.map((o) => o.dist));
  const cm = (k) => { const v = outs.map((o) => o[k]).filter((x) => x != null); return v.length ? mean(v) : null; };
  for (const k of ["maxGain", "daysToMax", "maxCloseGain", "minLowRet", "closeDrawdown", "tp20", ...L.HORIZONS.flatMap((D) => [`r${D}`, `n${D}`, `x${D}`]), ...L.THRESH.flatMap((t) => [`hit${t}`, `hitC${t}`])]) c[`ctl_${k}`] = cm(k);
  c.ctl_lateMax = mean(outs.map((o) => (o.daysToMax != null && o.daysToMax > 150 ? 1 : 0)));
  // pool-average (unmatched, point-in-time) baseline: 180d net and +20% touch
  const pv = pool.map((p) => { const o = pathOf(p.s, c.entryDate, c.entryMode); return o.ret ? { n180: o.ret[180] == null ? null : L.netOf(o.entry, o.entry * (1 + o.ret[180]), tier(p.f.adv20), tier(p.f.adv20)), hit20: o.touchH[20] != null ? 1 : 0, maxGain: o.maxGain } : null; }).filter(Boolean);
  c.pool_n180 = mean(pv.map((x) => x.n180).filter((x) => x != null)); c.pool_hit20 = mean(pv.map((x) => x.hit20)); c.pool_maxGain = mean(pv.map((x) => x.maxGain));
}
// copy control fields onto union rows (union rows are copies of their representative cluster)
const byId = new Map(clusters.map((c) => [c.id, c]));
for (const clock of [1, 2]) for (const u of unionRows[clock]) Object.assign(u, Object.fromEntries(Object.entries(byId.get(u.repId)).filter(([k]) => k.startsWith("ctl") || k.startsWith("pool") || k === "ctrlStatus" || k === "ctrlSyms" || k === "ctrlDist" || k === "poolSize")));

// ---------- 6. write ----------
const strip = (c) => { const { purchases, buyers, ...rest } = c; return rest; };
D6.writeOut("clusters.json", { builtAt: new Date().toISOString(), scales, clusters, unions: unionRows });
const cols = ["id", "clock", "cat", "cats", "cik", "ticker", "issuer", "exch", "owners", "usd", "nRows", "nTradeDates", "windowStart", "windowEnd", "completionDate", "T", "staleDays", "decision", "entryDate", "entryMode", "entryDelayed", "entryStatus", "outcomeStatus", "full180", "gap", "leftEdge",
  "ceoCfo", "tenPct", "director", "officer", "fundLike", "plan", "indirectShare", "medOwnIncrease", "price", "adv20", "usdToAdv", "pr30", "pr60", "vol40", "spyAbove50", "costPerSide",
  "entry", "maxGain", "maxDate", "daysToMax", "sessToMax", "maxCloseGain", "daysToMaxClose", "minLowRet", "closeDrawdown", "sigDD", "endedEarly",
  ...L.HORIZONS.flatMap((D) => [`r${D}`, `n${D}`, `spy${D}`, `x${D}`]), "spyMaxGain", ...L.THRESH.flatMap((t) => [`hit${t}`, `dHit${t}`, `hitC${t}`]), "tp20", "tp20How",
  "fc_entry", "fc_r180", "fc_maxGain", "ctrlStatus", "poolSize", "ctrlSyms", "ctl_maxGain", "ctl_n180", "ctl_x180", "ctl_hit20", "ctl_daysToMax", "ctl_tp20", "pool_n180", "pool_hit20", "pool_maxGain",
  "c1Completion", "disclosureLagDays", "c1r180", "c1MaxGain", "unionId"];
D6.writeOut("events.csv", L.toCsv(clusters.map(strip), cols));
D6.writeOut("union-clock2.csv", L.toCsv(unionRows[2].map(strip), cols));
D6.writeOut("union-clock1.csv", L.toCsv(unionRows[1].map(strip), cols));
const summ = {
  builtAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000),
  rows: { purchaseRows: P.length, eligible: elig.length, excluded: excl, flags: flagsCount },
  clusters: Object.fromEntries([1, 2].map((clock) => [clock, Object.fromEntries(["A", "B", "C"].map((cat) => { const cs = clusters.filter((c) => c.clock === clock && c.cat === cat); return [cat, { n: cs.length, entry: cnt(cs, (c) => c.entryStatus), outcome: cnt(cs.filter((c) => c.entryStatus === "ok"), (c) => c.outcomeStatus), gap: cs.filter((c) => c.gap).length, ctrl: cnt(cs.filter((c) => c.entryStatus === "ok"), (c) => c.ctrlStatus) }]; }))])),
  unions: { 1: unionRows[1].length, 2: unionRows[2].length }, matched, scales,
};
D6.writeOut("build-summary.json", JSON.stringify(summ, null, 1));
console.log(JSON.stringify(summ, null, 1));
