// server/scripts/research/deep2/execution/register.mjs — logs every execution test and portfolio
// simulation in deep2/registry.jsonl BEFORE anything is computed (idempotent: ids already present are skipped).
//   node scripts/research/deep2/execution/register.mjs
import { registerOnce } from "./execLib.mjs";
import { TESTS, PORTFOLIOS, FAMILIES } from "./grid.mjs";

let added = 0;
for (const t of TESTS) {
  const { id, family, statement, rationale, kind, trig = null, group = null, opts = null, N = null } = t;
  if (registerOnce({ id, family, familySize: FAMILIES[family], statement, rationale, preRegistered: true, spec: { kind, trig, group, N, opts },
    note: "Baseline trigger sets / deep-1 strata fixed by the lead's brief; every cost, entry, horizon and size variant counted in familySize. Discovery first; confirmation evaluated once after freeze." })) added++;
}
for (const p of PORTFOLIOS) {
  if (registerOnce({ id: p.id, family: "execution-portfolio", familySize: PORTFOLIOS.length, preRegistered: true,
    statement: `Descriptive portfolio simulation (no hypothesis test, no p-value): ${p.trig}${p.ahOnly ? " (after-close census subset)" : ""}, ${JSON.stringify(p.opts)}, ${JSON.stringify(p.sim)}.`,
    rationale: "Portfolio realism: concurrency, equity curve, drawdown, worst month, turnover and SPY buy-and-hold over the same days.", spec: { trig: p.trig, opts: p.opts, sim: p.sim } })) added++;
}
console.log(`[EXEC_REGISTER] families ${JSON.stringify(FAMILIES)}; tests ${TESTS.length}; portfolios ${PORTFOLIOS.length}; newly registered ${added}`);
