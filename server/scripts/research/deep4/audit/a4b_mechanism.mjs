// deep4/audit/a4b_mechanism.mjs — DESCRIPTIVE (no tests): original panel controls' early (0-20d) and late (20-30d) net excess by the
// distance (sessions) from the control day to its symbol's NEXT visible insider-purchase mark. Design + confirmation only.
//   node --max-old-space-size=8192 scripts/research/deep4/audit/a4b_mechanism.mjs
import fs from "node:fs";
import path from "node:path";
import { phaseA, L4, loadP, loadC, writeOut, mean, r4, fin, group, isPrimaryPurchase } from "./common.mjs";
import * as PL from "../panel/panelLib.mjs";
import { OUT_DIR } from "../../lib.mjs";
phaseA();
const P = loadP(["design", "confirm"]), C = loadC(["design", "confirm"]);
const M = PL.createMarket({ cutoff: null });
const secAll = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "deep2", "sec-rows.json"), "utf8"));
const SEC = L4.visible(secAll.rows, (r) => r.acceptedAt, "audit"); secAll.rows = null;
const cik2sym = new Map(); for (const r of SEC) if (r.ticker && r.cik && !cik2sym.has(r.cik)) cik2sym.set(r.cik, PL.symOf(r.ticker));
const marks = new Map();
for (const r of SEC) { if (r.code !== "P") continue; const s = r.ticker ? PL.symOf(r.ticker) : cik2sym.get(r.cik); if (!s) continue; const m = marks.get(s) || marks.set(s, []).get(s);
  const ad = String(r.acceptedAt || "").slice(0, 10); if (/^\d{4}-\d{2}-\d{2}$/.test(ad)) { const j = M.firstOnOrAfter(ad); m.push(j, j + 1); } if (/^\d{4}-\d{2}-\d{2}$/.test(r.tradeDate || "")) m.push(M.firstOnOrAfter(r.tradeDate)); }
for (const [s, m] of marks) marks.set(s, [...new Set(m)].sort((a, b) => a - b));
const out = {};
for (const seg of ["design", "confirm"]) {
  const E = P.rows.filter((r) => r.segment === seg && isPrimaryPurchase(r) && fin(r.B_xsNet30) != null);
  const seen = new Map(); for (const e of E) for (const c of C.of(e.key)) if (fin(c.B_xsNet30) != null && fin(c.B_xsNet20) != null && !seen.has(c.ctlKey)) seen.set(c.ctlKey, c);
  const rows = [...seen.values()].map((c) => { const j = M.idx.get(c.entryDate); const m = marks.get(c.sym) || []; const nx = m.find((x) => x > j); const pv = [...m].reverse().find((x) => x < j);
    const b = nx == null ? "none visible" : nx - j <= 30 ? "21-30 sessions" : nx - j <= 45 ? "31-45" : nx - j <= 80 ? "46-80" : ">80"; return { b, past: pv != null ? 1 : 0, early: c.B_xsNet20, late: c.B_xsNet30 - c.B_xsNet20, x30: c.B_xsNet30 }; });
  out[seg] = Object.fromEntries([...group(rows, (r) => r.b)].sort().map(([k, xs]) => [k, { n: xs.length, early0to20: r4(mean(xs.map((x) => x.early))), late20to30: r4(mean(xs.map((x) => x.late))), total30: r4(mean(xs.map((x) => x.x30))), shareWithPastMark: r4(mean(xs.map((x) => x.past))) }]));
  out[`${seg}.events`] = { n: E.length, early0to20: r4(mean(E.filter((e) => fin(e.B_xsNet20) != null).map((e) => e.B_xsNet20))), late20to30: r4(mean(E.filter((e) => fin(e.B_xsNet20) != null).map((e) => e.B_xsNet30 - e.B_xsNet20))) };
}
writeOut("a4b-mechanism.json", out);
console.log(JSON.stringify(out, null, 1));
