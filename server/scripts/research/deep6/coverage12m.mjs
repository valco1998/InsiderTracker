// deep6/coverage12m.mjs — READ-ONLY data audit for the 12-month (Nov 2025 – Oct 2026) insider-cluster 180-day study.
// Re-uses deep5's definitions (A = >=2 distinct owners same trade date, B = >=3 in 2 days, C = >=5 in 7 days,
// combined USD > $250,000) on the FULL SEC history store, and reports exactly which daily-price data is missing.
//   node --max-old-space-size=6144 scripts/research/deep6/coverage12m.mjs
// Inputs:  Form 4 history store (via lib.loadSec — same snapshot pipeline as the app), .cache/research/daily-bars.json (read only)
// Outputs: .cache/research/deep6/{sec-rows.json, coverage.json, price-needs.json}  (isolated; deep2/deep5 files are never written)
// No network, no MongoDB, no server code touched.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSec } from "../lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(here, "..", "..", "..");
const OUT = path.join(SERVER, ".cache", "research", "deep6");
fs.mkdirSync(OUT, { recursive: true });
const PERIOD = { from: "2025-11-01", to: "2026-10-31" };
const LOOKBACK_DAYS = 100; // pre-entry features (prior 60-calendar-day return, 20-session dollar volume) + margin
const HORIZON = 180;
const MIN_USD = 250000;
const DEF = { A: { W: 1, N: 2 }, B: { W: 2, N: 3 }, C: { W: 7, N: 5 } };

const dayN = (d) => Date.parse(d.slice(0, 10) + "T00:00:00Z") / 864e5;
const addDays = (d, n) => new Date((dayN(d) + n) * 864e5).toISOString().slice(0, 10);
const sym = (t) => String(t || "").trim().toUpperCase().replace(/-/g, ".");
const cnt = (a, f) => { const m = {}; for (const x of a) { const k = f(x); m[k] = (m[k] || 0) + 1; } return m; };

// 1. SEC rows — same mapping as deep2/lib2.loadSecRows, written to deep6 only.
const s = loadSec();
const rows = s.snap.economic.filter((r) => r.code === "P" || r.code === "S").map((r) => ({
  id: r.id, acc: r.accessionNo, form: r.formType, cik: Number(r.issuerCik), ticker: r.ticker, insiderCik: r.insiderCik, insider: r.insiderName,
  role: r.role, code: r.code, shares: r.shares, price: r.price, value: r.value, after: r.sharesOwnedAfter, own: r.ownership, nature: r.natureOfOwnership || null,
  fn: (r.footnotes || []).map((f) => f?.text || "").join(" | ").slice(0, 700), remarks: String(r.remarks || "").slice(0, 300),
  ctx: r.purchaseContext, plan: !!r.is10b5_1, tradeDate: r.transactionDate, acceptedAt: String(r.acceptedAtET || "").replace(/\s*ET$/, ""),
  dedupe: r.dedupe?.status || r.dedupe || null, priceCheck: r.priceCheck?.status || null, amend: r.amendment?.status || null,
}));
fs.writeFileSync(path.join(OUT, "sec-rows.json"), JSON.stringify({ builtAt: new Date().toISOString(), days: [s.days[0], s.days.at(-1)], rows }));

// 2. Bars (read only)
const bars = JSON.parse(fs.readFileSync(path.join(SERVER, ".cache", "research", "daily-bars.json"), "utf8"));
const barSyms = Object.keys(bars).filter((k) => k !== "__meta");
let lastBar = "0"; for (const k of barSyms) if (bars[k]?.length && bars[k].at(-1)[0] > lastBar) lastBar = bars[k].at(-1)[0];
const latestFullStart = addDays(lastBar, -HORIZON);

// 3. Eligible purchases (deep5 preliminary rules; trade date inside the store coverage)
const storeStart = s.days[0];
const excl = {};
const elig = [];
for (const r of rows) {
  if (r.code !== "P") continue;
  const why = !r.tradeDate ? "no_trade_date" : r.tradeDate < storeStart ? "trade_before_sec_coverage" : r.amend === "amends" ? "amendment_of_held_original"
    : r.amend === "superseded" ? "superseded_by_4A" : r.ctx === "offering_or_private" ? "offering_or_private_placement" : !(r.price > 0 && r.shares > 0 && r.value > 0) ? "no_price_or_value" : null;
  if (why) excl[why] = (excl[why] || 0) + 1; else elig.push(r);
}
const byIssuer = new Map();
for (const r of elig) (byIssuer.get(r.cik) || byIssuer.set(r.cik, []).get(r.cik)).push(r);

// 4. Preliminary clusters + disclosure (clock 2 upper bound = latest acceptance in the window) + price status
function status(ticker, entryDay) {
  if (!ticker) return "no_ticker";
  if (!(ticker in bars)) return "symbol_not_in_cache";
  const b = bars[ticker];
  if (!b || !b.length) return "symbol_without_bars_at_alpaca";
  if (b[0][0] > addDays(entryDay, -LOOKBACK_DAYS)) return b[0][0] <= entryDay ? "lookback_short" : "bars_start_after_entry";
  if (addDays(entryDay, HORIZON) > lastBar) return "immature_lt_180d";
  if (b.at(-1)[0] < addDays(entryDay, HORIZON)) return "bars_end_inside_window";
  return "full_180d";
}
const clusters = [];
for (const label of ["A", "B", "C"]) {
  const { W, N } = DEF[label];
  for (const [cik, raw] of byIssuer) {
    const rs = [...raw].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
    let lastEnd = -1e9;
    for (let i = 0; i < rs.length; i++) {
      const t = dayN(rs[i].tradeDate);
      if (t - lastEnd <= W) continue;
      const win = rs.filter((r) => dayN(r.tradeDate) <= t && dayN(r.tradeDate) > t - W);
      const owners = new Set(win.map((r) => r.insiderCik || r.insider));
      const usd = win.reduce((a, r) => a + r.value, 0);
      if (owners.size < N || usd <= MIN_USD) continue;
      lastEnd = t;
      const disclosedAt = win.map((r) => r.acceptedAt).sort().at(-1);
      const entry = addDays(disclosedAt.slice(0, 10), 1);
      const ticker = sym(rs[i].ticker);
      clusters.push({ label, cik, ticker, clusterDate: rs[i].tradeDate, disclosedAt, entry, owners: owners.size, usd: Math.round(usd), status: status(ticker, entry) });
    }
  }
}
const inPeriod = clusters.filter((c) => c.disclosedAt.slice(0, 10) >= PERIOD.from && c.disclosedAt.slice(0, 10) <= PERIOD.to);

// 5. Exact price needs
const need = { newSymbols: new Set(), lookbackExtend: new Set(), noTicker: [], endsInsideWindow: [], alpacaHasNoBars: [] };
for (const c of inPeriod) {
  if (c.status === "symbol_not_in_cache") need.newSymbols.add(c.ticker);
  else if (c.status === "lookback_short") need.lookbackExtend.add(c.ticker);
  else if (c.status === "no_ticker") need.noTicker.push({ label: c.label, cik: c.cik, clusterDate: c.clusterDate });
  else if (c.status === "bars_end_inside_window") need.endsInsideWindow.push({ label: c.label, ticker: c.ticker, entry: c.entry, lastBar: bars[c.ticker].at(-1)[0] });
  else if (c.status === "symbol_without_bars_at_alpaca") need.alpacaHasNoBars.push({ label: c.label, ticker: c.ticker });
}
// Matched controls need the same pre-entry lookback for every pool symbol: earliest entry − LOOKBACK.
const earliestEntry = inPeriod.map((c) => c.entry).sort()[0];
const poolStartNeeded = earliestEntry ? addDays(earliestEntry, -LOOKBACK_DAYS) : null;
const cacheStart = bars.__meta?.from;
const poolSymbols = barSyms.filter((k) => bars[k]?.length).length;

const summary = {};
for (const L of ["A", "B", "C"]) {
  const c = inPeriod.filter((x) => x.label === L);
  summary[L] = { clusters: c.length, byDisclosureMonth: cnt(c, (x) => x.disclosedAt.slice(0, 7)), status: cnt(c, (x) => x.status),
    fullByMonth: cnt(c.filter((x) => x.status === "full_180d"), (x) => x.disclosedAt.slice(0, 7)) };
}
const res = {
  builtAt: new Date().toISOString(), period: PERIOD, storeDays: [s.days[0], s.days.at(-1)], coverage: s.coverage,
  purchaseRows: rows.filter((r) => r.code === "P").length, eligible: elig.length, excluded: excl,
  bars: { cacheFrom: cacheStart, lastBar, latestEntryWithFull180d: latestFullStart, symbolsInCache: barSyms.length, poolSymbolsWithBars: poolSymbols },
  summary,
  priceNeeds: {
    newSymbols: [...need.newSymbols].sort(), lookbackExtendSymbols: [...need.lookbackExtend].sort(),
    poolLookback: { needFrom: poolStartNeeded, cacheFrom: cacheStart, short: poolStartNeeded && cacheStart && poolStartNeeded < cacheStart, symbols: poolSymbols },
    noTicker: need.noTicker, endsInsideWindow: need.endsInsideWindow, alpacaHasNoBars: need.alpacaHasNoBars,
  },
  note: "Preliminary cluster counts (deep5 coverage rules) for the data decision only; clock-2 entry approximated as the day after the last acceptance.",
};
fs.writeFileSync(path.join(OUT, "coverage.json"), JSON.stringify(res, null, 1));
fs.writeFileSync(path.join(OUT, "clusters-preliminary.json"), JSON.stringify(inPeriod));
console.log(JSON.stringify({ storeDays: res.storeDays, coverageComplete: s.coverage.complete, missing: s.coverage.firstMissing, bars: res.bars, summary,
  newSymbols: res.priceNeeds.newSymbols.length, lookbackExtend: res.priceNeeds.lookbackExtendSymbols.length, poolLookback: res.priceNeeds.poolLookback,
  noTicker: need.noTicker.length, endsInside: need.endsInsideWindow.length, alpacaNoBars: need.alpacaHasNoBars.length }, null, 1));
