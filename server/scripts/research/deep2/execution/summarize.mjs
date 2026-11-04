// server/scripts/research/deep2/execution/summarize.mjs — side-by-side DISCOVERY vs CONFIRMATION tables from the
// saved results (no re-computation of any test; only non-outcome coverage counts are recomputed from lib2 events).
//   node scripts/research/deep2/execution/summarize.mjs   → .cache/research/deep2/execution/summary-tables.md
import fs from "node:fs";
import path from "node:path";
import * as X from "./execLib.mjs";
const { L, pct } = X;

const load = (p) => JSON.parse(fs.readFileSync(path.join(X.OUT, `results-${p}.json`), "utf8"));
const RD = load("discover"), RC = load("confirm");
const D = Object.fromEntries(RD.tests.map((t) => [t.id, t])), C = Object.fromEntries(RC.tests.map((t) => [t.id, t]));
const PD = Object.fromEntries(RD.portfolios.map((p) => [p.id, p])), PC = Object.fromEntries(RC.portfolios.map((p) => [p.id, p]));
const TRIG = Object.keys(X.TRIGGERS);
const fp = (p) => (p == null ? "—" : p < 0.001 ? "<0.001" : p.toFixed(3));
const md = [];
const T = (head, rows) => { md.push(`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`), ""); };
const cell = (s) => (s?.n ? `${s.n} · ${pct(s.mean)} (${pct(s.median)}) t ${s.t ?? "—"}` : "—");

md.push("# Execution study — discovery vs confirmation (side by side)", "",
  `Generated ${new Date().toISOString().slice(0, 10)} from results-discover.json and results-confirm.json (confirmation evaluated once, code frozen: frozen-exec.json).`,
  "Cells: n · mean net excess vs SPY (median) t — issuer-clustered. q = BH over all 516 execution tests (discovery).", "");

md.push("## 1. Track B primary: next open → close of session N, liquidity-tier cost ×1", "");
T(["trigger", "N", "discovery", "q", "break-even ×", "confirmation", "issuer-median (C)", "p (C)", "gross excess D / C"], TRIG.flatMap((k) => X.HORIZONS_B.map((N) => {
  const id = `execution-B-${k}-nextOpen-h${N}-tier1`, d = D[id], c = C[id];
  return [k, N, cell(d.stats), fp(d.qAll), `${d.breakEvenCostMultiple?.toFixed(2) ?? "—"} / ${c.breakEvenCostMultiple?.toFixed(2) ?? "—"}`, cell(c.stats), pct(c.stats.issuerMedianOfMeans), fp(c.stats.p), `${pct(d.stats.meanExcessGross)} / ${pct(c.stats.meanExcessGross)}`];
})));

md.push("## 2. Cost sensitivity (mean net excess; next open, N = 3 and N = 5)", "");
T(["trigger", "N", "round-trip tier bps", "D ×1", "D ×2", "D ×3", "D spread model", "C ×1", "C ×2", "C ×3", "C spread model"], TRIG.flatMap((k) => [3, 5].map((N) => {
  const b = `execution-B-${k}-nextOpen-h${N}-`;
  return [k, N, D[`${b}tier1`].stats.meanRoundTripCostBps, ...["tier1", "tier2", "tier3", "spread"].map((c) => pct(D[`${b}${c}`].stats.mean)), ...["tier1", "tier2", "tier3", "spread"].map((c) => pct(C[`${b}${c}`].stats.mean))];
})));

md.push("## 3. Entry timing (tier ×1): next open vs one-session delay vs same-day MOC", "");
T(["trigger", "N", "D next open", "D delayed", "D MOC", "C next open", "C delayed", "C MOC"], TRIG.flatMap((k) => X.HORIZONS_B.map((N) => [k, N,
  ...["nextOpen", "delay1", "moc"].map((e) => { const s = D[`execution-B-${k}-${e}-h${N}-tier1`].stats; return `${pct(s.mean)} (n ${s.n})`; }),
  ...["nextOpen", "delay1", "moc"].map((e) => { const s = C[`execution-B-${k}-${e}-h${N}-tier1`].stats; return `${pct(s.mean)} (n ${s.n})`; })])));
md.push("Paired comparisons (gross excess, same events):", "");
T(["trigger", "delay cost N=2..5 (D)", "delay cost N=2..5 (C)", "MOC overnight gap D", "MOC overnight gap C"], TRIG.map((k) => [k,
  X.HORIZONS_B.map((N) => `${pct(D[`execution-Bpair-${k}-delayCost-h${N}`].stats.mean)} (t ${D[`execution-Bpair-${k}-delayCost-h${N}`].stats.t})`).join("; "),
  X.HORIZONS_B.map((N) => `${pct(C[`execution-Bpair-${k}-delayCost-h${N}`].stats.mean)} (t ${C[`execution-Bpair-${k}-delayCost-h${N}`].stats.t})`).join("; "),
  cell(D[`execution-Bpair-${k}-mocGap`].stats), cell(C[`execution-Bpair-${k}-mocGap`].stats)]));

md.push("## 4. Track A: MOO → MOC on the first session (tier ×1 unless stated)", "");
T(["trigger", "D gross excess", "D net ×1", "q", "D spread model", "C gross excess", "C net ×1", "p (C)", "C spread model"], TRIG.map((k) => {
  const d = D[`execution-Amoc-${k}-tier1`], c = C[`execution-Amoc-${k}-tier1`];
  return [k, pct(d.stats.meanExcessGross), cell(d.stats), fp(d.qAll), pct(D[`execution-Amoc-${k}-spread`].stats.mean), pct(c.stats.meanExcessGross), cell(c.stats), fp(c.stats.p), pct(C[`execution-Amoc-${k}-spread`].stats.mean)];
}));

md.push("## 5. Track A: after-hours entry (cached deep-1 sample, pre-holdout)", "", "### 5a. Latency decay — gross excess vs SPY, common subsample (valid entry at every latency)", "");
const decayRows = [];
for (const [lab, R] of [["D", RD], ["C", RC]]) for (const [g, d] of Object.entries(R.descriptive.afterHours.decay)) for (const x of d.byLatency)
  decayRows.push([lab, g, d.commonN, `${x.latencyMin} min (median fill ${x.medianMinutesAfterAcceptance?.toFixed(1)} min)`, pct(x.entryVsCloseMean), pct(x.nextOpenVsCloseMean),
    x.nextOpenVsCloseMean ? `${Math.round((x.entryVsCloseMean / x.nextOpenVsCloseMean) * 100)}%` : "—", `${pct(x.toOpenExcessMean)} (${pct(x.toOpenExcessMedian)})`, `${pct(x.toCloseExcessMean)} (${pct(x.toCloseExcessMedian)})`]);
T(["period", "group", "common n", "latency", "first fill vs 16:00 close", "next open vs 16:00 close", "share of gap already priced", "capture → next open mean (median)", "→ next close mean (median)"], decayRows);
md.push("### 5b. Net of extended-hours costs (latency 1 min; all events with a fill)", "");
T(["group", "exit", "D gross", "D net 25 / 50 / 100 bps", "D t (25)", "C gross", "C net 25 / 50 / 100 bps", "C t (25)"], Object.keys(RD.descriptive.afterHours.decay).flatMap((g) => ["nextOpen", "nextClose"].map((ex) => {
  const b = `execution-Aah-${g}-L1-${ex}-c`;
  return [g, ex, `${pct(D[`${b}25`].stats.meanExcessGross)} (n ${D[`${b}25`].stats.n})`, [25, 50, 100].map((c) => pct(D[`${b}${c}`].stats.mean)).join(" / "), D[`${b}25`].stats.t,
    `${pct(C[`${b}25`].stats.meanExcessGross)} (n ${C[`${b}25`].stats.n})`, [25, 50, 100].map((c) => pct(C[`${b}${c}`].stats.mean)).join(" / "), C[`${b}25`].stats.t];
})));
md.push("### 5c. After-hours size limit: 10% of the dollar volume traded in the first 5 / 15 minutes after acceptance + 60 s", "");
T(["period", "group", "n", "median AH $ in 5 / 15 min", "median buyable 5 / 15 min", "share buyable15 ≥ $10k", "≥ $50k"], [["D", RD], ["C", RC]].flatMap(([lab, R]) => Object.entries(R.descriptive.afterHours.capacity).map(([g, c]) =>
  [lab, g, c.n, `$${c.medianAhUsd5.toLocaleString("en-US")} / $${c.medianAhUsd15.toLocaleString("en-US")}`, `$${c.medianBuyable5.toLocaleString("en-US")} / $${c.medianBuyable15.toLocaleString("en-US")}`, pct(c.buyable15AtLeast10k, 0), pct(c.buyable15AtLeast50k, 0)])));
md.push(`Population-weighted gross capture of ALL after-close filings (inverse sampling weights, L = 1 min): discovery → next open ${pct(RD.descriptive.afterHours.populationWeightedGross.toNextOpen.weightedMeanExcess)}, → next close ${pct(RD.descriptive.afterHours.populationWeightedGross.toNextClose.weightedMeanExcess)}; confirmation ${pct(RC.descriptive.afterHours.populationWeightedGross.toNextOpen.weightedMeanExcess)} / ${pct(RC.descriptive.afterHours.populationWeightedGross.toNextClose.weightedMeanExcess)}.`, "");

md.push("## 6. Capacity: share of events supporting a position at 1% of 20-session dollar volume (next-open entry)", "");
T(["trigger", "D n", "D ≥ $10k / $50k / $250k", "D median max position", "C n", "C ≥ $10k / $50k / $250k", "C median max position"], TRIG.map((k) => {
  const d = RD.descriptive.capacity[k], c = RC.descriptive.capacity[k];
  const s = (x) => `${pct(x.support10k, 0)} / ${pct(x.support50k, 0)} / ${pct(x.support250k, 0)}`;
  return [k, d.n, s(d), `$${Math.round(d.medianMaxPositionUsd / 1e3)}k`, c.n, s(c), `$${Math.round(c.medianMaxPositionUsd / 1e3)}k`];
}));
T(["trigger", "size", ...X.HORIZONS_B.map((N) => `N=${N} D / C`)], TRIG.flatMap((k) => ["10k", "50k", "250k"].map((sz) => [k, sz, ...X.HORIZONS_B.map((N) => {
  const id = `execution-Bcap-${k}-${sz}-h${N}`; return `${pct(D[id].stats.mean)} (${D[id].stats.n}) / ${pct(C[id].stats.mean)} (${C[id].stats.n})`;
})])));

md.push("## 7. Execution traps: baseline vs fixed (next open N = 5 and MOO→MOC, tier ×1)", "");
T(["trigger", "spec", "D baseline", "D suspects out", "D 09:28 cut-off", "D all fixed", "C baseline", "C all fixed"], TRIG.flatMap((k) => [
  [k, "next open N=5", ...[`execution-B-${k}-nextOpen-h5-tier1`, `execution-traps-noSuspect-${k}-h5`, `execution-traps-mooCutoff-${k}-h5`, `execution-trapsClean-${k}-h5`].map((id) => `${pct(D[id].stats.mean)} (${D[id].stats.n})`),
    ...[`execution-B-${k}-nextOpen-h5-tier1`, `execution-trapsClean-${k}-h5`].map((id) => `${pct(C[id].stats.mean)} (${C[id].stats.n})`)],
  [k, "MOO→MOC", ...[`execution-Amoc-${k}-tier1`, `execution-traps-noSuspect-${k}-mooMoc`, `execution-traps-mooCutoff-${k}-mooMoc`, `execution-trapsClean-${k}-mooMoc`].map((id) => `${pct(D[id].stats.mean)} (${D[id].stats.n})`),
    ...[`execution-Amoc-${k}-tier1`, `execution-trapsClean-${k}-mooMoc`].map((id) => `${pct(C[id].stats.mean)} (${C[id].stats.n})`)]]));

md.push("## 8. Portfolio realism (20 slots, equal notional, one position per issuer, cash at 0%; SHORT history — CAGR-like is illustrative)", "");
const PF = (id) => [PD[id], PC[id]];
const pfRow = (id, label) => { const [d, c] = PF(id); const f = (p) => (p?.trades ? `${pct(p.totalReturn, 1)} / ${pct(p.cagrLike, 0)} / ${pct(p.maxDrawdown, 1)} / ${p.worstMonth ? `${p.worstMonth.month} ${pct(p.worstMonth.ret, 1)}` : "—"} / ${p.trades} tr / conc ${p.meanConcurrency?.toFixed(1)} / TO ${p.turnoverAnnualOneWay?.toFixed(0)}× / SPY ${pct(p.spy.totalReturn, 1)} (DD ${pct(p.spy.maxDrawdown, 1)})` : "—"); return [label, f(d), f(c)]; };
T(["simulation", "DISCOVERY: total / CAGR-like / max DD / worst month / trades / mean concurrency / turnover / SPY", "CONFIRMATION: same"], [
  ...TRIG.flatMap((k) => [pfRow(`execution-pf-${k}-nextOpen-h3-tier1`, `${k} next open N=3 ×1`), pfRow(`execution-pf-${k}-nextOpen-h5-tier1`, `${k} next open N=5 ×1`), pfRow(`execution-pf-${k}-nextOpen-h5-tier2`, `${k} next open N=5 ×2`),
    pfRow(`execution-pf-${k}-nextOpen-h5-tier1-cap1M`, `${k} N=5 ×1, $1M account, 1% ADV cap`), pfRow(`execution-pf-${k}-moc-h5-tier1`, `${k} MOC N=5 ×1`), pfRow(`execution-pf-${k}-mooMoc-tier1`, `${k} MOO→MOC ×1`)]),
  pfRow("execution-pf-S1ah-L1-nextOpen-c50", "T3 after-close census: AH L1 → next open, 50 bps"), pfRow("execution-pf-S1ah-L1-nextClose-c50", "T3 after-close census: AH L1 → next close, 50 bps")]);
md.push("Signals far exceed slots for T1/T2/T5 (demand concurrency 40–235 vs 20 slots), so those simulations trade an arbitrary first-come ~10–15% of signals and their totals mostly reflect that draw; the per-event statistics above are the cleaner measure.", "");

md.push("## 9. Track A coverage — measurable vs not (priced pre-holdout events by publication time)", "");
{
  const E = L.loadEvents();
  const ah = X.loadAh().trades;
  const variants = [
    ["MEASURED: MOO→MOC first session (daily auction prints)", () => true],
    ["MEASURED: after-hours entry, cached deep-1 sample (16:00–19:55)", (e) => ah.has(e.id)],
    ["needs SIP trades (same type as cache): after-close filings not sampled", (e) => X.inAhPool(e) && !ah.has(e.id)],
    ["needs SIP trades: after-close 19:55–20:00", (e) => X.pubBucket(e) === "afterClose_close_20" && e.publishedAt.slice(11) >= "19:55:00"],
    ["needs minute bars / trades: regular-session entry after an intraday filing (09:30–16:00)", (e) => X.pubBucket(e) === "regular_0930_close"],
    ["needs premarket trades: filings 04:00–09:30 (premarket entry)", (e) => X.pubBucket(e) === "premarket_04_0930"],
    ["needs premarket trades: overnight filings 20:00–24:00 (next-morning premarket entry)", (e) => X.pubBucket(e) === "overnight_20_24"],
    ["needs premarket trades: weekend / holiday filings", (e) => X.pubBucket(e) === "nonSessionDay"],
    ["needs minute bars: intraday stops / targets on any entry", () => true],
  ];
  const rows = [];
  for (const [label, f] of variants) {
    const by = (p) => E.filter((e) => L.periodOf(e) === p && f(e));
    const d = by("discover"), c = by("confirm");
    const symDays = new Set([...d, ...c].map((e) => `${X.symOf(e.ticker)}|${e.publishedAt.slice(0, 10)}`)).size;
    rows.push([label, d.length, c.length, d.length + c.length, symDays, TRIG.map((k) => [...d, ...c].filter(X.TRIGGERS[k].f).length).join(" / ")]);
  }
  T(["variant", "discovery", "confirmation", "total", "distinct symbol-days", "T1 / T2 / T3 / T4 / T5 (total)"], rows);
  const months = new Set(E.map((e) => e.publishedAt.slice(0, 7))).size;
  md.push(`Pre-holdout events: ${E.length} over ${months} calendar months (Dec 2025 – Aug 2026). Minute data for the three "needs" groups would cover the symbol-days listed (one symbol-day per filing day); premarket groups need 04:00–09:30 trades on the entry day.`, "");
}
md.push("## 10. Timing / data audit (validation.json)", "");
const V = JSON.parse(fs.readFileSync(path.join(X.OUT, "validation.json"), "utf8"));
md.push(`- Stage-C reproduction (next open, N = 2/3/5): ${Object.entries(V.stageCReproduction).map(([N, v]) => `N=${N}: ${v.compared} compared, ${Object.values(v.mismatches).reduce((a, b) => a + b, 0)} mismatches`).join("; ")}.`,
  `- Deep-1 after-hours reproduction: ${V.ahReproduction.compared} compared, mismatches ${JSON.stringify(V.ahReproduction.mismatches)}.`,
  `- Entries before public availability (acceptance + 60 s): next open ${V.timing.nextOpenBeforeAvailability}, MOC ${V.timing.mocBeforeAvailability}; AH trades before acceptance + 60 s: ${V.timing.afterHours.tradesBeforeAcceptancePlus60s}.`,
  `- Same-day open fills whose acceptance + 60 s is after the 09:28 MOO cut-off: ${V.timing.sameDayOpenAfterMooCutoff.length} (${V.timing.sameDayOpenAfterMooCutoff.filter((x) => x.triggers.includes("T3_ceoCfoOM250k")).length} in T3); 09:20–09:28: ${V.timing.sameDayOpen0920to0928}.`,
  `- Filings accepted 09:30:00–09:31:00: ${V.timing.acceptedBetween0930and0931.length}, all entered at the next session's open (correct).`,
  `- Weekend/holiday publications: ${V.timing.nonSessionDayPublications.length} (Good Friday 2026-04-03) → next session. Early-close sessions used as entry: ${JSON.stringify(V.timing.earlyCloseEntrySessions)}; publications on early-close days: ${V.timing.earlyClosePublications}. Calendar vs SPY bar days: ${V.timing.calendarVsSpyMismatches.length} mismatches.`,
  `- Fill-bar sanity: zero-volume entry bars ${V.timing.fillBarSanity.entryZeroVolume}; open = previous close with volume < 1,000: ${V.timing.fillBarSanity.entryStaleOpenEqualsPrevClose_lowVol}; open outside [low, high]: ${V.timing.fillBarSanity.entryOpenOutsideRange}.`,
  `- Corrupt bars: ${V.extremeMoves.extremeMoves} daily moves > 75% in ${V.extremeMoves.symbols} symbols; ${V.extremeMoves.suspectReversals} reversed next day (${V.extremeMoves.suspectSymbols} suspect symbols = stage A). Events in suspect symbols: ${JSON.stringify(V.extremeMoves.eventsInStageASuspects)}.`,
  `- Split-adjusted price levels: ${V.asTradedInference.inferredSplitEvents} events have a split after the trade (${V.asTradedInference.inferredReverseSplit} reverse). ${V.priceLevelTrap.adjustedAtLeast5ButAsTradedBelow5} events look ≥ $5 on adjusted prices but traded < $5 (stage-C priceLevel: ${V.priceLevelTrap.stageCPriceLevelAtLeast5ButAsTradedBelow5}); ${V.priceLevelTrap.adjustedAtLeast1ButAsTradedBelow1} look ≥ $1 but traded < $1. Inference check on raw-bar symbols: ${V.asTradedInference.agree}/${V.asTradedInference.checkedOnRawSymbols} agree, ${V.asTradedInference.missedSplit} missed splits, ${V.asTradedInference.falseSplit} false splits.`, "");
X.writeOut("summary-tables.md", md.join("\n"));
console.log(`[EXEC_SUMMARY] wrote ${path.join(X.OUT, "summary-tables.md")}`);
