// deep2/behavior/gapReversalDiag.mjs — one registered diagnostic for the "momentum or reversal?" question of K1/K2:
// among true open-market filings, does the opening gap predict the post-open H5 net excess (rank slope)? Discovery only.
// Gap-conditioned ENTRY rules are the chart specialist's direction; this only interprets the behaviour null.
//   node scripts/research/deep2/behavior/gapReversalDiag.mjs
import { register, recordOnce, rankSlope, writeOut, r4, mean, median } from "./common.mjs";
import { buildRows } from "./outcomes.mjs";

const id = "behavior-diag-gapReversal-H5";
register({ id, family: "behavior-diagnostic", familySize: 1,
  statement: "Among true open-market filings (discovery), the SPY-adjusted opening gap predicts post-open H5 net excess (rank slope; expected negative = reversal of the open).",
  rationale: "If the open over-reacts to insider news (especially in thin stocks), the post-open loss of K1/K2 should concentrate in large-gap events; if under-reacts, the slope is positive (momentum).",
  test: "rank slope, discovery; descriptive gap quintiles" });
const rows = buildRows().filter((r) => r.period === "discover" && r.cls === "om" && r.gap != null && r.x[5] != null);
const s = rankSlope(rows.map((r) => ({ issuer: r.issuer, x: r.x[5], z: r.gap })));
const srt = [...rows].sort((a, b) => a.gap - b.gap), k = Math.floor(srt.length / 5);
const quint = [0, 1, 2, 3, 4].map((q) => { const g = srt.slice(q * k, q === 4 ? srt.length : (q + 1) * k); return { n: g.length, gapRange: [r4(g[0].gap), r4(g.at(-1).gap)], h1: r4(mean(g.map((r) => r.x[1]).filter((v) => v != null))), h5: r4(mean(g.map((r) => r.x[5]))), h5med: r4(median(g.map((r) => r.x[5]))) }; });
const res = { kind: "slope", slope: s, p: s?.p ?? null, quintiles: quint };
recordOnce(id, { period: "discover", ...res });
writeOut("gap-reversal-diagnostic.json", res);
const f = (v) => (v == null ? "-" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(2)}%`);
console.log(`${id}: n=${s?.n} top-bottom ${f(s?.b)} t=${s?.t} p=${r4(s?.p)}`);
for (const q of quint) console.log(`  gap ${f(q.gapRange[0])}..${f(q.gapRange[1])} n=${q.n} H1 ${f(q.h1)} H5 ${f(q.h5)} (med ${f(q.h5med)})`);
