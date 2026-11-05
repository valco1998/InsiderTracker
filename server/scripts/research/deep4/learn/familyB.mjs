// deep4/learn/familyB.mjs — family B (insider purchase + technical confirmation) on a segment: every rule on universe events
// and the identical rule on their matched controls. Registered tests learn.famB.* (design) are recorded with --record.
//   node --max-old-space-size=8192 scripts/research/deep4/learn/familyB.mjs [--segment=design] [--record]
import fs from "node:fs";
import { loadEvents, loadCtl, inUniverse, readOut, writeOut, outPath, record, recordedIds, checkpoint, toCsv, mean, median, L4 } from "./common.mjs";
import * as SL from "../panel/strategyLib.mjs";
import { decide, ruleTrade } from "./famBLib.mjs";

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split("=")[1] : d; };
const SEGMENT = arg("segment", "design"), DO_RECORD = process.argv.includes("--record");
if (SEGMENT === "confirm" && !fs.existsSync(L4.agentFrozenFile("learn"))) throw new Error("confirm needs learn/frozen.json first");
const spec = readOut("spec.json");
const G80 = spec.familyB.G80;
const segs = SEGMENT === "design" ? ["design"] : ["design", "confirm"];
const P = loadEvents({ segments: segs }), C = loadCtl({ segments: segs });
const U = P.rows.filter((r) => inUniverse(r) && r.segment === SEGMENT);
const M = SL.marketFor(SEGMENT === "design" ? L4.DESIGN_END : null);
const RULES = ["B0", ...spec.familyB.rules.map((r) => r.id)];
const DAYS = [30, 10];

const evRows = [], summary = {};
for (const rule of RULES) {
  const per = [];
  let ctlPassN = 0, ctlN = 0;
  for (const r of U) {
    const d = decide(M, rule, r.sym, r.entryDate, G80);
    const o = { rule, key: r.key, issuer: r.cik, sym: r.sym, month: r.month, entryDate: r.entryDate, pass: d.pass ? 1 : 0, why: d.why ?? null, ruleEntryDate: d.pass ? M.days[d.entryJ] ?? null : null, entryWhen: d.entryWhen ?? null };
    for (const D of DAYS) { const t = ruleTrade(M, r.sym, d, D, r.costBps); o[`xs${D}`] = t.status === "ok" ? t.xsNet : null; o[`net${D}`] = t.status === "ok" ? t.net : null; o[`st${D}`] = t.status; }
    // the identical rule on this event's matched controls
    const cs = C.of(r.key);
    const cx = { 30: [], 10: [] };
    for (const c of cs) {
      ctlN++;
      const dc = decide(M, rule, c.sym, c.entryDate, G80);
      if (dc.pass) ctlPassN++;
      for (const D of DAYS) { const t = ruleTrade(M, c.sym, dc, D, c.costBps); if (t.status === "ok") cx[D].push(t.xsNet); }
    }
    o.ctlN = cs.length; o.ctl30n = cx[30].length; o.ctl10n = cx[10].length;
    o.ctl30 = cx[30].length ? mean(cx[30]) : null; o.ctl10 = cx[10].length ? mean(cx[10]) : null;
    o.d30 = o.xs30 != null && o.ctl30 != null ? o.xs30 - o.ctl30 : null; o.d10 = o.xs10 != null && o.ctl10 != null ? o.xs10 - o.ctl10 : null;
    per.push(o); evRows.push(o);
  }
  const ev30 = per.filter((o) => o.xs30 != null), ev10 = per.filter((o) => o.xs10 != null);
  const d30 = per.filter((o) => o.d30 != null), d10 = per.filter((o) => o.d10 != null);
  const cs = (xs, f) => L4.companyStats(xs.map((o) => ({ issuer: o.issuer, x: f(o) })));
  summary[rule] = {
    events: U.length, pass: per.filter((o) => o.pass).length, passRate: per.filter((o) => o.pass).length / U.length, controlPassRate: ctlN ? ctlPassN / ctlN : null,
    ev30: cs(ev30, (o) => o.xs30), ev10: cs(ev10, (o) => o.xs10), absNet30: { mean: mean(ev30.map((o) => o.net30)), median: median(ev30.map((o) => o.net30)) },
    ctl30Mean: mean(d30.map((o) => o.ctl30)), ctl10Mean: mean(d10.map((o) => o.ctl10)),
    evc30: cs(d30, (o) => o.d30), evc10: cs(d10, (o) => o.d10),
    months30: [...new Set(ev30.map((o) => o.month))].sort().map((m) => { const xs = d30.filter((o) => o.month === m); const es = ev30.filter((o) => o.month === m); return { month: m, n: es.length, ev: mean(es.map((o) => o.xs30)), nd: xs.length, d: xs.length ? mean(xs.map((o) => o.d30)) : null }; }),
  };
}
// reproduction check: rule B0 (plain entry) must equal the panel's stored B_xsNet30 / B_xsNet10 for every event
const byKey = new Map(U.map((r) => [r.key, r]));
const repro = { compared: 0, mismatches: 0 };
for (const o of evRows.filter((x) => x.rule === "B0")) for (const D of DAYS) { const v = byKey.get(o.key)[`B_xsNet${D}`]; if (v == null && o[`xs${D}`] == null) continue; repro.compared++; if (v == null || o[`xs${D}`] == null || Math.abs(v - o[`xs${D}`]) > 2e-6) repro.mismatches++; }
console.log("B0 reproduction of B_xsNet30/10:", JSON.stringify(repro));
if (repro.mismatches) { if (SEGMENT === "design") throw new Error("B0 does not reproduce the panel outcomes"); console.warn("WARNING: B0 reproduction mismatches on", SEGMENT, repro); }
// registered tests (design only)
const already = recordedIds(), tests = [];
if (SEGMENT === "design") {
  for (const r of spec.familyB.rules) {
    const S = summary[r.id];
    for (const [suffix, st] of [["ev30", S.ev30], ["evc30", S.evc30], ["evc10", S.evc10]]) {
      const id = `learn.famB.${r.id}.${suffix}`;
      const res = { segment: SEGMENT, estimate: st.mean, t: st.t, p: st.p, n: st.n, issuers: st.issuers, median: st.median, meanExTop5Issuers: st.meanExTop5Issuers, ci95: st.ci95 };
      tests.push({ id, ...res });
      if (DO_RECORD && !already.has(id)) record(id, res);
    }
  }
}
writeOut(`famB-${SEGMENT}.json`, { segment: SEGMENT, G80, reproduction: repro, summary, tests });
fs.writeFileSync(outPath(`famB-${SEGMENT}-events.csv`), toCsv(evRows, Object.keys(evRows[0])));
checkpoint(`familyB-${SEGMENT}`, { rules: RULES, recorded: DO_RECORD });
const pc = (x) => (x == null ? "  -  " : (x * 100).toFixed(2).padStart(6));
for (const rule of RULES) {
  const S = summary[rule];
  console.log(`${rule} pass ${S.pass}/${S.events} (${(S.passRate * 100).toFixed(1)}%; controls ${(S.controlPassRate * 100).toFixed(1)}%) | ev30 n${S.ev30.n} ${pc(S.ev30.mean)} med ${pc(S.ev30.median)} t ${S.ev30.t} exTop5 ${pc(S.ev30.meanExTop5Issuers)} | ctl30 ${pc(S.ctl30Mean)} | evc30 n${S.evc30.n} ${pc(S.evc30.mean)} t ${S.evc30.t} p ${S.evc30.p?.toFixed(3)} | ev10 ${pc(S.ev10.mean)} evc10 ${pc(S.evc10.mean)} t ${S.evc10.t} p ${S.evc10.p?.toFixed(3)}`);
  console.log("     months30: " + S.months30.map((m) => `${m.month.slice(5)} n${m.n} ev ${pc(m.ev)} d ${pc(m.d)}`).join(" | "));
}
