// Counts for the final report (design segment): events by month, priced, primary, controls, classes, feature coverage.
import { loadPanel, loadControls } from "../data.mjs";
import * as PL from "../panelLib.mjs";
const P = loadPanel({ agent: "panel", segments: ["design"] });
const C = loadControls({ agent: "panel", segments: ["design"] });
const rows = P.rows;
const months = [...new Set(rows.map((r) => r.month))].sort();
console.log("month | filings | priced | primary(om,valued,priced) | primary&isPrimary | with controls | issuers(primary) | persons(primary)");
for (const m of [...months, "ALL"]) {
  const rs = m === "ALL" ? rows : rows.filter((r) => r.month === m);
  const pr = rs.filter((r) => r.primary === 1);
  console.log(`${m} | ${rs.length} | ${rs.filter((r) => r.priced).length} | ${pr.length} | ${pr.filter((r) => r.isPrimary === 1).length} | ${rs.filter((r) => r.C_n > 0).length} | ${new Set(pr.map((r) => r.cik)).size} | ${new Set(pr.map((r) => r.person)).size}`);
}
const cl = PL.cnt(rows, (r) => r.cls), clp = PL.cnt(rows.filter((r) => r.priced), (r) => r.cls);
console.log("class all", JSON.stringify(cl), "priced", JSON.stringify(clp));
console.log("controls: rows", C.rows.size, "refs", Object.values(C.byEvent).reduce((a, x) => a + x.length, 0), "exclTrunc share", PL.mean([...C.rows.values()].map((c) => c.exclTrunc)));
const pr = rows.filter((r) => r.primary === 1 && r.isPrimary === 1);
const q = (f) => [0.1, 0.5, 0.9].map((p) => PL.r6(PL.quantile(pr.map(f).filter((x) => x != null), p)));
console.log("primary usd p10/50/90", q((r) => r.usd), "pctHold", q((r) => r.pctHold), "lagDays", q((r) => r.lagDays), "pPrior", q((r) => r.pPrior), "histSessions", q((r) => r.histSessions));
console.log("primary roles", JSON.stringify(PL.cnt(pr, (r) => r.primaryRole)), "first-ever (since Dec 1)", PL.cnt(pr, (r) => r.pFirstEver), "repeat co", PL.cnt(pr, (r) => (r.pPriorCo > 0 ? 1 : 0)), "avgDown", JSON.stringify(PL.cnt(pr, (r) => r.avgDown)));
console.log("persons with >=2 primary buys", [...PL.group(pr, (r) => r.person).values()].filter((x) => x.length >= 2).length, ">=3", [...PL.group(pr, (r) => r.person).values()].filter((x) => x.length >= 3).length, ">=5", [...PL.group(pr, (r) => r.person).values()].filter((x) => x.length >= 5).length);
// how many primary events have a person-level matured 30-day track record at decision time
const H = (await import("../history.mjs")).createHistory(rows);
let with1 = 0, with3 = 0; for (const r of pr) { const h = H.historyForEvent(r, { horizon: 30 }).person.matured.n; if (h >= 1) with1++; if (h >= 3) with3++; }
let w5_1 = 0, w5_3 = 0; for (const r of pr) { const h = H.historyForEvent(r, { horizon: 5 }).person.matured.n; if (h >= 1) w5_1++; if (h >= 3) w5_3++; }
console.log(`primary events with >=1 / >=3 matured own 30-day outcomes at t: ${with1} / ${with3}; 5-day: ${w5_1} / ${w5_3} (of ${pr.length})`);
console.log("featOk / featureFields", PL.cnt(rows.filter((r) => r.priced), (r) => r.featOk), P.meta.design.featureFields.length);
