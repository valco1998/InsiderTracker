// deep3/sequence/leads.mjs — the three best sequence leads, frozen as exact rules, with full strategy metrics in discovery and
// confirmation (family R3, registered before computing). NOT a blind confirmation: the pre-planned descriptive confirmation
// tables (position buckets; speed and chart cross-tabs) had been printed before these rules were frozen. Disclosed.
//   node scripts/research/deep3/sequence/leads.mjs
import crypto from "node:crypto";
import { L, readOut, writePretty, writeOut, regMany, recMany, companyStats, clusteredMean, r4, mean, median, quantile, toCsv, calendar, group } from "./common.mjs";

const signals = readOut("signals.json"), outc = readOut("outcomes.json");
const bars = L.loadBars(); const cal = calendar(bars);
const J = signals.filter((s) => s.grouping === "cal" && s.universe === "om").map((s) => ({ ...s, out: outc[s.acc]?.status === "ok" ? outc[s.acc] : null })).filter((s) => s.out);
export const RULES = {
  L1_buyer2: { label: "Buyer #2 (calendar month, open-market)", f: (s) => s.position === 2,
    rule: "Universe: code-P Form 4 filings classified open-market by classification v2 (deep2 filing-class.json cls = om). Group by issuer and calendar month of SEC acceptance (ET). Distinct buyers = people (union-find of owner CIK/names and identical-transaction rows with an indirect holder, point in time). Signal: the filing whose acceptance makes a person the 2nd distinct buyer of the month." },
  L2_fastFollower: { label: "Buyer #2+ within 3 days of buyer #1", f: (s) => s.position >= 2 && s.daysSinceFirst <= 3,
    rule: "As L1, but any new buyer at position >= 2 whose filing is accepted <= 72 hours after the acceptance of the month's first open-market buyer filing at the issuer." },
  L3_drawdownFollower: { label: "Buyer #2+ after a >= 30% fall", f: (s) => s.position >= 2 && s.out.feat?.dd60 != null && s.out.feat.dd60 <= -0.3,
    rule: "As L1, any new buyer at position >= 2, when the last close before the entry session is >= 30% below the highest close of the 60 sessions up to it." },
};
const ENTRY_EXIT = "Entry: official opening auction (MOO) of the first NYSE session whose 09:30 ET open is >= SEC acceptance + 60 s. Exit: official closing auction (MOC) of the 3rd session after the entry session (hold = 4 sessions incl. the entry day). Invalidation: none (time exit only); one open position per issuer in the portfolio simulation. Costs: stage-C tier per side (5/15/35/75 bps by 20-session dollar volume before the trade date).";
const sha = crypto.createHash("sha256").update(JSON.stringify({ rules: Object.fromEntries(Object.entries(RULES).map(([k, v]) => [k, v.rule])), ENTRY_EXIT })).digest("hex");
regMany(Object.keys(RULES).flatMap((k) => ["discover", "confirm"].map((p) => ({ id: `sequence-R3-${k}-${p}`, family: "R3-frozen-leads", familySize: 6,
  statement: `${RULES[k].label}: net excess vs SPY at the close of session 3 (tier ×1) > 0 in ${p}. ${p === "confirm" ? "NOT BLIND (descriptive confirmation tables seen)." : "Post-hoc in discovery (selected from S2/S8 results)."}`,
  rationale: "Best sequence leads frozen with exact rules; full strategy metrics requested by the user.", spec: { rule: RULES[k].rule, entryExit: ENTRY_EXIT, sha256: sha } }))));

// ---- portfolio simulator (copied from deep2/execution/execLib.mjs simulatePortfolio2, adapted to the local bars map) ----
const bar = (s, d) => { if (!s) return null; const i = s.idx.get(d); return i == null ? null : s.arr[i]; };
function simulate(trades, { slots = 20, onePerIssuer = true } = {}) {
  const ts = trades.filter((t) => t.entryPrice > 0 && t.exitPrice > 0).sort((a, b) => a.entryDate.localeCompare(b.entryDate) || a.publishedAt.localeCompare(b.publishedAt) || a.id.localeCompare(b.id));
  if (!ts.length) return { trades: 0 };
  const spy = bars.get("SPY"); const first = ts[0].entryDate, last = ts.reduce((m, t) => (t.exitDate > m ? t.exitDate : m), first);
  const days = spy.arr.map((b) => b.d).filter((d) => d >= first && d <= last);
  const byEntry = group(ts, (t) => t.entryDate);
  let cash = 1; const pos = [], done = []; const skipped = { slotsFull: 0, issuerHeld: 0 };
  const value = () => pos.reduce((a, p) => a + p.shares * p.px, 0);
  const curve = [];
  for (const d of days) {
    for (const t of byEntry.get(d) || []) {
      if (pos.length >= slots) { skipped.slotsFull++; continue; }
      if (onePerIssuer && pos.some((p) => p.t.issuer === t.issuer)) { skipped.issuerHeld++; continue; }
      const eq = cash + value(); const notional = Math.min(eq / slots, cash); if (!(notional > 0)) continue;
      cash -= notional; pos.push({ t, shares: notional / (t.entryPrice * (1 + t.costIn)), px: t.entryPrice, notional });
    }
    for (const p of pos) { const b = bar(bars.get(p.t.sym), d); if (b) p.px = b.c; }
    for (let i = pos.length - 1; i >= 0; i--) { const p = pos[i]; if (p.t.exitDate === d) { const pr = p.shares * p.t.exitPrice * (1 - p.t.costOut); cash += pr; done.push({ ...p.t, pnl: pr / p.notional - 1 }); pos.splice(i, 1); } }
    curve.push([d, cash + value(), pos.length]);
  }
  const eqEnd = curve.at(-1)[1]; let peak = -Infinity, dd = 0; for (const [, v] of curve) { peak = Math.max(peak, v); dd = Math.min(dd, v / peak - 1); }
  const s0 = bar(spy, days[0]).o; const spyEnd = bar(spy, days.at(-1)).c / s0 - 1; let sp = -Infinity, sdd = 0; for (const d of days) { const v = bar(spy, d).c / s0; sp = Math.max(sp, v); sdd = Math.min(sdd, v / sp - 1); }
  const months = []; let prevV = 1, cur = null, lastV = 1; for (const [d, v] of curve) { const m = d.slice(0, 7); if (cur && m !== cur) { months.push([cur, r4(lastV / prevV - 1)]); prevV = lastV; } cur = m; lastV = v; } if (cur) months.push([cur, r4(lastV / prevV - 1)]);
  return { signals: ts.length, trades: done.length, skipped, start: days[0], end: days.at(-1), sessions: days.length, totalReturn: r4(eqEnd - 1), maxDrawdown: r4(dd), spyTotal: r4(spyEnd), spyMaxDrawdown: r4(sdd), excessVsSpy: r4(eqEnd - 1 - spyEnd),
    meanConcurrency: r4(mean(curve.map((c) => c[2]))), maxConcurrency: Math.max(...curve.map((c) => c[2])), months, worstMonth: months.reduce((w, m) => (!w || m[1] < w[1] ? m : w), null) };
}
function metrics(evs, period) {
  const rows = [];
  for (const s of evs) {
    const o = s.out.o; const x = o.x?.[3]; if (!x) continue; // embargoed / no exit bar
    const c = s.out.costBps / 1e4; const gross = o.gross[3], spyR = o.spyR[3];
    const net1 = (1 + gross) * (1 - c) / (1 + c) - 1;
    rows.push({ id: s.acc, issuer: s.cik, sym: s.sym, publishedAt: s.T, entryDate: o.exitDate ? s.out.entryDate : s.out.entryDate, exitDate: o.exitDate[3], entryPrice: o.entry, exitPrice: o.entry * (1 + gross), costIn: c, costOut: c,
      gross, spyR, net1, x1: x[0], x2: x[1], x3: x[2], delay1: s.out.od?.x?.[3]?.[0] ?? null, tp10: o.tp?.t10n3?.x1 ?? null, capacityUsd: s.out.capacityUsd, position: s.position, primaryRole: s.primaryRole, usd: s.usd, month: s.month, T: s.T });
  }
  if (!rows.length) return { n: 0 };
  const cs = companyStats(rows.map((r) => ({ issuer: r.issuer, x: r.x1 }))); const cm = clusteredMean(rows.map((r) => ({ issuer: r.issuer, x: r.x1 })));
  const pos = rows.filter((r) => r.net1 > 0).reduce((a, r) => a + r.net1, 0), neg = -rows.filter((r) => r.net1 < 0).reduce((a, r) => a + r.net1, 0);
  const posX = rows.filter((r) => r.x1 > 0).reduce((a, r) => a + r.x1, 0), negX = -rows.filter((r) => r.x1 < 0).reduce((a, r) => a + r.x1, 0);
  const calDays = rows.map((r) => (Date.parse(`${r.exitDate}T00:00:00Z`) - Date.parse(`${r.entryDate}T00:00:00Z`)) / 864e5);
  const lev = (k) => { const xs = rows.map((r) => r[k]).filter(Number.isFinite); const c2 = clusteredMean(rows.filter((r) => Number.isFinite(r[k])).map((r) => ({ issuer: r.issuer, x: r[k] }))); return { n: xs.length, mean: r4(mean(xs)), median: r4(median(xs)), t: c2.t, p: c2.p }; };
  return {
    period, trades: rows.length, issuers: cs.issuers, months: [...new Set(rows.map((r) => r.month))].length,
    winRateNet: r4(rows.filter((r) => r.net1 > 0).length / rows.length), winRateVsSpy: r4(rows.filter((r) => r.x1 > 0).length / rows.length),
    meanNet: r4(mean(rows.map((r) => r.net1))), medianNet: r4(median(rows.map((r) => r.net1))), meanGross: r4(mean(rows.map((r) => r.gross))), meanSpy: r4(mean(rows.map((r) => r.spyR))),
    spyRelative: { mean: cs.mean, median: cs.median, issuerMedianOfMeans: cs.issuerMedianOfMeans, t: cm.t, p: cm.p, ci95: cs.ci95, meanExTop5Issuers: cs.meanExTop5Issuers, positive: cs.positive },
    worstTrade: (() => { const w = rows.reduce((m, r) => (r.net1 < m.net1 ? r : m), rows[0]); return { sym: w.sym, T: w.T, net: r4(w.net1) }; })(), bestTrade: (() => { const b = rows.reduce((m, r) => (r.net1 > m.net1 ? r : m), rows[0]); return { sym: b.sym, T: b.T, net: r4(b.net1) }; })(),
    profitFactorNet: neg > 0 ? r4(pos / neg) : null, profitFactorVsSpy: negX > 0 ? r4(posX / negX) : null,
    holding: { sessions: "entry session + 3 (MOO → MOC)", meanCalendarDays: r4(mean(calDays)) },
    liquidity: { medianCapacityUsd: Math.round(median(rows.map((r) => r.capacityUsd)) || 0), share10k: r4(mean(rows.map((r) => (r.capacityUsd >= 1e4 ? 1 : 0)))), share50k: r4(mean(rows.map((r) => (r.capacityUsd >= 5e4 ? 1 : 0)))), share250k: r4(mean(rows.map((r) => (r.capacityUsd >= 2.5e5 ? 1 : 0)))), note: "capacity = 1% of the average daily dollar volume of the 20 sessions before entry" },
    slippage: { x1: lev("x1"), x2: lev("x2"), x3: lev("x3") }, oneSessionDelay: lev("delay1"), limitFillT10N3: lev("tp10"),
    portfolio20: simulate(rows.map((r) => ({ ...r, issuer: r.issuer })), { slots: 20 }),
    _rows: rows,
  };
}
const out = { frozenAt: new Date().toISOString(), sha256: sha, entryExit: ENTRY_EXIT, notBlind: "Descriptive confirmation tables (position buckets, speed/chart cross-tabs) were printed before freezing; treat confirmation as a check, not an independent test.", leads: {} };
const res = []; const csvRows = [];
for (const [k, R] of Object.entries(RULES)) {
  out.leads[k] = { label: R.label, rule: R.rule };
  for (const p of ["discover", "confirm"]) {
    const m = metrics(J.filter((s) => s.period === p && R.f(s)), p);
    const rows = m._rows || []; delete m._rows;
    rows.sort((a, b) => b.x1 - a.x1);
    m.winners = rows.slice(0, 12).map((r) => ({ sym: r.sym, T: r.T, position: r.position, role: r.primaryRole, usd: Math.round(r.usd || 0), x1: r4(r.x1) }));
    m.losers = rows.slice(-12).reverse().map((r) => ({ sym: r.sym, T: r.T, position: r.position, role: r.primaryRole, usd: Math.round(r.usd || 0), x1: r4(r.x1) }));
    out.leads[k][p] = m;
    for (const r of rows) csvRows.push({ lead: k, period: p, ...r });
    res.push([`sequence-R3-${k}-${p}`, { n: m.trades, issuers: m.issuers, estimate: m.spyRelative.mean, median: m.spyRelative.median, t: m.spyRelative.t, p: m.spyRelative.p, meanExTop5Issuers: m.spyRelative.meanExTop5Issuers, costsX2: m.slippage.x2.mean, delay1: m.oneSessionDelay.mean }]);
  }
}
recMany(res);
writePretty("frozen-leads.json", out);
writeOut("frozen-leads-events.csv", toCsv(csvRows, ["lead", "period", "id", "issuer", "sym", "T", "month", "position", "primaryRole", "usd", "entryDate", "exitDate", "entryPrice", "exitPrice", "costIn", "gross", "spyR", "net1", "x1", "x2", "x3", "delay1", "tp10", "capacityUsd"]));
const f = (v) => (v == null ? "—" : (v * 100).toFixed(2));
for (const [k, L1] of Object.entries(out.leads)) for (const p of ["discover", "confirm"]) { const m = L1[p];
  console.log(`${k} ${p}: trades ${m.trades} iss ${m.issuers} | win net ${f(m.winRateNet)} vsSPY ${f(m.winRateVsSpy)} | net mean ${f(m.meanNet)} med ${f(m.medianNet)} | xSPY mean ${f(m.spyRelative.mean)} med ${f(m.spyRelative.median)} t ${m.spyRelative.t} p ${m.spyRelative.p} exTop5 ${f(m.spyRelative.meanExTop5Issuers)} | PF ${m.profitFactorNet} | worst ${m.worstTrade.sym} ${f(m.worstTrade.net)} | x2 ${f(m.slippage.x2.mean)} x3 ${f(m.slippage.x3.mean)} delay1 ${f(m.oneSessionDelay.mean)} tp10 ${f(m.limitFillT10N3.mean)} | cap med $${m.liquidity.medianCapacityUsd} ≥$50k ${f(m.liquidity.share50k)} | port20 tot ${f(m.portfolio20.totalReturn)} DD ${f(m.portfolio20.maxDrawdown)} SPY ${f(m.portfolio20.spyTotal)} trades ${m.portfolio20.trades}`); }
