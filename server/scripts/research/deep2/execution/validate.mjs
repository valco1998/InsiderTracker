// server/scripts/research/deep2/execution/validate.mjs — code validation + execution-timing audit.
// Prints MISMATCH COUNTS and timing facts only (no performance summaries), so it can run before results.
//   node scripts/research/deep2/execution/validate.mjs
import fs from "node:fs";
import path from "node:path";
import * as X from "./execLib.mjs";
const { L } = X;

const E = L.loadEvents();
const out = { generatedAt: new Date().toISOString(), events: E.length };
const close = (a, b, tol = 1.5e-4) => a != null && b != null && Math.abs(a - b) <= tol;

// 1. Stage-C reproduction (next open, tier ×1) for N = 2, 3, 5: gross, spy, net, exit date.
const rep = {};
for (const N of [2, 3, 5]) {
  const r = X.evaluate(E, { entry: "nextOpen", exitSessions: N });
  const byId = new Map(r.rows.map((x) => [x.id, x]));
  let both = 0, mis = { exitDate: 0, gross: 0, spy: 0, net: 0, statusOnlyStageC: 0, statusOnlyMine: 0 }; const ex = [];
  for (const e of E) {
    const h = e.h?.[N], m = byId.get(e.id);
    const okC = h?.status === "ok", okM = m?.status === "ok";
    if (okC && !okM) { mis.statusOnlyStageC++; if (ex.length < 5) ex.push({ id: e.id, why: m?.status }); continue; }
    if (!okC && okM) { mis.statusOnlyMine++; continue; }
    if (!okC) continue;
    both++;
    if (h.exitDate !== m.exitDate) mis.exitDate++;
    if (!close(h.gross, m.gross)) mis.gross++;
    if (!close(h.spy, m.spyRet)) mis.spy++;
    if (!close(h.net, m.net)) { mis.net++; if (ex.length < 5) ex.push({ id: e.id, stageC: h.net, mine: m.net }); }
  }
  rep[N] = { compared: both, mismatches: mis, examples: ex };
}
out.stageCReproduction = rep;
// Entry price = daily-bar open on the entry date.
out.entryPriceEqualsBarOpen = E.filter((e) => { const b = X.bar(X.series(X.symOf(e.ticker)), e.entryDate); return !b || Math.abs(b.o - e.entryPrice) > 1e-9; }).length + " mismatches";

// 2. After-hours reproduction vs deep-1 afterHours.json (pre-holdout ids only; holdout rows are dropped before any field is read).
const pre = new Set(E.map((e) => e.id));
const ahRows = JSON.parse(fs.readFileSync(path.join(L.DEEP1, "afterHours.json"), "utf8")).rows.filter((r) => pre.has(r.id));
const evById = new Map(E.map((e) => [e.id, e]));
let ahCmp = 0; const ahMis = { status: 0, captureToOpen: 0, ex1: 0, minutes: 0 };
for (const r of ahRows) {
  const e = evById.get(r.id);
  const o = X.evaluateEvent(e, { ...X.DEFAULTS, entry: "ah", latencyMinutes: 1, exitSessions: "nextOpen", costModel: 0 });
  const c = X.evaluateEvent(e, { ...X.DEFAULTS, entry: "ah", latencyMinutes: 1, exitSessions: "nextClose", costModel: 0 });
  if ((r.status === "ok") !== (o.status === "ok")) { ahMis.status++; continue; }
  if (r.status !== "ok") continue;
  ahCmp++;
  if (!close(r.captureToOpen, o.excess)) ahMis.captureToOpen++;
  if (!close(r.ex1, c.excess)) ahMis.ex1++;
  if (!close(r.minutesAfterAcceptance, o.minutesAfterAcceptance, 2e-3)) ahMis.minutes++;
}
out.ahReproduction = { preHoldoutRows: ahRows.length, compared: ahCmp, mismatches: ahMis, deep1StatusCounts: ahRows.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {}) };

// 3. As-traded price inference (adjFactor from the insider's reported price) vs the true raw/adjusted factor
// where raw dailies exist (after-hours sample symbols).
const { raw } = X.loadAh();
let fChecked = 0, fAgree = 0, fMissSplit = 0, fFalseSplit = 0; const fEx = [];
for (const e of E) {
  const rb = raw.get(X.symOf(e.ticker)); if (!rb) continue;
  const s = X.series(X.symOf(e.ticker)); const b = X.bar(s, e.entryDate), rr = rb.get(e.entryDate);
  if (!b || !rr || !(rr.o > 0)) continue;
  const trueF = b.o / rr.o; // adjusted ÷ raw on the entry date
  const isSplit = trueF > 1.15 || trueF < 0.87;
  const inf = X.adjFactor(e);
  fChecked++;
  if (isSplit === inf.inferred && (!isSplit || Math.abs(Math.log(inf.f / trueF)) < Math.log(1.6))) fAgree++;
  else { if (isSplit && !inf.inferred) fMissSplit++; if (!isSplit && inf.inferred) fFalseSplit++; if (fEx.length < 8) fEx.push({ id: e.id, sym: X.symOf(e.ticker), trueF: X.r4(trueF), inferredF: X.r4(inf.f), ratio: X.r4(inf.ratio) }); }
}
const allInf = E.map((e) => X.adjFactor(e));
out.asTradedInference = { checkedOnRawSymbols: fChecked, agree: fAgree, missedSplit: fMissSplit, falseSplit: fFalseSplit, examples: fEx,
  inferredSplitEvents: allInf.filter((f) => f.inferred).length, inferredReverseSplit: allInf.filter((f) => f.inferred && f.f > 1).length, inferredForwardSplit: allInf.filter((f) => f.inferred && f.f < 1).length };
// Price-level misclassification from split-adjusted prices (look-ahead trap for any "price < $5" rule).
const adjLvl = (e) => e.entryPrice, trueLvl = (e) => e.entryPrice / X.adjFactor(e).f;
out.priceLevelTrap = { adjustedAtLeast5ButAsTradedBelow5: E.filter((e) => adjLvl(e) >= 5 && trueLvl(e) < 5).length, adjustedAtLeast1ButAsTradedBelow1: E.filter((e) => adjLvl(e) >= 1 && trueLvl(e) < 1).length,
  stageCPriceLevelAtLeast5ButAsTradedBelow5: E.filter((e) => e.priceLevel >= 5 && trueLvl(e) < 5).length };

// 4. Timing audit (no outcomes).
const T = {};
const avail = (e) => X.acceptanceMs(e) + 60_000;
T.nextOpenBeforeAvailability = E.filter((e) => X.etMs(e.entryDate, "09:30:00") < avail(e)).length;
T.mocBeforeAvailability = E.filter((e) => { const en = X.entryOf(e, { entry: "sameDayClose" }); return en.status === "ok" && en.entryMs < avail(e); }).length;
T.entryDateNotSession = E.filter((e) => !X.isSession(e.entryDate)).length;
T.entryDateIsPubDayButPubAfterOpen = E.filter((e) => e.entryDate === e.publishedAt.slice(0, 10) && e.publishedAt.slice(11) > "09:29:00").length;
const t = (e) => e.publishedAt.slice(11), sd = (e) => X.isSession(e.publishedAt.slice(0, 10));
T.acceptedBetween0930and0931 = E.filter((e) => sd(e) && t(e) >= "09:30:00" && t(e) < "09:31:00").map((e) => ({ id: e.id, publishedAt: e.publishedAt, entryDate: e.entryDate }));
T.sameDayOpenAfterMooCutoff = E.filter((e) => sd(e) && e.entryDate === e.publishedAt.slice(0, 10) && avail(e) > X.etMs(e.entryDate, "09:28:00")).map((e) => ({ id: e.id, ticker: e.ticker, publishedAt: e.publishedAt,
  triggers: Object.entries(X.TRIGGERS).filter(([, v]) => v.f(e)).map(([k]) => k) }));
T.sameDayOpen0920to0928 = E.filter((e) => sd(e) && e.entryDate === e.publishedAt.slice(0, 10) && t(e) >= "09:20:00" && avail(e) <= X.etMs(e.entryDate, "09:28:00")).length;
T.nonSessionDayPublications = E.filter((e) => !sd(e)).map((e) => ({ publishedAt: e.publishedAt, entryDate: e.entryDate }));
T.earlyCloseEntrySessions = [...new Set(E.filter((e) => X.isEarlyClose(e.entryDate)).map((e) => e.entryDate))].map((d) => ({ date: d, closeTime: X.closeTime(d), entries: E.filter((e) => e.entryDate === d).length }));
T.earlyClosePublications = E.filter((e) => X.isEarlyClose(e.publishedAt.slice(0, 10))).length;
T.calendarDaysPubToEntry = E.reduce((m, e) => { const k = X.daysBetween(e.publishedAt.slice(0, 10), e.entryDate); m[k] = (m[k] || 0) + 1; return m; }, {});
// Bar sanity at fills.
const badBar = { entryZeroVolume: 0, entryOpenOutsideRange: 0, entryStaleOpenEqualsPrevClose_lowVol: 0 };
for (const e of E) {
  const s = X.series(X.symOf(e.ticker)), i = s.idx.get(e.entryDate), b = s.arr[i], p = s.arr[i - 1];
  if (!(b.v > 0)) badBar.entryZeroVolume++;
  if (b.o > b.h * (1 + 1e-9) || b.o < b.l * (1 - 1e-9)) badBar.entryOpenOutsideRange++;
  if (p && b.o === p.c && b.v < 1000) badBar.entryStaleOpenEqualsPrevClose_lowVol++;
}
T.fillBarSanity = badBar;
// After-hours trade timing (pre-holdout sample).
const { trades } = X.loadAh();
let ahBefore = 0, ahAfter20 = 0, ahEarlyClose = 0, ahTrunc = 0;
for (const e of E) {
  const A = trades.get(e.id); if (!A || A.error) continue;
  if (A.truncated) ahTrunc++;
  if (X.isEarlyClose(e.publishedAt.slice(0, 10))) ahEarlyClose++;
  for (const [ms] of A.trades) { if (ms < avail(e)) ahBefore++; if (ms >= A.endMs) ahAfter20++; }
}
T.afterHours = { tradesBeforeAcceptancePlus60s: ahBefore, tradesAtOrAfter20h: ahAfter20, filingsOnEarlyCloseDays: ahEarlyClose, truncatedWindows: ahTrunc };
// Calendar vs SPY bars.
const spyDays = new Set(X.series("SPY").arr.map((b) => b.d)); const mism = [];
for (let d = "2025-10-01"; d <= X.COMPLETE_THROUGH; d = new Date(Date.parse(`${d}T00:00:00Z`) + 864e5).toISOString().slice(0, 10)) if (X.isSession(d) !== spyDays.has(d)) mism.push(d);
T.calendarVsSpyMismatches = mism;
out.timing = T;

// 5. Corrupt bars / extreme moves (stage-A rule over every symbol): |close/prev − 1| > 75%, suspect if reversed > 40% next day.
const extreme = [], suspect = [];
for (const [sym, s] of X.bars()) {
  const a = s.arr;
  for (let i = 1; i < a.length; i++) {
    const p = a[i - 1].c, m = a[i].c / p - 1;
    if (p > 0 && Math.abs(m) > 0.75) { extreme.push({ sym, d: a[i].d, move: X.r4(m) }); const n = a[i + 1]; if (n && Math.abs(n.c / a[i].c - 1) > 0.4) suspect.push({ sym, d: a[i].d }); }
  }
}
out.extremeMoves = { extremeMoves: extreme.length, symbols: new Set(extreme.map((x) => x.sym)).size, suspectReversals: suspect.length, suspectSymbols: new Set(suspect.map((x) => x.sym)).size,
  stageASuspectSymbols: X.SUSPECT_SYMBOLS.size, eventsInStageASuspects: Object.fromEntries(Object.entries(X.TRIGGERS).map(([k, v]) => { const s = E.filter(v.f); return [k, `${s.filter((e) => X.SUSPECT_SYMBOLS.has(X.symOf(e.ticker))).length}/${s.length}`]; })) };
X.writeOut("validation.json", out);
X.writeOut("extreme-moves.json", { rule: "|close/prev close − 1| > 75%; suspect = reversed by > 40% the next session", extreme, suspect });
console.log(JSON.stringify({ stageCReproduction: Object.fromEntries(Object.entries(rep).map(([k, v]) => [k, { compared: v.compared, ...v.mismatches }])), entryPriceEqualsBarOpen: out.entryPriceEqualsBarOpen,
  ahReproduction: out.ahReproduction, asTradedInference: out.asTradedInference, priceLevelTrap: out.priceLevelTrap }, null, 1));
console.log(JSON.stringify({ ...T, acceptedBetween0930and0931: T.acceptedBetween0930and0931.length, nonSessionDayPublications: T.nonSessionDayPublications.length }, null, 1));
console.log(JSON.stringify(out.extremeMoves));
