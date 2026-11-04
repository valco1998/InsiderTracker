// deep3/audit/exposed/run.mjs — auditor (agent "audit3"): THE SINGLE evaluation of the five frozen deep-3 leads on the
// PREVIOUSLY EXPOSED Sep–Nov period (published 2026-09-01 → 2026-11-02, completed exits only).
// LABEL: "previously exposed period, not an independent holdout" (seen in aggregate by deep 1 and by the deep-2 frozen rules).
//
//   node --max-old-space-size=16384 scripts/research/deep3/audit/exposed/run.mjs --dry
//        holdout LOCKED; the same code path on the CONFIRMATION period; proves that the copies reproduce the specialists'
//        outputs exactly; writes only .cache/research/deep3/audit/exposed/dry/
//   DEEP2_HOLDOUT=1 AUDIT3_EXPOSED=1 node --max-old-space-size=16384 scripts/research/deep3/audit/exposed/run.mjs
//        the ONE real run (refuses to run twice; refuses unless code-audit.json, power.json, multiple-testing.json exist)
//
// The copies in ./seq, ./tgt, ./beh differ from the originals ONLY in import depth, output folder, a private registry
// file, and the period switch (see .cache/research/deep3/audit/exposed-diff.txt). The frozen pattern definitions are
// imported from the original, hash-verified targets/defs.mjs; the frozen sequence RULES are in the copied leads.mjs
// (identical text, see the diff).
//
// ======================= PASS CRITERIA (written before the run; from frozen-rules.json "evaluation") =====================
// For each lead, on its frozen executable metric = per-event net excess return vs SPY at tier cost x1:
//   (1) mean > 0; (2) issuer-clustered p < 0.10; (3) median of issuer means > 0; (4) mean excluding the top-5 issuers > 0;
//   (5) mean > 0 at cost x2.
//   S-L1/S-L2/S-L3: MOO (first open >= acceptance + 60 s) -> MOC close of the 3rd session after entry; statistics exactly as
//     sequence/leads.mjs metrics() (every signal row, as frozen). Diagnostic only: one row per (issuer, entry date).
//   T-othersPlanOnly: BOTH frozen exits must pass: (a) limit-fill approximation +10% / stop -10% / else close of session 5
//     (worst-case ordering, 0.5% buffer, suspect symbols excluded, as targets/exec.mjs tpApprox); (b) plain close of
//     session 5 via execLib (MOO cut-off 09:28, requireVolume, excludeSuspects, tier).
//   T-C5_clu_low60: close of session 5 via execLib (same options).
// Verdict per lead: "survived the previously exposed period (not independent)" only if all five hold; else "failed".
// Also reported (not part of the criteria): n, issuers, median, CI, profit factor, worst trade, 20-slot portfolio,
// +10%-within-5 touch vs matched controls, and the buyer-position +10% touch table (positions 1–5, 6+), descriptively.
// ===========================================================================================================================
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DRY = process.argv.includes("--dry");
const EXPOSED = process.env.AUDIT3_EXPOSED === "1";
if (DRY) { if (process.env.DEEP2_HOLDOUT || EXPOSED) throw new Error("--dry must run with the holdout locked and AUDIT3_EXPOSED unset"); }
else if (process.env.DEEP2_HOLDOUT !== "1" || !EXPOSED) throw new Error("the real run needs DEEP2_HOLDOUT=1 AUDIT3_EXPOSED=1 for this process only");
const TARGET = DRY ? "confirm" : "holdout";
const PASS = { meanPositive: (s) => s.n > 0 && s.mean > 0, pBelow10: (s) => s.p != null && s.p < 0.1, issuerMedianPositive: (s) => s.issuerMedianOfMeans > 0, exTop5Positive: (s) => s.meanExTop5Issuers > 0, costX2Positive: (s, x2) => x2 != null && x2 > 0 };

const SERVER = process.cwd();
if (!fs.existsSync(path.join(SERVER, "scripts", "research", "deep3"))) throw new Error("run from server/");
const D3 = path.join(SERVER, ".cache", "research", "deep3"), AUD = path.join(D3, "audit"), XO = path.join(AUD, "exposed", DRY ? "dry" : "run");
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const readJ = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const t0 = Date.now(); const log = (...a) => console.log(`[audit3 exposed ${DRY ? "DRY" : "RUN"} ${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);

// ---------------------------------------------------------------- 1. integrity guards ----------------------------------
const FROZEN = path.join(D3, "frozen-rules.json"); const FSHA = "3ca2c3c4f4d99eac406e46b3efcfb2ebf5cbd501bde5971aa9803e05b6f72d21";
if (sha(FROZEN) !== FSHA) throw new Error("frozen-rules.json hash mismatch — abort");
const frozen = readJ(FROZEN);
const fileOf = { "sequence/frozen-leads.json": path.join(D3, "sequence", "frozen-leads.json"), "targets/protocol.json": path.join(D3, "targets", "protocol.json"), "scripts/targets/defs.mjs": path.join(SERVER, "scripts/research/deep3/targets/defs.mjs"), "scripts/sequence/leads.mjs": path.join(SERVER, "scripts/research/deep3/sequence/leads.mjs") };
for (const [k, h] of Object.entries(frozen.fileHashes)) if (sha(fileOf[k]) !== h) throw new Error(`inner hash mismatch: ${k}`);
for (const f of ["code-audit.json", "power.json", "multiple-testing.json"]) if (!fs.existsSync(path.join(AUD, f))) throw new Error(`steps 1-3 must be saved first (${f} missing)`);
const LOCK = path.join(XO, "STARTED.lock");
if (!DRY) {
  if (fs.existsSync(path.join(AUD, "exposed-period.json")) || fs.existsSync(path.join(AUD, "exposed-period-events.csv")) || fs.existsSync(LOCK)) throw new Error("the exposed period was already evaluated (or a run started) — refusing to run again");
  fs.mkdirSync(XO, { recursive: true }); fs.writeFileSync(LOCK, new Date().toISOString());
}
log(`frozen hashes verified; target period = ${TARGET}`);

// ---------------------------------------------------------------- 2. registration (real run, before computing) ------------
const A = await import("../common.mjs");
const LEADS = ["S-L1_buyer2", "S-L2_fastFollower", "S-L3_drawdownFollower", "T-othersPlanOnly", "T-C5_clu_low60"];
if (!DRY) {
  const famL = "audit3-X frozen deep-3 leads on the previously exposed Sep-Nov period (single evaluation)", famT = "audit3-X touch vs controls of the frozen leads (exposed period, diagnostic)", famP = "audit3-X buyer-position +10% touch table (exposed period, descriptive)";
  const H = [
    ...["L1_buyer2", "L2_fastFollower", "L3_drawdownFollower"].map((k) => ({ id: `audit3-X-S-${k}-N3`, family: famL, familySize: 6, statement: `Previously exposed period (published 2026-09-01..2026-11-02, completed exits): frozen lead S-${k}, MOO -> MOC N3 net excess vs SPY (tier x1) passes the five pre-written criteria.`, rationale: "Single evaluation of the frozen lead (frozen-rules.json sha256 3ca2c3c4...)." })),
    { id: "audit3-X-T-othersPlanOnly-tpApprox", family: famL, familySize: 6, statement: "Previously exposed period: frozen lead T-othersPlanOnly, limit-fill approximation (+10% / -10% / close of session 5, worst case) net excess vs SPY passes the five criteria.", rationale: "Single evaluation of the frozen lead." },
    { id: "audit3-X-T-othersPlanOnly-x5", family: famL, familySize: 6, statement: "Previously exposed period: frozen lead T-othersPlanOnly, execLib close of session 5 net excess vs SPY passes the five criteria.", rationale: "Single evaluation of the frozen lead." },
    { id: "audit3-X-T-C5_clu_low60-x5", family: famL, familySize: 6, statement: "Previously exposed period: frozen lead T-C5_clu_low60, execLib close of session 5 net excess vs SPY passes the five criteria.", rationale: "Single evaluation of the frozen lead." },
    ...["L1_buyer2", "L2_fastFollower", "L3_drawdownFollower"].map((k) => ({ id: `audit3-X-S-${k}-T10W5ctl`, family: famT, familySize: 5, statement: `Previously exposed period, lead S-${k}: touch +10% within 5 sessions (entry = session 1) minus volMom controls.`, rationale: "Touch diagnostic of the frozen lead (not a P&L)." })),
    { id: "audit3-X-T-othersPlanOnly-hit10_5ctl", family: famT, familySize: 5, statement: "Previously exposed period, T-othersPlanOnly: touch +10% within sessions 0..5 minus primary controls.", rationale: "Touch diagnostic (not a P&L)." },
    { id: "audit3-X-T-C5_clu_low60-hit10_5ctl", family: famT, familySize: 5, statement: "Previously exposed period, T-C5: touch +10% within sessions 0..5 minus within-pattern (nearLow60) controls.", rationale: "Touch diagnostic (not a P&L)." },
    ...["1", "2", "3", "4", "5", "6+"].map((b) => ({ id: `audit3-X-POS-b${b}-T10W5ctl`, family: famP, familySize: 6, statement: `DESCRIPTIVE. Previously exposed period, calendar-month open-market buyer position ${b}: touch +10% within 5 sessions minus volMom controls.`, rationale: "The user's central question on the exposed period, descriptively." })),
  ];
  let n = 0; for (const h of H) n += A.reg({ ...h, preRegistered: true }) ? 1 : 0;
  log(`registered ${n} audit3-X ids before computing`);
}

// ---------------------------------------------------------------- 3. run the copies (period switch only) ---------------
await import("./beh/features.mjs"); log("beh/features done");
await import("./seq/build.mjs"); log("seq/build done");
await import("./seq/outcomes.mjs"); log("seq/outcomes done");
const SL = await import("./seq/leads.mjs"); log("seq/leads done");
await import("./tgt/build.mjs"); log("tgt/build done");

// ---------------------------------------------------------------- 4. evaluation ------------------------------------------
const V = await import("../../dataquality/validate.mjs");
const L = A.L; const X = await import("../../../deep2/execution/execLib.mjs");
const TC = await import("./tgt/common.mjs");
const { patternList } = await import("../../targets/defs.mjs");
const r4 = A.r4, mean = A.mean, median = A.median;
const SEQO = path.join(XO, "seq"), TGTO = path.join(XO, "tgt");
const slimCS = (cs) => (cs?.n ? { n: cs.n, issuers: cs.issuers, mean: cs.mean, median: cs.median, issuerMedianOfMeans: cs.issuerMedianOfMeans, positive: cs.positive, t: cs.t, p: cs.p == null ? null : r4(cs.p), ci95: cs.ci95, meanExTop5Issuers: cs.meanExTop5Issuers } : { n: 0 });
const pf = (xs) => { const pos = xs.filter((x) => x > 0).reduce((a, b) => a + b, 0), neg = -xs.filter((x) => x < 0).reduce((a, b) => a + b, 0); return neg > 0 ? r4(pos / neg) : null; };
const verdict = (s, x2) => { const checks = Object.fromEntries(Object.entries(PASS).map(([k, f]) => [k, !!f(s, x2)])); return { checks, pass: Object.values(checks).every(Boolean) }; };
const mde = (rows) => { const c = V.clusteredMean(rows, { value: "x", cluster: "issuer" }); if (!(c.n > 2)) return null; const deff = Math.max(1, c.deff || 1); return { sd: r4(c.sd), deff: r4(deff), mde80: r4(V.mdeMean({ n: c.n, sd: c.sd, deff })), pT_Gminus1: r4(c.p) }; };
const csvRows = [];

// ---- S leads (sequence pipeline) ----
const sig = readJ(path.join(SEQO, "signals.json")), outc = readJ(path.join(SEQO, "outcomes.json")), ctl = readJ(path.join(SEQO, "controls.json")), fseq = readJ(path.join(SEQO, "filing-seq.json"));
const FL = readJ(path.join(SEQO, "frozen-leads.json"));
const Jt = sig.filter((s) => s.grouping === "cal" && s.universe === "om" && s.period === TARGET).map((s) => ({ ...s, out: outc[s.acc]?.status === "ok" ? outc[s.acc] : null, c: ctl[s.acc] || null })).filter((s) => s.out);
const touchOf = (o, W = 5) => { if (!o || o.availTouchW < W) return null; const f = o.first.t10; return f != null && f <= W ? 1 : 0; };
const seqLeads = {};
for (const [k, R] of Object.entries(SL.RULES)) {
  const m = FL.leads[k][TARGET]; const evs = Jt.filter((s) => R.f(s) && s.out.o.x?.[3]);
  const rows = evs.map((s) => ({ issuer: s.cik, x: s.out.o.x[3][0], x2: s.out.o.x[3][1], key: `${s.cik}|${s.out.entryDate}`, s }));
  const dd = [...A.group(rows, (r) => r.key).values()].map((xs) => xs.sort((a, b) => a.s.position - b.s.position)[0]);
  const tch = Jt.filter((s) => R.f(s)).map((s) => { const a = touchOf(s.out.o), b = s.c?.volMom?.hit?.t10w5; return a == null || b == null ? null : { issuer: s.cik, x: a - b, a, b }; }).filter(Boolean);
  const tc = A.cm(tch);
  const prim = m?.trades ? { n: m.trades, issuers: m.issuers, mean: m.spyRelative.mean, median: m.spyRelative.median, issuerMedianOfMeans: m.spyRelative.issuerMedianOfMeans, t: m.spyRelative.t, p: m.spyRelative.p, ci95: m.spyRelative.ci95, meanExTop5Issuers: m.spyRelative.meanExTop5Issuers, positive: m.spyRelative.positive } : { n: 0 };
  seqLeads[`S-${k}`] = { rule: frozen.leads.find((l) => l.id === `S-${k}`)?.rule, metric: "MOO -> MOC N3, net excess vs SPY, tier x1 (sequence/leads.mjs metrics)", primary: prim, costX2: m?.slippage?.x2 ?? null, costX3: m?.slippage?.x3 ?? null,
    verdict: m?.trades ? verdict(prim, m.slippage.x2.mean) : { pass: false, checks: "no completed trades" }, profitFactorNet: m?.profitFactorNet ?? null, profitFactorVsSpy: m?.profitFactorVsSpy ?? null, worstTrade: m?.worstTrade ?? null, bestTrade: m?.bestTrade ?? null,
    winRateVsSpy: m?.winRateVsSpy ?? null, meanNet: m?.meanNet ?? null, meanGross: m?.meanGross ?? null, oneSessionDelay: m?.oneSessionDelay ?? null, portfolio20: m?.portfolio20 ? { trades: m.portfolio20.trades, totalReturn: m.portfolio20.totalReturn, maxDrawdown: m.portfolio20.maxDrawdown, spyTotal: m.portfolio20.spyTotal, excessVsSpy: m.portfolio20.excessVsSpy } : null,
    winners: m?.winners?.slice(0, 8) ?? [], losers: m?.losers?.slice(0, 8) ?? [], diagnosticOneRowPerTrade: slimCS(L.companyStats(dd.map((r) => ({ issuer: r.issuer, x: r.x })))),
    touch10w5VsControls: { n: tc.n, issuers: tc.issuers, event: r4(mean(tch.map((r) => r.a))), control: r4(mean(tch.map((r) => r.b))), diff: tc.mean, ci95: tc.ci95, t: tc.t, p: tc.p }, power: mde(rows.map((r) => ({ issuer: r.issuer, x: r.x }))) };
  for (const r of rows) csvRows.push({ lead: `S-${k}`, variant: "MOO->MOC N3", id: r.s.acc, issuer: r.s.cik, sym: r.s.sym, publishedAt: r.s.T, entryDate: r.s.out.entryDate, exitDate: r.s.out.o.exitDate?.[3], position: r.s.position, usd: r.s.usd, gross: r.s.out.o.gross?.[3], spy: r.s.out.o.spyR?.[3], x1: r.x, x2: r.x2, touch10w5: touchOf(r.s.out.o), ctlTouch10w5: r.s.c?.volMom?.hit?.t10w5 ?? null, duplicateTrade: dd.includes(r) ? 0 : 1 });
}
log("S leads evaluated");

// ---- buyer-position table (descriptive) ----
const BK = (k) => (k >= 6 ? "6+" : String(k));
const posTable = {};
for (const b of ["1", "2", "3", "4", "5", "6+"]) {
  const evs = Jt.filter((s) => BK(s.position) === b);
  const tch = evs.map((s) => { const a = touchOf(s.out.o), c = s.c?.volMom?.hit?.t10w5; return a == null || c == null ? null : { issuer: s.cik, x: a - c, a, c }; }).filter(Boolean);
  const n3 = evs.map((s) => ({ issuer: s.cik, x: s.out.o.x?.[3]?.[0] })).filter((r) => Number.isFinite(r.x));
  const tc = A.cm(tch), nc = L.companyStats(n3);
  const full = evs.filter((s) => s.out.o.availTouchW >= 10), hits = full.filter((s) => s.out.o.first.t10 != null && s.out.o.first.t10 <= 10);
  posTable[b] = { signals: evs.length, issuers: new Set(evs.map((s) => s.cik)).size, touch10w5: { n: tc.n, event: r4(mean(tch.map((r) => r.a))), control: r4(mean(tch.map((r) => r.c))), diff: tc.mean, ci95: tc.ci95, t: tc.t, p: tc.p },
    touch5w2: (() => { const t = evs.map((s) => touchOf2(s.out.o)).filter((v) => v != null); return { n: t.length, event: r4(mean(t)) }; })(),
    net3: { n: nc.n, mean: nc.mean, median: nc.median, t: nc.t, p: nc.p == null ? null : r4(nc.p) }, medianSessionsTo10AmongHitters: hits.length ? median(hits.map((s) => s.out.o.first.t10)) : null, hitters10of: `${hits.length}/${full.length}` };
}
function touchOf2(o) { if (!o || o.availTouchW < 2) return null; const f = o.first.t5; return f != null && f <= 2 ? 1 : 0; }
const allF = fseq.filter((s) => s.grouping === "cal" && s.universe === "om" && s.period === TARGET).map((s) => ({ s, o: outc[s.acc]?.status === "ok" ? outc[s.acc] : null, c: ctl[s.acc] })).filter((x) => x.o);
const allT = allF.map((x) => { const a = touchOf(x.o.o), c = x.c?.volMom?.hit?.t10w5; return a == null || c == null ? null : { issuer: x.s.cik, x: a - c, a, c }; }).filter(Boolean); const allC = A.cm(allT);
posTable.allOpenMarketFilings = { n: allC.n, event: r4(mean(allT.map((r) => r.a))), control: r4(mean(allT.map((r) => r.c))), diff: allC.mean, ci95: allC.ci95 };
log("position table done");

// ---- T leads (targets pipeline + execLib) ----
const TROWS = readJ(path.join(TGTO, "events.json")).rows; const TH = readJ(path.join(TGTO, "thresholds.json"));
const PLm = new Map(patternList(TH).map((p) => [p.id, p]));
const E = L.loadEvents(); const bars = L.loadBars(); const cal = TC.calendar(bars);
const inT = (r) => r.per === TARGET;
const tLeads = {};
for (const pid of ["othersPlanOnly", "C5_clu_low60"]) {
  const P = PLm.get(pid); const sel = TROWS.filter((r) => inT(r) && (P.universe === "om" ? r.cls === "om" : true) && P.f(r)); const ids = new Set(sel.map((r) => r.id));
  const base = { entry: "nextOpen", exitSessions: 5, mooCutoff: "09:28:00", requireVolume: true, excludeSuspects: true, costModel: "tier", period: null, filter: (e) => ids.has(e.id), slots: 20, onePerIssuer: true };
  const okRows = (res) => res.rows.filter((r) => r.status === "ok" && r.period === TARGET && (TARGET !== "confirm" || r.exitDate < L.HOLDOUT_START));
  const r1 = X.evaluate(E, { ...base, costMultiplier: 1 }), r2 = X.evaluate(E, { ...base, costMultiplier: 2 });
  const ok1 = okRows(r1), ok2 = okRows(r2); const s1 = X.summarize(ok1), s2 = X.summarize(ok2);
  const port = ok1.length ? X.simulatePortfolio2(ok1.map(X.toTrade), { slots: 20, onePerIssuer: true, keepCurve: false }) : null;
  const worst = [...ok1].sort((a, b) => a.excessNet - b.excessNet)[0];
  const x5 = { metric: "execLib close of session 5, net excess vs SPY, tier x1", primary: slimCS(s1), costX2: slimCS(s2), verdict: verdict(slimCS(s1), s2.n ? s2.mean : null), statusCounts: r1.statusCounts,
    profitFactorVsSpy: pf(ok1.map((r) => r.excessNet)), profitFactorNet: pf(ok1.map((r) => r.net)), worstTrade: worst ? { sym: worst.sym, entryDate: worst.entryDate, excessNet: r4(worst.excessNet), net: r4(worst.net) } : null,
    portfolio20: port ? { trades: port.trades, totalReturn: port.totalReturn, maxDrawdown: port.maxDrawdown, spyTotal: port.spy?.totalReturn, excessVsSpy: port.excessVsSpy } : null, power: mde(ok1.map((r) => ({ issuer: r.issuerCik, x: r.excessNet }))) };
  for (const r of ok1) { const r2x = ok2.find((q) => q.id === r.id); const tr = TROWS.find((q) => q.id === r.id); csvRows.push({ lead: `T-${pid}`, variant: "execLib close of session 5", id: r.id, issuer: r.issuerCik, sym: r.sym, publishedAt: r.publishedAt, entryDate: r.entryDate, exitDate: r.exitDate, gross: r.gross, spy: r.spyRet, x1: r.excessNet, x2: r2x?.excessNet ?? null, touch10w5: tr?.o?.hit10_5 ?? null, ctlTouch10w5: (pid === "C5_clu_low60" ? tr?.cf?.nearLow60?.hit10_5 : tr?.cm?.hit10_5) ?? null, usd: tr?.filingValue ?? null }); }
  const out = { rule: frozen.leads.find((l) => l.id === `T-${pid}`)?.rule, candidates: sel.length, issuersCandidates: new Set(sel.map((r) => r.issuer)).size, x5 };
  // limit-fill approximation (othersPlanOnly only): as targets/exec.mjs tpApprox (suspects excluded), cost x2 recomputed on the same path
  if (pid === "othersPlanOnly") {
    const tp = sel.filter((r) => r.o?.tp10s10n5 != null && !X.SUSPECT_SYMBOLS.has(r.s));
    const tp2a = tp.map((r) => { const p = TC.pathAt(bars.get(r.s), r.k, cal, { perEnd: TC.periodEnd(r.per) }); const o2 = TC.outcomesOf(p, 2 * r.cost); return { issuer: r.issuer, x: o2?.tp10s10n5 ?? null }; });
    const tp2 = tp2a.filter((x) => x.x != null);
    const c1 = L.companyStats(tp.map((r) => ({ issuer: r.issuer, x: r.o.tp10s10n5 }))), c2 = L.companyStats(tp2);
    const w = [...tp].sort((a, b) => a.o.tp10s10n5 - b.o.tp10s10n5)[0];
    out.tpApprox = { metric: "LIMIT-FILL APPROXIMATION +10% / -10% / close of session 5 (worst case), net excess vs SPY, tier x1", primary: slimCS(c1), costX2: slimCS(c2), verdict: verdict(slimCS(c1), c2.n ? c2.mean : null),
      fills: tp.filter((r) => r.o.tp10s10n5_why === "tp").length, stops: tp.filter((r) => r.o.tp10s10n5_why === "stop").length, timeExits: tp.filter((r) => r.o.tp10s10n5_why === "time").length,
      profitFactorVsSpy: pf(tp.map((r) => r.o.tp10s10n5)), worstTrade: w ? { sym: w.s, entryDate: w.entryDate, x: r4(w.o.tp10s10n5) } : null, power: mde(tp.map((r) => ({ issuer: r.issuer, x: r.o.tp10s10n5 }))) };
    tp.forEach((r, i) => csvRows.push({ lead: "T-othersPlanOnly", variant: "limit-fill approximation", id: r.id, issuer: r.issuer, sym: r.s, publishedAt: r.publishedAt, entryDate: r.entryDate, exitDate: cal.days[r.j + r.o.tp10s10n5_t], x1: r.o.tp10s10n5, x2: tp2a[i].x, exitReason: r.o.tp10s10n5_why, touch10w5: r.o.hit10_5 ?? null, ctlTouch10w5: r.cm?.hit10_5 ?? null, usd: r.filingValue }));
    out.verdict = { pass: out.tpApprox.verdict.pass && out.x5.verdict.pass, rule: "both frozen exits must pass" };
  } else out.verdict = { pass: out.x5.verdict.pass };
  const ctlKey = pid === "C5_clu_low60" ? "nearLow60" : "cm";
  const td = sel.map((r) => { const e = r.o?.hit10_5, c = ctlKey === "cm" ? r.cm?.hit10_5 : r.cf?.[ctlKey]?.hit10_5; return e == null || c == null ? null : { issuer: r.issuer, x: e - c, e, c }; }).filter(Boolean);
  const tdc = L.companyStats(td.map(({ issuer, x }) => ({ issuer, x })));
  out.touch10_5VsControls = { convention: "targets: sessions 0..5 (entry = 0)", controls: ctlKey === "cm" ? "primary" : "within-pattern nearLow60", n: tdc.n, event: r4(mean(td.map((r) => r.e))), control: r4(mean(td.map((r) => r.c))), diff: tdc.mean, ci95: tdc.ci95, t: tdc.t, p: tdc.p == null ? null : r4(tdc.p) };
  tLeads[`T-${pid}`] = out;
}
log("T leads evaluated");

// ---------------------------------------------------------------- 5. outputs ---------------------------------------------
const leadsOut = { ...seqLeads, ...tLeads };
const verdicts = Object.fromEntries(Object.entries(leadsOut).map(([k, v]) => [k, v.verdict?.pass ? "survived the previously exposed period (NOT independent)" : "failed on the previously exposed period"]));
const result = {
  label: DRY ? "DRY RUN on the CONFIRMATION period (reproduction check; not the exposed period)" : "PREVIOUSLY EXPOSED PERIOD (published 2026-09-01 -> 2026-11-02, completed exits only) — NOT an independent holdout; single evaluation by the auditor",
  runAt: new Date().toISOString(), period: TARGET, frozenRulesSha256: FSHA, frozenAt: frozen.frozenAt, completeThrough: X.COMPLETE_THROUGH,
  passCriteria: "mean > 0; issuer-clustered p < 0.10; median of issuer means > 0; mean ex-top-5 issuers > 0; mean > 0 at cost x2 (T-othersPlanOnly: both frozen exits)",
  leads: leadsOut, verdicts, buyerPositionTouchTable: { note: "DESCRIPTIVE. Sequence convention: +10% within sessions 1..5 (entry session = 1) vs volMom matched non-event stock-days; N3 = MOO -> MOC 3rd session, tier x1, minus SPY.", table: posTable },
};
const cols = ["lead", "variant", "id", "issuer", "sym", "publishedAt", "entryDate", "exitDate", "position", "usd", "gross", "spy", "x1", "x2", "exitReason", "touch10w5", "ctlTouch10w5", "duplicateTrade"];
if (DRY) {
  // ---- reproduction checks against the specialists' files (confirmation period) ----
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const ORIG = { seq: path.join(D3, "sequence"), tgt: path.join(D3, "targets") };
  const check = {
    behEventFeatures: same(readJ(path.join(XO, "beh", "event-features.json")), readJ(path.join(L.DEEP2, "behavior", "event-features.json"))),
    seqSignals: same(sig, readJ(path.join(ORIG.seq, "signals.json"))), seqOutcomes: same(outc, readJ(path.join(ORIG.seq, "outcomes.json"))), seqControls: same(ctl, readJ(path.join(ORIG.seq, "controls.json"))), seqFilingSeq: same(fseq, readJ(path.join(ORIG.seq, "filing-seq.json"))),
    seqFrozenLeadMetrics: same(FL.leads, readJ(path.join(ORIG.seq, "frozen-leads.json")).leads),
    tgtEventRows: same(TROWS, readJ(path.join(ORIG.tgt, "events.json")).rows),
  };
  const ex = readJ(path.join(ORIG.tgt, "exec-results.json")).results; const cv = readJ(path.join(ORIG.tgt, "candidate-verdicts.json")).verdicts;
  check.tgtExecConfirm = { othersPlanOnly_x1: [tLeads["T-othersPlanOnly"].x5.primary.mean, ex.othersPlanOnly.confirm.x1.stats.mean], othersPlanOnly_x2: [tLeads["T-othersPlanOnly"].x5.costX2.mean, ex.othersPlanOnly.confirm.x2.stats.mean],
    C5_x1: [tLeads["T-C5_clu_low60"].x5.primary.mean, ex.C5_clu_low60.confirm.x1.stats.mean], C5_x2: [tLeads["T-C5_clu_low60"].x5.costX2.mean, ex.C5_clu_low60.confirm.x2.stats.mean],
    othersPlanOnly_tpApprox: [tLeads["T-othersPlanOnly"].tpApprox.primary.mean, ex.othersPlanOnly.confirm.tpApprox.stats.mean, ex.othersPlanOnly.confirm.tpApprox.n], C5_n: [tLeads["T-C5_clu_low60"].x5.primary.n, ex.C5_clu_low60.confirm.x1.stats.n] };
  fs.writeFileSync(path.join(XO, "dry-check.json"), JSON.stringify({ ...check, result }, null, 1));
  fs.writeFileSync(path.join(XO, "dry-events.csv"), A.toCsv(csvRows, cols));
  console.log("DRY reproduction checks:", JSON.stringify(check));
} else {
  // ---- leakage check: pre-holdout signals and outcomes must equal the specialists' files ----
  const ORIG = path.join(D3, "sequence");
  const so = readJ(path.join(ORIG, "signals.json")), oo = readJ(path.join(ORIG, "outcomes.json"));
  const preSig = sig.filter((s) => s.period !== "holdout");
  const preOut = Object.fromEntries(Object.entries(outc).filter(([k]) => oo[k] !== undefined));
  result.integrity = { preHoldoutSignalsIdenticalToSequenceAgent: JSON.stringify(preSig) === JSON.stringify(so), preHoldoutOutcomesIdentical: JSON.stringify(preOut) === JSON.stringify(oo), outcomeKeysOnlyInRun: Object.keys(outc).filter((k) => oo[k] === undefined).length,
    targetsPreHoldoutOutcomesIdentical: (() => { const orig = new Map(readJ(path.join(D3, "targets", "events.json")).rows.map((r) => [r.id, r])); let same = 0, diff = 0; for (const r of TROWS) { if (r.per === "holdout") continue; const o = orig.get(r.id); if (o && JSON.stringify(o.o) === JSON.stringify(r.o) && o.clu7 === r.clu7 && o.salesCovered === r.salesCovered) same++; else diff++; } return { same, diff }; })() };
  // ---- record results under the pre-registered audit3-X ids ----
  for (const k of ["L1_buyer2", "L2_fastFollower", "L3_drawdownFollower"]) { const v = seqLeads[`S-${k}`]; A.rec(`audit3-X-S-${k}-N3`, { ...v.primary, costX2: v.costX2?.mean ?? null, pass: v.verdict.pass, checks: v.verdict.checks, period: "exposed Sep-Nov" }); A.rec(`audit3-X-S-${k}-T10W5ctl`, { ...v.touch10w5VsControls, estimate: v.touch10w5VsControls.diff, period: "exposed Sep-Nov" }); }
  { const v = tLeads["T-othersPlanOnly"]; A.rec("audit3-X-T-othersPlanOnly-tpApprox", { ...v.tpApprox.primary, costX2: v.tpApprox.costX2.mean ?? null, pass: v.tpApprox.verdict.pass, checks: v.tpApprox.verdict.checks, period: "exposed Sep-Nov" }); A.rec("audit3-X-T-othersPlanOnly-x5", { ...v.x5.primary, costX2: v.x5.costX2.mean ?? null, pass: v.x5.verdict.pass, checks: v.x5.verdict.checks, period: "exposed Sep-Nov" }); A.rec("audit3-X-T-othersPlanOnly-hit10_5ctl", { ...v.touch10_5VsControls, estimate: v.touch10_5VsControls.diff, period: "exposed Sep-Nov" }); }
  { const v = tLeads["T-C5_clu_low60"]; A.rec("audit3-X-T-C5_clu_low60-x5", { ...v.x5.primary, costX2: v.x5.costX2.mean ?? null, pass: v.x5.verdict.pass, checks: v.x5.verdict.checks, period: "exposed Sep-Nov" }); A.rec("audit3-X-T-C5_clu_low60-hit10_5ctl", { ...v.touch10_5VsControls, estimate: v.touch10_5VsControls.diff, period: "exposed Sep-Nov" }); }
  for (const b of ["1", "2", "3", "4", "5", "6+"]) { const t = posTable[b].touch10w5; A.rec(`audit3-X-POS-b${b}-T10W5ctl`, { n: t.n, event: t.event, control: t.control, estimate: t.diff, ci95: t.ci95, t: t.t, p: t.p, net3: posTable[b].net3, period: "exposed Sep-Nov", descriptive: true }); }
  // ---- reference values (discovery / confirmation, computed by the specialists before the freeze) ----
  const fl0 = readJ(path.join(D3, "sequence", "frozen-leads.json")).leads, ex0 = readJ(path.join(D3, "targets", "exec-results.json")).results;
  result.reference = Object.fromEntries([...["L1_buyer2", "L2_fastFollower", "L3_drawdownFollower"].map((k) => [`S-${k}`, Object.fromEntries(["discover", "confirm"].map((p) => [p, { n: fl0[k][p].trades, mean: fl0[k][p].spyRelative.mean, p: fl0[k][p].spyRelative.p }]))]),
    ...["othersPlanOnly", "C5_clu_low60"].map((pid) => [`T-${pid}`, Object.fromEntries(["discover", "confirm"].map((p) => [p, { x5: { n: ex0[pid][p].x1.stats.n, mean: ex0[pid][p].x1.stats.mean, p: ex0[pid][p].x1.stats.p }, tpApprox: ex0[pid][p].tpApprox ? { n: ex0[pid][p].tpApprox.n, mean: ex0[pid][p].tpApprox.stats.mean } : null }]))])]);
  A.writeOut("exposed-period.json", result);
  A.writeOut("exposed-period-events.csv", A.toCsv(csvRows, cols));
}
const show = (k, s) => console.log(`${k.padEnd(34)} n ${s?.n ?? 0}/${s?.issuers ?? 0} mean ${s?.mean} med ${s?.median} imed ${s?.issuerMedianOfMeans} t ${s?.t} p ${s?.p} exTop5 ${s?.meanExTop5Issuers} ci ${JSON.stringify(s?.ci95)}`);
console.log(result.label);
for (const [k, v] of Object.entries(seqLeads)) { show(k, v.primary); console.log(`   x2 ${v.costX2?.mean} PF ${v.profitFactorNet} worst ${JSON.stringify(v.worstTrade)} touch ${JSON.stringify(v.touch10w5VsControls)} -> ${verdicts[k]}`); }
for (const [k, v] of Object.entries(tLeads)) { show(`${k} x5`, v.x5.primary); console.log(`   x2 ${v.x5.costX2.mean} PF ${v.x5.profitFactorVsSpy} worst ${JSON.stringify(v.x5.worstTrade)}`); if (v.tpApprox) { show(`${k} tpApprox`, v.tpApprox.primary); console.log(`   x2 ${v.tpApprox.costX2.mean} fills ${v.tpApprox.fills} stops ${v.tpApprox.stops} time ${v.tpApprox.timeExits}`); } console.log(`   touch ${JSON.stringify(v.touch10_5VsControls)} -> ${verdicts[k]}`); }
console.log("position table", JSON.stringify(posTable));
if (!DRY) { console.log("integrity", JSON.stringify(result.integrity)); fs.writeFileSync(path.join(XO, "FINISHED"), new Date().toISOString()); }
log("done");
