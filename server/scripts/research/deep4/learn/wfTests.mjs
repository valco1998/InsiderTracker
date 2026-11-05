// deep4/learn/wfTests.mjs — registered walk-forward tests (families learn.wf30 / learn.wfsec) from the saved predictions of
// wf.mjs, issuer-block bootstrap as declared in spec.json. Records each result once (lib4 registry).
//   node scripts/research/deep4/learn/wfTests.mjs [--segment=design] [--record]
import fs from "node:fs";
import { readOut, writeOut, outPath, existsOut, record, recordedIds, checkpoint, toCsv } from "./common.mjs";
import * as E from "./evalLib.mjs";

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split("=")[1] : d; };
const SEGMENT = arg("segment", "design"), DIR = `wf-${SEGMENT}`, DO_RECORD = process.argv.includes("--record");
const spec = readOut("spec.json");
const B = 1000;
const cache = new Map();
const R = (t, m) => { const k = `${t}-${m}`; if (!cache.has(k)) cache.set(k, existsOut(`${DIR}/recs-${k}.json`) ? readOut(`${DIR}/recs-${k}.json`) : null); return cache.get(k); };
const kindOf = (t) => (t.startsWith("hit") ? "auc" : "ic");

function compute(id) {
  const parts = id.split("."); // learn.<fam>.<target>.<model or pair>[.<what>]
  const t = parts[2], kind = kindOf(t), a = parts[3], what = parts[4] ?? null;
  if (a.includes("-") && !what) {
    if (a === "M3ev-M3cctl") { const ev = R(t, "M3"), ct = R(t, "M3c"); return { type: "twoSample", ...E.bootSkillTwoSample(ev.recs, ct.crecs, kind, { B }) }; }
    const [x, y] = a.split("-"); const A = R(t, x), Bm = R(t, y);
    return { type: "pairedDiff", models: [x, y], ...E.bootSkillDiff(A.recs, Bm.recs, kind, { B }) };
  }
  if (what === "skill") return { type: "skill", model: a, ...E.bootSkill(R(t, a).recs, kind, { B }) };
  if (what === "ctlSkill") return { type: "controlsSkill", model: a, ...E.bootSkill(R(t, a).crecs, kind, { B }) };
  if (what === "top") { // learn.wf30.<t>.<M>.top.net
    const sel = R(t, a).recs.filter((r) => r.sel && r.xs30 != null).map((r) => ({ issuer: r.issuer, y: r.xs30 }));
    return { type: "topNet", model: a, ...E.bootMean(sel, { B }) };
  }
  if (what === "top-base") {
    const items = R(t, a).recs.filter((r) => r.xs30 != null).map((r) => ({ issuer: r.issuer, month: r.month, sel: r.sel, y: r.xs30 }));
    return { type: "topBase", model: a, ...E.bootTopBase(items, { B }) };
  }
  throw new Error(`no computation for ${id}`);
}

const tests = spec.tests.filter((t) => t.family === "learn.wf30" || t.family === "learn.wfsec");
const already = recordedIds();
const results = [];
for (const t of tests) {
  const id = SEGMENT === "design" ? t.id : t.id.replace("learn.", `learn.confirm.`);
  const res = compute(t.id);
  results.push({ id: t.id, family: t.family, familySize: t.familySize, ...res });
  if (DO_RECORD && SEGMENT === "design" && !already.has(t.id)) record(t.id, { segment: SEGMENT, estimate: res.estimate, se: res.se, z: res.z, p: res.p, n: res.n ?? res.nAll ?? res.nA, detail: res });
}
// BH within the walk-forward families (and across learn's whole design registry later in bh.mjs)
const qs = E.normP ? null : null;
const ps = results.map((r) => r.p ?? null);
const idx = ps.map((p, i) => [p, i]).filter(([p]) => p != null).sort((x, y) => x[0] - y[0]);
const q = new Array(ps.length).fill(null); let mn = 1; for (let k = idx.length - 1; k >= 0; k--) { mn = Math.min(mn, (idx[k][0] * idx.length) / (k + 1)); q[idx[k][1]] = mn; }
results.forEach((r, i) => { r.qWithinWF = q[i]; });
writeOut(`${DIR}/tests.json`, results);
const flat = results.map((r) => ({ id: r.id, family: r.family, type: r.type, estimate: r.estimate, a: r.a ?? r.selectedMean ?? null, b: r.b ?? r.allMean ?? null, se: r.se, z: r.z, p: r.p, qWithinWF: r.qWithinWF, n: r.n ?? r.nAll ?? r.nA ?? null, nSel: r.nSelected ?? null, lo: r.ci95?.[0] ?? null, hi: r.ci95?.[1] ?? null }));
fs.writeFileSync(outPath(`${DIR}/tests.csv`), toCsv(flat, Object.keys(flat[0])));
checkpoint(`wfTests-${SEGMENT}`, { tests: results.length, recorded: DO_RECORD });
for (const r of flat) console.log(r.id.padEnd(40), String(r.type).padEnd(11), `est ${r.estimate?.toFixed(4)}`.padEnd(13), `a ${r.a?.toFixed?.(4) ?? "-"}`.padEnd(11), `b ${r.b?.toFixed?.(4) ?? "-"}`.padEnd(11), `se ${r.se?.toFixed(4)}`.padEnd(11), `z ${r.z?.toFixed(2)}`.padEnd(8), `p ${r.p?.toFixed(4)}`.padEnd(9), `q ${r.qWithinWF?.toFixed(3)}`, `n ${r.n}`, r.nSel != null ? `sel ${r.nSel}` : "");
