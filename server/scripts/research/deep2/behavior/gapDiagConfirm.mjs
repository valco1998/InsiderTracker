// deep2/behavior/gapDiagConfirm.mjs — the three discovery findings that passed BH (behaviour predicts the OPENING GAP)
// are frozen as written in discovery.mjs and evaluated ONCE on the confirmation period. Not trading rules: they test
// whether the market prices these behaviour features at the open.   node scripts/research/deep2/behavior/gapDiagConfirm.mjs
import { register, recordOnce, diffTest, rankSlope, writeOut, r4 } from "./common.mjs";
import { buildRows } from "./outcomes.mjs";

const isOm = (r) => r.cls === "om";
const pi = (r) => (r.firstPosition ? 1e6 : r.posIncrease);
const cov = (r) => isOm(r) && r.salesCovered;
const D = [
  { id: "behavior-diag-gap-pctRank-confirm", kind: "slope", A: (r) => isOm(r) && r.convValid && pi(r) != null, z: pi, statement: "Confirmation of behavior-conv-gap-pctRank: % position increase predicts the opening gap (positive)." },
  { id: "behavior-diag-gap-indep-confirm", kind: "diff", A: (r) => isOm(r) && r.buyerType30 === "independent", B: (r) => isOm(r) && r.buyerType30 === "repeat", statement: "Confirmation of behavior-mem-gap-indep: independent buyers get larger opening gaps than one insider repeating (positive)." },
  { id: "behavior-diag-gap-othersSold-confirm", kind: "diff", A: (r) => cov(r) && r.othersSold90 > 0, B: (r) => cov(r) && r.othersSold90 === 0, statement: "Confirmation of behavior-sales-gap-othersSold: buys made while other insiders sold get smaller opening gaps (negative)." },
];
for (const d of D) register({ id: d.id, family: "behavior-diagnostics-confirm", familySize: D.length, statement: d.statement,
  rationale: "If the market prices observable behaviour at the open, these gap relations should hold out of sample.", test: "single confirmation evaluation, same definitions as discovery" });
const rows = buildRows().filter((r) => r.period === "confirm" && r.gap != null);
const out = {};
for (const d of D) {
  let res;
  if (d.kind === "slope") { const sel = rows.filter(d.A); res = { kind: "slope", slope: rankSlope(sel.map((r) => ({ issuer: r.issuer, x: r.gap, z: d.z(r) }))) }; res.p = res.slope?.p ?? null; }
  else { res = { kind: "diff", diff: diffTest(rows.filter(d.A).map((r) => ({ issuer: r.issuer, x: r.gap })), rows.filter(d.B).map((r) => ({ issuer: r.issuer, x: r.gap }))) }; res.p = res.diff?.p ?? null; }
  out[d.id] = res; recordOnce(d.id, { period: "confirm", ...res });
}
writeOut("gap-diagnostics-confirm.json", out);
const f = (v) => (v == null ? "-" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(2)}%`);
for (const [id, r] of Object.entries(out)) console.log(id, r.kind === "slope" ? `n=${r.slope?.n} top-bottom ${f(r.slope?.b)} t=${r.slope?.t} p=${r4(r.p)}` : `A ${r.diff?.nA} ${f(r.diff?.meanA)} vs B ${r.diff?.nB} ${f(r.diff?.meanB)} diff ${f(r.diff?.diff)} t=${r.diff?.t} p=${r4(r.p)}`);
