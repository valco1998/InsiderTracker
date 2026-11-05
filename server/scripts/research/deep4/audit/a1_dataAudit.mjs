// deep4/audit/a1_dataAudit.mjs — Phase A items 1, 3, 4: SEC timestamps / point-in-time entry, classification + amendments,
// corporate actions / suspect bars. Design + confirmation rows only (phase A guard). Independent re-implementation of the
// entry rule from raw stamps and the SPY session list (no panelLib time helpers).
//   node --max-old-space-size=8192 scripts/research/deep4/audit/a1_dataAudit.mjs
import fs from "node:fs";
import path from "node:path";
import { phaseA, L4, loadP, writeOut, checkpoint, mean, median, quantile, r4, r6, group, countBy, fin, isPrimaryPurchase, cstats, toCsv, outPath } from "./common.mjs";
import { OUT_DIR, isSession } from "../../lib.mjs";

phaseA();
const t0 = Date.now();
const P = loadP(["design", "confirm"]);
const rows = P.rows;
const bars = L4.loadBars();
const spy = bars.get("SPY").arr;
const SESS = spy.map((b) => b.d);
const sessSet = new Set(SESS);
const lastBarDay = SESS.at(-1);
// ---------------- 1. timing ----------------
// independent: decision = naive ET stamp + 60 s; entry = that date if it is a session and time <= 09:28:00, else next session
const addSec = (stamp, s) => { const d = new Date(`${stamp.replace(" ", "T")}Z`); d.setUTCSeconds(d.getUTCSeconds() + s); return d.toISOString().slice(0, 19).replace("T", " "); };
const nextSess = (d) => { const i = SESS.findIndex((x) => x > d); return i >= 0 ? SESS[i] : null; };
const timing = { rows: rows.length, entryMismatch: [], decisionMismatch: 0, beyondBars: 0 };
const hours = {};
let after22 = 0, before06 = 0, weekendOrHoliday = 0, holidayEntryOk = 0;
for (const r of rows) {
  const dec = addSec(r.publishedAt, 60), dDate = dec.slice(0, 10), dTime = dec.slice(11);
  if (dec !== r.decisionAt) timing.decisionMismatch++;
  const h = r.publishedAt.slice(11, 13); hours[h] = (hours[h] || 0) + 1;
  if (r.publishedAt.slice(11) >= "22:00:00") after22++;
  if (r.publishedAt.slice(11) < "06:00:00") before06++;
  if (dDate > lastBarDay) { timing.beyondBars++; continue; }
  const entry = sessSet.has(dDate) && dTime <= "09:28:00" ? dDate : nextSess(dDate);
  if (!sessSet.has(dDate)) { weekendOrHoliday++; if (entry === r.entryDate) holidayEntryOk++; }
  if (entry !== r.entryDate) timing.entryMismatch.push({ key: r.key, publishedAt: r.publishedAt, panel: r.entryDate, audit: entry });
}
// app calendar vs SPY bars (holidays / half days)
const calMismatch = []; { let d = SESS[0]; while (d <= lastBarDay) { const a = isSession(d), b = sessSet.has(d); if (a !== b) calMismatch.push({ d, app: a, spyBar: b }); const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); d = x.toISOString().slice(0, 10); } }
// lags (trade date -> decision date, calendar days), business-day lateness
const lag = rows.map((r) => r.lagDays).filter((x) => fin(x) != null);
const prim = rows.filter(isPrimaryPurchase);
const lagP = prim.map((r) => r.lagDays).filter((x) => fin(x) != null);
const bdays = (a, b) => { let n = 0; let d = a; while (d < b) { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); d = x.toISOString().slice(0, 10); const wd = new Date(`${d}T00:00:00Z`).getUTCDay(); if (wd !== 0 && wd !== 6) n++; } return n; };
const late = prim.filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.tradeDate || "") && bdays(r.tradeDate, r.decisionDate) > 2);
// feature/outcome date invariants
const inv = { decDateNotBeforeEntry: 0, tdDecDateNotBeforeTd: 0, tdAfterDecision: rows.filter((r) => r.tdAfterDecision === 1).length, B_end30Wrong: 0, checkedEnd: 0 };
for (const r of rows) {
  if (r.decDate && r.entryDate && !(r.decDate < r.entryDate)) inv.decDateNotBeforeEntry++;
  if (r.td_decDate && r.tradeDate && !(r.td_decDate < r.tradeDate)) inv.tdDecDateNotBeforeTd++;
  if (r.B_status === "ok" && r.B_end30) { inv.checkedEnd++; const lim = new Date(`${r.entryDate}T00:00:00Z`); lim.setUTCDate(lim.getUTCDate() + 30); const L = lim.toISOString().slice(0, 10); const exp = [...SESS].reverse().find((d) => d <= L) ?? null; if (L <= lastBarDay && exp !== r.B_end30) inv.B_end30Wrong++; }
}
// publication windows of primary events and their mean outcomes (descriptive)
const byWin = [...group(prim.filter((r) => fin(r.B_xsNet30) != null), (r) => r.window)].map(([w, xs]) => ({ window: w, n: xs.length, xsNet30: r4(mean(xs.map((r) => r.B_xsNet30))), gapEntry: r4(mean(xs.map((r) => r.gapEntry))) }));
// cross-check publishedAt vs sec-rows acceptedAt (visible rows only)
const secAll = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "deep2", "sec-rows.json"), "utf8"));
const secVis = L4.visible(secAll.rows, (r) => r.acceptedAt, "audit"); secAll.rows = null;
const accOf = new Map(); for (const r of secVis) if (!accOf.has(r.acc)) accOf.set(r.acc, r.acceptedAt);
let accChecked = 0, accMismatch = 0; for (const r of rows) { const a = accOf.get(r.acc); if (!a) continue; accChecked++; if (a !== r.publishedAt) accMismatch++; }
timing.summary = { decisionMismatch: timing.decisionMismatch, entryMismatch: timing.entryMismatch.length, entryMismatchExamples: timing.entryMismatch.slice(0, 10), beyondBars: timing.beyondBars,
  acceptanceHourHistogram: hours, acceptedAfter22ET: after22, acceptedBefore06ET: before06, nonSessionDecisionDays: weekendOrHoliday, nonSessionEntryOk: holidayEntryOk,
  appCalendarVsSpyBars: { mismatches: calMismatch.length, examples: calMismatch.slice(0, 10) }, publishedAtVsSecRowsAcceptedAt: { checked: accChecked, mismatches: accMismatch },
  lagDaysAll: { n: lag.length, median: median(lag), p90: quantile(lag, 0.9), p99: quantile(lag, 0.99), max: Math.max(...lag) },
  lagDaysPrimary: { n: lagP.length, median: median(lagP), p90: quantile(lagP, 0.9), gt2BusinessDays: late.length, share: r4(late.length / prim.length), lateMeanXsNet30: r4(mean(late.map((r) => r.B_xsNet30))), onTimeMeanXsNet30: r4(mean(prim.filter((r) => !late.includes(r)).map((r) => r.B_xsNet30))) },
  invariants: inv, primaryByWindow: byWin };
delete timing.entryMismatch;
console.log("timing", JSON.stringify(timing.summary).slice(0, 1500));

// ---------------- 3. classification + amendments ----------------
const forms = countBy(rows, (r) => r.form);
const formsPrim = countBy(prim, (r) => r.form);
// 4/A rows kept: do they duplicate an earlier kept filing (same person, issuer, trade date)?
const byPIT = group(rows, (r) => `${r.person}|${r.cik}|${r.tradeDate}`);
const amendDup = [];
for (const r of rows.filter((x) => String(x.form).includes("/A"))) {
  const sib = (byPIT.get(`${r.person}|${r.cik}|${r.tradeDate}`) || []).filter((g) => g.key !== r.key && g.publishedAt < r.publishedAt && !String(g.form).includes("/A"));
  if (sib.length) amendDup.push({ key: r.key, form: r.form, publishedAt: r.publishedAt, originalKey: sib[0].key, originalPublishedAt: sib[0].publishedAt, sameEntry: sib[0].entryDate === r.entryDate ? 1 : 0, primary: isPrimaryPurchase(r) ? 1 : 0, shares: r.shares, origShares: sib[0].shares, B_xsNet30: r.B_xsNet30 });
}
const amendDupPrimDiffEntry = amendDup.filter((x) => x.primary && !x.sameEntry);
const amend = { forms, formsPrimary: formsPrim, amendField: countBy(rows, (r) => r.amend), amendFieldPrimary: countBy(prim, (r) => r.amend),
  kept4A: rows.filter((r) => String(r.form).includes("/A")).length, kept4ADuplicatingEarlierOriginal: amendDup.length, ofWhichPrimaryWithOwnEntry: amendDupPrimDiffEntry.length,
  examples: amendDup.slice(0, 8), dupPrimaryMeanXsNet30: r4(mean(amendDupPrimDiffEntry.map((x) => x.B_xsNet30))) };
// classes: priced rows by class v2, outcome B 30d (descriptive; "unknown" is excluded from the primary universe)
const priced = rows.filter((r) => r.priced === 1 && r.isPrimary === 1 && fin(r.B_xsNet30) != null);
const byCls = {};
for (const seg of ["design", "confirm"]) for (const [c, xs] of group(priced.filter((r) => r.segment === seg), (r) => r.cls)) byCls[`${seg}|${c}`] = { n: xs.length, valued: xs.filter((r) => r.valued === 1).length, xsNet30: r4(mean(xs.map((r) => r.B_xsNet30))), ctl30: r4(mean(xs.map((r) => r.C_xsNet30))), diff: r4(mean(xs.filter((r) => fin(r.C_xsNet30) != null).map((r) => r.B_xsNet30 - r.C_xsNet30))) };
const unknownOM = rows.filter((r) => r.cls === "unknown" && r.valued === 1 && r.priced === 1 && r.isPrimary === 1);
const cls = { byClass: byCls, unknownValuedPricedPrimary: unknownOM.length, unknownVenue: countBy(unknownOM, (r) => r.venueStated), unknownRoles: countBy(unknownOM, (r) => r.primaryRole) };
console.log("amend", JSON.stringify(amend).slice(0, 800));
console.log("cls", JSON.stringify(cls).slice(0, 1200));

// ---------------- 4. corporate actions / suspect bars ----------------
const SA = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "deep", "stageA.json"), "utf8"));
const suspect = new Set(SA.prices.suspectSymbols || []);
const adj = { primary: prim.length, adjInferred: prim.filter((r) => r.fut_adjInferred === 1).length, adjNoRatio: prim.filter((r) => r.fut_adjRatio == null).length };
adj.adjInferredRatioHist = countBy(prim.filter((r) => r.fut_adjInferred === 1), (r) => (r.fut_adjRatio < 0.2 ? "<0.2" : r.fut_adjRatio < 0.55 ? "0.2-0.55" : r.fut_adjRatio < 3 ? "1.8-3" : r.fut_adjRatio < 12 ? "3-12" : ">=12"));
adj.adjInferredMeanA30 = r4(mean(prim.filter((r) => r.fut_adjInferred === 1).map((r) => r.A_xs30)));
adj.notInferredMeanA30 = r4(mean(prim.filter((r) => r.fut_adjInferred === 0).map((r) => r.A_xs30)));
// largest single-day |log return| inside [entry, B_end30] (both bars split-adjusted); flags unadjusted splits / bad prints
const flag = [];
for (const r of prim) {
  if (r.B_status !== "ok" || !r.sym || !r.B_end30) continue;
  const s = bars.get(r.sym); if (!s) continue;
  const a = s.arr; let mx = 0, at = null;
  for (let k = 1; k < a.length; k++) { if (a[k].d < r.entryDate) continue; if (a[k].d > r.B_end30) break; if (a[k].c > 0 && a[k - 1].c > 0) { const v = Math.abs(Math.log(a[k].c / a[k - 1].c)); if (v > mx) { mx = v; at = a[k].d; } } }
  // open-to-close inside the entry bar and the overnight move into the entry open
  if (mx > Math.log(2.5)) flag.push({ key: r.key, sym: r.sym, segment: r.segment, maxAbsLogRet: r4(mx), at, suspectSymbol: suspect.has(r.sym) ? 1 : 0, B_xsNet30: r4(r.B_xsNet30) });
}
const primSuspect = prim.filter((r) => suspect.has(r.sym));
const S0 = (xs) => cstats(xs.filter((r) => fin(r.B_xsNet30) != null).map((r) => ({ issuer: r.cik, x: r.B_xsNet30, month: r.month })));
const corp = { ...adj, suspectSymbols: suspect.size, primaryOnSuspectSymbols: primSuspect.length, primaryOnSuspectSymbolsBySeg: countBy(primSuspect, (r) => r.segment),
  extremeDailyMoveInWindow: { n: flag.length, bySeg: countBy(flag, (x) => x.segment), onSuspect: flag.filter((x) => x.suspectSymbol).length, examples: flag.slice(0, 15) },
  effectOnPrimaryMean: Object.fromEntries(["design", "confirm"].map((seg) => { const xs = prim.filter((r) => r.segment === seg); const fk = new Set(flag.map((f) => f.key)); const a = S0(xs), b = S0(xs.filter((r) => !fk.has(r.key) && !suspect.has(r.sym)));
    return [seg, { all: { n: a.n, mean: a.mean, t: a.t, median: a.median }, excludingFlaggedAndSuspect: { n: b.n, mean: b.mean, t: b.t, median: b.median } }]; })) };
console.log("corp", JSON.stringify(corp).slice(0, 1500));
writeOut("a1-data-audit.json", { builtAt: new Date().toISOString(), segments: ["design", "confirm"], timing: timing.summary, amendments: amend, classes: cls, corporateActions: corp, elapsedSec: (Date.now() - t0) / 1000 });
fs.writeFileSync(outPath("a1-extreme-moves.csv"), toCsv(flag));
checkpoint("a1_dataAudit", { elapsedSec: (Date.now() - t0) / 1000 });
console.log("done", ((Date.now() - t0) / 1000).toFixed(1), "s");
