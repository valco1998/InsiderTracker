// deep3/targets/patterns.mjs — pattern families, DISCOVERY only (registered by register.mjs before this ran).
//   node scripts/research/deep3/targets/patterns.mjs --stage=simple   (F01–F20)
//   node scripts/research/deep3/targets/patterns.mjs --stage=combo    (F21, run after the simple families)
import { rec, isRegistered, writeOut, readOut, existsOut, checkpoint, myResults, bhQ, r4, toCsv, mean } from "./common.mjs";
import { patternList, PATTERN_TESTS } from "./defs.mjs";
import { loadRows, testResult, tenQuestions, stability, diffRows, diffTest } from "./stats.mjs";

const stage = (process.argv.find((a) => a.startsWith("--stage=")) || "--stage=simple").split("=")[1];
const rows = loadRows();
const TH = readOut("thresholds.json");
const D = rows.filter((r) => r.per === "discover");
const OM = D.filter((r) => r.cls === "om");
const P = patternList(TH).filter((p) => (stage === "combo" ? p.family.startsWith("F21") : !p.family.startsWith("F21")));
const outName = `patterns-${stage}-discovery.json`;
const res = {};
for (const p of P) {
  const base = p.universe === "om" ? OM : D;
  const sel = base.filter((r) => p.f(r));
  const ctl = p.chart || "cm";
  const tests = {};
  for (const t of PATTERN_TESTS) {
    const id = `targets-P-${p.id}-${t.k}`; if (!isRegistered(id)) throw new Error(`not registered: ${id}`);
    const r = testResult(sel, t, ctl); rec(id, r); tests[t.k] = r;
  }
  // descriptive context (not registered): versus all other insider events of the universe, and the volRich control variant
  const rest = base.filter((r) => !p.f(r));
  const vsRest = {};
  for (const k of ["hit10_5", "dd10_5"]) vsRest[k] = diffTest(diffRows(sel, k, ctl).map(({ issuer, x }) => ({ issuer, x })), diffRows(rest, k, "cm").map(({ issuer, x }) => ({ issuer, x })));
  const raw = { hit10_5: r4(mean(sel.map((r) => r.o.hit10_5).filter((v) => v != null))), restHit10_5: r4(mean(rest.map((r) => r.o.hit10_5).filter((v) => v != null))) };
  const volRich = p.chart ? null : { hit10_5: testResult(sel, { k: "hit10_5", kind: "diff" }, "cv"), dd10_5: testResult(sel, { k: "dd10_5", kind: "diff" }, "cv") };
  res[p.id] = { family: p.family, label: p.label, universe: p.universe, controls: p.chart ? `within chart pattern '${p.chart}'` : "primary", n: sel.length, issuers: new Set(sel.map((r) => r.issuer)).size,
    tests, rawHitVsRestOfUniverse: raw, insiderLiftVsRest: vsRest, volRich, tenQuestions: tenQuestions(sel, ctl), stability: stability(sel, { ctl }) };
}
// BH over every discovery result of this agent recorded so far (overall + patterns), latest per id
const latest = new Map(); for (const x of myResults()) latest.set(x.id, x.result);
const ids = [...latest.keys()].filter((id) => id.startsWith("targets-OV") || id.startsWith("targets-P-"));
const qs = bhQ(ids.map((id) => latest.get(id)?.p ?? null)); const qOf = new Map(ids.map((id, i) => [id, qs[i]]));
for (const [pid, v] of Object.entries(res)) for (const k of Object.keys(v.tests)) v.tests[k].q = r4(qOf.get(`targets-P-${pid}-${k}`));
writeOut(outName, { generatedAt: new Date().toISOString(), stage, bhNote: `BH over ${ids.length} discovery results recorded so far (final BH in summary.mjs)`, patterns: res });
// flat CSV
const flat = [];
for (const [pid, v] of Object.entries(res)) for (const [k, t] of Object.entries(v.tests)) flat.push({ pattern: pid, family: v.family, test: k, n: t.n, issuers: t.issuers, event: t.eventMean ?? null, control: t.controlMean, mean: t.mean, median: t.median, issuerMedian: t.issuerMedianOfMeans, t: t.t, p: t.p, q: t.q, exTop5: t.meanExTop5Issuers, ciLo: t.ci95?.[0], ciHi: t.ci95?.[1] });
writeOut(`patterns-${stage}-discovery.csv`, toCsv(flat, Object.keys(flat[0])));
checkpoint(`pattern families (${stage}) discovery`, { patterns: P.length, file: outName });
const f = (v) => (v == null ? "  — " : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}`);
console.log("pattern            n   iss | hit10_5 ev/ctl diff t q | dd10_5 ev/ctl diff t q | tp10s10n5 mean med t q | x5 mean med t q");
for (const [pid, v] of Object.entries(res)) {
  const a = v.tests.hit10_5, b = v.tests.dd10_5, c = v.tests.tp10s10n5, d = v.tests.x5;
  console.log(`${pid.padEnd(16)} ${String(v.n).padStart(5)} ${String(v.issuers).padStart(4)} | ${f(a.eventMean)}/${f(a.controlMean)} ${f(a.mean)} t${a.t} q${a.q} | ${f(b.eventMean)}/${f(b.controlMean)} ${f(b.mean)} t${b.t} q${b.q} | ${f(c.mean)} ${f(c.median)} t${c.t} q${c.q} | ${f(d.mean)} ${f(d.median)} t${d.t} q${d.q}`);
}
