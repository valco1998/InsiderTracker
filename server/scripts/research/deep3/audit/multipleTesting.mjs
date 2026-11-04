// deep3/audit/multipleTesting.mjs — auditor (agent "audit3"): multiple-testing accounting for deep 3 (+ deep 1 and deep 2).
//   node scripts/research/deep3/audit/multipleTesting.mjs        (holdout locked; reads registries only)
// Output: .cache/research/deep3/audit/multiple-testing.json
import fs from "node:fs";
import path from "node:path";
import * as V from "../dataquality/validate.mjs";
import { L, DEEP3, readJsonl, writeOut, countBy, group, r4 } from "./common.mjs";

if (process.env.DEEP2_HOLDOUT) throw new Error("run with the holdout locked");
const REG3 = readJsonl(path.join(DEEP3, "registry.jsonl")), RES3 = readJsonl(path.join(DEEP3, "registry-results.jsonl"));
const REG2 = readJsonl(path.join(L.DEEP2, "registry.jsonl")), RES2 = readJsonl(path.join(L.DEEP2, "registry-results.jsonl"));
const D1 = readJsonl(path.join(L.DEEP1, "registry.jsonl"));
const regById = new Map(); for (const r of REG3) if (!regById.has(r.id)) regById.set(r.id, r);
const lastRes = new Map(); for (const s of RES3) lastRes.set(s.id, s); // latest record per id (re-records only added flags)

// ---------------- 1. registration discipline ----------------
const order = RES3.map((s) => ({ id: s.id, agent: s.agent, at: s.at, reg: regById.get(s.id)?.registeredAt })).filter((x) => x.reg);
const fam = {};
for (const r of REG3) { const k = `${r.agent}|${r.family}`; const f = (fam[k] ||= { agent: r.agent, family: r.family, registered: 0, declared: new Set(), first: r.registeredAt }); f.registered++; f.declared.add(r.familySize); if (r.registeredAt < f.first) f.first = r.registeredAt; }
const firstResultByAgent = {}; for (const s of RES3) if (!firstResultByAgent[s.agent] || s.at < firstResultByAgent[s.agent]) firstResultByAgent[s.agent] = s.at;
const families = Object.values(fam).map((f) => ({ agent: f.agent, family: f.family, registered: f.registered, declaredFamilySize: [...f.declared], honestCount: f.declared.size === 1 && [...f.declared][0] === f.registered,
  firstRegisteredAt: f.first, registeredAfterAgentHadResults: f.first > firstResultByAgent[f.agent] }));
const timing = { registered: REG3.length, uniqueRegistered: regById.size, resultRecords: RES3.length, uniqueResultIds: new Set(RES3.map((s) => s.id)).size,
  resultBeforeRegistration: order.filter((x) => x.at < x.reg).length, unregisteredResults: RES3.filter((s) => !regById.has(s.id)).length,
  minSecondsRegistrationToResult: Math.min(...order.map((x) => (Date.parse(x.at) - Date.parse(x.reg)) / 1000)), byAgent: countBy(REG3, (r) => r.agent),
  familySizeMismatches: families.filter((f) => !f.honestCount).map((f) => ({ agent: f.agent, family: f.family, registered: f.registered, declared: f.declaredFamilySize })) };

// ---------------- 2. classify every deep-3 test ----------------
const pOf = (r) => (Number.isFinite(r?.p) ? r.p : Number.isFinite(r?.stats?.p) ? r.stats.p : null);
const effOf = (r) => [r?.estimate, r?.mean, r?.diff, r?.value].find(Number.isFinite) ?? null;
function periodOf(id, agent, res) {
  if (agent === "audit3") return "preholdoutPooled";
  if (/^sequence-S11-|^sequence-R3-.*-confirm$|^targets-(OC|CF)-|^targets-EX-.*-confirm-|^targets-M-/.test(id)) return "confirm";
  return "discover";
}
function kindOf(id, agent, res, reg) {
  if (agent === "sequence") {
    const k = res?.kind || reg?.spec?.kind || ""; const m = res?.metric || reg?.spec?.metric || "";
    if (/^sequence-R3-/.test(id)) return { kind: "frozen lead: long rule, net excess vs SPY (MOO->MOC N3, tier x1)", longRule: true, net: true, executable: true };
    if (/^sequence-R2-/.test(id)) { if (/-level-/.test(id)) return { kind: "robustness of a long net rule", longRule: true, net: true, executable: true }; return { kind: "robustness of an event-minus-control residual (not a P&L)", longRule: false, net: true, executable: false }; }
    if (k === "level") return { kind: "long rule, net excess vs SPY (MOO->MOC, tier x1)", longRule: true, net: true, executable: true };
    if (k === "ctl" || k === "ctlNet" || k === "ctlTouch") return { kind: /^T/.test(m) ? "touch rate minus matched controls (not a P&L)" : "net minus matched controls (residual, not a P&L)", longRule: false, net: !/^T/.test(m), executable: false };
    if (k === "diff" || k === "diffAll") return { kind: "difference between groups (long-short, not a long rule)", longRule: false, net: !/^T/.test(m), executable: false };
    if (k === "slope") return { kind: "rank slope (not a rule)", longRule: false, net: false, executable: false };
    return { kind: k || "other", longRule: false, net: false, executable: false };
  }
  if (agent === "targets") {
    if (/^targets-M-/.test(id)) return { kind: "model AUC lift / top bucket (not a P&L)", longRule: false, net: false, executable: false };
    if (/vsControls|vsVolRich/.test(id)) return { kind: "pattern minus controls (not a P&L)", longRule: false, net: true, executable: false };
    if (/tpApprox|tp\d+s\d+n\d+/.test(id)) return { kind: "LIMIT-FILL APPROXIMATION long rule (daily bars; not verifiable)", longRule: true, net: true, executable: false, approximation: true };
    if (/-x[1-5]?\d*($|-)|-EX-.*-x[12]$/.test(id)) return { kind: "long rule, net excess vs SPY (close exit, tier cost)", longRule: true, net: true, executable: true };
    if (/hit\d+_\d+/.test(id)) return { kind: "touch rate minus controls (not a P&L)", longRule: false, net: false, executable: false };
    if (/dd\d+_\d+/.test(id)) return { kind: "drawdown rate minus controls (risk, not a P&L)", longRule: false, net: false, executable: false };
    return { kind: "other", longRule: false, net: false, executable: false };
  }
  if (/-N3-level$/.test(id)) return { kind: "long rule, net excess (audit)", longRule: true, net: true, executable: true };
  return { kind: "audit diagnostic (difference vs controls / descriptive)", longRule: false, net: false, executable: false };
}
const tests = [];
for (const [id, s] of lastRes) {
  const reg = regById.get(id); const p = pOf(s.result); if (p == null || !(p >= 0)) continue;
  tests.push({ id, agent: s.agent, family: reg?.family, familySize: reg?.familySize, preRegistered: reg?.preRegistered ?? null, period: periodOf(id, s.agent, s.result), p, effect: effOf(s.result), n: s.result?.n ?? null, t: s.result?.t ?? null, ...kindOf(id, s.agent, s.result, reg) });
}
const noP = [...lastRes.values()].filter((s) => pOf(s.result) == null).length;
const spec = tests.filter((t) => t.agent !== "audit3");
const disc = spec.filter((t) => t.period === "discover");
const discPre = disc.filter((t) => /^sequence-S([1-9]|10)-|^targets-(OV|OVR|P)-/.test(t.id));

// ---------------- 3. BH ----------------
function runBH(name, arr) {
  const q = V.bh(arr.map((t) => t.p)); const rows = arr.map((t, i) => ({ ...t, q: q[i] }));
  const s10 = rows.filter((t) => t.q != null && t.q < 0.1);
  const tradable = (t) => t.longRule && t.net && t.effect > 0;
  return { name, tests: arr.length, survivorsQ10: s10.length, survivorsQ05: rows.filter((t) => t.q < 0.05).length, byAgent: countBy(s10, (t) => t.agent), bySign: countBy(s10, (t) => (t.effect > 0 ? "+" : "-")),
    byKind: countBy(s10, (t) => `${t.effect > 0 ? "+" : "-"} ${t.kind}`),
    positiveLongNetSurvivors: s10.filter(tradable).map((t) => ({ id: t.id, n: t.n, effect: r4(t.effect), t: t.t, p: Number(t.p.toPrecision(3)), q: r4(t.q), kind: t.kind, executable: t.executable })),
    positiveExecutableLongNetSurvivors: s10.filter((t) => tradable(t) && t.executable).map((t) => t.id),
    survivors: s10.sort((a, b) => a.p - b.p).map((t) => ({ id: t.id, n: t.n, effect: r4(t.effect), p: Number(t.p.toPrecision(3)), q: r4(t.q), sign: t.effect > 0 ? "+" : "-", kind: t.kind })), rows };
}
const A = runBH("deep-3 specialists, PRE-REGISTERED discovery tests (sequence S1-S10 + targets OV/OVR/P)", discPre);
const B = runBH("deep-3 specialists, ALL discovery-period tests (incl. post-hoc follow-ups, robustness, frozen-lead discovery, execLib)", disc);
const Cc = runBH("deep-3, every recorded test with a p-value (discovery + confirmation + audit3)", tests);
// cross-study: deep-1 train (vs SPY) + deep-2 discovery + deep-3 discovery
const pOf2 = (res) => res?.p ?? res?.stats?.p ?? null;
const reg2 = new Map(REG2.map((r) => [r.id, r]));
const d2 = []; for (const s of RES2) { const p = pOf2(s.result); if (p == null || !Number.isFinite(p)) continue; const r = reg2.get(s.id); const per = s.result?.period ?? (r?.agent === "chart" ? "discover" : null); if (per !== "discover") continue; d2.push({ id: s.id, agent: `deep2-${r?.agent}`, p, effect: s.result?.mean ?? s.result?.stats?.mean ?? null, longRule: false, net: false, kind: "deep-2 discovery test" }); }
const d1 = D1.filter((r) => r.train?.p != null && Number.isFinite(r.train.p)).map((r) => ({ id: r.id, agent: "deep1", p: r.train.p, effect: r.train.meanExcess, longRule: false, net: false, kind: "deep-1 train test" }));
const G = runBH("grand: deep-1 train + deep-2 discovery + deep-3 discovery (all)", [...d1, ...d2, ...disc]);
const deep3InGrand = G.rows.filter((t) => !String(t.agent).startsWith("deep")).filter((t) => t.q < 0.1);

// ---------------- 4. where do the frozen leads sit ----------------
const qB = new Map(B.rows.map((t) => [t.id, t])); const rankB = [...B.rows].sort((a, b) => a.p - b.p).map((t) => t.id);
const leads = ["sequence-R3-L1_buyer2-discover", "sequence-R3-L2_fastFollower-discover", "sequence-R3-L3_drawdownFollower-discover", "targets-P-othersPlanOnly-tp10s10n5", "targets-P-othersPlanOnly-x5", "targets-P-C5_clu_low60-x5", "targets-EX-othersPlanOnly-discover-x1", "targets-EX-C5_clu_low60-discover-x1"]
  .map((id) => ({ id, p: qB.get(id) ? Number(qB.get(id).p.toPrecision(3)) : null, qGlobalDeep3Discovery: qB.get(id) ? r4(qB.get(id).q) : null, rankByP: rankB.indexOf(id) + 1, of: rankB.length }));
// replication of the specialists' discovery survivors in confirmation (sequence S11 pre-specified pairs; targets CF)
const s11 = [...lastRes.values()].filter((s) => /^sequence-S11-/.test(s.id)).map((s) => ({ id: s.id, discoveryId: s.result.discoveryId, estimate: s.result.estimate, p: s.result.p, discoveryEstimate: s.result.discoveryEstimate, discoveryQ: s.result.discoveryQ, replicates: s.result.replicates }));
const cf = [...lastRes.values()].filter((s) => /^targets-CF-/.test(s.id)).map((s) => ({ id: s.id, n: s.result.n, mean: s.result.mean, p: s.result.p == null ? null : r4(s.result.p) }));

const out = {
  generatedAt: new Date().toISOString(),
  counts: { deep3Registered: REG3.length, deep3RegisteredByAgent: countBy(REG3, (r) => r.agent), deep3ResultRecords: RES3.length, deep3TestsWithP: tests.length, deep3TestsWithoutP: noP,
    deep3SpecialistDiscoveryWithP: disc.length, deep3SpecialistPreRegisteredDiscoveryWithP: discPre.length, deep3ConfirmationWithP: spec.filter((t) => t.period === "confirm").length, audit3WithP: tests.filter((t) => t.agent === "audit3").length,
    deep2RegisteredIds: REG2.length, deep2PValues: RES2.filter((s) => Number.isFinite(pOf2(s.result))).length, deep2DiscoveryPValues: d2.length, deep1Tests: D1.length, deep1TrainPValues: d1.length,
    totalPValuesAcrossStudies: d1.length + RES2.filter((s) => Number.isFinite(pOf2(s.result))).length + tests.length },
  timing, families: families.filter((f) => f.registeredAfterAgentHadResults || !f.honestCount),
  notes: [
    "All 642 specialist ids were registered before their first result (0 results before registration, 0 unregistered results).",
    "sequence R1/R2/R3 (40 ids) carry preRegistered:true although their statements say POST-HOC / robustness / frozen leads; they are treated as post-hoc here.",
    "targets built its per-event outcome table (events.json) 82 s before registering; no outcome statistic was printed by build.mjs (counts and a stage-C reproduction check only).",
    "audit3 tests (I1, C1, E1) pool discovery + confirmation and are reported separately; E1a is NOT blind (computed in the code audit first).",
  ],
  bh: [A, B, Cc, G].map(({ rows, ...x }) => x),
  deep3SurvivorsInGrand: deep3InGrand.map((t) => ({ id: t.id, effect: r4(t.effect), p: Number(t.p.toPrecision(3)), q: r4(t.q), kind: t.kind, sign: t.effect > 0 ? "+" : "-" })),
  frozenLeadsPosition: leads, sequenceS11Replication: s11, targetsCF: cf,
};
writeOut("multiple-testing.json", out);
console.log(JSON.stringify({ counts: out.counts, timing: { ...timing, familySizeMismatches: timing.familySizeMismatches.length }, bh: out.bh.map((b) => ({ name: b.name, tests: b.tests, q10: b.survivorsQ10, q05: b.survivorsQ05, byAgent: b.byAgent, bySign: b.bySign, positiveLongNet: b.positiveLongNetSurvivors, posExec: b.positiveExecutableLongNetSurvivors })), leads, deep3InGrand: out.deep3SurvivorsInGrand.length }, null, 1));
