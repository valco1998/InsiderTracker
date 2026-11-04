// deep4/learn/writeSpec.mjs — writes the PRE-DECLARED analysis specification spec.json (+ sha256) BEFORE any outcome value of
// the deep-4 panel is read by agent "learn". Inputs: features.mjs (feature list), feature-profile.json (feature-only design
// quantiles). Refuses to overwrite an existing spec.json (the spec is fixed once written).
//   node scripts/research/deep4/learn/writeSpec.mjs
import fs from "node:fs";
import path from "node:path";
import { outPath, readOut, writeOut, sha256File, checkpoint, SCRIPTS } from "./common.mjs";
import { FEATURES, GROUPS, SETS } from "./features.mjs";

if (fs.existsSync(outPath("spec.json"))) { console.log("spec.json exists — not overwritten (spec is fixed)"); process.exit(0); }
const prof = readOut("feature-profile.json");
const cut = (k) => [prof.features[k].q33, prof.features[k].q67];
const G80 = prof.gapEntry.q80;

const primaryT = [
  { id: "xs30", field: "B_xsNet30", type: "continuous", model: "ridge", horizon: 30, end: "B_end30", label: "30-calendar-day net excess return vs SPY (tier x1 costs), entry at the public-trader open" },
  { id: "hit30", field: "B_hit10_30", type: "binary", model: "logistic", horizon: 30, end: "B_end30", label: "+10% touch (daily high >= entry x 1.10) within 30 calendar days (descriptive probability, not a profit)" },
];
const secondaryT = [
  { id: "xs5", field: "B_xsNet5", type: "continuous", model: "ridge", horizon: 5, end: "B_end5" },
  { id: "xs10", field: "B_xsNet10", type: "continuous", model: "ridge", horizon: 10, end: "B_end10" },
  { id: "mae30", field: "B_mae30", type: "continuous", model: "ridge", horizon: 30, end: "B_end30", label: "maximum adverse excursion within 30 days (higher = less adverse)" },
  { id: "hit10d", field: "B_hit10_10", type: "binary", model: "logistic", horizon: 10, end: "B_end10", label: "+10% touch within 10 days (speed of the touch)" },
];

// ---------------- tests (registered before computing; family sizes are the counts below) ----------------
const tests = [];
const add = (family, id, statement, extra = {}) => tests.push({ family, id, statement, ...extra });
// F1 primary walk-forward (30 days)
for (const t of ["xs30", "hit30"]) {
  const sk = t === "xs30" ? "IC (n-weighted mean of within-month Spearman(prediction, realised B_xsNet30))" : "AUC (n-weighted mean of within-month AUC for B_hit10_30)";
  const nul = t === "xs30" ? "0" : "0.5";
  for (const m of ["M1", "M2", "M3", "M4"]) add("learn.wf30", `learn.wf30.${t}.${m}.skill`, `${m} walk-forward ${sk} differs from ${nul} (design months)`);
  add("learn.wf30", `learn.wf30.${t}.M4-M1`, `combined M4 vs purchase-only M1: paired difference in ${sk} != 0`);
  add("learn.wf30", `learn.wf30.${t}.M4-M3`, `combined M4 vs technical+regime M3: paired difference in ${sk} != 0 (does insider information add beyond price patterns?)`);
  add("learn.wf30", `learn.wf30.${t}.M3-M3c`, `technical model trained on insider events (M3) vs the same model trained on matched non-insider controls (M3c), both scored on events: paired difference in ${sk} != 0`);
  add("learn.wf30", `learn.wf30.${t}.M3c.ctlSkill`, `controls-trained technical model M3c scored on matched controls: ${sk} on controls differs from ${nul}`);
  add("learn.wf30", `learn.wf30.${t}.M3ev-M3cctl`, `technical predictability with insiders (M3 on events) minus without insiders (M3c on controls) != 0`);
  add("learn.wf30", `learn.wf30.${t}.M5-M3p`, `pooled events+controls model with insider x feature interactions and insider features (M5) vs pooled technical model with an insider dummy (M3p), scored on events: paired difference in ${sk} != 0`);
  add("learn.wf30", `learn.wf30.${t}.TREE.skill`, `depth<=3 tree (M4 features) walk-forward ${sk} differs from ${nul}`);
  if (t === "xs30") add("learn.wf30", `learn.wf30.${t}.EN.skill`, `elastic net (alpha 0.5, M4 features) walk-forward ${sk} differs from ${nul}`);
  add("learn.wf30", `learn.wf30.${t}.D1.skill`, `volatility-conditioned M4 (separate fits below/above the training median of lvol20) walk-forward ${sk} differs from ${nul}`);
  add("learn.wf30", `learn.wf30.${t}.D2.skill`, `market-regime-conditioned M4 (separate fits for spyR20 > 0 and <= 0) walk-forward ${sk} differs from ${nul}`);
  add("learn.wf30", `learn.wf30.${t}.M4.top.net`, `executable top quintile of M4 (prediction >= q80 of the month model's in-sample training predictions): mean realised B_xsNet30 != 0 (issuer-clustered)`);
  for (const m of ["M4", "M1", "M2", "M3", "TREE", "D1", "D2", ...(t === "xs30" ? ["EN"] : [])]) add("learn.wf30", `learn.wf30.${t}.${m}.top-base`, `executable top quintile of ${m}: mean realised B_xsNet30 minus the all-universe mean in the same months != 0 (joint issuer bootstrap)`);
}
// F2 secondary horizons / targets
for (const t of ["xs5", "xs10"]) {
  for (const m of ["M2", "M3", "M4"]) add("learn.wfsec", `learn.wfsec.${t}.${m}.skill`, `${m} walk-forward IC for ${t} differs from 0`);
  add("learn.wfsec", `learn.wfsec.${t}.M4-M3`, `M4 vs M3 paired IC difference for ${t} != 0`);
  add("learn.wfsec", `learn.wfsec.${t}.M3-M3c`, `M3 (events-trained) vs M3c (controls-trained) on events, IC difference for ${t} != 0`);
  add("learn.wfsec", `learn.wfsec.${t}.M5-M3p`, `M5 vs M3p (pooled, insider interactions) on events, IC difference for ${t} != 0`);
}
for (const m of ["M2", "M3", "M4"]) add("learn.wfsec", `learn.wfsec.mae30.${m}.skill`, `${m} walk-forward IC for B_mae30 differs from 0`);
add("learn.wfsec", "learn.wfsec.mae30.M4-M3", "M4 vs M3 paired IC difference for B_mae30 != 0 (does insider information predict less downside beyond price patterns?)");
add("learn.wfsec", "learn.wfsec.hit10d.M4.skill", "M4 logistic walk-forward AUC for B_hit10_10 differs from 0.5");
add("learn.wfsec", "learn.wfsec.hit10d.M4-M3", "M4 vs M3 paired AUC difference for B_hit10_10 != 0");
// F3 interactions
const PAIRS = [
  { id: "I1", kind: "event", x: "lusd", z: "dHi60", stat: "[d(x T3) - d(x T1)] in z T1 (deepest drawdown) minus the same in z T3 (near the 60-session high)", why: "large purchases after deep drawdowns = conviction at the bottom" },
  { id: "I2", kind: "event", x: "ceoCfo", z: "dHi60", stat: "[d(CEO/CFO) - d(other)] in z T1 minus the same in z T3", why: "top-executive buying after a drawdown" },
  { id: "I3", kind: "event", x: "lpct", z: "lvol20", stat: "[d(x T3) - d(x T1)] in z T3 (high volatility) minus the same in z T1", why: "conviction (holding increase) matters more where prices are noisier" },
  { id: "I4", kind: "insider", z: "lvol20", stat: "d(z T3) - d(z T1)", why: "insider-specific excess (event minus matched controls) larger in volatile names" },
  { id: "I5", kind: "insider", z: "r20", stat: "d(z T1 losers) - d(z T3 winners)", why: "insider buying after losses vs after gains (beyond generic reversal: controls share the chart)" },
  { id: "I6", kind: "insider", z: "spyR20", stat: "d(z T1 weak market) - d(z T3 strong market)", why: "market regime conditioning of the insider-specific excess" },
  { id: "I7", kind: "insider", z: "ldv20", stat: "d(z T1 illiquid) - d(z T3 liquid)", why: "information asymmetry is larger in small / illiquid names" },
  { id: "I8", kind: "insider", z: "lvolSurge", stat: "d(z T3 abnormal volume) - d(z T1)", why: "abnormal pre-filing volume may mean the information is already being traded" },
];
for (const p of PAIRS) for (const t of ["xs30", "hit30"]) add("learn.int", `learn.int.${p.id}.${t}`, `interaction ${p.id} (${p.kind === "event" ? `${p.x} x ${p.z}` : `insider x ${p.z}`}) on the matched-control-adjusted ${t}: ${p.stat} != 0`);
// F4 family B
const RULES = [
  { id: "B1", name: "hold-2", entry: "open of session j0+2", condition: "close of the last bar on or before session j0+1 >= decision close D (the stock held its pre-filing level for two completed sessions after the filing became tradable)" },
  { id: "B2", name: "breakout-20", entry: "open of session s+1", condition: "first session s in [j0, j0+9] whose close >= max close of the 20 sessions before s (new 20-session closing high); no trade if none" },
  { id: "B3", name: "gap-cap LOO", entry: "open of j0 (limit-on-open buy at D x (1+G80): fills at the auction price only if open <= limit)", condition: `gapEntry = open(j0)/D - 1 <= G80 = ${G80}` },
  { id: "B4", name: "gap-cap MOC", entry: "close of j0 (market-on-close order submitted after the open is known)", condition: `gapEntry <= G80 = ${G80}` },
  { id: "B5", name: "day-0 hold", entry: "open of session j0+1", condition: "close(j0) >= open(j0) (the entry session did not fade)" },
];
for (const r of RULES) {
  add("learn.famB", `learn.famB.${r.id}.ev30`, `family-B rule ${r.id} (${r.name}): events' mean net excess (30d calendar exit from the rule's entry, tier x1) != 0 (issuer-clustered)`);
  add("learn.famB", `learn.famB.${r.id}.evc30`, `rule ${r.id}: events minus their matched controls passing the same rule (30d) != 0`);
  add("learn.famB", `learn.famB.${r.id}.evc10`, `rule ${r.id}: events minus their matched controls passing the same rule (10d) != 0`);
}
const famSize = tests.reduce((m, t) => ((m[t.family] = (m[t.family] || 0) + 1), m), {});
for (const t of tests) t.familySize = famSize[t.family];

const spec = {
  agent: "learn", version: 1, createdAt: new Date().toISOString(),
  preDeclaration: "Written before agent learn read any outcome value (B_*, A_*, C_*) of the deep-4 panel. Seen before this spec: deep-2/3 findings, the panel findings.md descriptive aggregates (30-day net excess -0.4% events vs -1.5% controls; +10% touch 43% vs 48.5%; large monthly dispersion), and warm-up COUNTS of available outcomes. Feature quantiles below come from feature-profile.json (features only).",
  data: {
    loader: "panel/data.mjs loadPanel/loadControls with agent 'learn'; design only until frozen.json exists; the exposed segment is never loaded",
    universe: "design panel rows with primary==1 (class v2 open-market, valued, priced) && isPrimary==1 (one per person/issuer/entry) && featOk==1 (>= 26 bars)",
    universeCounts: { events: prof.universe, controls: prof.controls },
    controls: "unique matched control stock-days of universe events (10 per event, deep-2 method); same T/R features and B outcomes; no insider features",
    leftCensoring: "insider history before 2025-12-01 is unknown; track-record features are sparse (person matured history for " + prof.trackRecordCoverage.personWithMatured + " of " + prof.universe + " events)",
  },
  features: FEATURES.map((d) => ({ name: d.name, group: d.group, def: d.def })),
  groups: { P: "purchase", H: "person history", C: "cluster / issuer activity", TR: "track record (history.mjs: 30d B xsNet of earlier PRIMARY purchases matured before t, empirical-Bayes shrunk; value = estimate - pool mean)", T: "technical (bars before the entry date)", R: "market regime" },
  groupMembers: GROUPS, featureSets: SETS,
  notFeatures: "gapEntry/gapEntryX (at the open only; used only by family-B entry decisions), outcomes, fut_*, adjusted price levels, amend, dedupe, dupSize, priceStatus/primary",
  preprocessing: "fitted on each training window: winsorise each feature at the window's 1st/99th percentiles, impute nulls with the window median, z-score with the window mean/sd; identical transform applied to scored rows. Continuous training targets winsorised at the window's 1st/99th percentiles; evaluation always on raw realised values.",
  targets: { primary: primaryT, secondary: secondaryT, descriptive: ["time to +10% (B_tt10d among hits; share with B_hit10_10) by predicted quintile", "B_lim10_30 limit +10% approximation (secondary, labelled)", "absolute net return vs SPY return"] },
  models: {
    M0: "intercept only (training mean / base rate) = the all-insider baseline predictor (no ranking)",
    M1: "purchase-only features (insider activity alone)", M2: "all insider information P+H+C+TR", M3: "technical + regime T+R trained on insider events", M4: "combined (all 38 features)",
    M3c: "T+R trained on the matched non-insider controls only (CV on controls); scored on events and on controls",
    M3p: "pooled events + controls: T+R + insider indicator I",
    M5: "pooled events + controls: T+R + I + I x z(T+R) + I x z(P+H+C+TR) (insider features z-scored on training events, 0 for controls)",
    TREE: "CART on M4 features: depth <= 3, every leaf >= 100 events and >= 40 issuers, candidate thresholds = training-window deciles (9 per feature); regression on the winsorised target (xs) / 0-1 target (hit); leaf mean = prediction; no pruning",
    EN: "elastic net on M4 features, alpha 0.5, target standardised inside the fit (xs30 only)",
    D1: "volatility-conditioned M4: two fits, training events split at the training-window median of lvol20; each scored event uses its half's model",
    D2: "regime-conditioned M4: two fits, spyR20 > 0 vs <= 0; a side with < 150 training events falls back to the single M4 fit",
    linkByTarget: "continuous targets -> ridge (EN where listed); binary targets -> L2 logistic",
  },
  hyperparameters: {
    ridge: { objective: "(1/2n)||y-b0-Zb||^2 + (lambda/2)||b||^2, intercept unpenalised", grid: [0.1, 0.3, 1, 3, 10, 30, 100], default: 3 },
    logistic: { objective: "mean log-loss + (lambda/2)||b||^2, intercept unpenalised (Newton/IRLS)", grid: [0.001, 0.003, 0.01, 0.03, 0.1, 0.3, 1], default: 0.01 },
    enet: { alpha: 0.5, grid: [0.003, 0.01, 0.02, 0.05, 0.1, 0.2], default: 0.05 },
    innerCV: "time-ordered inside each training window: for each month start s inside the window, inner-train = training rows whose outcome ended before s, inner-validation = training rows decided in month(s); fold valid if >= 200 inner-train and >= 100 validation rows (events; controls for M3c); criterion ridge/EN = mean within-fold Spearman IC, logistic = mean log-loss (lower better); ties -> larger lambda; no valid fold -> default lambda. D1/D2 halves run their own CV. Pooled models validate on events.",
  },
  walkForward: {
    engine: "panel/walkforward.mjs walkForward (monthly by decision month; training = rows whose outcome window ended before the month start: lib4.maturedBy; model fitted once and frozen per month; every eligible event of the month scored)",
    minTrainEvents: 300, minEvalWithOutcome: 20,
    designMonths: "all design months meeting the minima (expected: 30d Feb-May 2026 = 4; 5d/10d Jan-Jun 2026 = 6)",
    confirmMonths: ["2026-06 (confirm rows only)", "2026-07", "2026-08"],
    perMonthReport: ["trainN", "lambda chosen", "scoredN/issuers", "IC or AUC", "Brier and Brier skill vs the training base rate (binary)", "calibration-in-the-large and calibration slope", "within-month top-quintile vs rest realised B_xsNet30 and B_hit10_30", "executable selection (>= training q80) realised B_xsNet30 / hit", "controls-trained model metrics"],
  },
  metrics: {
    skillContinuous: "IC = n-weighted mean over evaluated months of the within-month Spearman correlation between prediction and realised outcome",
    skillBinary: "AUC = n-weighted mean over evaluated months of the within-month AUC",
    executableSelection: "thr(month) = 80th percentile of the month model's in-sample predictions on its training events; selected = scored events with prediction >= thr",
    inference: "issuer-block bootstrap (B = 1000, seed 7) recomputing the within-month statistics; z = estimate / bootstrap SE; two-sided normal p. Model differences paired on the same draws. Controls resampled by symbol. Top-base: joint issuer resampling.",
    multipleTesting: "BH within learn's registered design tests and globally over the deep-4 registry results available at reporting time",
  },
  interactions: { pairs: PAIRS, tercileCuts: Object.fromEntries([...new Set(PAIRS.flatMap((p) => [p.x, p.z]).filter(Boolean))].filter((k) => k !== "ceoCfo").map((k) => [k, cut(k)])),
    cells: "tercile cells from design quantiles of universe events: T1 x <= q33, T2 q33 < x <= q67, T3 x > q67; ceoCfo binary",
    outcome: "d = event outcome minus the mean of its matched controls' outcomes (controls with a value); events without controls dropped; raw event means reported too",
    sample: "design universe events with the 30-day outcome available (window ended before 2026-06-15)",
    inference: "issuer-block bootstrap B = 2000 of the corner statistic; two-sided normal p" },
  familyB: { rules: RULES, G80, G80source: "design 80th percentile of gapEntry among universe events (feature-profile.json; at-entry information, no outcome)",
    common: "j0 = public-trader entry session; D = close of the symbol's last bar before j0; only bars completed before the rule's entry timestamp are used; exits: official close of the last session <= rule entry date + 30 calendar days (primary) / + 10 days (evc10); costs tier x1 per side; SPY over the same fills",
    controls: "the identical rule on each event's matched control stock-days (j0 = control entry session, D = its last close before j0); matched difference = event minus the mean of its controls that pass the rule; events with no passing control dropped from the difference",
    executionAssumption: "B3 needs a limit-on-open order at D x (1+G80) (fills at the official open only if open <= limit); B4 needs only a market-on-close order after the open is observed" },
  strategies: {
    template: { universe: "as data.universe", liquidityFloor: "dv20 >= $1,000,000 (cost tier <= 35 bps per side)", publicationTime: "no restriction", entry: "official open of the first session whose 09:28 ET MOO cut-off >= acceptance + 60 s (family B: the rule's entry)", sizing: "equal slots, 20 slots (5% each); skip when full", perCompanyCap: 1, exit: "official close of the last session <= entry date + 30 calendar days", holding: "30 calendar days", risk: "no stop; max 20 concurrent; 1 per issuer", costs: "tier 5/15/35/75/100 bps per side x1; sensitivity x0, x1, x2, x3" },
    baseline: "S0 = all universe events with the template", control: "SC = the matched controls of S0's events with the same entry/exit (no-insider control)",
    conversion: "S1/S2 = the two model strategies with the largest design top-base t among {M1, M2, M4, TREE, D1, D2} x {xs30, hit30} + EN(xs30) (M3 is a comparator, not an insider strategy), only if t > 0; S3 = the family-B rule with the largest design evc30 t, only if t > 0. Model strategy = executable selection (>= thr) of the frozen monthly model + template. No-floor version reported as sensitivity.",
    gates: { g1: "mean net excess (30d, tier x1, independent trades) > 0", g2: "minus S0 in the same months > 0 with p < 0.10", g3: "minus its own matched controls > 0", g4: "mean excluding the top-5 issuers > 0", g5: "mean at x2 costs > 0", g6: ">= 60% of evaluated months positive" },
    verdicts: {
      VALIDATED: "all design gates, key design test global BH q <= 0.10, and confirmation consistent (mean > 0, beats S0 and controls, >= 30 confirm trades). Confirmation alone never validates.",
      PROMISING: "g1 and g2 plus >= 2 more gates in design; confirmation not significantly negative",
      REJECTED: "fails g1 or g2 in design, or confirmation significantly negative / below S0",
      INSUFFICIENT_DATA: "< 50 independent design trades or < 20 confirmation trades",
    },
    metrics: "panel/strategyLib.mjs strategyMetrics (independent trades, win rate, mean/median net, vs SPY, profit factor, max DD, worst trade, exposure, time in market, monthly and issuer stability, cost sensitivity, CI, vs matched controls); winners/losers >= 10 each",
  },
  interpretability: { coefficients: "standardised coefficients per month and their sign stability; full-design in-sample fits (labelled in-sample) with issuer-bootstrap CIs", trees: "every monthly tree printed; full-design in-sample trees for M4 (events) and M3 (events vs controls)", permutation: "permutation importance on walk-forward predictions of M4 (xs30 ridge, hit30 logistic): each feature and each group permuted within month among scored events, 20 repeats, drop in IC / AUC" },
  confirmation: "after frozen.json (rules, procedure, grids, sha256 of scripts and spec.json): one run of the frozen walk-forward (monthly refits as frozen) through the confirm months and one run of the frozen strategies (S1-S3 if converted, S0, SC) and family-B rules; confirmation tests registered at freeze time",
  tests, familySizes: famSize,
};
const f = writeOut("spec.json", spec);
const h = sha256File(f);
fs.writeFileSync(outPath("spec.sha256"), `${h}  spec.json\n`);
checkpoint("spec", { sha256: h, tests: tests.length, families: famSize, features: FEATURES.length });
console.log(JSON.stringify({ written: path.relative(process.cwd(), f), sha256: h, tests: tests.length, families: famSize, features: FEATURES.length, G80, scriptDir: path.relative(process.cwd(), SCRIPTS) }, null, 1));
