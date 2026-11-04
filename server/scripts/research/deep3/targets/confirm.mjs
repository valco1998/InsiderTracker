// deep3/targets/confirm.mjs — the SINGLE confirmation evaluation (2026-06-15..08-31, sessions < 2026-09-01) of
// (1) the promising patterns (frozen in promising.json; definitions unchanged) and (2) the pre-registered overall
// confirmation tests (targets-OC-*). Run once. Re-running reproduces identical numbers (rec() does not re-append).
//   node scripts/research/deep3/targets/confirm.mjs
import { reg, rec, isRegistered, readOut, writeOut, existsOut, checkpoint, r4 } from "./common.mjs";
import { patternList, PATTERN_TESTS } from "./defs.mjs";
import { loadRows, testResult, tenQuestions, stability } from "./stats.mjs";

const prom = readOut("promising.json").promising.filter((x) => x.promising);
const TH = readOut("thresholds.json");
const PL = new Map(patternList(TH).map((p) => [p.id, p]));
const pats = [...new Set(prom.map((x) => x.pattern))];
for (const pid of pats) for (const t of PATTERN_TESTS) reg({ id: `targets-CF-${pid}-${t.k}`, family: "targets-CF confirmation of promising patterns (single evaluation)", familySize: pats.length * PATTERN_TESTS.length,
  statement: `Confirmation, pattern ${pid} (definition frozen in discovery): ${t.desc}; same sign as discovery.`, rationale: "Single out-of-sample look after discovery robustness was recorded." });

const rows = loadRows();
const C = rows.filter((r) => r.per === "confirm");
const res = { patterns: {}, overall: {} };
for (const pid of pats) {
  const p = PL.get(pid); const ctl = p.chart || "cm";
  const sel = C.filter((r) => (p.universe === "om" ? r.cls === "om" : true) && p.f(r));
  const tests = {};
  for (const t of PATTERN_TESTS) { const id = `targets-CF-${pid}-${t.k}`; if (!isRegistered(id)) throw new Error(id); const r = testResult(sel, t, ctl); rec(id, r); tests[t.k] = r; }
  res.patterns[pid] = { n: sel.length, issuers: new Set(sel.map((r) => r.issuer)).size, tests, tenQuestions: tenQuestions(sel, ctl), stability: stability(sel, { ctl }) };
}
const U = { om: C.filter((r) => r.cls === "om"), all: C };
for (const u of ["om", "all"]) for (const k of ["hit10_5", "dd10_5", "tp10s10n5", "x5"]) {
  const id = `targets-OC-${u}-${k}`; if (!isRegistered(id)) throw new Error(id);
  const r = testResult(U[u], { k, kind: k.startsWith("hit") || k.startsWith("dd") ? "diff" : "abs" }); rec(id, r); res.overall[id] = r;
}
res.overall.tenQuestionsOm = tenQuestions(U.om);
writeOut("confirmation.json", { generatedAt: new Date().toISOString(), note: "Single confirmation evaluation. Pattern definitions and thresholds frozen in discovery (protocol.json, promising.json).", ...res });
checkpoint("confirmation (single evaluation)", { patterns: pats, file: "confirmation.json" });
const f = (v) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)}%`);
for (const pid of pats) { const P = res.patterns[pid]; console.log(`\n${pid}: n ${P.n} issuers ${P.issuers}`); for (const [k, t] of Object.entries(P.tests)) console.log(`  ${k.padEnd(10)} n ${t.n} iss ${t.issuers} ev ${f(t.eventMean)} ctl ${f(t.controlMean)} mean ${f(t.mean)} med ${f(t.median)} issuerMed ${f(t.issuerMedianOfMeans)} t ${t.t} p ${r4(t.p)} exTop5 ${f(t.meanExTop5Issuers)}`); }
console.log("\nOVERALL confirmation:"); for (const [id, t] of Object.entries(res.overall)) if (id.startsWith("targets-OC")) console.log(`  ${id.padEnd(26)} n ${t.n} ev ${f(t.eventMean)} ctl ${f(t.controlMean)} mean ${f(t.mean)} med ${f(t.median)} t ${t.t} p ${r4(t.p)}`);
const q = res.overall.tenQuestionsOm; console.log("om confirm touch +10%:", JSON.stringify(q.touch[10].hit), "ctl", JSON.stringify(q.touch[10].control), "MAE<=-10% N5", q.mfeMae[5].pMAEle10, "ctl", q.mfeMae[5].controlPMAEle10);
