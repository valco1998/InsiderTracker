// deep4/audit/a8_multipleTesting.mjs — Phase A item 8: registration discipline and global Benjamini–Hochberg over the deep-4
// registry, and grand BH across deep 2 + 3 + 4 (deep-2/3 selection rules copied from deep3/audit/multipleTesting.mjs).
// Reads registries only (no outcome data).   node scripts/research/deep4/audit/a8_multipleTesting.mjs
import path from "node:path";
import { L4, V, readJsonl, writeOut, checkpoint, countBy, r4, group } from "./common.mjs";
import { OUT_DIR } from "../../lib.mjs";

const D4 = L4.DEEP4, D3 = path.join(OUT_DIR, "deep3"), D2 = path.join(OUT_DIR, "deep2"), D1 = path.join(OUT_DIR, "deep");
const REG4 = readJsonl(path.join(D4, "registry.jsonl")), RES4 = readJsonl(path.join(D4, "registry-results.jsonl"));
const reg4 = new Map(); for (const r of REG4) if (!reg4.has(r.id)) reg4.set(r.id, r);
const pOf = (x) => { for (const v of [x?.p, x?.pPerm, x?.pValue, x?.detail?.p, x?.stats?.p]) if (typeof v === "number" && Number.isFinite(v)) return v; return null; };
const effOf = (x) => [x?.estimate, x?.mean, x?.diff, x?.rho, x?.r, x?.meanXsNet, x?.est, x?.value].find((v) => typeof v === "number" && Number.isFinite(v)) ?? null;
const segOf = (s) => (s.result?.segment === "confirm" || /\.confirm\./.test(s.id) ? "confirm" : s.result?.segment === "exposed" ? "exposed" : "design");
// ---- registration discipline (deep 4) ----
const firstRes = new Map(); for (const s of RES4) if (!firstRes.has(s.id)) firstRes.set(s.id, s);
const fam = {}; for (const r of REG4) { const k = `${r.agent}|${r.family}`; const f = (fam[k] ||= { agent: r.agent, family: r.family, n: 0, declared: new Set() }); f.n++; f.declared.add(r.familySize); }
const discipline = { registered: REG4.length, uniqueRegistered: reg4.size, results: RES4.length, uniqueResultIds: new Set(RES4.map((s) => s.id)).size,
  resultBeforeRegistration: [...firstRes.values()].filter((s) => reg4.get(s.id) && s.at < reg4.get(s.id).registeredAt).map((s) => s.id),
  unregisteredResults: RES4.filter((s) => !reg4.has(s.id)).map((s) => s.id),
  familySizeMismatches: Object.values(fam).filter((f) => f.declared.size !== 1 || [...f.declared][0] !== f.n).map((f) => ({ agent: f.agent, family: f.family, registered: f.n, declared: [...f.declared] })),
  byAgent: countBy(REG4, (r) => r.agent), resultsByAgentSegment: countBy(RES4, (s) => `${s.agent}|${segOf(s)}`),
  postHocFlags: countBy(REG4, (r) => `${r.agent}|preRegistered=${r.preRegistered ?? "?"}|posthoc=${r.posthoc ?? false}`) };
// ---- deep-4 tests: one per (id, segment), first result of that segment ----
const tests4 = []; const seen = new Set();
for (const s of RES4) { const seg = segOf(s); const k = `${s.id}|${seg}`; if (seen.has(k)) continue; const p = pOf(s.result); if (p == null) continue; seen.add(k);
  const reg = reg4.get(s.id); tests4.push({ id: s.id, agent: s.agent, segment: seg, family: reg?.family ?? null, p, effect: effOf(s.result), n: s.result?.n ?? s.result?.n30 ?? null }); }
function runBH(name, arr) {
  const q = V.bh(arr.map((t) => t.p)); const rows = arr.map((t, i) => ({ ...t, q: q[i] }));
  const s10 = rows.filter((t) => t.q != null && t.q < 0.1);
  return { name, tests: arr.length, q10: s10.length, q05: rows.filter((t) => t.q < 0.05).length, byAgent: countBy(s10, (t) => t.agent), bySign: countBy(s10, (t) => (t.effect == null ? "?" : t.effect > 0 ? "+" : "-")),
    survivors: s10.sort((a, b) => a.p - b.p).map((t) => ({ id: t.id, segment: t.segment, effect: r4(t.effect), p: Number(t.p.toPrecision(3)), q: r4(t.q) })), rows };
}
const spec4design = tests4.filter((t) => t.segment === "design" && (t.agent === "behavior" || t.agent === "learn"));
const B4a = runBH("deep-4 specialists, design-segment tests (first design result per id)", spec4design);
const B4b = runBH("deep-4 specialists, confirmation tests", tests4.filter((t) => t.segment === "confirm" && t.agent !== "audit4"));
const B4c = runBH("deep-4 every recorded (id, segment) with a p-value (specialists design + confirmation + audit4 phase A)", tests4);
// ---- deep 3 + deep 2 (+ deep 1) discovery, exactly as the deep-3 auditor selected them ----
const REG3 = readJsonl(path.join(D3, "registry.jsonl")), RES3 = readJsonl(path.join(D3, "registry-results.jsonl"));
const REG2 = readJsonl(path.join(D2, "registry.jsonl")), RES2 = readJsonl(path.join(D2, "registry-results.jsonl"));
const REG1 = readJsonl(path.join(D1, "registry.jsonl"));
const last3 = new Map(); for (const s of RES3) last3.set(s.id, s);
const reg3 = new Map(); for (const r of REG3) if (!reg3.has(r.id)) reg3.set(r.id, r);
const period3 = (id, agent) => (agent === "audit3" ? "audit" : /^sequence-S11-|^sequence-R3-.*-confirm$|^targets-(OC|CF)-|^targets-EX-.*-confirm-|^targets-M-/.test(id) ? "confirm" : "discover");
const d3 = []; for (const [id, s] of last3) { const p = pOf(s.result); if (p == null || !(p >= 0)) continue; if (period3(id, s.agent) !== "discover") continue; d3.push({ id, agent: `deep3-${s.agent}`, segment: "discover", p, effect: effOf(s.result) }); }
const reg2 = new Map(REG2.map((r) => [r.id, r]));
const d2 = []; for (const s of RES2) { const p = s.result?.p ?? s.result?.stats?.p ?? null; if (p == null || !Number.isFinite(p)) continue; const r = reg2.get(s.id); const per = s.result?.period ?? (r?.agent === "chart" ? "discover" : null); if (per !== "discover") continue; d2.push({ id: s.id, agent: `deep2-${r?.agent}`, segment: "discover", p, effect: s.result?.mean ?? s.result?.stats?.mean ?? null }); }
const d1 = REG1.filter((r) => r.train?.p != null && Number.isFinite(r.train.p)).map((r) => ({ id: r.id, agent: "deep1", segment: "train", p: r.train.p, effect: r.train.meanExcess }));
const G234 = runBH("grand: deep-2 discovery + deep-3 discovery + deep-4 design (specialists)", [...d2, ...d3, ...spec4design]);
const G1234 = runBH("grand: deep-1 train + deep-2 discovery + deep-3 discovery + deep-4 design (specialists)", [...d1, ...d2, ...d3, ...spec4design]);
const deep4InGrand = (G) => G.rows.filter((t) => t.agent === "behavior" || t.agent === "learn").filter((t) => t.q < 0.1).map((t) => ({ id: t.id, effect: r4(t.effect), p: Number(t.p.toPrecision(3)), q: r4(t.q) }));
// positive long-rule (tradable) deep-4 design survivors: strategy-type ids with positive effect
const tradable = (id) => /^behavior\.(S|A\d|C0[89]|C10)|^learn\.(wf30\.xs30\.[A-Z0-9]+\.top|famB\.B\d\.ev30|strat)/.test(id);
const out = { generatedAt: new Date().toISOString(), discipline, counts: { deep4TestsWithP: tests4.length, deep4SpecialistDesign: spec4design.length, deep4SpecialistConfirm: B4b.tests, deep4Audit: tests4.filter((t) => t.agent === "audit4").length, deep3Discover: d3.length, deep2Discover: d2.length, deep1Train: d1.length },
  bh: [B4a, B4b, B4c, G234, G1234].map(({ rows, ...x }) => x),
  deep4DesignSurvivorsInGrand234: deep4InGrand(G234), deep4DesignSurvivorsInGrand1234: deep4InGrand(G1234),
  positiveTradableDeep4DesignSurvivors: B4a.rows.filter((t) => t.q < 0.1 && t.effect > 0 && tradable(t.id)).map((t) => ({ id: t.id, effect: r4(t.effect), p: t.p, q: r4(t.q) })),
  positiveTradableDeep4InGrand: G234.rows.filter((t) => (t.agent === "behavior" || t.agent === "learn") && t.q < 0.1 && t.effect > 0 && tradable(t.id)).map((t) => ({ id: t.id, effect: r4(t.effect), q: r4(t.q) })) };
writeOut("multiple-testing.json", out);
checkpoint("a8_multipleTesting", { tests4: tests4.length });
console.log(JSON.stringify({ discipline: { ...discipline, postHocFlags: discipline.postHocFlags }, counts: out.counts, bh: out.bh.map((b) => ({ name: b.name, tests: b.tests, q10: b.q10, q05: b.q05, byAgent: b.byAgent, bySign: b.bySign, top: b.survivors.slice(0, 12) })), deep4InGrand234: out.deep4DesignSurvivorsInGrand234, posTradable: out.positiveTradableDeep4DesignSurvivors, posTradableGrand: out.positiveTradableDeep4InGrand }, null, 1));
