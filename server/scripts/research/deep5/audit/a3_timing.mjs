// Task 3: timing audit. 30 random Clock-2 and 30 random Clock-1 clusters, checked step by step against raw rows and raw bars.
import fs from "node:fs";
import path from "node:path";
import * as A from "./alib.mjs";
const rows = A.loadRows(); const K = A.market();
const P = rows.filter((r) => r.code === "P");
const { rows: elig } = A.eligibleRows(P, K);
const byCik = A.byKey(elig, (r) => r.cik);
const J = JSON.parse(fs.readFileSync(path.join(A.D5, "clusters.json"), "utf8"));
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const wd = (d) => WD[new Date(d + "T00:00:00Z").getUTCDay()];

// calendar sanity: weekdays missing from SPY bars between 2025-10-01 and 2026-11-03
const missing = []; for (let d = "2025-10-01"; d <= "2026-11-03"; d = A.add(d, 1)) { const w = wd(d); if (w !== "Sat" && w !== "Sun" && !K.isSess(d)) missing.push(d); }
const weekendBars = K.cal.filter((d) => ["Sat", "Sun"].includes(wd(d)));
const EXPECTED_HOLIDAYS = ["2025-11-27", "2025-12-25", "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07"];

const c2 = J.clusters.filter((c) => c.clock === 2 && c.entryStatus === "ok");
const c1 = J.clusters.filter((c) => c.clock === 1 && c.entryStatus === "ok");
const out2 = [];
for (const c of A.sampleK(c2, 30, 20261105)) {
  const iss = byCik.get(c.cik); const D = A.DEFS[c.cat];
  // (1) all purchases accepted <= T and one at T
  const allLe = c.purchases.every((p) => p.acceptedAt <= c.T), oneAt = c.purchases.some((p) => p.acceptedAt === c.T);
  // (2) T is the FIRST stamp at which a window containing a fresh row qualifies (brute force over every earlier stamp, any window end)
  const stamps = [...new Set(iss.map((r) => r.acceptedAt))].filter((s) => s < c.T).sort();
  let earlierQual = null;
  for (const s of stamps) {
    const known = iss.filter((r) => r.acceptedAt <= s); const G = A.owners(known);
    for (const end of [...new Set(known.map((r) => r.tradeDate))]) for (let j = 0; j < D.W; j++) {
      const e = A.add(end, j); const w = known.filter((r) => r.tradeDate <= e && A.dn(r.tradeDate) > A.dn(e) - D.W);
      if (new Set(w.map((r) => G.get(r.id))).size >= D.N && w.reduce((a, r) => a + r.value, 0) > 250000) { earlierQual = earlierQual || s; }
    }
  }
  const prevSameCat = J.clusters.filter((x) => x.clock === 2 && x.cat === c.cat && x.cik === c.cik && x.T < c.T).map((x) => x.T).sort().at(-1) || null;
  const earlierExplained = !earlierQual || (prevSameCat && earlierQual <= c.T && (A.dn(earlierQual) - A.dn(prevSameCat) < 30 || earlierQual <= prevSameCat));
  // (3) decision and entry
  const dec = A.decision(c.T); const sched = K.isSess(dec.date) && dec.time <= "09:28:00" ? dec.date : K.nextSess(dec.date);
  const s = K.S.get(c.ticker); const i = s.ix.get(c.entryDate);
  const later = iss.filter((r) => r.acceptedAt > c.T && c.purchases.some((p) => p.acc === r.acc && p.shares === r.shares));
  out2.push({ id: c.id, ticker: c.ticker, T: c.T, Twd: wd(c.T.slice(0, 10)), TisSession: K.isSess(c.T.slice(0, 10)) ? 1 : 0, decision: `${dec.date} ${dec.time}`, decisionStudy: c.decision, scheduled: sched, scheduledStudy: c.scheduledEntry, entryDate: c.entryDate, entryWd: wd(c.entryDate), delayed: c.entryDelayed,
    openRaw: s.a[i][1], entryStudy: c.entry ?? null, allAcceptedLeT: allLe ? 1 : 0, oneAtT: oneAt ? 1 : 0, earlierQualStamp: earlierQual, prevSameCatT: prevSameCat, earlierExplainedByCooldown: earlierExplained ? 1 : 0, rowsAfterTInCluster: later.length,
    ok: allLe && oneAt && earlierExplained && sched === c.scheduledEntry && `${dec.date} ${dec.time}` === c.decision && (c.entry == null || Math.abs(s.a[i][1] - c.entry) < 1e-9) && c.entryDate >= sched && later.length === 0 ? 1 : 0 });
}
const out1 = [];
for (const c of A.sampleK(c1, 30, 7)) {
  const iss = byCik.get(c.cik); const D = A.DEFS[c.cat]; const G = A.owners(iss);
  // first trade date >= (previous same-cat completion + 30) where window qualifies
  const prev = J.clusters.filter((x) => x.clock === 1 && x.cat === c.cat && x.cik === c.cik && x.completionDate < c.completionDate).map((x) => x.completionDate).sort().at(-1) || null;
  let first = null;
  for (const d of [...new Set(iss.map((r) => r.tradeDate))].sort()) { if (prev && A.dn(d) - A.dn(prev) < 30) continue; if (prev && d <= prev) continue; const w = iss.filter((r) => r.tradeDate <= d && A.dn(r.tradeDate) > A.dn(d) - D.W); if (new Set(w.map((r) => G.get(r.id))).size >= D.N && w.reduce((a, r) => a + r.value, 0) > 250000) { first = d; break; } }
  const s = K.S.get(c.ticker); const j = K.le(s, c.completionDate);
  out1.push({ id: c.id, ticker: c.ticker, completion: c.completionDate, recomputedCompletion: first, wd: wd(c.completionDate), barOnCompletion: s.ix.has(c.completionDate) ? 1 : 0, entryDate: c.entryDate, closeRaw: s.a[j][4], entryStudy: c.entry ?? null,
    ok: first === c.completionDate && c.entryDate === s.D[j] && (c.entry == null || Math.abs(c.entry - s.a[j][4]) < 1e-9) ? 1 : 0 });
}
// population-wide checks
const allC2 = J.clusters.filter((c) => c.clock === 2 && c.entryStatus === "ok");
const pop = {
  c2: allC2.length, c2EntryBeforeDecisionDate: allC2.filter((c) => c.entryDate < c.decision.slice(0, 10)).length,
  c2EntrySameDayAfterCutoff: allC2.filter((c) => c.entryDate === c.decision.slice(0, 10) && c.decision.slice(11) > "09:28:00").length,
  c2Delayed: allC2.filter((c) => c.entryDelayed).length,
  c2DecisionInRegularSession: allC2.filter((c) => K.isSess(c.decision.slice(0, 10)) && c.decision.slice(11) >= "09:30:00" && c.decision.slice(11) < "16:00:00").length,
  c1EntryBarBeforeCompletion: J.clusters.filter((c) => c.clock === 1 && c.entryStatus === "ok" && c.entryDate < c.completionDate).length,
};
const res = { calendar: { weekdaysWithoutSpyBar: missing, expectedHolidays: EXPECTED_HOLIDAYS, unexpected: missing.filter((d) => !EXPECTED_HOLIDAYS.includes(d)), weekendBars }, clock2: { n: out2.length, ok: out2.filter((x) => x.ok).length }, clock1: { n: out1.length, ok: out1.filter((x) => x.ok).length }, population: pop };
A.save("a3_timing.json", res); A.save("a3_clock2_sample.csv", A.csv(out2)); A.save("a3_clock1_sample.csv", A.csv(out1));
console.log(JSON.stringify(res, null, 1)); console.log(out2.filter((x) => !x.ok)); console.log(out1.filter((x) => !x.ok));
