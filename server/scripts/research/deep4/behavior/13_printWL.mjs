// deep4/behavior/13_printWL.mjs — print winners / losers (context + path) from winners-losers.json (read-only).
//   node scripts/research/deep4/behavior/13_printWL.mjs
import { readJson } from "./common.mjs";
const w = readJson("winners-losers.json");
const f = (x) => (x == null ? "-" : (x * 100).toFixed(1));
const show = (t) => [String(t.ticker || "").padEnd(5), String(t.insider || "").slice(0, 22).padEnd(22), String(t.role || "").padEnd(8), `pub ${String(t.published || "").slice(0, 10)}`, `in ${t.entryDate}`, `out ${t.exitDate}`,
  `usd ${Math.round((t.usd || 0) / 1000)}k`, `r20 ${f(t.context.r20)}`, `dLo60 ${f(t.context.dLo60)}`, `dHi60 ${f(t.context.dHi60)}`, `rep ${t.context.pPriorCo}`, `gap ${f(t.path.gapEntry)}`, `x5 ${f(t.path.xs5)}`, `mfe ${f(t.path.mfe30)}`, `mae ${f(t.path.mae30)}`, `=> xsNet30 ${f(t.xsNet)}`].join(" ");
for (const id of ["behavior.S1x.firstObserved", "behavior.S0.all"]) for (const seg of ["design", "confirm"]) {
  const x = w[id][seg]; if (!x) continue;
  console.log(`\n### ${id} ${seg} WINNERS`); x.winners.slice(0, 10).forEach((t) => console.log(show(t)));
  console.log(`### ${id} ${seg} LOSERS`); x.losers.slice(0, 10).forEach((t) => console.log(show(t)));
}
