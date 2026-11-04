// Investigate pPrior vs history prior-count mismatches.
import { createHistory } from "../history.mjs";
import { loadPanel } from "../data.mjs";
const P = loadPanel({ agent: "panel", segments: ["design"] });
const H = createHistory(P.rows);
let n = 0;
for (const r of P.rows) {
  if (!(r.isPrimary === 1 && r.dupSize === 1 && r.pConcurrent === 0)) continue;
  const h = H.historyForEvent(r, { dedupe: false });
  if (h.person.prior.n === r.pPrior) continue;
  n++;
  const near = P.rows.filter((x) => x.person === r.person && x.publishedAt >= r.publishedAt && x.publishedAt < r.decisionAt && x.key !== r.key).map((x) => [x.key, x.publishedAt, x.cik]);
  if (n <= 10) console.log(JSON.stringify({ key: r.key, person: r.person, publishedAt: r.publishedAt, decisionAt: r.decisionAt, pPrior: r.pPrior, histPrior: h.person.prior.n, filingsInLatencyWindow: near }));
}
console.log("total mismatches", n);
