// Investigate the split-identity check (selfcheck section G).
import * as PL from "../panelLib.mjs";
import { loadPanel } from "../data.mjs";
const P = loadPanel({ agent: "panel", segments: ["design"] });
const M = PL.createMarket({ cutoff: PL.L4.DESIGN_END });
const inf = P.rows.filter((r) => r.fut_adjInferred === 1);
let a = 0, b = 0; const ex = [];
for (const r of inf) {
  const A = M.aligned(r.sym); const j = M.lastOnOrBefore(r.tradeDate); const k = A ? A.kAt[j] : -1;
  const close = k >= 0 ? A.arr[k].c : null;
  const okA = close != null && Math.abs(r.insPriceAdj - close) <= 1e-6 * Math.max(1, close);
  const okB = r.decCloseAsTraded == null || Math.abs(r.decCloseAsTraded * r.fut_adjFactor - r.decCloseAdj) <= 1e-6 * Math.max(1, r.decCloseAdj);
  if (!okA) a++; if (!okB) b++;
  if ((!okA || !okB) && ex.length < 8) ex.push({ key: r.key, ticker: r.ticker, tradeDate: r.tradeDate, firstBar: A?.first, barDate: k >= 0 ? A.arr[k].d : null, close, insPriceAdj: r.insPriceAdj, reported: r.priceReported, f: r.fut_adjFactor, ratio: r.fut_adjRatio, decAsTraded: r.decCloseAsTraded, decAdj: r.decCloseAdj, prod: r.decCloseAsTraded * r.fut_adjFactor });
}
console.log({ inferred: inf.length, failA: a, failB: b });
console.log(JSON.stringify(ex, null, 1));
