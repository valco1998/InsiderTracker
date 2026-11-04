// deep4/behavior/06_profilePerf.mjs — DESCRIPTIVE per-insider performance (design): month-by-month tables per person with
// >= 2 primary purchases, outcome A (insider's hypothetical UNREALISED mark from the reported price) and outcome B (public
// trader, executable: first MOO-eligible open, tier x1 costs, minus SPY) kept in separate columns; plus outcome summaries
// by purchase label and by profile style tag (no tests: family A holds the registered tests).
//   node --max-old-space-size=6144 scripts/research/deep4/behavior/06_profilePerf.mjs
import { loadDesign, isPrimaryPurchase, readJson, writeJson, writeCsv, checkpoint, group, mean, median, r4, r6, fin, stats } from "./common.mjs";
import { STYLE_RULES_FILE, labelsOf, ALL_LABELS } from "./styles.mjs";

const th = readJson(STYLE_RULES_FILE).thresholds;
const prof = readJson("profiles.json");
const { rows } = loadDesign();
const prim = rows.filter(isPrimaryPurchase);
for (const e of prim) e.L = labelsOf(e, th);
const byPerson = group(prim, (r) => r.person);
const m6 = (xs) => r6(mean(xs.filter((x) => fin(x) != null)));
const nn = (xs) => xs.filter((x) => fin(x) != null).length;
const cell = (rs) => ({ nPurchases: rs.length, issuers: new Set(rs.map((r) => r.cik)).size, usd: Math.round(rs.reduce((a, r) => a + (r.usd || 0), 0)),
  A_n5: nn(rs.map((r) => r.A_xs5)), A_xs5: m6(rs.map((r) => r.A_xs5)), A_n30: nn(rs.map((r) => r.A_xs30)), A_xs30: m6(rs.map((r) => r.A_xs30)), A_hit10_30: m6(rs.map((r) => r.A_hit10_30)),
  B_n5: nn(rs.map((r) => r.B_xsNet5)), B_xsNet5: m6(rs.map((r) => r.B_xsNet5)), B_n30: nn(rs.map((r) => r.B_xsNet30)), B_xsNet30: m6(rs.map((r) => r.B_xsNet30)), B_xsNet2x30: m6(rs.map((r) => r.B_xsNet2x30)),
  B_hit10_30: m6(rs.map((r) => r.B_hit10_30)), B_gapEntry: m6(rs.map((r) => r.gapEntry)), C_xsNet30: m6(rs.map((r) => r.C_xsNet30)) });
const monthRows = [], personRows = [];
const tagOf = new Map(prof.profiles.map((p) => [p.person, p]));
for (const [person, rs] of byPerson) {
  if (rs.length < 2) continue;
  const p = tagOf.get(person);
  for (const [m, ms] of [...group(rs, (r) => r.month).entries()].sort()) monthRows.push({ person, ownerName: rs[0].ownerName, tickers: [...new Set(ms.map((r) => r.sym))].join("|"), month: m, ...cell(ms) });
  personRows.push({ person, ownerName: rs[0].ownerName, tickers: [...new Set(rs.map((r) => r.sym))].join("|"), roles: [...new Set(rs.map((r) => r.primaryRole))].join("|"), nEpisodes: p?.nEpisodes, styleTags: (p?.styleTags || []).join("|"), confidence: p?.confidence, months: new Set(rs.map((r) => r.month)).size, ...cell(rs) });
}
personRows.sort((a, b) => b.nPurchases - a.nPurchases);
writeCsv("insider-month-perf.csv", monthRows);
writeCsv("insider-perf.csv", personRows);
// by current-purchase label (purchase level) and by profile tag (persons with >= 2 purchases)
const byLabel = {};
for (const L of ALL_LABELS) for (const v of [1, 0]) { const rs = prim.filter((e) => e.L[L] === v); const s30 = stats(rs, { value: (e) => fin(e.B_xsNet30) }); byLabel[`${L}=${v}`] = { n: rs.length, B30: { n: s30.n, mean: s30.mean, median: s30.median, t: s30.t }, B5: m6(rs.map((r) => r.B_xsNet5)), A30: m6(rs.map((r) => r.A_xs30)), A5: m6(rs.map((r) => r.A_xs5)), ctl30: m6(rs.map((r) => r.C_xsNet30)), gapEntry: m6(rs.map((r) => r.gapEntry)) }; }
const byTag = {};
const tagged = prof.profiles.filter((p) => p.nPurchases >= 2);
const tags = [...new Set(tagged.flatMap((p) => p.styleTags))];
for (const t of [...tags, "(none)"]) {
  const persons = new Set(tagged.filter((p) => (t === "(none)" ? p.styleTags.filter((x) => x !== "MULTI_COMPANY").length === 0 : p.styleTags.includes(t))).map((p) => p.person));
  const rs = prim.filter((e) => persons.has(e.person));
  const s30 = stats(rs, { value: (e) => fin(e.B_xsNet30) });
  byTag[t] = { persons: persons.size, purchases: rs.length, B30: { n: s30.n, issuers: s30.issuers, mean: s30.mean, median: s30.median, t: s30.t }, A30: m6(rs.map((r) => r.A_xs30)), A5: m6(rs.map((r) => r.A_xs5)), ctl30: m6(rs.map((r) => r.C_xsNet30)),
    note: "IN-SAMPLE: tags use the person's whole design history, so these rows are descriptive, not point-in-time selection rules (family A holds the point-in-time tests)" };
}
// purchase rank within person (1st, 2nd, 3rd+) — descriptive
const byRank = {};
for (const rs of byPerson.values()) rs.forEach((e, i) => { e.rank = i === 0 ? "1st" : i === 1 ? "2nd" : i < 5 ? "3rd-5th" : "6th+"; });
for (const k of ["1st", "2nd", "3rd-5th", "6th+"]) { const rs = prim.filter((e) => e.rank === k); const s = stats(rs, { value: (e) => fin(e.B_xsNet30) }); byRank[k] = { n: rs.length, B30: { n: s.n, mean: s.mean, median: s.median, t: s.t }, B5: m6(rs.map((r) => r.B_xsNet5)), A30: m6(rs.map((r) => r.A_xs30)), A5: m6(rs.map((r) => r.A_xs5)), ctl30: m6(rs.map((r) => r.C_xsNet30)), gapEntry: m6(rs.map((r) => r.gapEntry)) }; }
const out = { builtAt: new Date().toISOString(), note: "DESCRIPTIVE ONLY (design). Outcome A = insider's hypothetical unrealised mark from the reported price; outcome B = public trader, executable, net of tier x1 costs minus SPY. Not point-in-time selections.", byLabel, byTag, byRank,
  files: { monthTable: "insider-month-perf.csv", personTable: "insider-perf.csv" }, counts: { personsGe2: personRows.length, personMonths: monthRows.length } };
writeJson("profile-perf.json", out);
checkpoint("06_profilePerf", out.counts);
const f = (x) => (x == null ? "  —  " : (x * 100).toFixed(2).padStart(6));
console.log("label        n    B30n  B30mean B30med  t     B5     A30    A5    ctl30  gapEntry");
for (const [k, v] of Object.entries(byLabel)) console.log(`${k.padEnd(11)} ${String(v.n).padStart(5)} ${String(v.B30.n).padStart(5)} ${f(v.B30.mean)} ${f(v.B30.median)} ${String(v.B30.t).padStart(5)} ${f(v.B5)} ${f(v.A30)} ${f(v.A5)} ${f(v.ctl30)} ${f(v.gapEntry)}`);
console.log("tag          persons purch B30n B30mean B30med t   A30   A5   ctl30");
for (const [k, v] of Object.entries(byTag)) console.log(`${k.padEnd(13)} ${String(v.persons).padStart(5)} ${String(v.purchases).padStart(5)} ${String(v.B30.n).padStart(5)} ${f(v.B30.mean)} ${f(v.B30.median)} ${String(v.B30.t).padStart(5)} ${f(v.A30)} ${f(v.A5)} ${f(v.ctl30)}`);
console.log("rank", JSON.stringify(byRank));
console.log("top persons:"); for (const p of personRows.slice(0, 12)) console.log(JSON.stringify({ person: p.person, name: p.ownerName, tickers: p.tickers, n: p.nPurchases, tags: p.styleTags, A30: p.A_xs30, B30: p.B_xsNet30, B5: p.B_xsNet5, months: p.months }));
