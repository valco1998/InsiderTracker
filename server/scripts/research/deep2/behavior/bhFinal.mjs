// deep2/behavior/bhFinal.mjs — Benjamini–Hochberg over ALL of this agent's registered discovery tests (append-only
// registry), plus the confirmation evaluations of the frozen candidates.   node scripts/research/deep2/behavior/bhFinal.mjs
import fs from "node:fs";
import path from "node:path";
import { DEEP2, bhQ } from "../lib2.mjs";
import { AGENT, writeOut, r4 } from "./common.mjs";

const read = (f) => fs.readFileSync(path.join(DEEP2, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const reg = read("registry.jsonl").filter((x) => x.agent === AGENT);
const res = read("registry-results.jsonl").filter((x) => x.agent === AGENT);
const disc = res.filter((x) => x.result?.period === "discover");
const q = bhQ(disc.map((x) => x.result.p ?? null));
const famOf = new Map(reg.map((x) => [x.id, x.family]));
const rows = disc.map((x, i) => {
  const r = x.result;
  const eff = r.kind === "mean" ? { n: r.stats?.n, issuers: r.stats?.issuers, estimate: r.stats?.mean, median: r.stats?.median }
    : r.kind === "diff" ? { n: `${r.diff?.nA} vs ${r.diff?.nB}`, estimate: r.diff?.diff, meanA: r.diff?.meanA, meanB: r.diff?.meanB }
      : { n: r.slope?.n, estimate: r.slope?.b };
  return { id: x.id, family: famOf.get(x.id), kind: r.kind, ...eff, p: r4(r.p), q: r4(q[i]) };
});
const conf = res.filter((x) => x.result?.period === "confirm").map((x) => {
  const r = x.result;
  if (r.kind === "slope") return { id: x.id, kind: "slope", n: r.slope?.n, issuers: r.slope?.issuers, mean: r.slope?.b, median: null, t: r.slope?.t, p: r4(r.p) };
  if (r.kind === "diff") return { id: x.id, kind: "diff", n: `${r.diff?.nA} vs ${r.diff?.nB}`, issuers: null, mean: r.diff?.diff, median: null, t: r.diff?.t, p: r4(r.p) };
  return { id: x.id, kind: "mean", n: r.stats?.n, issuers: r.stats?.issuers, mean: r.stats?.mean, median: r.stats?.median, issuerMedianOfMeans: r.stats?.issuerMedianOfMeans, t: r.stats?.t, p: r4(r.p) };
});
const out = { registered: reg.length, discoveryTests: disc.length, confirmationEvaluations: conf.length, passingQ10: rows.filter((r) => r.q < 0.1).map((r) => r.id), discovery: rows, confirmation: conf };
writeOut("bh-final.json", out);
const f = (v) => (v == null ? "-" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(2)}%`);
console.log(`registered ${out.registered}; discovery tests ${out.discoveryTests}; confirmation evaluations ${out.confirmationEvaluations}`);
for (const r of [...rows].sort((a, b) => a.p - b.p)) console.log(`${r.id.padEnd(46)} ${r.kind.padEnd(5)} n=${String(r.n).padEnd(12)} est ${f(r.estimate).padStart(8)} p=${String(r.p).padEnd(7)} q=${r.q}`);
console.log("q < 0.10:", out.passingQ10);
for (const c of conf) console.log(`CONFIRM ${c.id.padEnd(46)} n=${c.n}/${c.issuers} mean ${f(c.mean)} med ${f(c.median)} t=${c.t} p=${c.p}`);
