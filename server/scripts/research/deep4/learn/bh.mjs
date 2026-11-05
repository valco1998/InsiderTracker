// deep4/learn/bh.mjs — Benjamini-Hochberg q-values: (a) within learn's registered design tests, (b) globally over every deep-4
// registry result that carries a p-value (all agents, latest result per id; confirmation results reported separately).
//   node scripts/research/deep4/learn/bh.mjs
import fs from "node:fs";
import path from "node:path";
import { writeOut, checkpoint, L4 } from "./common.mjs";

const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const reg = read(path.join(L4.DEEP4, "registry.jsonl")), res = read(path.join(L4.DEEP4, "registry-results.jsonl"));
const regById = new Map(reg.map((h) => [h.id, h]));
const latest = new Map(); for (const r of res) latest.set(r.id, r);
const pOf = (r) => { const v = r.result?.p ?? r.result?.pValue ?? r.result?.detail?.p ?? null; return typeof v === "number" && Number.isFinite(v) ? v : null; };
function bh(items) {
  const idx = items.map((it, i) => [it.p, i]).filter(([p]) => p != null).sort((a, b) => a[0] - b[0]);
  const m = idx.length, q = new Array(items.length).fill(null); let mn = 1;
  for (let k = m - 1; k >= 0; k--) { mn = Math.min(mn, (idx[k][0] * m) / (k + 1)); q[idx[k][1]] = mn; }
  return { m, q };
}
const isConfirm = (id, r) => /\.confirm\./.test(id) || r.result?.segment === "confirm";
const all = [...latest.values()].filter((r) => regById.has(r.id)).map((r) => ({ id: r.id, agent: r.agent, family: regById.get(r.id).family, familySize: regById.get(r.id).familySize, p: pOf(r), estimate: r.result?.estimate ?? null, segment: isConfirm(r.id, r) ? "confirm" : "design" }));
const design = all.filter((x) => x.segment === "design");
const learnD = design.filter((x) => x.agent === "learn");
const a = bh(learnD); learnD.forEach((x, i) => { x.qLearn = a.q[i]; });
const g = bh(design); design.forEach((x, i) => { x.qGlobal = g.q[i]; });
const out = { at: new Date().toISOString(), learnDesignTests: a.m, globalDesignTests: g.m, agents: [...new Set(design.map((x) => x.agent))], learn: learnD.sort((x, y) => (x.p ?? 1) - (y.p ?? 1)) };
writeOut("bh.json", out);
checkpoint("bh", { learn: a.m, global: g.m });
console.log(`learn design tests with p: ${a.m}; global deep-4 design tests with p: ${g.m} (agents ${out.agents.join(", ")})`);
for (const x of out.learn) console.log(`${x.id.padEnd(40)} est ${x.estimate?.toFixed?.(4) ?? "-"}`.padEnd(58), `p ${x.p?.toExponential(2)}`.padEnd(12), `qLearn ${x.qLearn?.toFixed(4)}`.padEnd(15), `qGlobal ${x.qGlobal?.toFixed(4)}`);
