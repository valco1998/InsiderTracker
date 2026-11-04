// deep2/chart/candidates.mjs — candidate rules from the chart agent: register, discovery stats + stress diagnostics,
// freeze (STAGE0 criteria), then ONE confirmation look per frozen candidate (guarded: never recomputed).
//   node scripts/research/deep2/chart/candidates.mjs
//
// C1 and C2 were chosen AFTER seeing tasks 1-3 (the r5 tercile split in chartStructure.mjs), so their discovery
// statistics are selection-biased; confirmation (2026-06-15 .. 2026-08-31, exits < 2026-09-01) is the real test.
import fs from "node:fs";
import path from "node:path";
import { setup, matchAll } from "./mcSetup.mjs";
import { outcomeAt, usable, usableN, companyStats, mean, median, r4, reg, rec, xnetAt, writeOut, toCsv, pct, myResults, bhQ, OUT, DISCOVER_END, HOLDOUT_START } from "./common.mjs";
import { sha256 } from "../lib2.mjs";

const S = await setup();
const CANDS = [
  { id: "chart-C1", cut: -0.0346, venue: "open_market",
    rule: "Form 4 code-P filing whose largest valued row states an open-market purchase (stage-C venue === 'open_market'); r5 = decisionClose / close 5 bars earlier − 1 <= −0.0346 (split-adjusted daily closes, decision bar = last bar strictly before the entry session); BUY at the official open of the first regular session whose 09:30 ET open is >= acceptance + 60 s; SELL at the official close of the 5th session after the entry session. No stop/target. Skip if the entry or exit bar is missing.",
    mechanism: "Insider information plus short-term reversal: a discretionary open-market insider buy into a falling stock (the insider is a contrarian liquidity provider) may be under-weighted by a market that just sold the stock; task 3 found winners fell into the filing, losers had run up." },
  { id: "chart-C2", cut: -0.0293, venue: null,
    rule: "Any priced stage-C purchase filing with r5 <= −0.0293 (bottom discovery tercile for all events); same entry/exit as C1.",
    mechanism: "Same as C1 without the stated-venue requirement (71% of filings do not state the venue)." },
];
const inRule = (c, r) => (!c.venue || r.e.venue === c.venue) && r.r5 != null && r.r5 <= c.cut;
const COST_MULT2 = (r) => { const h = r.e.h[5]; const c = (2 * r.e.costBpsPerSide) / 1e4; return (1 + h.gross) * (1 - c) / (1 + c) - 1 - h.spy; };

// ---------- registration ----------
for (const c of CANDS) reg({ id: `${c.id}-discovery`, family: "chart candidates (discovery)", familySize: CANDS.length,
  statement: `Discovery: rule ${c.id} has mean 5-session net excess vs SPY > 0. Rule: ${c.rule}`, rationale: `${c.mechanism} Selected after tasks 1-3 (data-driven); confirmation is decisive.` });
const DIAG = [
  ["cost2", "costs doubled (2× per-side tier)"], ["delay1", "one-session delay: buy the open of the session after the entry session, sell the close 5 sessions later"],
  ["moc", "enter at the entry session's closing auction instead of its open; sell at the close 5 sessions after the entry session"],
  ["liquid", "only names with 20-session dollar volume >= $1M at the decision close (cost tier <= 35 bps)"],
  ["vsControls", "C1 event x5 minus the mean x5 of its 10 primary matched controls (insider-specific residual)"],
];
for (const [k, d] of DIAG) reg({ id: `chart-C1-diag-${k}`, family: "chart-C1 stress diagnostics (discovery)", familySize: DIAG.length,
  statement: `Discovery, rule chart-C1 under stress '${d}': mean net excess vs SPY > 0.`, rationale: "Executability and attribution checks for C1 (cost, latency, alternative fill, capacity, insider-specific vs generic reversal)." });

// ---------- discovery ----------
const disc = S.ev.filter((r) => r.per === "discover");
const Mdisc = matchAll(S, disc, "primary");
const evRowFor = (r) => ({ issuer: r.e.issuerCik, x: r.e.h[5].excessNet });
function evalRule(c, rows, per, M) {
  const sel = rows.filter((r) => inRule(c, r) && usable(r.e, 5, per));
  const main = companyStats(sel.map(evRowFor));
  const diag = {};
  diag.cost2 = companyStats(sel.map((r) => ({ issuer: r.e.issuerCik, x: COST_MULT2(r) })), { boot: 0 });
  const dl = []; for (const r of sel) { const o = outcomeAt(r.ser, r.k + 1, S.cal, r.e.costBpsPerSide); if (!o || !o.x[5] || !o.exitDates[5] || o.exitDates[5] >= (per === "discover" ? DISCOVER_END : HOLDOUT_START)) continue; dl.push({ issuer: r.e.issuerCik, x: o.x[5].xnet }); }
  diag.delay1 = companyStats(dl, { boot: 0 });
  diag.moc = companyStats(sel.filter((r) => r.o.moc[5]).map((r) => ({ issuer: r.e.issuerCik, x: r.o.moc[5].xnet })), { boot: 0 });
  diag.liquid = companyStats(sel.filter((r) => r.tier <= 35).map(evRowFor), { boot: 0 });
  const vs = []; for (const r of sel) { const cs = (M.get(r.e.id) || []).map((m) => xnetAt(S.bars.get(m.r.s), m.r.k, S.cal, 5, r.e.costBpsPerSide, "open")).filter((v) => v != null); if (cs.length) vs.push({ issuer: r.e.issuerCik, x: r.e.h[5].excessNet - mean(cs), ctl: mean(cs) }); }
  diag.vsControls = { ...companyStats(vs, { boot: 0 }), controlMean: r4(mean(vs.map((v) => v.ctl))) };
  return { sel, main, diag };
}
const results = { generatedAt: new Date().toISOString(), discovery: {}, confirmation: {}, frozen: [] };
const toRecord = [];
const D = {};
for (const c of CANDS) { D[c.id] = evalRule(c, disc, "discover", Mdisc); results.discovery[c.id] = { main: D[c.id].main, diag: c.id === "chart-C1" ? D[c.id].diag : undefined }; toRecord.push([`${c.id}-discovery`, D[c.id].main]); }
for (const [k] of DIAG) toRecord.push([`chart-C1-diag-${k}`, D["chart-C1"].diag[k]]);
for (const [id, res] of toRecord) rec(id, res);
const latest = new Map(); for (const x of myResults()) latest.set(x.id, x.result);
const ids = [...latest.keys()], qs = bhQ(ids.map((k) => latest.get(k)?.p ?? null)); const qOf = new Map(ids.map((k, i) => [k, qs[i]]));
results.bhTests = ids.filter((k) => latest.get(k)?.p != null).length;
for (const c of CANDS) {
  const m = D[c.id].main, q = qOf.get(`${c.id}-discovery`);
  const checks = { bhQ: r4(q), qOk: q < 0.1, nOk: m.n >= 40, issuersOk: m.issuers >= 25, positive: m.mean > 0, exTop5SameSign: m.meanExTop5Issuers > 0 };
  results.discovery[c.id].checks = checks;
  if (Object.values(checks).every((v) => v === true || typeof v === "number")) results.frozen.push(c.id);
}

// ---------- event-level outputs + winners/losers descriptions (discovery) ----------
const pathStr = (r) => { const a = r.ser.arr, i = r.k - 1; const pts = [60, 40, 20, 10, 5, 0].map((n) => (i - n >= 0 ? a[i - n].c : null)); const base = pts[0] || pts.find((x) => x); return pts.map((p) => (p && base ? Math.round((p / base) * 100) : "—")).join("→"); };
const postStr = (r) => { const a = r.ser.arr; const out = []; for (let n = 0; n <= 5; n++) { const b = a[r.k + n]; out.push(b ? Math.round((b.c / r.e.entryPrice - 1) * 1000) / 10 : "—"); } return out.join(","); };
const describe = (r, y) => `${r.e.ticker} ${r.e.entryDate} (${r.e.role}, ${r.e.venue}, $${Math.round(r.e.filingValue / 1000)}k): 60s path ${pathStr(r)} (r60 ${pct(r.r60, 0)}, r20 ${pct(r.r20, 0)}, r5 ${pct(r.r5, 1)}, dd60 ${pct(r.dd60, 0)}, vs SMA50 ${pct(r.sma50r, 0)}), vol spike ${r.volSpike?.toFixed(1)}×, SPY>50d ${r.spyAbove50}, open gap ${pct(r.gapX, 1)}, post-entry closes vs entry % [${postStr(r)}] → x5 net excess ${pct(y, 1)}`;
const wl = (rows) => { const s = [...rows].sort((a, b) => a.e.h[5].excessNet - b.e.h[5].excessNet); return { winners: s.slice(-12).reverse().map((r) => describe(r, r.e.h[5].excessNet)), losers: s.slice(0, 12).map((r) => describe(r, r.e.h[5].excessNet)) }; };
results.discoveryWinnersLosers = { "chart-C1": wl(D["chart-C1"].sel), openMarketAll: wl(disc.filter((r) => r.e.venue === "open_market" && usable(r.e, 5, "discover"))) };
const csvRow = (r, per) => ({ candidate: "chart-C1", period: per, id: r.e.id, ticker: r.e.ticker, issuer: r.e.issuerCik, issuerName: r.e.issuerName, insider: r.e.insider, role: r.e.role, venue: r.e.venue, ownership: r.e.ownership, filingValue: Math.round(r.e.filingValue),
  publishedAt: r.e.publishedAt, decisionDate: r.decDate, decisionClose: r.price, close5Before: r.ser.arr[r.k - 6]?.c, r5: r.r5, r20: r.r20, r60: r.r60, dd60: r.dd60, sma50r: r.sma50r, volSpike: r.volSpike, spyAbove50: r.spyAbove50, tier: r.tier, costBpsPerSide: r.e.costBpsPerSide,
  entryDate: r.e.entryDate, entryPrice: r.e.entryPrice, gapX: r.gapX, exitDate: r.e.h[5].exitDate, exitPrice: r.e.h[5].exitPrice, gross5: r.e.h[5].gross, spy5: r.e.h[5].spy, net5: r.e.h[5].net, excessNet5: r.e.h[5].excessNet, mocExcessNet5: r.o.moc[5]?.xnet ?? null });
const csvCols = Object.keys(csvRow(D["chart-C1"].sel[0], "discover"));

// ---------- confirmation: one look per frozen candidate (guarded) ----------
const frozenFile = path.join(OUT, "frozen-candidates.json");
const already = myResults().filter((x) => /^chart-C\d-confirmation$/.test(x.id)).map((x) => x.id);
let confRows = [];
if (results.frozen.length) {
  if (!fs.existsSync(frozenFile)) {
    const frozen = CANDS.filter((c) => results.frozen.includes(c.id)).map((c) => ({ id: c.id, rule: c.rule, cut: c.cut, venue: c.venue, horizon: 5 }));
    fs.writeFileSync(frozenFile, JSON.stringify({ frozenAt: new Date().toISOString(), sha256: sha256(JSON.stringify(frozen)), frozen }, null, 1));
  }
  const conf = S.ev.filter((r) => r.per === "confirm");
  const Mconf = matchAll(S, conf, "primary");
  for (const id of results.frozen) {
    const c = CANDS.find((x) => x.id === id);
    reg({ id: `${id}-confirmation`, family: "chart candidates (confirmation, one look)", familySize: results.frozen.length,
      statement: `Confirmation (published 2026-06-15..08-31, exits < 09-01): frozen rule ${id} has the same sign as discovery with p < 0.10 and a positive median of issuer means.`, rationale: "Single pre-declared confirmation look of a frozen rule." });
    if (already.includes(`${id}-confirmation`)) { results.confirmation[id] = { note: "already evaluated once; not recomputed", previous: myResults().filter((x) => x.id === `${id}-confirmation`).at(-1).result }; continue; }
    const ev = evalRule(c, conf, "confirm", Mconf);
    const pass = ev.main.mean > 0 && ev.main.p < 0.1 && ev.main.issuerMedianOfMeans > 0;
    results.confirmation[id] = { main: ev.main, diag: ev.diag, pass };
    rec(`${id}-confirmation`, { ...ev.main, pass, diag: ev.diag });
    if (id === "chart-C1") { confRows = ev.sel; results.confirmationWinnersLosers = wl(ev.sel); }
  }
}
writeOut("candidate-results.json", results);
const allRows = [...D["chart-C1"].sel.map((r) => csvRow(r, "discover")), ...confRows.map((r) => csvRow(r, "confirm"))];
writeOut("candidate-C1-events.csv", toCsv(allRows, csvCols));
writeOut("candidate-C2-events.csv", toCsv(D["chart-C2"].sel.map((r) => ({ ...csvRow(r, "discover"), candidate: "chart-C2" })), csvCols));

// console
const L = (s) => `n ${s.n} iss ${s.issuers} mean ${pct(s.mean)} wmean ${pct(s.wmean)} med ${pct(s.median)} pos ${s.positive} issMed ${pct(s.issuerMedianOfMeans)} issPos ${s.issuersPositive} t ${s.t} p ${r4(s.p)} exTop5 ${pct(s.meanExTop5Issuers)} CI ${JSON.stringify(s.ci95)}`;
for (const c of CANDS) { console.log(`\n${c.id} DISCOVERY: ${L(results.discovery[c.id].main)}`); console.log("  checks", JSON.stringify(results.discovery[c.id].checks)); }
console.log("\nC1 diagnostics (discovery):"); for (const [k, s] of Object.entries(D["chart-C1"].diag)) console.log(" ", k.padEnd(10), L(s), s.controlMean != null ? `ctl ${pct(s.controlMean)}` : "");
console.log("\nfrozen:", results.frozen, "BH tests:", results.bhTests);
for (const [id, x] of Object.entries(results.confirmation)) { if (x.main) { console.log(`\n${id} CONFIRMATION: ${L(x.main)} pass=${x.pass}`); for (const [k, s] of Object.entries(x.diag)) console.log(" ", k.padEnd(10), L(s), s.controlMean != null ? `ctl ${pct(s.controlMean)}` : ""); } else console.log(id, x.note); }
console.log("\nC1 discovery winners:"); for (const s of results.discoveryWinnersLosers["chart-C1"].winners) console.log("  +", s);
console.log("C1 discovery losers:"); for (const s of results.discoveryWinnersLosers["chart-C1"].losers) console.log("  -", s);
