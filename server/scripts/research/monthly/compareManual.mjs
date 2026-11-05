// Compares a monthly-study run with a MANUAL report, ticker by ticker (comparison only — the
// manual values are an input to this diff, never to the engine or its tests).
//   node scripts/research/monthly/compareManual.mjs --run oct2026-1m --manual scripts/research/monthly/manual-oct-2026.json
// Output: .cache/research/monthly/<run>/manual-compare.{json,md}
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { summarizeRule, ruleResult } from "../../../services/backtest/exitRules.js";

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : null; };
const runDir = path.join(SERVER, ".cache", "research", "monthly", arg("run") || "oct2026-1m");
const manual = JSON.parse(fs.readFileSync(path.resolve(SERVER, arg("manual") || "scripts/research/monthly/manual-oct-2026.json"), "utf8"));
const study = JSON.parse(fs.readFileSync(path.join(runDir, "study.json"), "utf8"));
const pct = (x, d = 2) => (x == null ? "N/A" : `${x > 0 ? "+" : ""}${(x * 100).toFixed(d)}%`);
const near = (a, b, tol) => a != null && b != null && Math.abs(a - b) <= tol;

const rows = [];
for (const m of manual.rows) {
  const ours = study.signals.filter((s) => s.ticker === m.ticker);
  const s = ours.find((x) => x.evaluation?.entryDate === m.entryDate) || ours[0] || null;
  const e = s?.evaluation || null;
  const diffs = [];
  if (!s) diffs.push("not a signal in our run");
  else {
    if (ours.length > 1) diffs.push(`${ours.length} signals in our run (buyers: ${ours.map((x) => x.buyerName).join("; ")})`);
    if (s.publishedAt.slice(0, 16) !== m.publishedAt) diffs.push(`publication ${s.publishedAt} vs manual ${m.publishedAt}`);
    if (e?.entryDate !== m.entryDate) diffs.push(`entry date ${e?.entryDate} vs manual ${m.entryDate}`);
    if (e?.status !== "ok") diffs.push(`our status ${e?.status}${e?.naReason ? ` (${e.naReason})` : ""}`);
    if (e?.entryPrice != null && !near(e.entryPrice, m.entryPrice, m.entryPrice * 0.002)) diffs.push(`entry open ${e.entryPrice} vs manual ${m.entryPrice}`);
    (m.closes || []).forEach((c, i) => {
      if (c == null) return;
      const ourC = e?.entryPrice != null && e?.closes?.[i + 1] != null ? e.entryPrice * (1 + e.closes[i + 1]) : null;
      if (ourC == null) diffs.push(`day ${i + 1}: no close in our run (window incomplete at cutoff)`);
      else if (!near(ourC, c, Math.max(0.011, c * 0.002))) diffs.push(`day ${i + 1} close ${ourC.toFixed(4)} vs manual ${c}`);
    });
  }
  rows.push({ ticker: m.ticker, buyer: s?.buyerName || null, ours: s ? { publishedAt: s.publishedAt, entryDate: e?.entryDate, entryPrice: e?.entryPrice, status: e?.status, naReason: e?.naReason, closes: e?.closes } : null, manual: m, match: !diffs.length, diffs });
}
// Signals we found that the manual report did not list.
const manualSet = new Set(manual.rows.map((r) => r.ticker).concat(manual.keptWithoutReturn || []));
const extra = study.signals.filter((s) => !manualSet.has(s.ticker));
const candidates = new Set(manual.unverifiedCandidates || []);

// The manual sample re-computed with our engine (data check, not a strategy result).
// Same ticker AND the manual's entry date (one row per stock, as in the manual). "asManual"
// ignores our N/A verdicts (e.g. a security-scale mismatch) to reproduce the manual method;
// "ourRules" applies them.
const entryOf = Object.fromEntries(manual.rows.map((m) => [m.ticker, m.entryDate]));
const sample = [...new Map(study.signals.filter((s) => manual.fiveDaySample.includes(s.ticker) && s.evaluation?.entryDate === entryOf[s.ticker] && s.evaluation.completeDays >= 5)
  .map((s) => [s.ticker, s])).values()];
const ruleOn = (list, r) => summarizeRule(list.map((s) => { const ev = { ...s.evaluation, status: "ok" }; const x = ruleResult(ev, r); return { ret: x?.ret ?? null, hit: x?.hit ?? null, issuer: s.issuerCik }; }), { costs: [0] });
const pack = (list) => ({ n: list.length, tickers: list.map((s) => s.ticker), close1: ruleOn(list, { kind: "close", horizon: 1 }), close2: ruleOn(list, { kind: "close", horizon: 2 }), close3: ruleOn(list, { kind: "close", horizon: 3 }), close5: ruleOn(list, { kind: "close", horizon: 5 }), tp4: ruleOn(list, { kind: "tp", target: 0.04, horizon: 5 }), tp65: ruleOn(list, { kind: "tp", target: 0.065, horizon: 5 }) });
const replication = { asManual: pack(sample), ourRules: pack(sample.filter((s) => s.evaluation.status === "ok")), manualReported: manual.reported };
const out = { run: path.basename(runDir), manualSource: manual.source, rows, extraSignals: extra.map((s) => ({ ticker: s.ticker, buyer: s.buyerName, publishedAt: s.publishedAt, valueUsdAtSignal: s.valueUsdAtSignal, status: s.evaluation?.status, naReason: s.evaluation?.naReason, inManualCandidateList: candidates.has(s.ticker) })), replication };
fs.writeFileSync(path.join(runDir, "manual-compare.json"), JSON.stringify(out, null, 1));

const L = [`# Comparison with the manual report (${manual.source})`, "", "| ticker | match | differences |", "|---|---|---|"];
for (const r of rows) L.push(`| ${r.ticker} | ${r.match ? "yes" : "no"} | ${r.diffs.join("; ") || "—"} |`);
for (const [k, v] of [["as the manual computed it", replication.asManual], ["with our N/A rules", replication.ourRules]]) {
  L.push("", `## Manual 5-day sample re-computed with this engine — ${k} (n=${v.n})`);
  L.push(`- close day 1/2/3/5: ${pct(v.close1.mean)} / ${pct(v.close2.mean)} / ${pct(v.close3.mean)} / ${pct(v.close5.mean)} | TP 4%/5d: ${pct(v.tp4.mean)} (${v.tp4.hits}/${v.tp4.n} hit) | TP 6.5%/5d: ${pct(v.tp65.mean)} (${v.tp65.hits}/${v.tp65.n} hit, ${pct(v.tp65.pctPositive, 0)} positive)`);
}
L.push(`- manual report: ${JSON.stringify(manual.reported)}`);
L.push("", `## Signals in this run that the manual report did not list: ${extra.length}`, "", "| ticker | buyer | at signal $ | published | our status | in the manual's unverified list |", "|---|---|---|---|---|---|");
for (const x of out.extraSignals) L.push(`| ${x.ticker || "—"} | ${String(x.buyer).slice(0, 34)} | ${Math.round(x.valueUsdAtSignal).toLocaleString("en-US")} | ${x.publishedAt.slice(0, 16)} | ${x.status}${x.naReason ? ` (${x.naReason})` : ""} | ${x.inManualCandidateList ? "yes" : ""} |`);
fs.writeFileSync(path.join(runDir, "manual-compare.md"), L.join("\n"));
console.log(L.slice(0, 30).join("\n"));
console.log(`[COMPARE_DONE] ${path.join(runDir, "manual-compare.md")}`);
