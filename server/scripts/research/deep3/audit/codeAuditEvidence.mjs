// deep3/audit/codeAuditEvidence.mjs — auditor (agent "audit3"): quantitative evidence for the code and data-join audit of
// scripts/research/deep3/{sequence,targets}. Pre-holdout data only (holdout locked; nothing here reads >= 2026-09-01 outcomes).
//   node --max-old-space-size=12288 scripts/research/deep3/audit/codeAuditEvidence.mjs
// Output: .cache/research/deep3/audit/code-audit-evidence.json  (code-audit.json is written by writeCodeAudit.mjs)
// The app-rule recomputation (I1) is a robustness recomputation of the sequence agent's S1 cells: registered first
// (family audit3-I1) because it produces event-minus-control estimates with p-values.
import fs from "node:fs";
import path from "node:path";
import { L, OUT, SEQ, TGT, DQ, readJson, readSeq, readTgt, writeOut, group, countBy, r4, mean, median, quantile, cm, seqTouch, seqNet, tbucket, BUCKETS, reg, rec, companyStats } from "./common.mjs";

if (process.env.DEEP2_HOLDOUT) throw new Error("run with the holdout locked");
const t0 = Date.now(); const log = (...a) => console.log(`[audit3 evidence ${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const E = {}; // evidence

// ---------------------------------------------------------------- registration (before any computation) -------------
const I1 = [];
for (const p of ["discover", "confirm"]) for (const b of BUCKETS) I1.push({ id: `audit3-I1-appRule-${p}-b${b}-T10W5-ctl`, family: "audit3-I1 identity-rule robustness (app rule)", familySize: 12,
  statement: `Sequence S1/S11 cell recomputed with the data agent's app identity rule (p-filings.json 'person') instead of union-find: calendar-month open-market buyer position ${b}, ${p}: touch +10% within 5 sessions (entry session = 1) minus volMom controls.`,
  rationale: "Issue I1 (dataquality): the identity rule changes buyer counts; check whether the position table changes.", preRegistered: true });
let nReg = 0; for (const h of I1) nReg += reg(h) ? 1 : 0;
log(`registered ${nReg} new audit3-I1 ids`);

// ---------------------------------------------------------------- load ------------------------------------------------
const signals = readSeq("signals.json"), outc = readSeq("outcomes.json"), ctl = readSeq("controls.json"), filings = readSeq("filings.json");
const filingByAcc = new Map(filings.map((f) => [f.acc, f]));
const J = signals.map((s) => ({ ...s, out: outc[s.acc]?.status === "ok" ? outc[s.acc] : null, ctl: ctl[s.acc] || null }));
const calOm = J.filter((s) => s.grouping === "cal" && s.universe === "om");
const sec = await L.loadSecRows();
log(`loaded: signals ${signals.length}, filings ${filings.length}, sec rows ${sec.rows.length}`);

// ---------------------------------------------------------------- A. ties, duplicates in the frozen leads ------------
{
  const ties = calOm.filter((s) => s.tieSize > 1);
  const tieGroups = [...group(ties, (s) => `${s.cik}|${s.T}`).values()].map((xs) => ({ sym: xs[0].sym, T: xs[0].T, period: xs[0].period, tieSize: xs[0].tieSize, positions: xs.map((s) => s.position).sort((a, b) => a - b), priced: xs.filter((s) => s.out).length }));
  const allpTies = J.filter((s) => s.grouping === "cal" && s.universe === "allp" && s.tieSize > 1);
  const allpTieGroups = [...group(allpTies, (s) => `${s.cik}|${s.T}`).values()].map((xs) => ({ sym: xs[0].sym, T: xs[0].T, tieSize: xs[0].tieSize, classes: [...new Set(xs.map((s) => s.cls))].join("+") }));
  // frozen-lead rows (exact copies of leads.mjs selections) and duplicates of the same trade (same issuer, same entry date)
  const RULES = { L1_buyer2: (s) => s.position === 2, L2_fastFollower: (s) => s.position >= 2 && s.daysSinceFirst <= 3, L3_drawdownFollower: (s) => s.position >= 2 && s.out.feat?.dd60 != null && s.out.feat.dd60 <= -0.3 };
  const dup = {};
  for (const [k, f] of Object.entries(RULES)) for (const p of ["discover", "confirm"]) {
    const rows = calOm.filter((s) => s.out && s.period === p && f(s)).filter((s) => s.out.o.x?.[3]).map((s) => ({ s, issuer: s.cik, key: `${s.cik}|${s.out.entryDate}`, x: s.out.o.x[3][0], x2: s.out.o.x[3][1] }));
    const byKey = group(rows, (r) => r.key);
    const dedup = [...byKey.values()].map((xs) => xs.sort((a, b) => a.s.position - b.s.position)[0]);
    const dupGroups = [...byKey.values()].filter((xs) => xs.length > 1).map((xs) => ({ sym: xs[0].s.sym, entryDate: xs[0].s.out.entryDate, rows: xs.length, positions: xs.map((r) => r.s.position).join(","), x1: r4(xs[0].x) })).sort((a, b) => b.rows - a.rows);
    const cs = (rs) => { const c = companyStats(rs.map((r) => ({ issuer: r.issuer, x: r.x }))); return { n: c.n, issuers: c.issuers, mean: c.mean, median: c.median, issuerMedianOfMeans: c.issuerMedianOfMeans, t: c.t, p: c.p == null ? null : r4(c.p), meanExTop5Issuers: c.meanExTop5Issuers, x2mean: r4(mean(rs.map((r) => r.x2))) }; };
    dup[`${k}|${p}`] = { rows: rows.length, distinctTrades: byKey.size, duplicateRows: rows.length - byKey.size, asFrozen: cs(rows), oneRowPerTrade: cs(dedup), largestDuplicateGroups: dupGroups.slice(0, 8) };
  }
  E.ties = { calOmTieSignals: ties.length, calOmTieGroups: tieGroups, calAllpTieSignals: allpTies.length, calAllpTieGroups: allpTieGroups.slice(0, 12), leadsDuplicateTrades: dup };
  log("A ties/duplicates done");
}

// ---------------------------------------------------------------- B. point in time: independent position recomputation (union-find inputs not available → app rule) + I1 -----
{
  const pf = readJson(path.join(DQ, "p-filings.json")).rows; const personOf = new Map(pf.map((r) => [r.acc, r.person]));
  const om = filings.filter((f) => f.cls === "om");
  const nullPerson = om.filter((f) => !personOf.get(f.acc)).length;
  const keyOf = (f) => personOf.get(f.acc) || `acc:${f.acc}`;
  const app = []; // signals under the app rule, same ordering conventions as build.mjs (ties: $ desc, then accession)
  for (const [cik, fs_] of group(om, (f) => f.cik)) {
    const byT = group(fs_, (f) => f.acceptedAt); const times = [...byT.keys()].sort();
    const seen = new Map(); // month -> Set(person)
    for (const T of times) {
      const M = T.slice(0, 7); const set = seen.get(M) || seen.set(M, new Set()).get(M);
      const atT = byT.get(T).sort((a, b) => (b.usd || 0) - (a.usd || 0) || a.acc.localeCompare(b.acc));
      const cR = new Map(); for (const f of atT) { const k = keyOf(f); (cR.get(k) || cR.set(k, []).get(k)).push(f); }
      const usdR = (xs) => xs.reduce((a, f) => a + (f.usd || 0), 0);
      const newR = [...cR.entries()].filter(([k]) => !set.has(k)).sort((a, b) => usdR(b[1]) - usdR(a[1]) || a[1][0].acc.localeCompare(b[1][0].acc));
      const nBefore = set.size;
      newR.forEach(([k, xs], i) => app.push({ cik, T, month: M, acc: xs[0].acc, accs: xs.map((f) => f.acc).join("+"), position: nBefore + i + 1, tieSize: newR.length, person: k, period: T < "2026-06-15" ? "discover" : "confirm" }));
      for (const k of cR.keys()) set.add(k);
    }
  }
  const uf = calOm.map((s) => ({ acc: s.acc, position: s.position, period: s.period }));
  const ufByAcc = new Map(uf.map((s) => [s.acc, s])), appByAcc = new Map(app.map((s) => [s.acc, s]));
  let same = 0, diffPos = 0, onlyUf = 0, onlyApp = 0; const bucketMoves = {};
  for (const s of uf) { const a = appByAcc.get(s.acc); if (!a) { onlyUf++; continue; } if (a.position === s.position) same++; else { diffPos++; const k = `${tbucket(s.position)}->${tbucket(a.position)}`; bucketMoves[k] = (bucketMoves[k] || 0) + 1; } }
  for (const a of app) if (!ufByAcc.has(a.acc)) onlyApp++;
  const monthsUf = group(calOm, (s) => `${s.cik}|${s.month}`), monthsApp = group(app, (s) => `${s.cik}|${s.month}`);
  const ge2 = (m) => [...m.values()].filter((xs) => Math.max(...xs.map((s) => s.position)) >= 2).length;
  // touch table under both rules (same outcomes and controls: per-filing, keyed by the representative accession)
  const table = (rows) => {
    const out = {};
    for (const p of ["discover", "confirm"]) for (const b of BUCKETS) {
      const sel = rows.filter((s) => s.period === p && tbucket(s.position) === b);
      const d = [], ev = [], cv = [], n3 = [];
      for (const s of sel) {
        const o = outc[s.acc]; if (o?.status !== "ok") continue;
        const a = seqTouch(o.o, 0.10, 5), c = ctl[s.acc]?.volMom?.hit?.t10w5; const x3 = seqNet(o.o, 3);
        if (x3 != null) n3.push({ issuer: s.cik, x: x3 });
        if (a == null || c == null) continue; d.push({ issuer: s.cik, x: a - c }); ev.push(a); cv.push(c);
      }
      const c = cm(d), c3 = cm(n3);
      out[`${p}|${b}`] = { n: c.n, issuers: c.issuers, event: r4(mean(ev)), control: r4(mean(cv)), diff: c.mean, ci95: c.ci95, t: c.t, p: c.p, n3: c3.n, n3mean: c3.mean, n3t: c3.t };
    }
    return out;
  };
  const tUf = table(calOm.filter((s) => s.out)), tApp = table(app);
  // record the registered I1 results (app rule)
  for (const p of ["discover", "confirm"]) for (const b of BUCKETS) { const r = tApp[`${p}|${b}`]; rec(`audit3-I1-appRule-${p}-b${b}-T10W5-ctl`, { n: r.n, issuers: r.issuers, event: r.event, control: r.control, estimate: r.diff, ci95: r.ci95, t: r.t, p: r.p, unionFindEstimate: tUf[`${p}|${b}`].diff, unionFindN: tUf[`${p}|${b}`].n, period: p }); }
  E.identity = { appRuleIsHindsight: "p-filings.json 'person' = union-find over the WHOLE store (all dates): later co-reporting merges earlier identities (mild look-ahead); union-find in build.mjs is point in time",
    omFilings: om.length, omFilingsWithoutPerson: nullPerson, signals: { unionFind: uf.length, appRule: app.length, samePosition: same, differentPosition: diffPos, onlyUnionFind: onlyUf, onlyAppRule: onlyApp, bucketMoves },
    issuerMonthsGe2Buyers: { unionFind: ge2(monthsUf), appRule: ge2(monthsApp) },
    positionCounts: { unionFind: countBy(uf.filter((s) => outc[s.acc]?.status === "ok"), (s) => `${s.period}|${tbucket(s.position)}`), appRule: countBy(app.filter((s) => outc[s.acc]?.status === "ok"), (s) => `${s.period}|${tbucket(s.position)}`) },
    touchTable: { unionFind: tUf, appRule: tApp } };
  log("B identity done", JSON.stringify(E.identity.signals));
}

// ---------------------------------------------------------------- C. amendments (A1) ---------------------------------
{
  const P = sec.rows.filter((r) => r.code === "P" && String(r.acceptedAt) < "2026-09-01");
  const formByAcc = new Map(); for (const r of sec.rows) if (r.code === "P" && !formByAcc.has(r.acc)) formByAcc.set(r.acc, r.form);
  const amendByAcc = new Map(); for (const r of P) { const s = amendByAcc.get(r.acc) || amendByAcc.set(r.acc, new Set()).get(r.acc); if (r.amend) s.add(r.amend); }
  // sequence: new-buyer signals whose representative filing is a 4/A (kept: original not in the store or other items)
  const sig4a = calOm.filter((s) => s.out && /A$/.test(formByAcc.get(s.acc) || ""));
  const sig4aDetail = countBy(sig4a, (s) => `${s.period}|${[...(amendByAcc.get(s.acc) || [])].join("+") || "none"}`);
  // targets: stage-C rows (pre-holdout) that are 4/A filings; the 229 hindsight-dropped originals (p-filings.json)
  const pf = readJson(path.join(DQ, "p-filings.json")).rows;
  const dropped = pf.filter((r) => /supersed/i.test(String(r.excludedReason || "")));
  E.amendments = {
    sequence: { rule: "build.mjs:44-52 drops a 4/A whose superseded original (same issuer, owner CIK, trade date) was accepted earlier; the original stays (point in time)", droppedAmendmentRows: readSeq("build-summary.json").rows.droppedAmendments,
      newBuyerSignalsTriggeredBy4A: sig4a.length, byPeriodAndStatus: sig4aDetail, shareOfPricedCalOm: r4(sig4a.length / calOm.filter((s) => s.out).length) },
    targets: { rule: "stage C (lib2.loadEvents) drops filings whose purchase rows were ALL superseded by a later 4/A (hindsight); the 4/A becomes the event at its own (later) acceptance",
      droppedOriginals: dropped.length, droppedByPeriodClass: countBy(dropped, (r) => `${r.period}|${r.cls}`) },
  };
  log("C amendments done");
}

// ---------------------------------------------------------------- D. touch conventions (sequence 1-based vs targets 0-based)
{
  const evs = calOm.filter((s) => s.out && s.out.o.availTouchW >= 10);
  const rate = (p, W) => { const xs = evs.filter((s) => s.period === p).map((s) => { const f = s.out.o.first.t10; return f != null && f <= W ? 1 : 0; }); return { n: xs.length, rate: r4(mean(xs)) }; };
  const ttt = (p) => { const hits = evs.filter((s) => s.period === p && s.out.o.first.t10 != null && s.out.o.first.t10 <= 10).map((s) => s.out.o.first.t10); return { hitters: hits.length, medianSession1Based: median(hits), medianSession0Based: median(hits) - 1 }; };
  E.touchConventions = {
    sequence: "o.first is 1-based (entry session = session 1); 'within W' = sessions 1..W (common.mjs:250, 281); T10W5 = entry day + 4 sessions",
    targets: "ttt is 0-based (entry session = session 0); 'within N' = sessions 0..N (common.mjs:188-190); hit10_5 = entry day + 5 sessions",
    calOmPositionAll_T10: { discover: { sequenceW5: rate("discover", 5), targetsN5_equivalent: rate("discover", 6) }, confirm: { sequenceW5: rate("confirm", 5), targetsN5_equivalent: rate("confirm", 6) } },
    timeToTarget10: { discover: ttt("discover"), confirm: ttt("confirm") },
  };
  log("D conventions done");
}

// ---------------------------------------------------------------- E. control-design sensitivity -----------------------
{
  const seq = {};
  for (const p of ["discover", "confirm"]) for (const b of BUCKETS) for (const set of ["volOnly", "volMom", "volMomGap"]) {
    const d = []; for (const s of calOm) { if (!s.out || s.period !== p || tbucket(s.position) !== b) continue; const a = seqTouch(s.out.o, 0.10, 5), c = s.ctl?.[set]?.hit?.t10w5; if (a == null || c == null) continue; d.push({ issuer: s.cik, x: a - c }); }
    const c = cm(d); seq[`${p}|${b}|${set}`] = { n: c.n, diff: c.mean, ci95: c.ci95 };
  }
  // day-1-only (entry session) excess under each design, all positions
  for (const p of ["discover", "confirm"]) for (const set of ["volOnly", "volMom", "volMomGap"]) for (const W of [1, 2, 5]) {
    const d = []; for (const s of calOm) { if (!s.out || s.period !== p) continue; const a = seqTouch(s.out.o, 0.10, W), c = s.ctl?.[set]?.hit?.[`t10w${W}`]; if (a == null || c == null) continue; d.push({ issuer: s.cik, x: a - c }); }
    const c = cm(d); seq[`${p}|all|${set}|W${W}`] = { n: c.n, diff: c.mean, ci95: c.ci95 };
  }
  const bal = readSeq("controls-balance.json").balance;
  E.controls = { sequenceBalanceSMD: Object.fromEntries(Object.entries(bal).map(([k, v]) => [k, v.smd])), sequenceTouchDiffByDesign: seq };
  log("E1 sequence control sensitivity done");
}

// ---------------------------------------------------------------- F. targets rows: control sensitivity, embargo, limit fill, 4/A -----
{
  const T = readTgt("events.json").rows;
  const bars = L.loadBars(); const spy = bars.get("SPY"); const days = spy.arr.map((b) => b.d);
  const perEnd = (p) => (p === "discover" ? L.DISCOVER_END : L.HOLDOUT_START);
  // embargo: the last session read must be before the period end
  let embViol = 0, embChecked = 0, embViolD = 0;
  for (const r of T) { if (r.o?.last >= 0) { embChecked++; if (days[r.j + r.o.last] >= perEnd(r.per)) embViol++; } if (r.oD?.last >= 0 && days[r.j + 1 + r.oD.last] >= perEnd(r.per)) embViolD++; }
  // control sensitivity (om): hit10_5 and dd10_5 under primary (cm), gap-matched (cg) and volRich (cv)
  const sens = {};
  for (const p of ["discover", "confirm"]) for (const k of ["hit10_5", "hit10_1", "dd10_5", "x5"]) for (const c of ["cm", "cg", "cv"]) {
    const d = []; for (const r of T) { if (r.per !== p || r.cls !== "om") continue; const e = r.o?.[k], cc = r[c]?.[k]; if (e == null || cc == null || !Number.isFinite(e) || !Number.isFinite(cc)) continue; d.push({ issuer: r.issuer, x: e - cc }); }
    const s = cm(d); sens[`${p}|${k}|${c}`] = { n: s.n, diff: s.mean, ci95: s.ci95, t: s.t };
  }
  // limit-fill approximation: sessions where the open gaps through the +10% target (fills at the open for certain) but the code
  // books the -10% stop first because the same session's low breaches the stop (targets common.mjs:166-170)
  const SUS = new Set(readJson(path.join(L.DEEP1, "stageA.json")).prices.suspectSymbols || []);
  let tpChecked = 0, gapThroughAndStop = 0, bothSameSession = 0, gapThroughFills = 0; const gx = [];
  for (const r of T) {
    if (r.cls !== "om" || r.o?.tp10s10n5 == null) continue; tpChecked++;
    const ser = bars.get(r.s); const k0 = r.k; const P0 = r.entryPrice;
    for (let t = 0; t <= 5; t++) {
      const d = days[r.j + t]; const i = ser.idx.get(d); if (i == null) continue; const b = ser.arr[i];
      const o = t === 0 ? P0 : b.o; const hiHit = b.h >= P0 * 1.1 * 1.005, loHit = b.l <= P0 * 0.9;
      if (loHit && hiHit) bothSameSession++;
      if (o >= P0 * 1.1 && loHit) { gapThroughAndStop++; if (gx.length < 6) gx.push({ s: r.s, d, open: o / P0 - 1, low: b.l / P0 - 1 }); }
      if (loHit || hiHit) { if (hiHit && !loHit && o >= P0 * 1.1) gapThroughFills++; break; }
    }
  }
  // 4/A rows in the targets universe
  const formByAcc = new Map(); for (const r of (await L.loadSecRows()).rows) if (r.code === "P" && !formByAcc.has(r.acc)) formByAcc.set(r.acc, r.form);
  const t4a = T.filter((r) => /A$/.test(formByAcc.get(r.acc) || ""));
  const ex4a = {};
  for (const p of ["discover", "confirm"]) for (const k of ["hit10_5", "x5"]) {
    const all = [], ex = [];
    for (const r of T) { if (r.per !== p || r.cls !== "om") continue; const e = r.o?.[k], c = r.cm?.[k]; if (e == null || (k.startsWith("hit") && c == null)) continue; const x = k.startsWith("hit") ? e - c : e; all.push({ issuer: r.issuer, x }); if (!/A$/.test(formByAcc.get(r.acc) || "")) ex.push({ issuer: r.issuer, x }); }
    ex4a[`${p}|${k}`] = { all: cm(all), without4A: cm(ex) };
  }
  E.targets = { rows: T.length, embargo: { checked: embChecked, violations: embViol, delayVariantViolations: embViolD },
    controlSensitivityOm: sens,
    limitFill: { checkedOmTrades: tpChecked, sessionsTargetAndStopBothBreached: bothSameSession, gapThroughTargetButStopBooked: gapThroughAndStop, examples: gx, gapThroughTargetFilledAtOpen: gapThroughFills },
    amendments4A: { rows4A: t4a.length, byPeriodClass: countBy(t4a, (r) => `${r.per}|${r.cls}`), effectOm: ex4a },
    suspectSymbolsInRows: T.filter((r) => SUS.has(r.s)).length };
  log("F targets checks done");
}

// ---------------------------------------------------------------- G. embargo + costs (sequence outcomes) -------------
{
  let checked = 0, viol = 0, costMis = 0, costChecked = 0; const ex = [];
  const pe = (p) => (p === "discover" ? L.DISCOVER_END : L.HOLDOUT_START);
  for (const [acc, o] of Object.entries(outc)) {
    if (o.status !== "ok") continue;
    for (const v of ["o", "od", "oc"]) { const O = o[v]; if (!O) continue; for (const d of Object.values(O.exitDate || {})) { checked++; if (d >= pe(o.period)) { viol++; if (ex.length < 5) ex.push({ acc, v, d, period: o.period }); } } }
    const O = o.o; const c = o.costBps / 1e4;
    for (const N of [1, 3, 5]) { if (!O.x?.[N]) continue; costChecked++; const want = (1 + O.gross[N]) * (1 - c) / (1 + c) - 1 - O.spyR[N]; if (Math.abs(want - O.x[N][0]) > 2e-4) costMis++; }
  }
  E.sequenceEmbargoCosts = { exitDatesChecked: checked, embargoViolations: viol, examples: ex, netRecomputed: costChecked, netMismatches: costMis, stageCValidation: readSeq("validation-stageC.json") };
  log("G embargo/costs done");
}

// ---------------------------------------------------------------- H. partial SEC days / gap flag ---------------------
{
  const inv = readJson(path.join(DQ, "inventory.json"));
  const partial = inv.sec.storeCoverage.partialDays; const unparsed = partial.reduce((a, d) => a + d.listed - d.parsed, 0);
  const listedTotal = 164188, rawPFilings = 11380; const expectedP = unparsed * rawPFilings / listedTotal;
  const SEQ_GAP = ["2025-12-24", "2025-12-26", "2025-12-29", "2025-12-30", "2025-12-31", "2025-12-19", "2026-01-05", "2026-03-10", "2026-03-30", "2026-03-31", "2026-04-16", "2026-04-17", "2026-04-30", "2026-05-05", "2026-05-18"];
  const omitted = partial.map((d) => d.day).filter((d) => !SEQ_GAP.includes(d));
  const ev = calOm.filter((s) => s.out);
  const byMonth = Object.fromEntries([...group(ev, (s) => s.month).entries()].sort().map(([m, xs]) => [m, { n: xs.length, flagged: xs.filter((s) => s.gapDaysInWindow).length, share: r4(xs.filter((s) => s.gapDaysInWindow).length / xs.length) }]));
  // #2 N3 (the sequence agent's caveat): flagged vs clean overall, by period, and within months that contain both
  const n3 = (xs) => cm(xs.map((s) => ({ issuer: s.cik, x: seqNet(s.out.o, 3) })).filter((r) => r.x != null));
  const p2 = ev.filter((s) => s.position === 2);
  const within = []; for (const [m, xs] of group(p2.filter((s) => s.period === "discover"), (s) => s.month)) { const f = xs.filter((s) => s.gapDaysInWindow), c = xs.filter((s) => !s.gapDaysInWindow); if (f.length && c.length) within.push({ month: m, flagged: n3(f), clean: n3(c) }); }
  const monthGroup = (s) => (s.month <= "2026-01" || (s.month >= "2026-03" && s.month <= "2026-05") ? "Dec-Jan,Mar-May" : "Feb,Jun-Aug");
  E.partialDays = { unparsedFilingsAllForms: unparsed, partialDays: partial.length, expectedMissingPurchaseFilings: r4(expectedP), sequenceGapDaysUsed: SEQ_GAP.length, partialDaysOmittedBySequence: omitted,
    missingWholeDays: inv.sec.storeCoverage.missing,
    calOmFlaggedShareByMonth: byMonth,
    pos2N3: { discoverFlagged: n3(p2.filter((s) => s.period === "discover" && s.gapDaysInWindow)), discoverClean: n3(p2.filter((s) => s.period === "discover" && !s.gapDaysInWindow)),
      confirmFlagged: n3(p2.filter((s) => s.period === "confirm" && s.gapDaysInWindow)), confirmClean: n3(p2.filter((s) => s.period === "confirm" && !s.gapDaysInWindow)),
      byMonthGroupDiscover: Object.fromEntries([...group(p2.filter((s) => s.period === "discover"), monthGroup).entries()].map(([k, xs]) => [k, n3(xs)])), withinMonthDiscover: within },
    decemberAfter24: ev.filter((s) => s.month === "2025-12" && s.T >= "2025-12-24").length };
  log("H partial days done");
}

// ---------------------------------------------------------------- I. registry discipline -------------------------------
{
  const rd = (f) => fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const R = rd(path.join(path.dirname(OUT), "registry.jsonl")), S = rd(path.join(path.dirname(OUT), "registry-results.jsonl"));
  const spec = R.filter((r) => r.agent === "sequence" || r.agent === "targets");
  const posthocMarkedPre = spec.filter((r) => r.preRegistered === true && /^sequence-R[123]-/.test(r.id));
  const plannedLater = spec.filter((r) => /^targets-(R|CF|EX)-/.test(r.id));
  const tgtBuilt = readTgt("build-summary.json").builtAt, tgtFirstReg = spec.filter((r) => r.agent === "targets").map((r) => r.registeredAt).sort()[0];
  const seqOutFile = fs.statSync(path.join(SEQ, "outcomes.json")).mtime.toISOString(), seqFirstReg = spec.filter((r) => r.agent === "sequence").map((r) => r.registeredAt).sort()[0];
  E.registry = { specialistIds: spec.length, sequencePostHocFlaggedPreRegisteredTrue: posthocMarkedPre.length, postHocIdsSample: posthocMarkedPre.slice(0, 6).map((r) => r.id),
    targetsRobustnessConfirmExecRegisteredAfterDiscoveryButBeforeComputing: plannedLater.length,
    targetsOutcomeTableBuiltAt: tgtBuilt, targetsFirstRegistration: tgtFirstReg, targetsSecondsOutcomesBeforeRegistration: r4((Date.parse(tgtFirstReg) - Date.parse(tgtBuilt)) / 1000),
    sequenceOutcomesFileMtime: seqOutFile, sequenceFirstRegistration: seqFirstReg };
}

writeOut("code-audit-evidence.json", { generatedAt: new Date().toISOString(), note: "Evidence for code-audit.json; pre-holdout data only, holdout locked.", ...E });
log("written code-audit-evidence.json");
