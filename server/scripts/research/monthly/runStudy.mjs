// Monthly per-buyer purchase study — reproducible CLI (research only; read-only towards SEC
// store, MongoDB, Firebase and the alert system). Uses the SAME engine as the Backtesting page
// (backtestEngine.monthlyStudy), so the page and this report cannot disagree.
//
//   npm run research:monthly -- --months 2026-10 --cutoff 2026-11-04 [--threshold 1000000]
//       [--latency 60] [--no-disclosure] [--label oct-1m]
//       [--freeze]                 write frozen-rules.json from THIS run (in-sample month)
//       [--frozen <label>]         evaluate the rules frozen in .cache/research/monthly/<label>/
//                                  on these months WITHOUT re-selecting anything
//
// Outputs (git-ignored, derived from licensed-for-internal-use market data):
//   server/.cache/research/monthly/<label>/{config.json, study.json, signals.csv,
//   purchases.csv, grid.csv, frozen-rules.json?, frozen-eval.json?, report.md}
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createBacktestService } from "../../../services/backtest/backtestEngine.js";
import { gridSummary, ruleResult, ruleLabel, summarizeRule, TP_GRID, HOLD_DAYS, FOCUS_TARGETS } from "../../../services/backtest/exitRules.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(HERE, "..", "..", "..");
const OUT_ROOT = path.join(SERVER, ".cache", "research", "monthly");
const CODE_FILES = ["services/backtest/monthlyStudy.js", "services/backtest/exitRules.js", "services/backtest/ownerProfile.js", "services/backtest/fxReference.js", "services/backtest/priorDisclosure.js", "services/backtest/signals.js", "services/backtest/backtestEngine.js", "scripts/research/monthly/runStudy.mjs"];

const argv = process.argv.slice(2);
const arg = (name, def = null) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : def; };
const flag = (name) => argv.includes(`--${name}`);
const months = String(arg("months", "")).split(",").map((s) => s.trim()).filter(Boolean);
if (!months.length) { console.error("usage: --months YYYY-MM[,YYYY-MM…] [--cutoff YYYY-MM-DD] [--threshold N] [--latency S] [--no-disclosure] [--label X] [--freeze] [--frozen LABEL]"); process.exit(2); }
const label = arg("label", `${months[0]}${months.length > 1 ? `_${months.at(-1)}` : ""}-${arg("threshold", "1000000")}`).replace(/[^A-Za-z0-9._-]/g, "_");
const outDir = path.join(OUT_ROOT, label);
fs.mkdirSync(outDir, { recursive: true });
const write = (name, data) => { const f = path.join(outDir, name); fs.writeFileSync(f, typeof data === "string" ? data : JSON.stringify(data, null, 1)); return f; };
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(path.join(SERVER, f))).digest("hex");
const csvCell = (v) => { if (v == null) return ""; const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const toCsv = (rows, cols) => [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\n");
const pct = (x, d = 2) => (x == null ? "N/A" : `${x > 0 ? "+" : ""}${(x * 100).toFixed(d)}%`);

const service = createBacktestService({ live: () => null }); // historical SEC store only
const n = service.normalizeStudy({ months, thresholdUsd: arg("threshold"), latencySeconds: arg("latency"), cutoff: arg("cutoff"), priorDisclosure: !flag("no-disclosure") });
if (n.error) { console.error(n.error); process.exit(2); }
const t0 = Date.now();
const r = await service.monthlyStudy(n.config, { full: true, onProgress: (p) => console.log(`[MONTHLY] ${JSON.stringify(p)}`) });
console.log(`[MONTHLY] signals=${r.counts.signals} runMs=${Date.now() - t0}`);

const codeHashes = Object.fromEntries(CODE_FILES.map((f) => [f, sha(f)]));
write("config.json", { label, generatedAt: r.generatedAt, config: r.config, codeHashes, prices: r.prices, fx: r.fx, methodology: r.methodology });
write("study.json", r);

// ---- signals.csv (one row per signal, every field needed to audit it) ----
const sigRows = r.signals.map((s) => {
  const e = s.evaluation || {};
  const f4 = e.focus?.[0.04], f65 = e.focus?.[0.065];
  return {
    month: s.month, id: s.id, ticker: s.ticker, symbol: s.symbol, issuerCik: s.issuerCik, issuer: s.issuerName, buyer: s.buyerName,
    legalOwners: (s.legalOwners || []).map((o) => `${o.name} (${o.cik})`).join("; "), roles: (s.roles || []).join("|"), ownership: (s.ownership || []).join("|"),
    purchaseTypes: s.purchaseTypes.join("|"), newCapitalShare: s.newCapitalShare, currencies: s.currencies.join("|"),
    valueUsdAtSignal: s.valueUsdAtSignal, purchasesAtSignal: s.purchasesAtSignal, tradeDateFrom: s.tradeDateFrom, tradeDateTo: s.tradeDateTo, tradedBeforeMonth: s.tradedBeforeMonth,
    publishedAt: s.publishedAt, crossingAccession: s.crossingAccessions?.[0], filingUrl: s.purchases?.find((p) => p.accessionNo === s.crossingAccessions?.[0])?.url,
    availableAt: e.timing?.availableEt, entryDate: e.entryDate, entryOpen: e.entryPrice, status: e.status, naReason: e.naReason, completeDays: e.completeDays,
    securityMatch: s.securityMatch?.status, securityReasons: (s.securityMatch?.reasons || []).join("|"), priceScaleRatio: e.priceScale?.ratio,
    ...Object.fromEntries(HOLD_DAYS.map((k) => [`close${k}`, e.closes?.[k]])), ...Object.fromEntries(HOLD_DAYS.map((k) => [`spy${k}`, e.spy?.[k]])),
    tp4ret: f4?.ret, tp4hit: f4?.hit, tp4days: f4?.daysToTarget, tp65ret: f65?.ret, tp65hit: f65?.hit, tp65days: f65?.daysToTarget,
    mfe5: e.excursion5?.mfe, daysToPeak5: e.excursion5?.daysToPeak, mae5: e.excursion5?.mae, mfeToCutoff: e.excursionToCutoff?.mfe, daysToPeakCutoff: e.excursionToCutoff?.daysToPeak, cutoffDate: e.excursionToCutoff?.lastDate,
    insiderAvgPriceUsd: s.insiderAvgPriceUsd, insiderSplitFactor: e.insider?.splitFactor, insiderToEntry: e.insider?.toEntryOpen, insiderToClose5: e.insider?.toClose?.[5],
    priorDisclosure: s.priorDisclosure?.status, priorDisclosureFirst: s.priorDisclosure?.firstAt, priorDisclosureForms: (s.priorDisclosure?.filings || []).map((x) => x.form).join("|"), priorDisclosureReason: s.priorDisclosure?.reason,
  };
});
write("signals.csv", toCsv(sigRows, Object.keys(sigRows[0] || { id: 1 })));
write("purchases.csv", toCsv(r.examined.map((p) => ({ ...p, owners: p.owners.map((o) => `${o.name} (${o.cik})`).join("; "), footnotes: p.footnotes.join(" | ").slice(0, 900), fx: p.fx ? `${p.fx.from}@${p.fx.rate} ${p.fx.rateDate}` : "", reportedBy: (p.reportedBy || []).map((x) => x.accessionNo).join("|") })),
  ["month", "publishedAt", "transactionDate", "ticker", "issuerCik", "owners", "accessionNo", "formType", "securityTitle", "shares", "price", "valueReported", "currency", "currencyBasis", "fx", "valueUsd", "valueExcludedReason", "correctionOf", "purchaseType", "isNewCapital", "ownership", "natureOfOwnership", "possibleDuplicate", "amends", "signalId", "reportedBy", "url", "footnotes"]));

// ---- grid.csv ----
const gridRows = [];
for (const view of ["signal", "consolidated"]) {
  const g = r.summary[view];
  for (const H of HOLD_DAYS) {
    const h = g.horizons[H];
    const row = (rule, target, s, buffered = null) => ({ view, horizon: H, rule, target, n: s.n, issuers: s.issuers, mean: s.mean, median: s.median, hitRate: s.hitRate, pctPositive: s.pctPositive, avgWin: s.avgWin, avgLoss: s.avgLoss, payoff: s.payoff, meanExTop1: s.meanExTop1, meanExTop3: s.meanExTop3, ci95lo: s.ci95?.[0], ci95hi: s.ci95?.[1], spyMean: s.spyMean, excessMean: s.excessMean, meanDaysToTarget: s.meanDaysToTarget, net10: s.netMean?.[10], net25: s.netMean?.[25], net50: s.netMean?.[50], bufferedMean: buffered?.mean, bufferedHitRate: buffered?.hitRate });
    gridRows.push(row("close", null, h.close));
    for (const t of h.tp) gridRows.push(row("tp", t.target, t, t.buffered));
  }
}
write("grid.csv", toCsv(gridRows, Object.keys(gridRows[0])));

// ---- frozen rules ----
const PREDECLARED = [{ kind: "tp", target: 0.04, horizon: 5 }, { kind: "tp", target: 0.065, horizon: 5 }, { kind: "close", horizon: 2 }, { kind: "close", horizon: 3 }, { kind: "close", horizon: 5 }];
if (flag("freeze")) {
  const w = r.summary.signal.winner;
  const rules = [...PREDECLARED];
  if (w && !rules.some((x) => x.kind === "tp" && Math.abs(x.target - w.target) < 1e-9 && x.horizon === w.horizon)) rules.unshift({ kind: "tp", target: w.target, horizon: w.horizon, origin: "in-sample winner" });
  const frozen = { frozenAt: new Date().toISOString(), selectedOn: { label, months: r.config.months, threshold: r.config.thresholdUsd, cutoff: r.config.cutoff }, inSampleWinner: w, rules, codeHashes };
  frozen.sha256 = crypto.createHash("sha256").update(JSON.stringify({ rules: frozen.rules, codeHashes })).digest("hex");
  console.log(`[MONTHLY_FROZEN] ${write("frozen-rules.json", frozen)} sha256=${frozen.sha256}`);
}
let frozenEval = null;
const frozenLabel = arg("frozen");
if (frozenLabel) {
  const fz = JSON.parse(fs.readFileSync(path.join(OUT_ROOT, frozenLabel, "frozen-rules.json"), "utf8"));
  const items = r.signals.map((s) => ({ sig: s, ev: s.evaluation }));
  const evalRule = (its, rule, view) => {
    let ok = its.filter((it) => it.ev?.status === "ok" && it.ev.completeDays >= rule.horizon);
    if (view === "consolidated") { const m = new Map(); for (const it of ok) { const k = `${it.ev.symbol}|${it.ev.entryDate}`; if (!m.has(k)) m.set(k, it); } ok = [...m.values()]; }
    return summarizeRule(ok.map((it) => { const x = ruleResult(it.ev, rule); return { ret: x?.ret ?? null, hit: x?.hit ?? null, daysToTarget: x?.daysToTarget ?? null, issuer: it.sig.issuerCik, spy: it.ev.spy?.[rule.horizon] ?? null }; }));
  };
  frozenEval = {
    frozenFrom: frozenLabel, frozenSha256: fz.sha256, codeHashesMatch: Object.entries(fz.codeHashes).filter(([f, h]) => codeHashes[f] !== h).map(([f]) => f),
    rules: fz.rules.map((rule) => ({
      rule, label: ruleLabel(rule),
      pooled: { signal: evalRule(items, rule, "signal"), consolidated: evalRule(items, rule, "consolidated") },
      byMonth: Object.fromEntries(r.config.months.map((m) => [m, evalRule(items.filter((it) => it.sig.month === m), rule, "signal")])),
    })),
  };
  write("frozen-eval.json", frozenEval);
}

// ---- report.md (Hebrew summary; every number comes from the objects above) ----
const S = r.summary.signal, C = r.summary.consolidated;
const lines = [];
lines.push(`# Monthly study — purchases above ${r.config.thresholdUsd.toLocaleString("en-US")} USD per buyer and issuer`, "");
lines.push(`- Months: ${r.config.months.join(", ")} | price cutoff: ${r.config.cutoff} | latency: ${r.config.latencySeconds} s | generated: ${r.generatedAt}`);
lines.push(`- Run: \`${label}\` | code hashes: config.json`, "");
lines.push("## SEC coverage");
for (const c of r.coverage) lines.push(`- ${c.month}: SEC business days ${c.businessDays}, complete ${c.complete}, partial ${c.partial}, missing ${c.missing}, failed filings ${c.failed}, coverage ${(c.ratio * 100).toFixed(0)}%`);
lines.push("", "## Census");
lines.push(`- Code-P purchases examined (first published in the months): ${r.stats.purchases}; not counted toward the threshold: ${JSON.stringify(r.stats.notCounted)}`);
lines.push(`- Signals: ${r.counts.signals} | priced: ${S.counts.eligible} | N/A: ${S.counts.na} ${JSON.stringify(S.counts.naReasons)} | pending: ${S.counts.pending}`);
lines.push(`- Consolidated view (stock + entry date): ${C.counts.eligible} (${C.counts.mergedDuplicates || 0} duplicates merged)`, "");
lines.push("## Fixed exits — same 5-day sample (close of day k; entry day = day 1)", "", "| day | n | mean | median | % positive | SPY | excess | mean net 25bp/side |", "|---|---|---|---|---|---|---|---|");
for (const k of HOLD_DAYS) { const s = S.fixedSample5[k]; lines.push(`| ${k} | ${s.n} | ${pct(s.mean)} | ${pct(s.median)} | ${pct(s.pctPositive, 0)} | ${pct(s.spyMean)} | ${pct(s.excessMean)} | ${pct(s.netMean?.[25])} |`); }
lines.push("", "## Fixed exits — each day on its own full sample", "", "| day | n | mean | median | % positive |", "|---|---|---|---|---|");
for (const k of HOLD_DAYS) { const s = S.horizons[k].close; lines.push(`| ${k} | ${s.n} | ${pct(s.mean)} | ${pct(s.median)} | ${pct(s.pctPositive, 0)} |`); }
lines.push("", "## Take profit or close of day 5, no stop (theoretical touch)", "", "| target | n | mean | median | hit | % positive | avg win | avg loss | ex-top-3 | CI 95% | buffer 0.5% |", "|---|---|---|---|---|---|---|---|---|---|---|");
for (const t of FOCUS_TARGETS) { const s = S.horizons[5].tp.find((x) => Math.abs(x.target - t) < 1e-9); lines.push(`| ${(t * 100).toFixed(1)}% | ${s.n} | ${pct(s.mean)} | ${pct(s.median)} | ${s.hits ?? "-"}/${s.n} | ${pct(s.pctPositive, 0)} | ${pct(s.avgWin)} | ${pct(s.avgLoss)} | ${pct(s.meanExTop3)} | ${s.ci95 ? `${pct(s.ci95[0])}…${pct(s.ci95[1])}` : "-"} | ${pct(s.buffered?.mean)} |`); }
lines.push("", `Hindsight winner among ${S.combinations} combinations: ${S.winner ? `TP ${(S.winner.target * 100).toFixed(1)}% / ${S.winner.horizon} days, mean ${pct(S.winner.mean)} (n=${S.winner.n})` : "—"} — selected after the fact, not a forecast.`);
lines.push("", "## Hindsight (not a strategy)");
lines.push(`- Max run-up within 5 days: mean ${pct(S.hindsight.mfe5.mean)} (n=${S.hindsight.mfe5.n}), mean days to peak ${S.hindsight.meanDaysToPeak5}`);
lines.push(`- Max run-up to the cutoff: mean ${pct(S.hindsight.mfeToCutoff.mean)} (n=${S.hindsight.mfeToCutoff.n}) — windows of different lengths`);
lines.push(`- Insider (from the reported price, split-adjusted) to the entry open: mean ${pct(S.insiderToEntry.mean)} (n=${S.insiderToEntry.n}); to close of day 5: ${pct(S.insider.mean)} (n=${S.insider.n})`);
lines.push("", "## Point-in-time buyer selection (prior signals' outcome only after it was known)");
for (const k of ["selected", "notSelected", "noHistory"]) lines.push(`- ${k}: n=${r.selection[k].n || 0} mean=${pct(r.selection[k].mean)} hit=${pct(r.selection[k].hitRate, 0)}`);
if (frozenEval) {
  lines.push("", `## Frozen rules (from ${frozenEval.frozenFrom}, sha256 ${String(frozenEval.frozenSha256).slice(0, 12)}…) — not re-selected`, "", "| rule | n | mean | median | hit | % positive | CI 95% | excess vs SPY | consolidated mean |", "|---|---|---|---|---|---|---|---|---|");
  for (const fr of frozenEval.rules) { const s = fr.pooled.signal; lines.push(`| ${fr.label} | ${s.n || 0} | ${pct(s.mean)} | ${pct(s.median)} | ${s.hitRate == null ? "-" : pct(s.hitRate, 0)} | ${pct(s.pctPositive, 0)} | ${s.ci95 ? `${pct(s.ci95[0])}…${pct(s.ci95[1])}` : "-"} | ${pct(s.excessMean)} | ${pct(fr.pooled.consolidated.mean)} |`); }
  if (frozenEval.codeHashesMatch.length) lines.push("", `Note: code changed since the freeze in: ${frozenEval.codeHashesMatch.join(", ")}`);
}
lines.push("", "## Signals", "", "| month | ticker | buyer | at signal $ | published | entry | status | d1 | d2 | d3 | d5 | TP4/5d | TP6.5/5d | types | earlier disclosure |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const s of sigRows) lines.push(`| ${s.month} | ${s.ticker || "—"} | ${String(s.buyer).slice(0, 32)} | ${Math.round(s.valueUsdAtSignal).toLocaleString("en-US")} | ${s.publishedAt?.slice(0, 16)} | ${s.entryDate || "—"} | ${s.status}${s.naReason ? ` (${s.naReason})` : ""} | ${pct(s.close1)} | ${pct(s.close2)} | ${pct(s.close3)} | ${pct(s.close5)} | ${pct(s.tp4ret)} | ${pct(s.tp65ret)} | ${s.purchaseTypes} | ${s.priorDisclosure || "—"}${s.priorDisclosureForms ? ` ${s.priorDisclosureForms}` : ""} |`);
write("report.md", lines.join("\n"));
console.log(`[MONTHLY_DONE] out=${outDir}`);
process.exit(0);
