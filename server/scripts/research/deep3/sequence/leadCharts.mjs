// deep3/sequence/leadCharts.mjs — chart descriptions (prior 60/20-session path, gap, volume, path after) for the 12 winners and
// 12 losers of each frozen lead (frozen-leads.json). Descriptive only.   node scripts/research/deep3/sequence/leadCharts.mjs
import { L, readOut, writePretty, r4, mean, sd } from "./common.mjs";

const leads = readOut("frozen-leads.json"), signals = readOut("signals.json"), outc = readOut("outcomes.json");
const bars = L.loadBars(), spy = bars.get("SPY");
const p = (v) => (v == null || !Number.isFinite(v) ? "n/a" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`);
function describe(sym, T) {
  const s = signals.find((x) => x.grouping === "cal" && x.universe === "om" && x.sym === sym && x.T === T); if (!s) return null;
  const o = outc[s.acc]; const ser = bars.get(sym); const k = ser.idx.get(o.entryDate); const a = ser.arr; const i = k - 1;
  const r = (n) => (i - n >= 0 ? a[i].c / a[i - n].c - 1 : null);
  const w = (n) => a.slice(Math.max(0, i - n + 1), i + 1);
  const hi60 = Math.max(...w(60).map((b) => b.c));
  const v5 = mean(w(5).map((b) => b.v)), v60 = mean(w(60).map((b) => b.v));
  const path = [0, 1, 3, 10].map((n) => (a[k + n] && a[k + n].d < "2026-09-01" ? a[k + n].c / o.o.entry - 1 : null));
  return { sym, T, position: s.position, role: s.primaryRole, usd: Math.round(s.usd || 0), buyersKnown: s.buyersSoFar, daysSinceFirst: s.daysSinceFirst,
    prior60: r4(r(60)), prior20: r4(r(20)), dd60: r4(a[i].c / hi60 - 1), volume5vs60: r4(v5 / v60), gapX: o.pre.gapX, day0: r4(path[0]), close1: r4(path[1]), close3: r4(path[2]), close10: r4(path[3]),
    mfe5: o.o.mfe[5], mae5: o.o.mae[5], netN3: o.o.x[3]?.[0] ?? null,
    text: `${sym} #${s.position} ${s.primaryRole} $${Math.round((s.usd || 0) / 1000)}k (${T.slice(0, 16)}; ${s.buyersSoFar} buyers known, ${s.daysSinceFirst?.toFixed?.(1)}d after #1). Before: ${p(r(60))} over 60 sessions, ${p(r(20))} over 20, ${p(a[i].c / hi60 - 1)} from the 60-session high, volume ${(v5 / v60).toFixed(1)}× its 60-session average in the last 5 sessions. Entry gap ${p(o.pre.gapX)} vs SPY; entry day open→close ${p(path[0])}; from the entry open: ${p(path[1])} at the next close, ${p(path[2])} at close 3, ${p(path[3])} at close 10 (MFE5 ${p(o.o.mfe[5])}, MAE5 ${p(o.o.mae[5])}); net excess N3 ${p(o.o.x[3]?.[0])}.` };
}
const out = {};
for (const [k, v] of Object.entries(leads.leads)) for (const per of ["discover", "confirm"]) {
  out[`${k}|${per}`] = { winners: v[per].winners.map((x) => describe(x.sym, x.T)).filter(Boolean), losers: v[per].losers.map((x) => describe(x.sym, x.T)).filter(Boolean) };
  const W = out[`${k}|${per}`].winners, Lz = out[`${k}|${per}`].losers;
  const avg = (xs, f) => r4(mean(xs.map(f).filter(Number.isFinite)));
  out[`${k}|${per}`].profile = { winners: { prior60: avg(W, (x) => x.prior60), prior20: avg(W, (x) => x.prior20), dd60: avg(W, (x) => x.dd60), volume5vs60: avg(W, (x) => x.volume5vs60), gapX: avg(W, (x) => x.gapX) },
    losers: { prior60: avg(Lz, (x) => x.prior60), prior20: avg(Lz, (x) => x.prior20), dd60: avg(Lz, (x) => x.dd60), volume5vs60: avg(Lz, (x) => x.volume5vs60), gapX: avg(Lz, (x) => x.gapX) } };
}
writePretty("frozen-leads-charts.json", out);
for (const key of ["L2_fastFollower|discover", "L3_drawdownFollower|discover", "L2_fastFollower|confirm"]) {
  console.log(`\n=== ${key} profile ${JSON.stringify(out[key].profile)}`);
  console.log("WINNERS"); for (const x of out[key].winners.slice(0, 10)) console.log(" -", x.text);
  console.log("LOSERS"); for (const x of out[key].losers.slice(0, 10)) console.log(" -", x.text);
}
