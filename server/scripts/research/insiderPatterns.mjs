// Insider-purchase patterns: which ones would have made money for someone following SEC filings?
// Point-in-time events (lib.mjs), entry at the first open after SEC acceptance + 60 s, horizons
// 1/5/10/20/30/60 sessions, SPY over the same dates, liquidity-tiered costs, max drawdown and max
// favorable move after entry. In-sample (published before OOS_FROM) vs out-of-sample, issuer-
// clustered t-statistics and Benjamini–Hochberg false-discovery control over ALL variants ×
// horizons tested. Usage (from server/): node scripts/research/insiderPatterns.mjs
import { loadSec, purchaseItemsByIssuer, buildEvents, loadDailyBars, lastCompleteSession, priceEvent, summarize, bhQ, writeOut, toCsv, HORIZONS, r4, pct, sym } from "./lib.mjs";
import { detectSignals, normalizeSignalConfig } from "../../services/backtest/signals.js";

const OOS_FROM = "2026-08-01";
const MAIN_H = 20; // headline horizon (others reported too)
const t0 = Date.now();
const sec = loadSec();
const itemsByIssuer = purchaseItemsByIssuer(sec);
const events = buildEvents({ itemsByIssuer, acc: sec.acc });
const completeThrough = lastCompleteSession();

// Default-strategy cluster signals (2 distinct buyers, ≥ $250k, 30 days) — the app's signals.
const { signals } = detectSignals({ rows: sec.snap.economic, acceptedAtByAccession: sec.acc, config: normalizeSignalConfig({}).config,
  reportOwners: (id) => sec.snap.rawById.get(id)?.owners, reportRow: (id) => sec.snap.rawById.get(id) });
const sigEvents = signals.map((s) => ({ issuerCik: Number(s.issuerCik), ticker: s.ticker, issuerName: s.issuerName, signalId: s.id, publishedAt: s.publishedAt.replace(/ ET$/, ""),
  tradeDate: s.windowTo, price: null, buyers: s.uniqueBuyers, purchases: s.purchases, valueUsd: s.valueUsd, windowFrom: s.windowFrom, possibleDuplicates: s.possibleDuplicatePurchases }));

const bars = await loadDailyBars([...events.map((e) => e.ticker), ...sigEvents.map((e) => e.ticker), "SPY", "IWM"]);
const spy = bars.get("SPY"), iwm = bars.get("IWM");
for (const e of [...events, ...sigEvents]) priceEvent(e, { bars: bars.get(sym(e.ticker)), spy, iwm, completeThrough });

// ---------------- Pattern families (parameter grids; nothing tuned to RAPP) ----------------
const big = (e, v) => e.filingValue >= v;
const families = {
  "Multiple insiders": [
    ["≥2 distinct buyers in 30 days (incl. this)", (e) => e.buyersInWindow >= 2],
    ["≥3 distinct buyers in 30 days", (e) => e.buyersInWindow >= 3],
    ["≥5 distinct buyers in 30 days", (e) => e.buyersInWindow >= 5],
    ["≥3 buyers and filing ≥ $250k", (e) => e.buyersInWindow >= 3 && big(e, 2.5e5)],
  ],
  "Increasing purchase sizes": [
    ["Same insider, ≥3 buys, each larger", (e) => e.progressive],
  ],
  "Repeated purchases by the same insider": [
    ["Same insider bought ≥1× earlier in 30 days", (e) => e.sameInsiderPriorTx >= 1],
    ["Same insider bought ≥3× earlier in 30 days", (e) => e.sameInsiderPriorTx >= 3],
  ],
  "Large vs. earlier purchases": [
    ["≥3× largest earlier purchase (any buyer)", (e) => e.ratioToMaxPrior >= 3],
    ["≥10× largest earlier purchase", (e) => e.ratioToMaxPrior >= 10],
    ["≥2 earlier other buyers, then ≥10×", (e) => e.priorOtherBuyers >= 2 && e.ratioToMaxPrior >= 10],
    ["This filing ≥90% of 30-day value, ≥2 buyers", (e) => e.buyersInWindow >= 2 && e.windowShare >= 0.9],
  ],
  "Direct vs. fund ownership": [
    ["Direct (personal), ≥ $100k", (e) => e.ownership === "D" && big(e, 1e5)],
    ["Indirect (fund / trust / entity), ≥ $100k", (e) => e.ownership === "I" && big(e, 1e5)],
    ["Direct, ≥ $1M", (e) => e.ownership === "D" && big(e, 1e6)],
    ["Indirect, ≥ $1M", (e) => e.ownership === "I" && big(e, 1e6)],
  ],
  "Open market vs. private placement": [
    ["Stated open market", (e) => e.venue === "open_market"],
    ["Open market, price within 2% of prior close", (e) => e.venue === "open_market" && e.priceVsPrevClose != null && Math.abs(e.priceVsPrevClose) <= 0.02],
    ["Stated offering / private placement", (e) => e.venue === "offering_or_private"],
    ["Price ≥5% below prior close (offering proxy)", (e) => e.priceVsPrevClose != null && e.priceVsPrevClose <= -0.05],
  ],
  "After price declines": [
    ["Prior 20-session return ≤ −10%", (e) => e.ret20 != null && e.ret20 <= -0.1],
    ["Prior 20-session return ≤ −20%", (e) => e.ret20 != null && e.ret20 <= -0.2],
    ["Prior 20-session return ≤ −30%", (e) => e.ret20 != null && e.ret20 <= -0.3],
    ["≤ −20% and open market", (e) => e.ret20 != null && e.ret20 <= -0.2 && e.venue === "open_market"],
  ],
  "Combinations": [
    ["≥2 buyers + open market + filing ≥ $100k", (e) => e.buyersInWindow >= 2 && e.venue === "open_market" && big(e, 1e5)],
    ["≥3 buyers + open market", (e) => e.buyersInWindow >= 3 && e.venue === "open_market"],
    ["Direct ≥ $250k + open market + ≤ −10% prior", (e) => e.ownership === "D" && big(e, 2.5e5) && e.venue === "open_market" && e.ret20 != null && e.ret20 <= -0.1],
    ["Officer (CEO/CFO) open-market buy", (e) => e.venue === "open_market" && /chief executive|chief financial|\bceo\b|\bcfo\b/i.test(e.role || "")],
  ],
  "Liquidity (20-day avg dollar volume)": [
    ["Very liquid ≥ $50M/day", (e) => e.avgDollarVol20 >= 50e6],
    ["Liquid $5–50M/day", (e) => e.avgDollarVol20 >= 5e6 && e.avgDollarVol20 < 50e6],
    ["Thin $1–5M/day", (e) => e.avgDollarVol20 >= 1e6 && e.avgDollarVol20 < 5e6],
    ["Very thin < $1M/day", (e) => e.avgDollarVol20 > 0 && e.avgDollarVol20 < 1e6],
  ],
  "Controls": [
    ["All purchase filings", () => true],
    ["All purchase filings ≥ $1M", (e) => big(e, 1e6)],
  ],
};
const isIS = (e) => e.publishedAt < OOS_FROM;
const results = [];
for (const [family, vs] of Object.entries(families)) for (const [name, f] of vs) {
  const es = events.filter(f);
  const missing = es.reduce((m, e) => (e.priceStatus === "ok" ? m : ((m[e.priceStatus] = (m[e.priceStatus] || 0) + 1), m)), {});
  const byH = {};
  for (const N of HORIZONS) byH[N] = { all: summarize(es, N), is: summarize(es.filter(isIS), N), oos: summarize(es.filter((e) => !isIS(e)), N) };
  // Consistency: share of publication months with positive mean net excess at MAIN_H.
  const months = new Map();
  for (const e of es) if (e.h?.[MAIN_H]?.status === "ok") { const k = e.publishedAt.slice(0, 7); (months.get(k) || months.set(k, []).get(k)).push(e.h[MAIN_H].excessNet); }
  const monthly = [...months].sort().map(([m, xs]) => ({ month: m, n: xs.length, meanExcessNet: r4(xs.reduce((a, b) => a + b, 0) / xs.length) }));
  results.push({ family, name, candidates: es.length, issuers: new Set(es.map((e) => e.issuerCik)).size, missing, byH, monthly,
    positiveMonths: monthly.filter((m) => m.n >= 5).length ? r4(monthly.filter((m) => m.n >= 5 && m.meanExcessNet > 0).length / monthly.filter((m) => m.n >= 5).length) : null });
}
// Default-strategy signals as their own row.
const sigRow = { family: "App signals", name: "Default strategy signals (2 buyers, ≥$250k, 30d)", candidates: sigEvents.length, issuers: new Set(sigEvents.map((e) => e.issuerCik)).size,
  missing: sigEvents.reduce((m, e) => (e.priceStatus === "ok" ? m : ((m[e.priceStatus] = (m[e.priceStatus] || 0) + 1), m)), {}),
  byH: Object.fromEntries(HORIZONS.map((N) => [N, { all: summarize(sigEvents, N), is: summarize(sigEvents.filter(isIS), N), oos: summarize(sigEvents.filter((e) => !isIS(e)), N) }])) };
results.push(sigRow);

// Multiple comparisons: BH q-values over every in-sample test (variant × horizon) of NET excess.
const tests = [];
for (const r of results) for (const N of HORIZONS) tests.push({ r, N, p: r.byH[N].is.pExcessNet });
const q = bhQ(tests.map((t) => t.p));
tests.forEach((t, i) => { t.r.byH[t.N].is.qExcessNet = r4(q[i]); });
// "Validated" = in-sample FDR q < 0.10 on net excess AND same sign out-of-sample with OOS p < 0.05.
for (const r of results) for (const N of HORIZONS) {
  const { is, oos } = r.byH[N];
  r.byH[N].verdict = is.qExcessNet != null && is.qExcessNet < 0.1 && oos.n >= 10 && oos.pExcessNet != null && oos.pExcessNet < 0.05 && Math.sign(oos.meanExcessNet) === Math.sign(is.meanExcessNet)
    ? (is.meanExcessNet > 0 ? "validated_positive" : "validated_negative")
    : is.qExcessNet != null && is.qExcessNet < 0.1 ? "in_sample_only" : "not_significant";
}

// ---------------- Outputs ----------------
const evCols = ["publishedAt", "ticker", "issuerName", "accessionNo", "insider", "role", "ownership", "venue", "tradeDate", "price", "filingValue", "buyersInWindow", "priorOtherBuyers", "ratioToMaxPrior", "sameInsiderPriorTx", "progressive", "priceVsPrevClose", "ret20", "avgDollarVol20", "costBpsPerSide", "priceStatus", "entryDate", "entryPrice",
  ...HORIZONS.flatMap((N) => [(e) => e.h?.[N]?.status ?? "", (e) => e.h?.[N]?.gross ?? "", (e) => e.h?.[N]?.net ?? "", (e) => e.h?.[N]?.spy ?? "", (e) => e.h?.[N]?.excess ?? "", (e) => e.h?.[N]?.maxDrawdown ?? "", (e) => e.h?.[N]?.maxFavorable ?? ""])];
const evHead = ["publishedAt_ET", "ticker", "issuer", "accession", "insider", "role", "ownership", "venue", "tradeDate", "reportedPrice", "filingValueUsd", "buyersInWindow", "priorOtherBuyers", "ratioToMaxPrior", "sameInsiderPriorTx", "progressive", "priceVsPrevClose", "priorRet20", "avgDollarVol20", "costBpsPerSide", "priceStatus", "entryDate", "entryOpen",
  ...HORIZONS.flatMap((N) => [`h${N}_status`, `h${N}_gross`, `h${N}_net`, `h${N}_spy`, `h${N}_excess`, `h${N}_maxDD`, `h${N}_maxFav`])];
const csv = (rows, cols, head) => toCsv(rows, cols).replace(/^[^\n]*/, head.join(","));
writeOut("events.csv", csv(events, evCols, evHead));
const sigCols = ["publishedAt", "ticker", "issuerName", "signalId", "windowFrom", "tradeDate", "buyers", "purchases", "valueUsd", "possibleDuplicates", "costBpsPerSide", "priceStatus", "entryDate", "entryPrice",
  ...HORIZONS.flatMap((N) => [(e) => e.h?.[N]?.status ?? "", (e) => e.h?.[N]?.gross ?? "", (e) => e.h?.[N]?.net ?? "", (e) => e.h?.[N]?.spy ?? "", (e) => e.h?.[N]?.excess ?? "", (e) => e.h?.[N]?.maxDrawdown ?? "", (e) => e.h?.[N]?.maxFavorable ?? ""])];
writeOut("signals.csv", csv(sigEvents, sigCols, ["publishedAt_ET", "ticker", "issuer", "signalId", "windowFrom", "windowTo", "buyers", "purchases", "valueUsd", "possibleDuplicates", "costBpsPerSide", "priceStatus", "entryDate", "entryOpen",
  ...HORIZONS.flatMap((N) => [`h${N}_status`, `h${N}_gross`, `h${N}_net`, `h${N}_spy`, `h${N}_excess`, `h${N}_maxDD`, `h${N}_maxFav`])]));
const meta = { generatedAt: new Date().toISOString(), runSeconds: Math.round((Date.now() - t0) / 1000), completeThrough, oosFrom: OOS_FROM, horizons: HORIZONS, latencySeconds: 60,
  sec: { heldDays: sec.days.length, from: sec.days[0], to: sec.days.at(-1), coverage: sec.coverage.ratio, coveredDays: sec.coverage.coveredDays, businessDays: sec.coverage.businessDays },
  events: events.length, eventsPriced: events.filter((e) => e.priceStatus === "ok").length, priceStatus: events.reduce((m, e) => ((m[e.priceStatus] = (m[e.priceStatus] || 0) + 1), m), {}),
  signals: sigEvents.length, signalsPriced: sigEvents.filter((e) => e.priceStatus === "ok").length, tests: tests.length,
  costModel: "per side by 20-day avg dollar volume: ≥$50M 5 bps, $5–50M 15, $1–5M 35, <$1M 75, unknown 100",
  entryRule: "open of the first NYSE session whose 09:30 ET open is ≥ SEC acceptance + 60 s (daily split-adjusted Alpaca SIP bars)" };
writeOut("patterns.json", { meta, results });

// Markdown report (tables only from computed values).
const H = [1, 5, 10, 20, 30, 60];
let md = `# Insider purchase patterns — results\n\nGenerated ${meta.generatedAt} · complete sessions through ${completeThrough} · SEC days held ${meta.sec.heldDays} (${meta.sec.from} – ${meta.sec.to}, coverage ${pct(meta.sec.coverage, 0)})\n\n`;
md += `Events: ${meta.events} purchase filings (${meta.eventsPriced} priced) · app signals: ${meta.signals} (${meta.signalsPriced} priced) · tests corrected: ${meta.tests} · in-sample < ${OOS_FROM} ≤ out-of-sample\n\nEntry: ${meta.entryRule}. Costs: ${meta.costModel}.\n\n`;
md += `## ${MAIN_H}-session results (net of costs; excess vs SPY, and vs IWM small caps)\n\n| Family | Pattern | n | Avg net | Median gross | Win | Net excess vs SPY | t (clustered) | IS (n) | IS q | OOS (n) | OOS p | Verdict | Net excess vs IWM (t) | Med. max DD | Med. max fav. |\n|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|---|--:|--:|--:|\n`;
for (const r of results) { const a = r.byH[MAIN_H].all, i = r.byH[MAIN_H].is, o = r.byH[MAIN_H].oos;
  md += `| ${r.family} | ${r.name} | ${a.n} | ${pct(a.meanNet)} | ${pct(a.medianGross)} | ${pct(a.winRate, 0)} | ${pct(a.meanExcessNet)} | ${a.tExcessNet ?? "—"} | ${pct(i.meanExcessNet)} (${i.n}) | ${i.qExcessNet ?? "—"} | ${pct(o.meanExcessNet)} (${o.n}) | ${o.pExcessNet ?? "—"} | ${r.byH[MAIN_H].verdict} | ${pct(a.meanExcessIwmNet)} (${a.tExcessIwmNet ?? "—"}) | ${pct(a.medianMaxDrawdown)} | ${pct(a.medianMaxFavorable)} |\n`; }
md += `\n## Net excess vs SPY by horizon (all periods; n in brackets; "pending" = not enough sessions yet)\n\n| Pattern | ${H.map((N) => `${N}d`).join(" | ")} |\n|---|${H.map(() => "--:").join("|")}|\n`;
for (const r of results) md += `| ${r.name} | ${H.map((N) => (r.byH[N].all.n ? `${pct(r.byH[N].all.meanExcessNet)} (${r.byH[N].all.n})` : `pending (${r.byH[N].all.pending})`)).join(" | ")} |\n`;
writeOut("report.md", md);

// Console summary.
console.log(JSON.stringify(meta, null, 1));
console.log(`\n${MAIN_H}-SESSION: pattern | n | avgNet | win | netExcess | t | IS(n,q) | OOS(n,p) | verdict | medDD | medFav`);
for (const r of results) { const a = r.byH[MAIN_H].all, i = r.byH[MAIN_H].is, o = r.byH[MAIN_H].oos;
  console.log(`${r.name.padEnd(46)} ${String(a.n).padStart(5)} ${pct(a.meanNet).padStart(7)} ${pct(a.winRate, 0).padStart(5)} ${pct(a.meanExcessNet).padStart(7)} t=${String(a.tExcessNet).padStart(6)} IS ${pct(i.meanExcessNet).padStart(7)}(${i.n},q=${i.qExcessNet}) OOS ${pct(o.meanExcessNet).padStart(7)}(${o.n},p=${o.pExcessNet}) ${r.byH[MAIN_H].verdict} | IWM ${pct(a.meanExcessIwmNet)} (t=${a.tExcessIwmNet}) | DD ${pct(a.medianMaxDrawdown)} MFE ${pct(a.medianMaxFavorable)}`); }
console.log("\nVERDICTS AT ANY HORIZON (validated = IS FDR q<0.10 and OOS same sign with p<0.05):");
for (const r of results) for (const N of HORIZONS) if (r.byH[N].verdict.startsWith("validated")) console.log(`  ${r.byH[N].verdict} · ${r.name} · ${N}d · IS ${pct(r.byH[N].is.meanExcessNet)} (n=${r.byH[N].is.n}, q=${r.byH[N].is.qExcessNet}) · OOS ${pct(r.byH[N].oos.meanExcessNet)} (n=${r.byH[N].oos.n}, p=${r.byH[N].oos.pExcessNet})`);
