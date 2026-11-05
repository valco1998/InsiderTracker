// cluster-bollinger/run.mjs — signals → four variants (event level + portfolio) → controls, SPY, sensitivities.
//   node --max-old-space-size=6144 scripts/research/cluster-bollinger/run.mjs   → .cache/research/cluster-bollinger/*
import * as C from "./cbLib.mjs";
const { L } = C;
const { addDays, dnum, symOf, group, mean, median, cnt, quantile } = L;

const t0 = Date.now();
const sec = L.loadSec(), K = L.makeMarket(), names = L.loadNames();
const bars = K.M.bars;

// ---------- 1. purchases ----------
const purchaseRows = sec.rows.filter((r) => r.code === "P").length;
const { rows: elig, excl: rowExcl } = C.eligibleRows(sec, bars, names);

// ---------- 2. signals ----------
const episodes = [];
for (const [cik, rs] of group(elig, (r) => r.cik)) for (const e of C.issuerSignals(rs, K)) episodes.push({ cik, issuer: names.get(cik)?.name || "", ...e });
const mostCommon = (xs) => Object.entries(cnt(xs, (x) => x)).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
function toSignal(ep, v, rule) {
  const sym = symOf(mostCommon(v.rows.map((r) => r.ticker).filter(Boolean)));
  const t = L.decisionOf(v.T), E = L.entryDateOf(v.T);
  const s = sym ? K.ser(sym) : null;
  let entryDate = null, status = "ok";
  if (!sym) status = "no_ticker";
  else if (!s || !s.arr.length) status = "no_price_history";
  else { const j = K.firstBarOnOrAfter(s, E); if (j >= s.arr.length || dnum(s.arr[j].d) - dnum(E) > 5) status = "no_bar_near_entry"; else entryDate = s.arr[j].d; }
  return { id: `${rule}:${ep.cik}:${v.T}`, rule, cik: ep.cik, issuer: ep.issuer, ticker: sym, T: v.T, decision: t?.at, entryDate, status, owners: v.owners.length, value: Math.round(v.value), dOwn: v.dOwn, tier: v.tier, band: v.band, vwapAdj: v.vwapAdj,
    insiders: v.owners.map((o) => ({ names: o.names, roles: o.roles, officer: o.officer, value: Math.round(o.value), avgPrice: o.avgPrice, dOwn: o.dOwn, lines: o.lines.map((l) => ({ line: l.line, bought: l.bought, pre: l.pre, dOwn: l.dOwn })) })),
    trades: v.rows.map((r) => ({ insider: r.insider, role: r.role, tradeDate: r.tradeDate, acceptedAt: r.acceptedAt, shares: r.shares, price: r.price, value: Math.round(r.value), acc: r.acc })) };
}
const signals = { base: [], tiered: [] };
const funnel = { episodes: episodes.length, base: {}, tiered: {} };
for (const ep of episodes) for (const rule of ["base", "tiered"]) {
  const v = ep[rule];
  if (!v) { const why = ep.last?.fail || "unknown"; funnel[rule][why] = (funnel[rule][why] || 0) + 1; continue; }
  const s = toSignal(ep, v, rule);
  if (s.status !== "ok") { funnel[rule][s.status] = (funnel[rule][s.status] || 0) + 1; continue; }
  if (rule === "tiered" && ep.base && ep.base.T !== v.T) s.lateVsBase = true;
  signals[rule].push(s);
}

// ---------- 3. event-level trades per variant ----------
const VAR = {
  A: { rule: "base", mode: "fixed", chase: false, label: "Clusters only, fixed 20-session exit" },
  B: { rule: "tiered", mode: "fixed", chase: false, label: "Clusters + tiers, fixed 20-session exit" },
  C: { rule: "base", mode: "bb", chase: false, label: "Clusters + Bollinger exits" },
  D: { rule: "tiered", mode: "bb", chase: true, label: "Full strategy: tiers, 7% filter, Bollinger exits, risk sizing" },
};
const spyRet = (entryDate, exitDate) => { const s = K.ser("SPY"); const i = s.idx.get(entryDate); const j = K.lastBarOnOrBefore(s, exitDate); return i != null && j >= 0 ? s.arr[j].c / s.arr[i].o - 1 : null; };
const crashProxy = (sym, entryDate) => { const s = K.ser(sym); const i = s.idx.get(entryDate); for (let j = Math.max(1, i - 10); j < i; j++) if (s.arr[j].c / s.arr[j - 1].c - 1 < -0.15) return true; return false; };
function runTrades(key, opts = {}) {
  const V = { ...VAR[key], ...opts };
  return signals[V.rule].map((s) => {
    const r = C.simulate(K, s.ticker, s.entryDate, { mode: V.mode, chase: V.chase, vwapAdj: s.vwapAdj, timeStop: V.timeStop !== false });
    const x = { ...s, variant: key, sim: r.status, ...r };
    if (r.status === "closed" || r.status === "open_at_data_end") { x.spy = spyRet(s.entryDate, r.exitDate || r.lastDate); x.xSpy = x.spy == null ? null : r.net - x.spy; x.crashProxy = crashProxy(s.ticker, s.entryDate); }
    return x;
  });
}
const trades = {}; for (const k of Object.keys(VAR)) trades[k] = runTrades(k);

// ---------- 4. matched controls (point-in-time pool, deep5 method) run through the same exits ----------
const firstP = new Map();
for (const r of sec.rows) if (r.code === "P") { const s = symOf(r.ticker); if (s && r.acceptedAt && (!firstP.has(s) || r.acceptedAt < firstP.get(s))) firstP.set(s, r.acceptedAt); }
const sigTimes = group(signals.base, (s) => s.ticker);
const fMemo = new Map(); const feat = (s, d) => { const k = s + "|" + d; if (!fMemo.has(k)) fMemo.set(k, L.featuresBefore(K, s, d)); return fMemo.get(k); };
const okF = (f) => f && f.histBars >= 40 && f.staleDays <= 7 && f.adv20 > 0 && f.vol40 > 0 && f.r30 != null && f.r60 != null && f.price > 0;
const vec = (f) => [Math.log(f.adv20), f.r30, f.r60, Math.log(f.vol40), Math.log(f.price)];
const allSyms = [...bars.keys()].filter((s) => s !== "SPY");
const evVecs = signals.base.map((s) => feat(s.ticker, s.entryDate)).filter(okF).map(vec);
const scales = [0, 1, 2, 3, 4].map((k) => Math.max(1e-6, (quantile(evVecs.map((v) => v[k]), 0.75) - quantile(evVecs.map((v) => v[k]), 0.25)) / 1.349));
const poolMemo = new Map();
function pool(entryDate, T) {
  const key = entryDate + "|" + T; if (poolMemo.has(key)) return poolMemo.get(key);
  const out = [];
  for (const s of allSyms) {
    const fp = firstP.get(s); if (!fp || fp > T) continue;
    const ser = K.ser(s); if (!ser || ser.idx.get(entryDate) == null) continue;
    const f = feat(s, entryDate); if (!okF(f)) continue;
    if ((sigTimes.get(s) || []).some((x) => x.T <= T && dnum(T) - dnum(x.T) <= 30)) continue;
    out.push({ s, v: vec(f) });
  }
  poolMemo.set(key, out); return out;
}
const ctlMemo = new Map();
function controlsFor(sig, mode) {
  const f = feat(sig.ticker, sig.entryDate); if (!okF(f)) return null;
  const key = sig.ticker + "|" + sig.entryDate + "|" + sig.T;
  let picks = ctlMemo.get(key);
  if (!picks) { const ev = vec(f); picks = pool(sig.entryDate, sig.T).filter((p) => p.s !== sig.ticker).map((p) => ({ s: p.s, d: Math.sqrt(p.v.reduce((a, x, k) => a + ((x - ev[k]) / scales[k]) ** 2, 0)) })).sort((a, b) => a.d - b.d).slice(0, 5).map((p) => p.s); ctlMemo.set(key, picks); }
  const res = picks.map((s) => C.simulate(K, s, sig.entryDate, { mode })).filter((r) => r.status === "closed" || r.status === "open_at_data_end");
  return res.length >= 3 ? { syms: picks.join(" "), net: mean(res.map((r) => r.net)), win: mean(res.map((r) => (r.net > 0 ? 1 : 0))), sessions: mean(res.map((r) => r.sessions)) } : null;
}
for (const k of Object.keys(VAR)) for (const t of trades[k]) if (t.sim === "closed" || t.sim === "open_at_data_end") { const c = controlsFor(t, VAR[k].mode); if (c) { t.ctlNet = c.net; t.ctlSyms = c.syms; t.xCtl = t.net - c.net; } }

// ---------- 5. event-level statistics ----------
const closedOf = (ts) => ts.filter((t) => t.sim === "closed");
function eventStats(ts) {
  const c = closedOf(ts); if (!c.length) return { n: 0 };
  const nets = c.map((t) => t.net), w = nets.filter((x) => x > 0), l = nets.filter((x) => x <= 0);
  const it = c.map((t) => ({ ...t, issuer: t.cik }));
  const boot = (f, items = it) => L.clusterBoot(items, f);
  const xc = it.filter((t) => t.xCtl != null);
  return {
    n: c.length, issuers: new Set(c.map((t) => t.cik)).size, openAtEnd: ts.filter((t) => t.sim === "open_at_data_end").length, delisted: c.filter((t) => t.delisted).length,
    winRate: w.length / nets.length, avgWin: mean(w), avgLoss: mean(l), profitFactor: l.length ? w.reduce((a, b) => a + b, 0) / -l.reduce((a, b) => a + b, 0) : null,
    expectancy: mean(nets), median: median(nets), meanCI: boot((x) => mean(x.map((t) => t.net))),
    holdMean: mean(c.map((t) => t.sessions)), holdMedian: median(c.map((t) => t.sessions)), reasons: cnt(c, (t) => t.reason),
    spy: mean(c.map((t) => t.spy).filter((x) => x != null)), xSpy: boot((x) => mean(x.map((t) => t.xSpy).filter((v) => v != null))),
    ctlN: xc.length, ctlNet: mean(xc.map((t) => t.ctlNet)), xCtl: L.clusterBoot(xc, (x) => mean(x.map((t) => t.xCtl))),
  };
}
const cancelled = (ts) => cnt(ts.filter((t) => t.sim !== "closed" && t.sim !== "open_at_data_end"), (t) => t.sim);
const ev = {};
for (const k of Object.keys(VAR)) {
  const ts = trades[k];
  ev[k] = { label: VAR[k].label, signals: ts.length, cancelled: cancelled(ts), all: eventStats(ts), train: eventStats(ts.filter((t) => t.entryDate < C.TEST_START)), test: eventStats(ts.filter((t) => t.entryDate >= C.TEST_START)),
    byTier: Object.fromEntries(["T1", "T2", "T3"].map((x) => [x, eventStats(ts.filter((t) => t.tier === x))])) };
}

// ---------- 6. portfolio ----------
const sessions = K.M.days.filter((d) => d <= L.COMPLETE_THROUGH);
const weekOf = (d) => { const dt = new Date(d + "T00:00:00Z"); const wd = (dt.getUTCDay() + 6) % 7; return addDays(d, -wd); };
function portfolio(ts, { sizing, risk = 0.015, posPct = 0.10, maxPos = 10, weekCap = 3, maxPosPct = 0.20 }) {
  let cash = 100000; const open = []; const log = []; const rejects = {}; const curve = []; const weekCount = {};
  const byEntry = group(ts.filter((t) => t.sim === "closed" || t.sim === "open_at_data_end" || t.sim === "cancelled_chase_7pct" || t.sim === "invalid_stop_distance"), (t) => t.entryDate);
  const first = [...byEntry.keys()].sort()[0]; const days = sessions.filter((d) => d >= first);
  let prevEq = cash;
  const mark = (d) => open.reduce((a, p) => a + p.shares * (C.closeOn(K, p.t.ticker, d) ?? p.entryPx), 0);
  for (let di = 0; di < days.length; di++) {
    const d = days[di];
    const eq0 = prevEq;
    const cands = (byEntry.get(d) || []).sort((a, b) => (b.dOwn ?? -1) - (a.dOwn ?? -1));
    for (const t of cands) {
      const rej = (why) => { rejects[why] = (rejects[why] || 0) + 1; };
      if (open.length >= maxPos) { rej("max_10_positions"); continue; }
      const wk = weekOf(d); if ((weekCount[wk] || 0) >= weekCap) { rej("max_3_new_per_week"); continue; }
      if (t.sim === "cancelled_chase_7pct") { rej("cancelled_open_above_1.07x_insider_price"); continue; }
      if (t.sim === "invalid_stop_distance") { rej("open_at_or_below_stop"); continue; }
      const s = K.ser(t.ticker); const prevClose = s.arr[s.idx.get(d) - 1].c;
      let shares;
      if (sizing === "risk") { const dist = prevClose - t.stop; if (!(dist > 0)) { rej("sizing_price_at_or_below_stop"); continue; } shares = Math.floor((eq0 * risk) / dist); }
      else shares = Math.floor((eq0 * posPct) / prevClose);
      shares = Math.min(shares, Math.floor((eq0 * maxPosPct) / prevClose), Math.floor(cash / (t.entry * (1 + t.cost))));
      if (shares < 1) { rej("no_cash_or_size_zero"); continue; }
      cash -= shares * t.entry * (1 + t.cost);
      weekCount[wk] = (weekCount[wk] || 0) + 1;
      open.push({ t, shares, entryPx: t.entry, eqAtEntry: eq0 });
    }
    for (let i = open.length - 1; i >= 0; i--) {
      const p = open[i]; const t = p.t;
      if (t.sim === "closed" && t.exitDate === d) {
        const slip = /hard_stop/.test(t.reason) ? C.STOP_SLIP : 0;
        const proceeds = p.shares * t.exit * (1 - t.cost - slip);
        cash += proceeds;
        const pnl = proceeds - p.shares * t.entry * (1 + t.cost);
        log.push({ ticker: t.ticker, issuer: t.issuer, tier: t.tier, T: t.T, insiderVwapAdj: t.vwapAdj, owners: t.owners, value: t.value, dOwn: t.dOwn, entryDate: t.entryDate, entry: t.entry, stop: t.stop, shares: p.shares, positionUsd: p.shares * t.entry, exitDate: t.exitDate, exit: t.exit, reason: t.reason, sessions: t.sessions, pnl, ret: t.net, riskUsd: t.stop ? p.shares * (t.entry - t.stop) : null, eqAtEntry: p.eqAtEntry });
        open.splice(i, 1);
      }
    }
    const eq = cash + mark(d); curve.push([d, eq]); prevEq = eq;
  }
  for (const p of open) log.push({ ticker: p.t.ticker, issuer: p.t.issuer, tier: p.t.tier, T: p.t.T, entryDate: p.t.entryDate, entry: p.t.entry, stop: p.t.stop, shares: p.shares, positionUsd: p.shares * p.t.entry, exitDate: null, reason: "open_at_data_end", pnl: p.shares * (C.closeOn(K, p.t.ticker, L.COMPLETE_THROUGH) - p.t.entry), ret: p.t.net, open: true });
  // metrics
  const eqs = curve.map((c) => c[1]); let peak = -Infinity, mdd = 0, mddAt = null;
  for (const [d, e] of curve) { peak = Math.max(peak, e); const dd = e / peak - 1; if (dd < mdd) { mdd = dd; mddAt = d; } }
  const closed = log.filter((x) => !x.open); const w = closed.filter((x) => x.pnl > 0), l = closed.filter((x) => x.pnl <= 0);
  const days0 = curve[0][0], days1 = curve.at(-1)[0], yrs = (dnum(days1) - dnum(days0)) / 365.25;
  const spy0 = K.ser("SPY").arr[K.ser("SPY").idx.get(days0)].o, spy1 = C.closeOn(K, "SPY", days1);
  const periodRet = (f) => { const m = group(curve, (c) => f(c[0])); let prev = 100000; const out = []; for (const [k, cs] of [...m.entries()].sort()) { const end = cs.at(-1)[1]; out.push({ period: k, ret: end / prev - 1, end }); prev = end; } return out; };
  const spyCurve = curve.map(([d]) => [d, 100000 * C.closeOn(K, "SPY", d) / spy0]);
  return {
    start: days0, end: days1, years: yrs, final: eqs.at(-1), totalReturn: eqs.at(-1) / 100000 - 1, annualized: yrs > 0 ? (eqs.at(-1) / 100000) ** (1 / yrs) - 1 : null,
    maxDrawdown: mdd, maxDrawdownDate: mddAt, spyReturn: spy1 / spy0 - 1, spyMaxDrawdown: (() => { let pk = -Infinity, m = 0; for (const [, e] of spyCurve) { pk = Math.max(pk, e); m = Math.min(m, e / pk - 1); } return m; })(),
    trades: closed.length, openAtEnd: log.length - closed.length, winRate: closed.length ? w.length / closed.length : null, avgWinUsd: mean(w.map((x) => x.pnl)), avgLossUsd: mean(l.map((x) => x.pnl)),
    avgWinPct: mean(w.map((x) => x.ret)), avgLossPct: mean(l.map((x) => x.ret)), profitFactor: l.length ? w.reduce((a, x) => a + x.pnl, 0) / -l.reduce((a, x) => a + x.pnl, 0) : null,
    expectancyUsd: mean(closed.map((x) => x.pnl)), expectancyPct: mean(closed.map((x) => x.ret)), holdMean: mean(closed.map((x) => x.sessions)), holdMedian: median(closed.map((x) => x.sessions)),
    reasons: cnt(closed, (x) => x.reason), byTier: Object.fromEntries(["T1", "T2", "T3"].map((k) => { const c = closed.filter((x) => x.tier === k); return [k, { n: c.length, pnl: c.reduce((a, x) => a + x.pnl, 0), winRate: c.length ? mean(c.map((x) => (x.pnl > 0 ? 1 : 0))) : null, meanRet: mean(c.map((x) => x.ret)) }]; })),
    rejects, monthly: periodRet((d) => d.slice(0, 7)), quarterly: periodRet((d) => `${d.slice(0, 4)}-Q${Math.floor((+d.slice(5, 7) - 1) / 3) + 1}`),
    curve: curve.map(([d, e], i) => [d, Math.round(e), Math.round(spyCurve[i][1])]), log,
  };
}
const pf = {
  A: portfolio(trades.A, { sizing: "fixed" }), B: portfolio(trades.B, { sizing: "fixed" }), C: portfolio(trades.C, { sizing: "fixed" }), D: portfolio(trades.D, { sizing: "risk", risk: 0.015 }),
};
const tradesNoTime = runTrades("D", { timeStop: false });
const sens = {
  "D risk 1%": portfolio(trades.D, { sizing: "risk", risk: 0.01 }), "D risk 1.5%": pf.D, "D risk 3%": portfolio(trades.D, { sizing: "risk", risk: 0.03 }),
  "D without 45-session time stop": portfolio(tradesNoTime, { sizing: "risk", risk: 0.015 }),
  "D with crash proxy (>15% one-day drop, prior 10 sessions)": portfolio(trades.D.filter((t) => !t.crashProxy), { sizing: "risk", risk: 0.015 }),
};
const sensEvent = { "D without time stop": eventStats(tradesNoTime), "D with crash proxy": eventStats(trades.D.filter((t) => !t.crashProxy)) };

// ---------- 7. write ----------
const strip = (o) => { const { curve, log, ...r } = o; return r; };
const out = {
  builtAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000),
  coverage: { purchaseRows, eligibleRows: elig.length, rowExcl, episodes: episodes.length },
  funnel, signalCounts: { base: signals.base.length, tiered: signals.tiered.length, tieredByTier: cnt(signals.tiered, (s) => s.tier), tieredLaterThanBase: signals.tiered.filter((s) => s.lateVsBase).length },
  ev, pf: Object.fromEntries(Object.entries(pf).map(([k, v]) => [k, strip(v)])), curves: Object.fromEntries(Object.entries(pf).map(([k, v]) => [k, v.curve])),
  sens: Object.fromEntries(Object.entries(sens).map(([k, v]) => [k, strip(v)])), sensEvent,
  logD: pf.D.log, logs: { A: pf.A.log, B: pf.B.log, C: pf.C.log },
};
C.writeOut("results.json", JSON.stringify(out));
C.writeOut("signals.json", JSON.stringify(signals));
const cols = ["variant", "ticker", "issuer", "tier", "T", "decision", "entryDate", "owners", "value", "dOwn", "vwapAdj", "sim", "entry", "stop", "exitDate", "exit", "reason", "sessions", "cost", "gross", "net", "spy", "xSpy", "ctlNet", "xCtl", "ctlSyms", "crashProxy"];
C.writeOut("event-trades.csv", L.toCsv(Object.values(trades).flat(), cols));
C.writeOut("portfolio-D-trades.csv", L.toCsv(pf.D.log, ["ticker", "issuer", "tier", "T", "insiderVwapAdj", "owners", "value", "dOwn", "entryDate", "entry", "stop", "shares", "positionUsd", "riskUsd", "exitDate", "exit", "reason", "sessions", "pnl", "ret", "eqAtEntry"]));
const p = (x) => (x == null ? "—" : (x * 100).toFixed(2) + "%");
console.log("rows", purchaseRows, "eligible", elig.length, JSON.stringify(rowExcl));
console.log("episodes", episodes.length, "signals", JSON.stringify(out.signalCounts)); console.log("funnel", JSON.stringify(funnel));
for (const k of Object.keys(VAR)) { const e = ev[k].all; console.log(k, "signals", ev[k].signals, "cancel", JSON.stringify(ev[k].cancelled), "| n", e.n, "win", p(e.winRate), "PF", e.profitFactor?.toFixed(2), "exp", p(e.expectancy), "CI", p(e.meanCI?.lo90), p(e.meanCI?.hi90), "hold", e.holdMedian, "xSPY", p(e.xSpy?.est), "xCtl", p(e.xCtl?.est), "p", e.xCtl?.p?.toFixed(2), "train", ev[k].train.n, p(ev[k].train.expectancy), "test", ev[k].test.n, p(ev[k].test.expectancy), "reasons", JSON.stringify(e.reasons)); }
for (const [k, v] of Object.entries({ ...pf, ...sens })) console.log("PF", k, "trades", v.trades, "open", v.openAtEnd, "ret", p(v.totalReturn), "ann", p(v.annualized), "mdd", p(v.maxDrawdown), "spy", p(v.spyReturn), "win", p(v.winRate), "PF", v.profitFactor?.toFixed(2), "expUSD", v.expectancyUsd?.toFixed(0), "rej", JSON.stringify(v.rejects));
console.log("seconds", out.seconds);
