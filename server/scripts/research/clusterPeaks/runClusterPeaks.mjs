// Cluster peak study — runner. READ-ONLY and NO NETWORK: the stored SEC Form 4 history
// (.cache/backfill/form4) and the existing research price cache (.cache/research/daily-bars.json,
// Alpaca SIP daily bars, split-adjusted). Never modifies the monthly study or any cache.
//
//   npm run research:cluster-peaks [-- --latency 60 --min-usd 250000]
//
// Categories (each detected independently, point in time — signals.detectSignals):
//   A  ≥ 2 distinct insiders, trade dates on the same calendar day        (window 1 day)
//   B  ≥ 3 distinct insiders, trade dates within 2 calendar days         (window 2 days)
//   C  ≥ 5 distinct insiders, trade dates within 7 calendar days         (window 7 days)
//   all with combined reliable purchase value > $250,000 (code P, every purchase type).
// Outputs (git-ignored): server/.cache/research/clusterPeaks/{clusters.csv, summary.json, report.md}
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadHistoryStore, buildHistoryDataset, monthlyCoverage } from "../../../services/backtest/form4History.js";
import { buildSnapshot } from "../../../services/edgar/insiderSnapshot.js";
import { detectSignals, normalizeSignalConfig } from "../../../services/backtest/signals.js";
import { peakWindow, summarizePeaks, THRESHOLDS, HORIZON_DAYS, quantile } from "./peakLib.mjs";

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const OUT = path.join(SERVER, ".cache", "research", "clusterPeaks");
const BARS_FILE = path.join(SERVER, ".cache", "research", "daily-bars.json");
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const LATENCY = Number(arg("latency", 60));
const MIN_USD = Number(arg("min-usd", 250000));
export const CATEGORIES = {
  A: { label: "≥2 insiders, same day", minBuyers: 2, windowDays: 1 },
  B: { label: "≥3 insiders, within 2 calendar days", minBuyers: 3, windowDays: 2 },
  C: { label: "≥5 insiders, within 7 calendar days", minBuyers: 5, windowDays: 7 },
};

fs.mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const store = loadHistoryStore();
const ds = buildHistoryDataset({ store });
const snap = buildSnapshot({ transactions: ds.transactions, amendmentFilings: ds.amendmentFilings });
const raw = JSON.parse(fs.readFileSync(BARS_FILE, "utf8"));
const meta = raw.__meta;
const CUTOFF = raw.SPY.at(-1)[0]; // last session in the price cache
const sym = (t) => String(t || "").trim().toUpperCase().replace(/-/g, ".");
const r6 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1e6) / 1e6);

// Baseline: the median result of every cached symbol over the SAME window (same entry date and
// window end) — how far a typical stock in this (insider-traded) universe peaks anyway.
const baseCache = new Map();
function baseline(entryDate, publishedAt) {
  const k = `${entryDate}|${publishedAt.slice(0, 10)}`;
  if (baseCache.has(k)) return baseCache.get(k);
  const peaks = [], ends = [];
  for (const [s, b] of Object.entries(raw)) {
    if (s === "__meta" || !Array.isArray(b)) continue;
    const w = peakWindow({ bars: b, publishedAt, cutoff: CUTOFF, latencySeconds: LATENCY });
    if (w.status !== "complete") continue;
    peaks.push(w.peakHighGain); ends.push(w.endReturn);
  }
  const v = { n: peaks.length, medianPeakHighGain: r6(quantile(peaks, 0.5)), medianEndReturn: r6(quantile(ends, 0.5)) };
  baseCache.set(k, v);
  return v;
}

const rows = [];
for (const [cat, c] of Object.entries(CATEGORIES)) {
  const cfg = normalizeSignalConfig({ minBuyers: c.minBuyers, windowDays: c.windowDays, minValueUsd: MIN_USD + 0.01 }).config; // "exceed" = strictly above
  const { signals } = detectSignals({ rows: snap.economic, acceptedAtByAccession: ds.acceptedAtByAccession, config: cfg,
    reportOwners: (id) => snap.rawById.get(id)?.owners, reportRow: (id) => snap.rawById.get(id) });
  for (const s of signals) {
    const symbol = sym(s.ticker);
    const bars = symbol ? raw[symbol] : undefined;
    let w = !symbol ? { status: "no_ticker" } : bars === undefined ? { status: "not_in_price_cache" } : peakWindow({ bars, publishedAt: s.publishedAt, cutoff: CUTOFF, latencySeconds: LATENCY });
    const spy = peakWindow({ bars: raw.SPY, publishedAt: s.publishedAt, cutoff: CUTOFF, latencySeconds: LATENCY });
    const base = w.status === "complete" ? baseline(w.entryDate, s.publishedAt) : null;
    const contexts = [...new Set(s.snapshot.purchases.map((p) => p.purchaseContext || "unspecified"))];
    rows.push({
      category: cat, id: s.id, ticker: s.ticker, symbol, issuerCik: s.issuerCik, issuer: s.issuerName,
      tradeFrom: s.windowFrom, tradeTo: s.windowTo, publishedAt: s.publishedAt, buyers: s.uniqueBuyers, purchases: s.purchases,
      valueUsd: s.valueUsd, roles: s.roles.join("|"), buyerNames: s.buyers.slice(0, 6).map((b) => b.name).join("; "),
      purchaseContexts: contexts.join("|"), lagDays: s.lagDays, possibleDuplicates: s.possibleDuplicatePurchases,
      filingUrl: s.filings?.[0]?.url || null,
      ...w,
      thresholds: undefined,
      ...Object.fromEntries(THRESHOLDS.map((x) => [`hit${Math.round(x * 100)}`, w.thresholds?.[x]?.hit ?? null])),
      ...Object.fromEntries(THRESHOLDS.map((x) => [`days${Math.round(x * 100)}`, w.thresholds?.[x]?.calendarDays ?? null])),
      spyPeakHighGain: spy.peakHighGain ?? null, spyEndReturn: spy.endReturn ?? null,
      baselineMedianPeak: base?.medianPeakHighGain ?? null, baselineMedianEnd: base?.medianEndReturn ?? null, baselineN: base?.n ?? null,
      _w: w,
    });
  }
}

// Summaries: complete windows only; other statuses counted and listed separately.
const by = (xs, f) => xs.reduce((m, r) => { const k = f(r); (m[k] ||= []).push(r); return m; }, {});
const summary = { generatedAt: new Date().toISOString(), cutoff: CUTOFF, horizonDays: HORIZON_DAYS, latencySeconds: LATENCY, minUsdExclusive: MIN_USD,
  priceSource: meta, secStore: { firstDay: [...store.days.keys()].sort()[0], lastDay: [...store.days.keys()].sort().at(-1) },
  coverage: monthlyCoverage({ from: "2025-12-01", to: CUTOFF, store, live: null, today: CUTOFF }), categories: {} };
const uniqKey = (r) => `${r.issuerCik}|${r.entryDate}`;
for (const cat of [...Object.keys(CATEGORIES), "ANY"]) {
  let list = cat === "ANY" ? [...new Map(rows.filter((r) => r.status === "complete").map((r) => [uniqKey(r), r])).values()] : rows.filter((r) => r.category === cat);
  const complete = list.filter((r) => r.status === "complete");
  const statusCounts = Object.fromEntries(Object.entries(by(cat === "ANY" ? complete : list, (r) => r.status)).map(([k, v]) => [k, v.length]));
  const s = summarizePeaks(complete.map((r) => r._w));
  const rel = complete.filter((r) => r.baselineMedianPeak != null);
  summary.categories[cat] = {
    label: CATEGORIES[cat]?.label || "Any category (one row per company and entry date)", signals: list.length, statusCounts, complete: s,
    // complete clusters: the same window for SPY and for the median cached stock
    spyMedianPeak: r6(quantile(complete.map((r) => r.spyPeakHighGain).filter((x) => x != null), 0.5)),
    spyMedianEnd: r6(quantile(complete.map((r) => r.spyEndReturn).filter((x) => x != null), 0.5)),
    baselineMedianPeak: r6(quantile(rel.map((r) => r.baselineMedianPeak), 0.5)),
    baselineMedianEnd: r6(quantile(rel.map((r) => r.baselineMedianEnd), 0.5)),
    medianPeakMinusBaseline: r6(quantile(rel.map((r) => r.peakHighGain - r.baselineMedianPeak), 0.5)),
    medianEndMinusBaseline: r6(quantile(rel.map((r) => r.endReturn - r.baselineMedianEnd), 0.5)),
    shareAboveBaselinePeak: rel.length ? r6(rel.filter((r) => r.peakHighGain > r.baselineMedianPeak).length / rel.length) : null,
    incomplete: summarizePeaks(list.filter((r) => r.status === "incomplete" && r.sessionsObserved).map((r) => r._w)),
    seriesEnded: summarizePeaks(list.filter((r) => r.status === "series_ended").map((r) => r._w)),
  };
}
const csvCols = ["category", "ticker", "issuer", "status", "tradeFrom", "tradeTo", "publishedAt", "availableAt", "entryDate", "entryPrice", "windowEnd", "observedThrough", "sessionsObserved",
  "buyers", "purchases", "valueUsd", "roles", "purchaseContexts", "lagDays", "possibleDuplicates", "buyerNames",
  "peakHigh", "peakHighDate", "peakHighGain", "daysToPeakHigh", "sessionsToPeakHigh", "daysPublicationToPeakHigh", "peakClose", "peakCloseDate", "peakCloseGain", "daysToPeakClose", "sessionsToPeakClose",
  "endDate", "endClose", "endReturn", "drawdownBeforePeak", "maxDrawdown", "hit10", "hit20", "hit30", "hit50", "hit100", "days10", "days20", "days30", "days50", "days100",
  "spyPeakHighGain", "spyEndReturn", "baselineMedianPeak", "baselineMedianEnd", "lastBarDate", "issuerCik", "filingUrl"];
const cell = (v) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
fs.writeFileSync(path.join(OUT, "clusters.csv"), [csvCols.join(","), ...rows.map((r) => csvCols.map((c) => cell(r[c])).join(","))].join("\n"));
fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 1));
fs.writeFileSync(path.join(OUT, "clusters.json"), JSON.stringify(rows.map(({ _w, ...r }) => r)));
const pct = (x, d = 1) => (x == null ? "N/A" : `${x > 0 ? "+" : ""}${(x * 100).toFixed(d)}%`);
for (const [k, v] of Object.entries(summary.categories)) {
  const s = v.complete;
  console.log(`[${k}] ${v.label}: signals=${v.signals} status=${JSON.stringify(v.statusCounts)} | complete n=${s.n} peakHigh mean ${pct(s.peakHighGain.mean)} median ${pct(s.peakHighGain.median)} | peakClose median ${pct(s.peakCloseGain.median)} | days to peak median ${s.daysToPeakHigh.median} (sessions ${s.sessionsToPeakHigh.median}) mean ${s.daysToPeakHigh.mean} | end median ${pct(s.endReturn.median)} mean ${pct(s.endReturn.mean)} | reached ${THRESHOLDS.map((x) => `${x * 100}%:${pct(s.reached[x].share, 0)}`).join(" ")} | SPY median peak ${pct(v.spyMedianPeak)} | universe median peak ${pct(v.baselineMedianPeak)} end ${pct(v.baselineMedianEnd)} | peak−universe median ${pct(v.medianPeakMinusBaseline)} end−universe ${pct(v.medianEndMinusBaseline)}`);
}
console.log(`[CLUSTER_PEAKS_DONE] out=${OUT} cutoff=${CUTOFF} runMs=${Date.now() - t0}`);
