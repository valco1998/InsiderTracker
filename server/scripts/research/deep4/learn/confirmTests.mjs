// deep4/learn/confirmTests.mjs — computes and records the confirmation tests registered at freeze time (family learn.confirm)
// from the confirm outputs of wf.mjs / strategies.mjs / familyB.mjs. Runs only after frozen.json exists.
//   node --max-old-space-size=8192 scripts/research/deep4/learn/confirmTests.mjs
import fs from "node:fs";
import { readOut, writeOut, existsOut, record, recordedIds, checkpoint, L4 } from "./common.mjs";
import * as E from "./evalLib.mjs";

if (!fs.existsSync(L4.agentFrozenFile("learn"))) throw new Error("confirmTests needs learn/frozen.json");
const frozen = readOut("frozen.json");
const DIR = "wf-confirm", B = 1000;
const R = (t, m) => readOut(`${DIR}/recs-${t}-${m}.json`);
const kindOf = (t) => (t.startsWith("hit") ? "auc" : "ic");
const ST = readOut("strategies-confirm.json"), FB = readOut("famB-confirm.json"), IN = readOut("interactions-confirm.json");
function compute(id) {
  const p = id.split("."); // learn.confirm.<area>....
  if (p[2] === "wf") {
    const t = p[3], a = p[4], what = p[5] ?? null, kind = kindOf(t);
    if (what === "skill") return E.bootSkill(R(t, a).recs, kind, { B });
    if (what === "ctlSkill") return E.bootSkill(R(t, a).crecs, kind, { B });
    const [x, y] = a.split("-"); return E.bootSkillDiff(R(t, x).recs, R(t, y).recs, kind, { B });
  }
  if (p[2] === "strat") {
    const S = ST.strategies[p[3]]; if (!S || !S.metrics || !S.metrics.n) return { estimate: null, n: 0 };
    const m = S.metrics;
    if (p[4] === "net") return { estimate: m.companyStats.mean, t: m.companyStats.t, p: m.companyStats.p, n: m.n, issuers: m.issuers, median: m.medianXsNet, exTop5: m.companyStats.meanExTop5Issuers };
    if (p[4] === "vsS0") return { estimate: S.vsBaseline?.estimate ?? null, z: S.vsBaseline?.z ?? null, p: S.vsBaseline?.p ?? null, n: S.vsBaseline?.nSelected ?? null };
    if (p[4] === "vsCtl") { const d = m.vsControls?.diff; return { estimate: d?.mean ?? null, t: d?.t ?? null, p: d?.p ?? null, n: d?.n ?? null }; }
  }
  if (p[2] === "int") { const r = IN.results.find((x) => x.id === `learn.int.${p[3]}.${p[4]}`); return { estimate: r.estimate, se: r.se, z: r.z, p: r.p, n: r.n, issuers: r.issuers }; }
  if (p[2] === "famB") { const S = FB.summary[p[3]].evc30; return { estimate: S.mean, t: S.t, p: S.p, n: S.n, issuers: S.issuers }; }
  throw new Error(`no computation for ${id}`);
}
const already = recordedIds(), out = [];
for (const t of frozen.confirmTests) {
  const res = compute(t.id);
  out.push({ id: t.id, ...res });
  if (!already.has(t.id)) record(t.id, { segment: "confirm", estimate: res.estimate ?? null, se: res.se ?? null, z: res.z ?? res.t ?? null, p: res.p ?? null, n: res.n ?? null, detail: { ...res, months: res.months ?? undefined } });
}
writeOut("confirm-tests.json", out);
checkpoint("confirmTests", { n: out.length });
for (const r of out) console.log(r.id.padEnd(44), `est ${r.estimate?.toFixed?.(4) ?? "-"}`.padEnd(14), `z/t ${(r.z ?? r.t)?.toFixed?.(2) ?? "-"}`.padEnd(10), `p ${r.p?.toFixed?.(4) ?? "-"}`.padEnd(10), `n ${r.n ?? "-"}`, r.a != null ? `a ${r.a.toFixed(4)} b ${r.b.toFixed(4)}` : "");
