// Task 1 (+ base for 4/5): independent cluster reconstruction and comparison with deep5 clusters.json.
//   node --max-old-space-size=6144 scripts/research/deep5/audit/a1_reconstruct.mjs
import fs from "node:fs";
import path from "node:path";
import * as A from "./alib.mjs";

const rows = A.loadRows(); const K = A.market();
const P = rows.filter((r) => r.code === "P");
const { rows: elig, why } = A.eligibleRows(P, K);
const R = A.pipeline(K, elig, { allP: P });
const J = JSON.parse(fs.readFileSync(path.join(A.D5, "clusters.json"), "utf8"));
const theirs = new Map(J.clusters.map((c) => [c.id, c]));
const mine = new Map(R.clusters.map((c) => [c.id, c]));
const counts = {}; for (const clock of [1, 2]) for (const cat of ["A", "B", "C"]) counts[`${clock}${cat}`] = { mine: R.clusters.filter((c) => c.clock === clock && c.cat === cat).length, theirs: J.clusters.filter((c) => c.clock === clock && c.cat === cat).length };
const onlyMine = [...mine.keys()].filter((k) => !theirs.has(k)), onlyTheirs = [...theirs.keys()].filter((k) => !mine.has(k));
// field-level comparison
const close = (a, b, tol = 1e-7) => (a == null && b == null) || (a != null && b != null && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)));
const fieldBad = [];
for (const [id, m] of mine) {
  const t = theirs.get(id); if (!t) continue;
  const chk = [["owners", m.owners, t.owners, 0], ["usd", Math.round(m.usd), t.usd, 0], ["ticker", m.ticker, t.ticker], ["gap", m.gap, t.gap], ["entryStatus", m.entrySt, t.entryStatus], ["entryDate", m.E ?? null, t.entryDate ?? null],
    ["entry", m.o?.entry ?? null, t.entry ?? null, 1e-9], ["maxGain", m.o?.maxGain ?? null, t.maxGain ?? null, 1e-9], ["r180", m.r180 ?? null, t.r180 ?? null, 1e-9], ["n180", m.n180 ?? null, t.n180 ?? null, 1e-9], ["x180", m.x180 ?? null, t.x180 ?? null, 1e-9],
    ["ctrlStatus", m.ctrlSt ?? null, t.ctrlStatus ?? null], ["ctrlSyms", m.ctrl ? m.ctrl.map((x) => x.s).join(" ") : null, t.ctrlSyms ?? null], ["ctl_n180", m.ctl_n180 ?? null, t.ctl_n180 ?? null, 1e-9], ["ctl_maxGain", m.ctl_maxGain ?? null, t.ctl_maxGain ?? null, 1e-9], ["poolSize", m.poolN ?? null, t.poolSize ?? null]];
  for (const [f, a, b, tol] of chk) { const ok = typeof a === "number" || typeof b === "number" ? close(a, b, tol ?? 0) : (a ?? null) === (b ?? null); if (!ok) fieldBad.push({ id, field: f, mine: a, theirs: b }); }
}
// explain set mismatches
const reason = (id, side) => { const c = side === "mine" ? mine.get(id) : theirs.get(id); return { id, side, owners: c.owners, usd: Math.round(c.usd), rows: (c.rows || c.purchases || []).length }; };
const mm = [...onlyMine.map((id) => reason(id, "mine")), ...onlyTheirs.map((id) => reason(id, "theirs"))];
// union + main sample
const mainT = J.unions[2].filter((u) => u.full180 && !u.gap);
const mainM = R.main;
const mainIdsT = new Set(mainT.map((u) => u.repId)), mainIdsM = new Set(mainM.map((u) => u.id));
const res = {
  eligibility: { purchaseRows: P.length, eligible: elig.length, why },
  counts, onlyMine: onlyMine.length, onlyTheirs: onlyTheirs.length, setMismatches: mm,
  fieldMismatchCount: fieldBad.length, fieldMismatchByField: fieldBad.reduce((m, x) => ((m[x.field] = (m[x.field] || 0) + 1), m), {}),
  unions: { mine: { 1: R.unions[1].length, 2: R.unions[2].length }, theirs: { 1: J.unions[1].length, 2: J.unions[2].length } },
  main: { mine: mainM.length, theirs: mainT.length, mineIssuers: new Set(mainM.map((c) => c.cik)).size, onlyMine: [...mainIdsM].filter((x) => !mainIdsT.has(x)), onlyTheirs: [...mainIdsT].filter((x) => !mainIdsM.has(x)) },
  headline: (() => { const ok = mainM.filter((c) => c.ctrlSt === "ok"); return { n: mainM.length, medMaxGain: A.med(mainM.map((c) => c.maxGain)), medDaysToMax: A.med(mainM.map((c) => c.o.daysToMax)), hit: Object.fromEntries(A.TH.map((t) => [t, A.avg(mainM.map((c) => (c.o.hit[t] != null ? 1 : 0)))])), n180MinusCtl: A.avg(ok.map((c) => c.n180 - c.ctl_n180)), x180: A.avg(mainM.map((c) => c.x180)), maxGainMinusCtl: A.avg(ok.map((c) => c.maxGain - c.ctl_maxGain)), hit20MinusCtl: A.avg(ok.map((c) => c.hit20 - c.ctl_hit20)) }; })(),
};
A.save("a1_reconstruct.json", res);
A.save("a1_field_mismatches.csv", A.csv(fieldBad, ["id", "field", "mine", "theirs"]));
A.save("a1_set_mismatches.csv", A.csv(mm));
console.log(JSON.stringify({ ...res, setMismatches: mm.slice(0, 20) }, null, 1));
