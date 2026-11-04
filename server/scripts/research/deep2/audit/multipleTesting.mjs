// deep2/audit/multipleTesting.mjs — auditor (agent "audit"): multiple-testing accounting across deep 1 and deep 2.
//   node scripts/research/deep2/audit/multipleTesting.mjs        (holdout stays locked; reads registries only)
// Output: .cache/research/deep2/audit/multiple-testing.json
import fs from "node:fs";
import path from "node:path";
import { DEEP1, DEEP2 } from "../lib2.mjs";
import { writeOut, bh, r4, countBy, groupBy } from "./auditLib.mjs";

if (process.env.DEEP2_HOLDOUT) throw new Error("run with the holdout locked");
const jsonl = (f) => fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const REG = jsonl(path.join(DEEP2, "registry.jsonl")), RES = jsonl(path.join(DEEP2, "registry-results.jsonl"));
const D1 = jsonl(path.join(DEEP1, "registry.jsonl"));
const regById = new Map(REG.map((r) => [r.id, r]));

// ---------- 1. registration discipline ----------
const famDecl = {};
for (const r of REG) { const k = `${r.agent}|${r.family}`; const f = (famDecl[k] ||= { agent: r.agent, family: r.family, registered: 0, declared: new Set(), firstRegisteredAt: r.registeredAt }); f.registered++; f.declared.add(r.familySize); if (r.registeredAt < f.firstRegisteredAt) f.firstRegisteredAt = r.registeredAt; }
const firstResultByAgent = {}; for (const s of RES) if (!firstResultByAgent[s.agent] || s.at < firstResultByAgent[s.agent]) firstResultByAgent[s.agent] = s.at;
const families = Object.values(famDecl).map((f) => ({ agent: f.agent, family: f.family, registered: f.registered, declaredFamilySize: [...f.declared], honestCount: f.declared.size === 1 && [...f.declared][0] === f.registered,
  firstRegisteredAt: f.firstRegisteredAt, registeredAfterAgentHadRecordedResults: f.firstRegisteredAt > firstResultByAgent[f.agent] }));
const order = RES.map((s) => ({ id: s.id, at: s.at, reg: regById.get(s.id)?.registeredAt })).filter((x) => x.reg);
const timing = { results: RES.length, uniqueIds: new Set(RES.map((s) => s.id)).size, registered: REG.length, uniqueRegistered: new Set(REG.map((r) => r.id)).size,
  resultBeforeRegistration: order.filter((x) => x.at < x.reg).length, unregisteredResults: RES.filter((s) => !regById.has(s.id)).length,
  minSecondsRegistrationToResult: Math.min(...order.map((x) => (Date.parse(x.at) - Date.parse(x.reg)) / 1000)),
  executionGapHours: r4((Date.parse(RES.filter((s) => s.agent === "execution").map((s) => s.at).sort()[0]) - Date.parse(REG.filter((r) => r.agent === "execution").map((r) => r.registeredAt).sort()[0])) / 3.6e6),
  duplicateResultsSameIdPeriod: Object.values(countBy(RES, (s) => `${s.id}|${s.result?.period ?? "-"}`)).filter((v) => v > 1).length,
  frozenRulesInRegistry: REG.filter((r) => /^F[123]$|lead/i.test(r.id) || r.agent === "lead").length };

// ---------- 2. test records with p-values ----------
const pOf = (res) => res?.p ?? res?.stats?.p ?? null;
const effectOf = (res) => { if (Number.isFinite(res?.mean)) return res.mean; if (Number.isFinite(res?.stats?.mean)) return res.stats.mean; if (Number.isFinite(res?.diff?.diff)) return res.diff.diff; if (Number.isFinite(res?.diff)) return res.diff; if (Number.isFinite(res?.slope?.b)) return res.slope.b; return null; };
const nOf = (res) => res?.n ?? res?.stats?.n ?? res?.diff?.nA ?? res?.slope?.n ?? null;
// What kind of quantity is tested (decides whether a survivor could be a long, net-of-cost, tradable rule).
function kindOf(reg, res) {
  const id = reg.id, fam = reg.family;
  if (reg.agent === "execution") {
    if (/paired/.test(fam)) return { kind: "paired comparison (not a strategy)", longRule: false, net: false };
    if (/-A-ah/.test(fam)) return { kind: "after-hours entry, net of a flat bps cost", longRule: true, net: true };
    return { kind: "long rule, net excess vs SPY at the stated cost", longRule: true, net: true };
  }
  if (reg.agent === "chart") {
    if (/gapX/.test(id)) return { kind: "opening gap vs controls (realised BEFORE any feasible entry; no cost)", longRule: false, net: false };
    if (/^chart-T3 chart structure/.test(fam)) return { kind: "top-minus-bottom tercile difference (not a single long rule)", longRule: false, net: true };
    if (/matched control|control-validity/.test(fam)) return { kind: "event minus matched-control difference (not a P&L; events' own net excess is negative)", longRule: false, net: true };
    if (/candidates|stress/.test(fam)) return { kind: "long rule, net excess vs SPY (5 sessions)", longRule: true, net: true };
    if (/strong filing with no gap|huge gap surprise/.test(fam)) return { kind: "gap-conditioned subset (open fill conditions on the same open: optimistic) or MOC fill", longRule: true, net: true, conditionalOnOpen: /open/.test(reg.statement || "") };
    if (/interpretable models/.test(fam)) return { kind: "walk-forward model top bucket, long, net", longRule: true, net: true };
    return { kind: "difference between groups / terciles (not a single long rule)", longRule: false, net: true };
  }
  // behavior
  const k = res?.kind;
  if (/gap/i.test(id) || /gap/i.test(reg.statement || "")) return { kind: "opening gap (pre-entry) or gap diagnostic", longRule: false, net: false };
  if (k === "mean") return { kind: "long rule, net excess vs SPY", longRule: true, net: true };
  if (k === "diff") return { kind: "difference between groups (long-short, not a long rule)", longRule: false, net: true };
  if (k === "slope") return { kind: "rank slope (not a rule)", longRule: false, net: true };
  return { kind: k || "other", longRule: false, net: false };
}
const tests = [];
for (const s of RES) {
  const reg = regById.get(s.id); const p = pOf(s.result); if (p == null || !Number.isFinite(p)) continue;
  const per = s.result?.period ?? (reg.agent === "chart" ? "discover" : null);
  tests.push({ key: `${s.id}|${per}`, id: s.id, agent: reg.agent, family: reg.family, familySize: reg.familySize, period: per, p, effect: effectOf(s.result), n: nOf(s.result), t: s.result?.t ?? s.result?.stats?.t ?? s.result?.diff?.t ?? s.result?.slope?.t ?? null, ...kindOf(reg, s.result) });
}
const disc = tests.filter((t) => t.period === "discover");
const d1 = D1.filter((r) => r.train?.p != null).map((r) => ({ key: `deep1|${r.id}`, id: r.id, agent: "deep1", family: r.family, period: "train", p: r.train.p, pAbn: r.train.pAbn, effect: r.train.meanExcess, n: r.train.n, t: r.train.t, longRule: r.family !== "interaction" || true, net: true, kind: "deep-1 train test (net excess vs SPY)" }));

function runBH(name, arr, pKey = "p") {
  const q = bh(arr.map((t) => t[pKey]));
  const rows = arr.map((t, i) => ({ ...t, q: q[i] }));
  const surv = (thr) => rows.filter((t) => t.q != null && t.q < thr);
  const tradableLong = (t) => t.agent !== "deep1" && t.longRule && t.net && t.effect > 0 && !t.conditionalOnOpen;
  const deep1Pos = (t) => t.agent === "deep1" && t.effect > 0;
  return { name, tests: arr.length, survivorsQ10: surv(0.1).length, survivorsQ05: surv(0.05).length,
    survivorsQ10ByAgent: countBy(surv(0.1), (t) => t.agent), deep1PositiveTrainSurvivorsQ10: surv(0.1).filter(deep1Pos).sort((a, b) => a.p - b.p).slice(0, 15).map((t) => ({ id: t.id, n: t.n, meanExcessNet: r4(t.effect), t: t.t, q: r4(t.q) })), deep1PositiveTrainSurvivorsQ10Count: surv(0.1).filter(deep1Pos).length, positiveNetLongRuleSurvivorsQ10: surv(0.1).filter(tradableLong).map((t) => ({ id: t.id, period: t.period, n: t.n, effect: r4(t.effect), t: t.t, p: t.p, q: r4(t.q), kind: t.kind })),
    rows };
}
const A = runBH("deep-2, all DISCOVERY-period tests with p-values", disc);
const B = runBH("deep-2, every recorded test with a p-value (discovery + confirmation records)", tests);
const C = runBH("grand: deep-1 train (2,490 with p, vs SPY) + deep-2 discovery", [...d1, ...disc]);
const C2 = runBH("grand on deep-1 abnormal p (promotion measure) + deep-2 discovery", [...d1.map((t) => ({ ...t, p: t.pAbn })), ...disc]);
const survTable = (R) => R.rows.filter((t) => t.q < 0.1 && t.agent !== "deep1").sort((a, b) => a.p - b.p).map((t) => ({ id: t.id, agent: t.agent, period: t.period, n: t.n, effect: r4(t.effect), t: t.t, p: Number(t.p.toPrecision(3)), q: r4(t.q), kind: t.kind, sign: t.effect > 0 ? "+" : "-" }));

// ---------- 3. where do the frozen rules sit? ----------
const qA = new Map(A.rows.map((t) => [t.id, t.q]));
const frozenPos = ["execution-trapsClean-T3_ceoCfoOM250k-h3", "execution-trapsClean-T3_ceoCfoOM250k-h5", "execution-B-T3_ceoCfoOM250k-nextOpen-h3-tier1", "execution-B-T3_ceoCfoOM250k-nextOpen-h5-tier1"].map((id) => {
  const t = disc.find((x) => x.id === id); const rankP = [...disc].sort((a, b) => a.p - b.p).findIndex((x) => x.id === id) + 1;
  return { id, p: t?.p, qGlobalDeep2Discovery: r4(qA.get(id)), rankByPAmongDiscoveryTests: rankP, ofTests: disc.length };
});
// T3 cells in the execution discovery grid (how many T3 specifications were looked at before F1/F2 were frozen)
const t3cells = disc.filter((t) => /T3_ceoCfoOM250k|S1_ceoCfoOM250k/.test(t.id));

const out = {
  generatedAt: new Date().toISOString(),
  counts: { deep1Tests: D1.length, deep1WithP: d1.length, deep2Registered: REG.length, deep2RegisteredByAgent: countBy(REG, (r) => r.agent), deep2ResultRecords: RES.length,
    deep2TestsWithP: tests.length, deep2DiscoveryTestsWithP: disc.length, deep2ConfirmationRecordsWithP: tests.filter((t) => t.period === "confirm").length,
    deep2DescriptiveNoP: RES.filter((s) => pOf(s.result) == null).length, deep2PortfoliosDescriptive: REG.filter((r) => r.family === "execution-portfolio").length,
    totalTestsWithPValuesAcrossStudies: d1.length + tests.length, totalRegisteredAcrossStudies: D1.length + REG.length },
  timing, families,
  bh: [A, B, C, C2].map(({ rows, ...x }) => x),
  survivorsDeep2Discovery: survTable(A),
  survivorsGrand: survTable(C),
  frozenRulesPosition: frozenPos,
  t3CellsLookedAtInDiscovery: { n: t3cells.length, positive: t3cells.filter((t) => t.effect > 0).length, pBelow10: t3cells.filter((t) => t.p < 0.1).length, minP: Math.min(...t3cells.map((t) => t.p)), ids: t3cells.filter((t) => t.p < 0.15).map((t) => `${t.id} (p ${t.p.toFixed(3)}, mean ${r4(t.effect)})`) },
  f3Registered: REG.some((r) => /Aah-S1.*L1-nextOpen/.test(r.id)) ? "S1 L1 nextOpen at 25/50/100 bps registered, but WITHOUT the frozen buyable-size (>= $5k) invalidation: the exact F3 rule was never registered or evaluated before freezing" : "not registered",
};
writeOut("multiple-testing.json", out);
console.log(JSON.stringify({ counts: out.counts, timing, bh: out.bh.map((b) => ({ name: b.name, tests: b.tests, q10: b.survivorsQ10, q05: b.survivorsQ05, byAgent: b.survivorsQ10ByAgent, tradable: b.positiveNetLongRuleSurvivorsQ10, deep1Pos: b.deep1PositiveTrainSurvivorsQ10Count, deep1PosTop: b.deep1PositiveTrainSurvivorsQ10 })), frozenPos, t3: out.t3CellsLookedAtInDiscovery }, null, 1));
console.log("\nfamilies registered after the agent had recorded results:"); for (const f of families.filter((f) => f.registeredAfterAgentHadRecordedResults)) console.log(" ", f.agent, f.family, f.registered, f.firstRegisteredAt);
console.log("\ndeep-2 discovery survivors (q<0.10):"); for (const s of out.survivorsDeep2Discovery) console.log(" ", s.sign, s.id.padEnd(52), "n", s.n, "eff", s.effect, "t", s.t, "q", s.q, "|", s.kind);
