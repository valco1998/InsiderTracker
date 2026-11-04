// deep3/targets/cases.mjs — winners and losers (>= 10 each) of the promising patterns with chart descriptions, and
// self-contained case files (daily OHLCV 60 sessions before -> 20 after the entry, with filing markers) for the lead.
// Holdout-safe: only events whose 20-session window ends before 2026-09-01; markers only for filings accepted before.
//   node scripts/research/deep3/targets/cases.mjs
import fs from "node:fs";
import path from "node:path";
import { readOut, writeOut, checkpoint, loadBars, loadSecRows, calendar, HOLDOUT_START, DEEP2, r4, mean, toCsv, OUT } from "./common.mjs";
import { patternList } from "./defs.mjs";
import { loadRows } from "./stats.mjs";

const prom = readOut("promising.json").promising.filter((x) => x.promising);
const TH = readOut("thresholds.json");
const PL = new Map(patternList(TH).map((p) => [p.id, p]));
const bars = loadBars(); const cal = calendar(bars);
const rows = loadRows();
const fc = JSON.parse(fs.readFileSync(path.join(DEEP2, "behavior", "filing-class.json"), "utf8"));
const sec = await loadSecRows();
const P = (v, d = 1) => (v == null || !Number.isFinite(v) ? "n/a" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(d)}%`);

function chart(r) {
  const s = bars.get(r.s), a = s.arr, k = r.k, i = k - 1;
  const w = (from, to) => a.slice(Math.max(0, from), to + 1);
  const pre60 = w(i - 59, i), pre5 = w(i - 4, i);
  const hi60 = Math.max(...pre60.map((b) => b.h)), lo60 = Math.min(...pre60.map((b) => b.l));
  const vAvg = (xs) => mean(xs.map((b) => b.v));
  const v5 = vAvg(pre5), v60 = vAvg(pre60);
  const e = a[k];
  const post = (n) => (r.o[`x${n}`] == null ? null : r.o[`x${n}`]);
  const d = { ret60: r.r60, ret20: r.r20, ret5: r.r5, dd60: r.dd60, pos60: r.pos60, vol20: r.vol20, vol5vs60: v60 > 0 ? v5 / v60 : null, dollarVol20: r.dv20, gap: r.gap, gapVsSpy: r.gapX, day0: e.c / e.o - 1, entryVolVs60: v60 > 0 ? e.v / v60 : null,
    x1: post(1), x3: post(3), x5: post(5), x10: post(10), mfe5: r.o.mfe5, mae5: r.o.mae5, mfe10: r.o.mfe10, mae10: r.o.mae10, ttt10: r.o.ttt10, tp: r.o.tp10s10n5, tpWhy: r.o.tp10s10n5_why };
  const where = d.pos60 <= 0.15 ? "at the bottom of its 60-session range" : d.pos60 >= 0.85 ? "near the top of its 60-session range" : `in the ${d.pos60 < 0.5 ? "lower" : "upper"} half of its 60-session range`;
  const volw = d.vol5vs60 >= 1.8 ? `volume ${d.vol5vs60.toFixed(1)}x the 60-session average in the last 5 sessions` : d.vol5vs60 <= 0.6 ? "volume drying up" : "normal volume";
  d.text = `Before: ${P(d.ret60)} over 60 sessions (${P(d.ret20)} over 20, ${P(d.ret5)} over 5), ${P(d.dd60)} from the 60-session high, ${where}; daily vol ${P(d.vol20)}; ${volw}; $${((d.dollarVol20 || 0) / 1e6).toFixed(1)}M/day. `
    + `Entry: gap ${P(d.gap)} (${P(d.gapVsSpy)} vs SPY), entry-day open->close ${P(d.day0)} on ${d.entryVolVs60 == null ? "n/a" : d.entryVolVs60.toFixed(1)}x volume. `
    + `After (net vs SPY): ${P(d.x1)} at close 1, ${P(d.x3)} at 3, ${P(d.x5)} at 5, ${P(d.x10)} at 10; MFE5 ${P(d.mfe5)}, MAE5 ${P(d.mae5)}; +10% ${d.ttt10 == null ? "not touched in 10" : `touched in session ${d.ttt10}`}; limit-fill rule exit ${d.tpWhy || "n/a"} ${P(d.tp)}.`;
  return d;
}
const filingsAt = (cik, from, to) => sec.rows.filter((x) => x.cik === cik && (x.code === "P" || x.code === "S") && String(x.acceptedAt) < HOLDOUT_START && String(x.acceptedAt).slice(0, 10) >= from && String(x.acceptedAt).slice(0, 10) <= to);

const report = {}; const caseCandidates = [];
for (const pid of [...new Set(prom.map((x) => x.pattern))]) {
  const p = PL.get(pid);
  const key = prom.find((x) => x.pattern === pid).test; // the promising outcome
  const sel = rows.filter((r) => (p.universe === "om" ? r.cls === "om" : true) && p.f(r) && r.o?.[key] != null);
  // one row per distinct situation (ticker + entry date): same-day filings by several insiders share one outcome
  const seenTD = new Map(); for (const r of sel) { const k2 = `${r.ticker}|${r.entryDate}`; seenTD.set(k2, (seenTD.get(k2) || 0) + 1); }
  const uniq = []; const usedTD = new Set(); for (const r of [...sel].sort((a, b) => b.o[key] - a.o[key])) { const k2 = `${r.ticker}|${r.entryDate}`; if (usedTD.has(k2)) continue; usedTD.add(k2); r.sameDayFilings = seenTD.get(k2); uniq.push(r); }
  const sorted = uniq;
  const fmt = (r) => ({ id: r.id, ticker: r.ticker, issuerName: r.issuerName, period: r.per, publishedAt: r.publishedAt, entryDate: r.entryDate, insider: r.insider, role: r.role, filingValue: Math.round(r.filingValue), cls: r.cls, pub: r.pubB, clu7: r.clu7,
    othersSold90: r.othersSold90, othersSoldAny90: r.othersSoldAny90, sameDayFilings: r.sameDayFilings, outcome: key, value: r4(r.o[key]), x5: r4(r.o.x5), chart: chart(r) });
  report[pid] = { outcome: key, n: sel.length, distinctSituations: uniq.length, winners: sorted.slice(0, 12).map(fmt), losers: sorted.slice(-12).reverse().map(fmt) };
  for (const [lab, list] of [["winner", sorted.slice(0, 12)], ["loser", sorted.slice(-12).reverse()]]) for (const r of list) caseCandidates.push({ pid, lab, r });
}
writeOut("winners-losers.json", { generatedAt: new Date().toISOString(), note: "Pattern events from discovery AND confirmation, ranked by the pattern's promising outcome (net excess vs SPY). Charts use split-adjusted daily bars.", patterns: report });
const flat = []; for (const [pid, v] of Object.entries(report)) for (const lab of ["winners", "losers"]) for (const x of v[lab]) flat.push({ pattern: pid, side: lab, ticker: x.ticker, period: x.period, entryDate: x.entryDate, role: x.role, filingValue: x.filingValue, outcome: x.outcome, value: x.value, x5: x.x5, description: x.chart.text });
writeOut("winners-losers.csv", toCsv(flat, Object.keys(flat[0])));

// ---------------- case files: up to 10, distinct tickers, windows ending before the holdout ----------------
const picks = []; const usedT = new Set();
const want = { winner: 5, loser: 5 };
for (const lab of ["winner", "loser"]) for (const pid of Object.keys(report)) {
  let taken = 0;
  for (const c of caseCandidates.filter((x) => x.lab === lab && x.pid === pid)) {
    if (taken >= Math.ceil(want[lab] / Object.keys(report).length) || picks.filter((x) => x.lab === lab).length >= want[lab]) break;
    const end = cal.days[c.r.j + 20]; if (!end || end >= HOLDOUT_START || usedT.has(c.r.ticker)) continue;
    picks.push(c); usedT.add(c.r.ticker); taken++;
  }
}
fs.mkdirSync(path.join(OUT, "cases"), { recursive: true });
const written = [];
for (const c of picks) {
  const r = c.r, s = bars.get(r.s), a = s.arr;
  const from = Math.max(0, r.k - 60), to = Math.min(a.length - 1, r.k + 20);
  const ohlcv = a.slice(from, to + 1).filter((b) => b.d < HOLDOUT_START).map((b) => ({ d: b.d, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));
  const spy = bars.get("SPY"); const spyBars = ohlcv.map((b) => { const x = spy.arr[spy.idx.get(b.d)]; return x ? { d: b.d, o: x.o, c: x.c } : null; }).filter(Boolean);
  const fl = filingsAt(r.issuer, ohlcv[0].d, ohlcv.at(-1).d);
  const byAcc = new Map(); for (const x of fl) { const g = byAcc.get(x.acc) || { acc: x.acc, code: x.code, acceptedAt: x.acceptedAt, tradeDate: x.tradeDate, insider: x.insider, role: x.role, value: 0, shares: 0, plan10b5_1: !!x.plan, cls: x.code === "P" ? fc[x.acc]?.cls || "unknown" : null }; g.value += x.value > 0 ? x.value : 0; g.shares += x.shares || 0; if (x.tradeDate > g.tradeDate) g.tradeDate = x.tradeDate; byAcc.set(x.acc, g); }
  const markers = [...byAcc.values()].sort((x, y) => x.acceptedAt.localeCompare(y.acceptedAt)).map((g) => ({ ...g, value: Math.round(g.value), isThisEvent: g.acc === r.acc }));
  const file = `case-${r.ticker}-${r.entryDate}.json`;
  const body = { ticker: r.ticker, issuerName: r.issuerName, issuerCik: r.issuer, pattern: c.pid, side: c.lab, period: r.per, event: { accession: r.acc, publishedAt: r.publishedAt, tradeDate: r.tradeDate, insider: r.insider, role: r.role, filingValue: Math.round(r.filingValue), classV2: r.cls, publication: r.pubB },
    entry: { date: r.entryDate, price: r.entryPrice, rule: "official open of the first session >= acceptance + 60 s" }, outcome: { key: report[c.pid].outcome, value: r4(r.o[report[c.pid].outcome]), x1: r4(r.o.x1), x3: r4(r.o.x3), x5: r4(r.o.x5), x10: r4(r.o.x10), mfe10: r4(r.o.mfe10), mae10: r4(r.o.mae10), sessionsToPlus10: r.o.ttt10 },
    chartDescription: chart(r).text, priceBasis: "split-adjusted daily bars (Alpaca SIP, regular-session high/low); volume as reported", window: { sessionsBefore: r.k - from, sessionsAfter: to - r.k }, ohlcv, spy: spyBars,
    filingMarkers: markers, markerNote: "All Form 4 P (purchase) and S (sale) filings at the issuer accepted inside the window (and before 2026-09-01); plan10b5_1 marks planned sales; cls = classification v2 for purchases." };
  fs.writeFileSync(path.join(OUT, "cases", file), JSON.stringify(body, null, 1));
  written.push({ file: `cases/${file}`, pattern: c.pid, side: c.lab, ticker: r.ticker, entryDate: r.entryDate, value: r4(r.o[report[c.pid].outcome]) });
}
writeOut("cases-index.json", written);
checkpoint("winners/losers and case files", { cases: written.length });
for (const [pid, v] of Object.entries(report)) {
  console.log(`\n=== ${pid} (${v.outcome}, n ${v.n}) WINNERS`); for (const x of v.winners) console.log(`${x.ticker} ${x.entryDate} ${x.period} ${x.role} $${x.filingValue} ${P(x.value)} | ${x.chart.text}`);
  console.log(`--- ${pid} LOSERS`); for (const x of v.losers) console.log(`${x.ticker} ${x.entryDate} ${x.period} ${x.role} $${x.filingValue} ${P(x.value)} | ${x.chart.text}`);
}
console.log("\ncases:", JSON.stringify(written));
