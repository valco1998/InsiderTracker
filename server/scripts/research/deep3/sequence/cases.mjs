// deep3/sequence/cases.mjs — case studies with self-contained chart data (case-<TICKER>-<month>.json).
//   node scripts/research/deep3/sequence/cases.mjs
// Objective selection among calendar-month open-market sequences with >= 3 distinct buyers and outcomes (discovery or
// confirmation; nothing after 2026-08-31 is ever written): the 5 best and 5 worst by the mean executable result of their
// position signals (net excess vs SPY at the close of session 5, tier ×1), plus the largest months by number of buyers
// not already chosen (big multi-buyer months, including the ones that failed). Chart: daily split-adjusted OHLCV from
// 60 sessions before buyer #1's first trade date to 20 sessions after the last buyer's entry session, truncated at
// 2026-08-31 (holdout never shown). Markers: every open-market filing of the month (new buyers and repeat buys).
import { L, readOut, writePretty, calendar, r4, mean, median, group, HOLDOUT_START } from "./common.mjs";

const signals = readOut("signals.json"), outc = readOut("outcomes.json"), fseq = readOut("filing-seq.json"), filings = readOut("filings.json");
const F = new Map(filings.map((f) => [f.acc, f]));
const bars = L.loadBars(); const cal = calendar(bars);
const CUT = "2026-08-31";
const cal0 = signals.filter((s) => s.grouping === "cal" && s.universe === "om");
const seqs = [...group(cal0, (s) => `${s.cik}|${s.month}`).values()].map((xs) => xs.sort((a, b) => a.T.localeCompare(b.T) || a.position - b.position));
const scored = seqs.filter((xs) => xs.length >= 3 && xs.every((s) => s.period !== "holdout")).map((xs) => {
  const n5 = xs.map((s) => outc[s.acc]?.o?.x?.[5]?.[0]).filter(Number.isFinite);
  return { xs, key: `${xs[0].sym}|${xs[0].month}`, n5mean: n5.length >= Math.ceil(xs.length / 2) ? mean(n5) : null, buyers: xs.length, accum: Math.max(...xs.map((s) => s.accumUsd || 0)) };
}).filter((x) => x.n5mean != null && x.xs[0].sym && bars.get(x.xs[0].sym));
scored.sort((a, b) => b.n5mean - a.n5mean);
const chosen = []; const seen = new Set();
const take = (x, why) => { if (seen.has(x.key) || chosen.length >= 14) return; seen.add(x.key); chosen.push({ ...x, why }); };
scored.slice(0, 5).forEach((x) => take(x, "top-5 mean N5 among months with >= 3 buyers"));
scored.slice(-5).reverse().forEach((x) => take(x, "bottom-5 mean N5 among months with >= 3 buyers"));
[...scored].sort((a, b) => b.buyers - a.buyers).slice(0, 6).forEach((x) => take(x, `largest multi-buyer month (${x.buyers} buyers)`));

const pct = (v, d = 1) => (v == null || !Number.isFinite(v) ? "n/a" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(d)}%`);
const idxOn = (ser, d) => { const i = ser.idx.get(d); return i != null ? i : L.idxBefore(ser, d) + 1; }; // first bar on/after d
const index = [];
for (const c of chosen) {
  const xs = c.xs; const sym = xs[0].sym, month = xs[0].month, cik = xs[0].cik;
  const ser = bars.get(sym), spy = bars.get("SPY");
  const firstTrade = xs.map((s) => s.tradeDateMin).filter(Boolean).sort()[0] || xs[0].T.slice(0, 10);
  const lastEntry = xs.map((s) => outc[s.acc]?.entryDate).filter(Boolean).sort().at(-1) || xs.at(-1).T.slice(0, 10);
  const i0 = Math.max(0, idxOn(ser, firstTrade) - 60);
  const iL = idxOn(ser, lastEntry);
  const i1 = Math.min(ser.arr.length - 1, iL + 20);
  const series = ser.arr.slice(i0, i1 + 1).filter((b) => b.d <= CUT).map((b) => ({ d: b.d, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, spyC: spy.arr[spy.idx.get(b.d)]?.c ?? null }));
  const truncated = ser.arr[i1]?.d > CUT;
  // markers: every open-market filing of the month (cal fseq), new buyers and repeat buys
  const fm = fseq.filter((x) => x.grouping === "cal" && x.universe === "om" && x.cik === cik && x.month === month).sort((a, b) => a.T.localeCompare(b.T));
  const markers = fm.map((x) => {
    const f = F.get(x.acc), o = outc[x.acc];
    const sig = xs.find((s) => s.acc === x.acc);
    return { type: x.isNew ? "newBuyer" : "repeatBuy", position: x.position, buyersKnown: x.buyersSoFar, name: f.names.join("; ").slice(0, 80), role: f.role, primaryRole: f.primaryRole, own: f.own, usd: Math.round(f.usd || 0),
      tradeDates: f.tradeDateMin === f.tradeDateMax ? f.tradeDateMin : `${f.tradeDateMin}..${f.tradeDateMax}`, acceptedAt: x.T, entryDate: o?.entryDate ?? null, entryOpen: o?.o?.entry ?? null,
      largestSoFar: sig ? sig.isLargestSoFar : null, largestFilingSoFar: x.largestFilingSoFar, gapX: o?.pre?.gapX ?? null, tradeToDecisionX: o?.pre?.tradeToDecisionX ?? null,
      firstTouch: o?.o?.first ?? null, net1: { N0: o?.o?.x?.[0]?.[0] ?? null, N1: o?.o?.x?.[1]?.[0] ?? null, N3: o?.o?.x?.[3]?.[0] ?? null, N5: o?.o?.x?.[5]?.[0] ?? null, N10: o?.o?.x?.[10]?.[0] ?? null }, tie: sig ? sig.tieSize : null };
  });
  // narrative numbers
  const it = idxOn(ser, firstTrade), b = (i) => ser.arr[Math.max(0, Math.min(ser.arr.length - 1, i))];
  const pre60 = it - 60 >= 0 ? b(it - 1).c / b(it - 61).c - 1 : null, pre20 = it - 21 >= 0 ? b(it - 1).c / b(it - 21).c - 1 : null;
  let hi60 = -Infinity; for (let k = Math.max(0, it - 60); k < it; k++) hi60 = Math.max(hi60, ser.arr[k].c);
  const dd60 = b(it - 1).c / hi60 - 1;
  const m1 = markers.find((m) => m.type === "newBuyer" && m.position === 1) || markers[0];
  const e1 = m1.entryOpen, ie1 = ser.idx.get(m1.entryDate);
  let t10From1 = null; if (ie1 != null) for (let k = ie1; k < Math.min(ser.arr.length, ie1 + 41); k++) { if (ser.arr[k].d > CUT) break; if (ser.arr[k].h >= e1 * 1.1) { t10From1 = k - ie1 + 1; break; } }
  const tradeClose = b(it).c, lastSeries = series.at(-1);
  const fromTradeToEnd = lastSeries ? lastSeries.c / tradeClose - 1 : null;
  const fromEntry1ToEnd = lastSeries && e1 ? lastSeries.c / e1 - 1 : null;
  const gaps = markers.filter((m) => m.type === "newBuyer").map((m) => m.gapX).filter(Number.isFinite);
  const preMoves = markers.filter((m) => m.type === "newBuyer").map((m) => m.tradeToDecisionX).filter(Number.isFinite);
  const posts = markers.filter((m) => m.type === "newBuyer").map((m) => m.net1.N5).filter(Number.isFinite);
  const reactions = markers.filter((m) => m.type === "newBuyer").map((m) => `#${m.position} ${m.primaryRole} $${(m.usd / 1000).toFixed(0)}k (${m.acceptedAt.slice(5, 16)}): gap ${pct(m.gapX)}, N1 ${pct(m.net1.N1)}, N5 ${pct(m.net1.N5)}`).join("; ");
  const narrative = [
    `${sym} ${month}: ${xs.length} distinct open-market buyers (${markers.filter((m) => m.type === "repeatBuy").length} repeat filings), $${(c.accum / 1e6).toFixed(2)}M in total; selected as ${c.why}.`,
    `Before the first purchase (${firstTrade}) the stock was ${pct(pre60)} over 60 sessions and ${pct(pre20)} over 20, ${pct(dd60)} from its 60-session closing high.`,
    `Reaction to each publication (gap = entry open vs the prior close, minus SPY; N = net excess at the close of session N): ${reactions}.`,
    `Before vs after publication: median move from the trade date to the last close before entry ${pct(median(preMoves))}, median entry gap ${pct(median(gaps))}, median post-entry N5 ${pct(median(posts))}. ` +
      (Math.abs(median(gaps) ?? 0) > Math.abs(median(preMoves) ?? 0) ? "Most of the visible reaction happened at the opening gap after publication, not between the trade and the filing." : "More of the move happened between the trades and their publication than at the open."),
    `Time to +10%: ${t10From1 == null ? "the daily high never reached +10% above buyer #1's entry open within 40 sessions (or before 2026-08-31)" : `${t10From1} session(s) after buyer #1's entry (session 1 = entry day)`}. From buyer #1's entry open to the end of the chart: ${pct(fromEntry1ToEnd)} (from the first trade-date close: ${pct(fromTradeToEnd)}).${truncated ? " Chart truncated at 2026-08-31." : ""}`,
  ].join(" ");
  const doc = { ticker: sym, issuerCik: cik, month, grouping: "calendar month of publication", universe: "open-market (classification v2)", selection: c.why, meanN5OfPositions: r4(c.n5mean),
    window: { from: series[0]?.d, to: series.at(-1)?.d, rule: "60 sessions before buyer #1's first trade date → 20 sessions after the last buyer's entry session", truncatedAtHoldout: truncated },
    summary: { buyers: xs.length, repeatFilings: markers.filter((m) => m.type === "repeatBuy").length, accumUsd: Math.round(c.accum), firstTrade, firstAcceptedAt: xs[0].T, lastAcceptedAt: xs.at(-1).T, pre60: r4(pre60), pre20: r4(pre20), dd60BeforeFirstTrade: r4(dd60), sessionsToPlus10FromBuyer1: t10From1, fromBuyer1EntryToEnd: r4(fromEntry1ToEnd) },
    fields: { series: "d, o, h, l, c (split-adjusted Alpaca SIP daily bars), v (shares), spyC (SPY close)", markers: "one per open-market filing; entryOpen = official open of the first session >= acceptance + 60 s; gapX = entry open vs prior close minus SPY gap; net1.N* = net excess vs SPY at the close of session N after entry (tier cost ×1); firstTouch = session (1 = entry day) of the first daily high >= +5/10/15/20%" },
    markers, series, narrative };
  const name = `case-${sym.replace(/[^A-Z0-9.]/g, "")}-${month}.json`;
  writePretty(name, doc);
  index.push({ file: name, ticker: sym, month, why: c.why, buyers: xs.length, meanN5: r4(c.n5mean), narrative });
  console.log(`\n${name}\n  ${narrative}`);
}
writePretty("cases-index.json", index);
