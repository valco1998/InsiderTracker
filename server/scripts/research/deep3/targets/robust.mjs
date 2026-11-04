// deep3/targets/robust.mjs — robustness of the PROMISING patterns (promising.json), DISCOVERY only.
// Registers every check first (deep-3 registry), then computes. Confirmation is NOT touched here.
//   node scripts/research/deep3/targets/robust.mjs
import { reg, rec, isRegistered, readOut, writeOut, checkpoint, loadBars, calendar, sym, pathAt, outcomesOf, periodEnd, DEEP1, cstats, r4, mean, median, quant } from "./common.mjs";
import { patternList } from "./defs.mjs";
import { loadRows, diffRows, absRows, slim } from "./stats.mjs";
import fs from "node:fs";
import path from "node:path";

const prom = readOut("promising.json").promising.filter((x) => x.promising);
const TH = readOut("thresholds.json");
const PL = new Map(patternList(TH).map((p) => [p.id, p]));
const pats = [...new Set(prom.map((x) => x.pattern))];
const OUTS = ["tp10s10n5", "x5"];
const CHECKS = {
  cost2: "per-side tier cost doubled (x2)",
  delay: "entry one session later (open of the next session), same exit rule counted from the new entry",
  onePerCompany: "first event per issuer only",
  spyUp: "decision date with SPY above its 50-day average",
  spyDown: "decision date with SPY below its 50-day average",
  exSuspects: "excluding stage-A suspect symbols",
  vsControls: "event minus its matched controls (within-pattern controls for chart patterns)",
  vsVolRich: "event minus volRich-matched controls (also vol60 and the volume spike)",
};
const fam = "targets-R robustness of promising patterns (discovery)";
for (const pid of pats) for (const k of OUTS) for (const [c, d] of Object.entries(CHECKS)) reg({ id: `targets-R-${pid}-${k}-${c}`, family: fam, familySize: pats.length * OUTS.length * Object.keys(CHECKS).length,
  statement: `Discovery, promising pattern ${pid}, outcome ${k}: ${d}; mean net excess (or difference) > 0.`, rationale: "Robustness of a promising discovery pattern before its single confirmation evaluation." });

const stageA = JSON.parse(fs.readFileSync(path.join(DEEP1, "stageA.json"), "utf8"));
const SUSPECT = new Set(stageA.prices.suspectSymbols || []);
const bars = loadBars(); const cal = calendar(bars);
const rows = loadRows().filter((r) => r.per === "discover");
const out = {};
for (const pid of pats) {
  const p = PL.get(pid); const ctl = p.chart || "cm";
  const sel = rows.filter((r) => (p.universe === "om" ? r.cls === "om" : true) && p.f(r));
  // cost x2: re-price from bars (same path, same embargo)
  const o2 = new Map(sel.map((r) => [r.id, outcomesOf(pathAt(bars.get(r.s), r.k, cal, { perEnd: periodEnd(r.per) }), 2 * r.cost)]));
  const first = []; const seen = new Set(); for (const r of [...sel].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt))) { if (!seen.has(r.issuer)) { seen.add(r.issuer); first.push(r); } }
  out[pid] = {};
  for (const k of OUTS) {
    const S = (rs, f = (r) => r.o[k]) => slim(cstats(rs.map((r) => ({ issuer: r.issuer, x: f(r) })).filter((x) => x.x != null && Number.isFinite(x.x)), { boot: 400 }));
    const res = {
      cost2: S(sel, (r) => o2.get(r.id)?.[k]),
      delay: S(sel, (r) => r.oD?.[k]),
      onePerCompany: S(first),
      spyUp: S(sel.filter((r) => r.spyAbove50 === true)),
      spyDown: S(sel.filter((r) => r.spyAbove50 === false)),
      exSuspects: S(sel.filter((r) => !SUSPECT.has(r.s))),
      vsControls: slim(cstats(diffRows(sel, k, ctl).map(({ issuer, x }) => ({ issuer, x })), { boot: 400 })),
      vsVolRich: slim(cstats(diffRows(sel, k, "cv").map(({ issuer, x }) => ({ issuer, x })), { boot: 400 })),
    };
    for (const [c, v] of Object.entries(res)) { const id = `targets-R-${pid}-${k}-${c}`; if (!isRegistered(id)) throw new Error(id); rec(id, v); }
    out[pid][k] = { base: S(sel), ...res };
  }
  // cost sensitivity grid (descriptive): x1, x2, x3 tier on the close exit x5 and the limit fill
  const o3 = new Map(sel.map((r) => [r.id, outcomesOf(pathAt(bars.get(r.s), r.k, cal, { perEnd: periodEnd(r.per) }), 3 * r.cost)]));
  out[pid].costGrid = Object.fromEntries(OUTS.map((k) => [k, { x1: r4(mean(sel.map((r) => r.o[k]).filter(Number.isFinite))), x2: r4(mean(sel.map((r) => o2.get(r.id)?.[k]).filter(Number.isFinite))), x3: r4(mean(sel.map((r) => o3.get(r.id)?.[k]).filter(Number.isFinite))) }]));
  out[pid].meanRoundTripCostBps = Math.round(mean(sel.map((r) => 2 * r.cost)));
  out[pid].tiers = sel.reduce((m, r) => ((m[r.tier] = (m[r.tier] || 0) + 1), m), {});
}
writeOut("robust-discovery.json", { generatedAt: new Date().toISOString(), patterns: pats, checks: CHECKS, results: out });
checkpoint("robustness of promising patterns (discovery)", { patterns: pats, file: "robust-discovery.json" });
const f = (v) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)}%`);
for (const pid of pats) for (const k of OUTS) { const R = out[pid][k]; console.log(`\n${pid} ${k}: base n ${R.base.n} mean ${f(R.base.mean)} med ${f(R.base.median)} t ${R.base.t} exTop5 ${f(R.base.meanExTop5Issuers)} CI [${f(R.base.ci95?.[0])}, ${f(R.base.ci95?.[1])}]`);
  for (const c of Object.keys(CHECKS)) { const v = R[c]; console.log(`  ${c.padEnd(14)} n ${String(v.n).padStart(4)} mean ${f(v.mean)} med ${f(v.median)} issuerMed ${f(v.issuerMedianOfMeans)} t ${v.t} exTop5 ${f(v.meanExTop5Issuers)}`); } }
for (const pid of pats) console.log(pid, "cost grid", JSON.stringify(out[pid].costGrid), "round trip bps", out[pid].meanRoundTripCostBps, "tiers", JSON.stringify(out[pid].tiers));
