// deep4/learn/wf.mjs — monthly walk-forward of every pre-declared model x target (spec.json) on a segment.
// Saves per-run month tables, event/control predictions, frozen-model summaries (lambda, threshold, coefficients, trees) and
// permutation importance. Tests are computed from the saved predictions by wfTests.mjs.
//   node --max-old-space-size=8192 scripts/research/deep4/learn/wf.mjs [--targets=xs30,hit30] [--segment=design]
import fs from "node:fs";
import { walkForward } from "../panel/walkforward.mjs";
import { loadEvents, loadCtl, inUniverse, writeOut, readOut, existsOut, outPath, checkpoint, toCsv, L4 } from "./common.mjs";
import { FEATURE_NAMES, SETS, GROUPS, trackRecords, eventFeatures, controlFeatures } from "./features.mjs";
import { makeRunner, isCtl, keyOf } from "./wfLib.mjs";
import * as Mo from "./models.mjs";
import * as E from "./evalLib.mjs";

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split("=")[1] : d; };
const SEGMENT = arg("segment", "design");
const spec = readOut("spec.json");
const hp = spec.hyperparameters;
const TARGETS = Object.fromEntries([...spec.targets.primary, ...spec.targets.secondary].map((t) => [t.id, t]));
const PLAN = {
  xs30: ["M0", "M1", "M2", "M3", "M4", "M3c", "M3p", "M5", "TREE", "EN", "D1", "D2"],
  hit30: ["M0", "M1", "M2", "M3", "M4", "M3c", "M3p", "M5", "TREE", "D1", "D2"],
  xs5: ["M0", "M2", "M3", "M4", "M3c", "M3p", "M5"],
  xs10: ["M0", "M2", "M3", "M4", "M3c", "M3p", "M5"],
  mae30: ["M0", "M2", "M3", "M4"],
  hit10d: ["M0", "M3", "M4"],
};
const CFG = {
  M0: { kind: "M0" }, M1: { kind: "linear", cols: SETS.M1 }, M2: { kind: "linear", cols: SETS.M2 }, M3: { kind: "linear", cols: SETS.M3, evalControls: true }, M4: { kind: "linear", cols: SETS.M4 },
  M3c: { kind: "controls", cols: SETS.M3, controls: true, evalControls: true },
  M3p: { kind: "pooled", cols: SETS.M3, controls: true, interactions: false }, M5: { kind: "pooled", cols: SETS.M3, controls: true, interactions: true },
  TREE: { kind: "tree", cols: SETS.M4 }, EN: { kind: "enet", cols: SETS.M4 },
  D1: { kind: "split", cols: SETS.M4, splitBy: "lvol20" }, D2: { kind: "split", cols: SETS.M4, splitBy: "spyR20" },
};
const targetsToRun = arg("targets", Object.keys(PLAN).join(",")).split(",");
const segs = SEGMENT === "design" ? ["design"] : ["design", "confirm"];
if (SEGMENT === "confirm" && !fs.existsSync(L4.agentFrozenFile("learn"))) throw new Error("confirm walk-forward needs learn/frozen.json first");

// ---------------- data ----------------
const t0 = Date.now();
const P = loadEvents({ segments: segs });
const rows = P.rows;
const U = rows.filter(inUniverse);
const C = loadCtl({ segments: segs });
const ctlKeys = new Set(); for (const r of U) for (const [k] of C.byEvent[r.key] || []) ctlKeys.add(k);
const ctlRows = [...ctlKeys].map((k) => C.rows.get(k)).filter(Boolean);
const TR = trackRecords(U, rows);
const store = new Map();
for (const r of U) { const o = eventFeatures(r, TR.get(r.key)); store.set(r.key, FEATURE_NAMES.map((n) => o[n])); }
for (const c of ctlRows) { const o = controlFeatures(c); store.set(c.ctlKey, FEATURE_NAMES.map((n) => o[n])); }
const evByKey = new Map(U.map((r) => [r.key, r])), ctlByKey = new Map(ctlRows.map((c) => [c.ctlKey, c]));
console.log(`loaded ${SEGMENT}: rows ${rows.length}, universe ${U.length}, controls ${ctlRows.length} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

// evaluated months per target (counts only): >= 300 matured universe training events and >= 20 scored events with an outcome
function monthsFor(t) {
  const segMonths = [...new Set(U.filter((r) => r.segment === SEGMENT).map((r) => r.month))].sort();
  const table = segMonths.map((m) => {
    const m0 = `${m}-01`;
    const trainN = U.filter((r) => L4.maturedBy(r[t.end], m0) && r[t.field] != null).length;
    const evalN = U.filter((r) => r.segment === SEGMENT && r.month === m).length, withY = U.filter((r) => r.segment === SEGMENT && r.month === m && r[t.field] != null).length;
    return { month: m, trainN, evalN, withY, evaluated: trainN >= spec.walkForward.minTrainEvents && withY >= spec.walkForward.minEvalWithOutcome };
  });
  return { table, months: table.filter((x) => x.evaluated).map((x) => x.month) };
}

const DIR = `wf-${SEGMENT}`;
fs.mkdirSync(outPath(DIR), { recursive: true });
const summary = existsOut(`${DIR}/summary.json`) ? readOut(`${DIR}/summary.json`) : { segment: SEGMENT, runs: {} };
for (const tid of targetsToRun) {
  const t = TARGETS[tid]; if (!t) throw new Error(`unknown target ${tid}`);
  const kind = t.type === "binary" ? "auc" : "ic";
  const mf = monthsFor(t);
  console.log(`\n== target ${tid} (${t.field}); months ${mf.months.join(",")}`);
  const predCols = new Map(); // key -> { model: p }
  const ctlPred = new Map();
  for (const mid of PLAN[tid]) {
    const cfg = { id: mid, ...CFG[mid] };
    const t1 = Date.now();
    const R = makeRunner(cfg, t, { store, hp, minTrainEvents: spec.walkForward.minTrainEvents });
    const res = walkForward({ agent: "learn", rows, controls: cfg.controls || cfg.evalControls ? ctlRows : null, horizon: t.horizon, target: (r) => r[t.field], endField: (r) => r[t.end],
      fit: R.fit, predict: R.predict, eligible: (r) => isCtl(r) || inUniverse(r), trainFilter: (r) => isCtl(r) || inUniverse(r),
      includeControlsInTrain: !!cfg.controls, evalControls: !!cfg.evalControls, months: mf.months, segment: SEGMENT, keepPredictions: true });
    const thrBy = new Map(R.models.filter((m) => !m.skipped).map((m) => [m.month, m.thr]));
    const baseBy = new Map(R.models.filter((m) => !m.skipped).map((m) => [m.month, m.baseRate]));
    const recs = [], crecs = [];
    for (const p of res.predictions) {
      if (p.prediction == null || p.realized == null) continue;
      if (p.isControl) { const c = ctlByKey.get(p.key); crecs.push({ key: p.key, month: p.month, issuer: c.sym, p: p.prediction, y: p.realized }); (ctlPred.get(p.key) || ctlPred.set(p.key, {}).get(p.key))[mid] = p.prediction; continue; }
      const r = evByKey.get(p.key);
      recs.push({ key: p.key, month: p.month, issuer: r.cik, p: p.prediction, y: p.realized, sel: p.prediction >= thrBy.get(p.month), xs30: r.B_xsNet30, hit30: r.B_hit10_30 });
      (predCols.get(p.key) || predCols.set(p.key, {}).get(p.key))[mid] = p.prediction;
    }
    const mt = E.monthTable(recs, kind, { baseRateByMonth: kind === "auc" ? baseBy : null });
    const ctlMt = crecs.length ? E.withinMonth(crecs, kind) : null;
    const pooled = E.withinMonth(recs, kind);
    const modelsInfo = R.models.map((m) => (m.skipped ? m : { month: m.month, trainEvents: m.trainEvents, trainControls: m.trainControls, lambda: m.lambda, cvDefaulted: m.L?.cv?.defaulted ?? m.P?.cv?.defaulted ?? (m.lo ? [m.lo.cv.defaulted, m.hi.cv.defaulted] : null),
      cvFolds: m.L?.cv?.folds ?? m.P?.cv?.folds ?? null, thr: m.thr, baseRate: m.baseRate, ...(m.kind === "split" ? { nLo: m.nLo, nHi: m.nHi, splitMed: m.splitMed, fallback: m.fallback } : {}), ...(m.kind === "enet" ? { nonZero: m.L.coef.nonZero } : {}) }));
    // coefficients (standardised) / trees for interpretation
    const coefs = R.models.filter((m) => !m.skipped).map((m) => {
      if (m.kind === "linear" || m.kind === "controls" || m.kind === "enet") return { month: m.month, names: cfg.cols, b0: m.L.coef.b0, b: m.L.coef.b };
      if (m.kind === "pooled") { const names = [...SETS.M3, "I", ...(cfg.interactions ? [...SETS.M3.map((n) => `Ix${n}`), ...SETS.M2.map((n) => `Ix${n}`)] : [])]; return { month: m.month, names, b0: m.P.coef.b0, b: m.P.coef.b }; }
      if (m.kind === "tree") return { month: m.month, leaves: Mo.treeLeaves(m.T), root: { name: m.T.root.name, cut: m.T.root.cut } };
      if (m.kind === "split") return { month: m.month, names: cfg.cols, lo: m.lo.coef.b, hi: m.hi.coef.b, nLo: m.nLo, nHi: m.nHi };
      return { month: m.month, value: m.value };
    });
    const run = { target: tid, model: mid, kind, months: mf.months, warmup: mf.table, monthTable: mt, pooledSkill: pooled.value, controlsSkill: ctlMt?.value ?? null, controlsMonths: ctlMt?.months ?? null,
      scoredN: recs.length, scoredIssuers: new Set(recs.map((r) => r.issuer)).size, selectedN: recs.filter((r) => r.sel).length, controlsScored: crecs.length, models: modelsInfo, secs: (Date.now() - t1) / 1000 };
    writeOut(`${DIR}/run-${tid}-${mid}.json`, { ...run, coefficients: coefs });
    writeOut(`${DIR}/recs-${tid}-${mid}.json`, { recs, crecs });
    summary.runs[`${tid}.${mid}`] = { ...run, monthTable: undefined, warmup: undefined, models: undefined, lambdas: modelsInfo.map((m) => m.lambda ?? null) };
    console.log(`  ${mid.padEnd(5)} skill ${pooled.value?.toFixed(4)} | months ${pooled.months.map((x) => `${x.month.slice(5)}:${x.value?.toFixed(3)}`).join(" ")} | ctl ${ctlMt?.value?.toFixed(4) ?? "-"} | n ${recs.length} sel ${run.selectedN} | lambda ${modelsInfo.map((m) => JSON.stringify(m.lambda ?? null)).join(",")} | ${run.secs.toFixed(1)}s`);
    // permutation importance (M4 and M5 on the primary targets): within-month permutation among scored events, 20 repeats
    if ((tid === "xs30" || tid === "hit30") && (mid === "M4" || mid === "M5")) {
      const live = R.models.filter((m) => !m.skipped);
      const byMonth = new Map(); for (const r of recs) (byMonth.get(r.month) || byMonth.set(r.month, []).get(r.month)).push(r);
      const featsToPermute = mid === "M4" ? SETS.M4 : [...SETS.M3, ...SETS.M2];
      const units = [...featsToPermute.map((f) => ({ name: f, cols: [FEATURE_NAMES.indexOf(f)] })),
        ...Object.entries(GROUPS).filter(([, fs]) => fs.some((f) => featsToPermute.includes(f))).map(([g, fs]) => ({ name: `group:${g}`, cols: fs.map((f) => FEATURE_NAMES.indexOf(f)) }))];
      const rnd = E.rng(11), imp = [];
      for (const u of units) {
        let sw = 0, sd = 0; const perMonth = [];
        for (const M of live) {
          const rs = byMonth.get(M.month); if (!rs || rs.length < 20) continue;
          const raws = rs.map((r) => store.get(r.key)), y = rs.map((r) => r.y);
          const metric = (pp) => (kind === "auc" ? Mo.auc(pp, y) : Mo.spearman(pp, y));
          const v0 = metric(raws.map((x) => R.predictRaw(M, x, false)));
          let acc = 0;
          for (let rep = 0; rep < 20; rep++) {
            const perm = [...raws.keys()]; for (let i = perm.length - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; [perm[i], perm[j]] = [perm[j], perm[i]]; }
            const pp = raws.map((x, i) => { const z = [...x]; for (const c of u.cols) z[c] = raws[perm[i]][c]; return R.predictRaw(M, z, false); });
            acc += v0 - metric(pp);
          }
          perMonth.push({ month: M.month, n: rs.length, base: v0, drop: acc / 20 }); sw += rs.length; sd += (acc / 20) * rs.length;
        }
        imp.push({ unit: u.name, meanDrop: sw ? sd / sw : null, perMonth });
      }
      imp.sort((a, b) => (b.meanDrop ?? -9) - (a.meanDrop ?? -9));
      writeOut(`${DIR}/permutation-${tid}-${mid}.json`, imp);
      console.log(`    permutation top: ${imp.slice(0, 8).map((x) => `${x.unit} ${x.meanDrop?.toFixed(4)}`).join(" | ")}`);
    }
  }
  // event-level prediction file for the target
  const cols = ["key", "month", "cik", "sym", "person", "decisionAt", "entryDate", t.field, "B_xsNet30", "B_hit10_30", ...PLAN[tid]];
  const out = []; for (const [k, ps] of predCols) { const r = evByKey.get(k); out.push({ key: k, month: r.month, cik: r.cik, sym: r.sym, person: r.person, decisionAt: r.decisionAt, entryDate: r.entryDate, [t.field]: r[t.field], B_xsNet30: r.B_xsNet30, B_hit10_30: r.B_hit10_30, ...ps }); }
  fs.writeFileSync(outPath(`${DIR}/predictions-${tid}.csv`), toCsv(out, cols));
  const cout = []; for (const [k, ps] of ctlPred) { const c = ctlByKey.get(k); cout.push({ ctlKey: k, entryMonth: c.entryMonth, sym: c.sym, entryDate: c.entryDate, [t.field]: c[t.field], ...ps }); }
  if (cout.length) fs.writeFileSync(outPath(`${DIR}/predictions-controls-${tid}.csv`), toCsv(cout, ["ctlKey", "entryMonth", "sym", "entryDate", t.field, ...PLAN[tid].filter((m) => CFG[m].evalControls)]));
  writeOut(`${DIR}/summary.json`, summary);
  checkpoint(`wf-${SEGMENT}-${tid}`, { months: mf.months, models: PLAN[tid] });
}
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
