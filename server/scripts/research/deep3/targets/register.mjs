// deep3/targets/register.mjs — registers EVERY planned test (deep-3 registry) and freezes the protocol, BEFORE any
// outcome statistic is computed. Idempotent: re-running never re-registers an id.
//   node scripts/research/deep3/targets/register.mjs
import crypto from "node:crypto";
import { reg, writeOut, readOut, existsOut, checkpoint, myRegistry, TARGETS, HORIZONS, STOPS, TP_N } from "./common.mjs";
import { patternList, PATTERN_TESTS } from "./defs.mjs";

const TH = readOut("thresholds.json");
const P = patternList(TH);

const protocol = {
  agent: "targets", writtenAt: new Date().toISOString(),
  universe: "Priced stage-C purchase filings (lib2.loadEvents; holdout hidden) with >= 26 prior bars. 'om' = classification-v2 open-market filings by individuals (deep2/behavior/filing-class.json); 'all' = every class.",
  entry: "Official open of the first session >= acceptance + 60 s (stage C). Touches are measured from this price, never from the insider's price.",
  outcomes: {
    touch: "daily HIGH >= entry*(1+X) in sessions 0..N (X = 5/10/15/20 %, N = 1/2/3/5/10). Descriptive probability, NOT a profit.",
    limitFill: "APPROXIMATION: sell limit at entry*(1+X) filled at max(open, target) on the first session whose high >= target*1.005; stop at entry*(1-S) filled at min(open, stop); stop assumed first when both are breached in one session; otherwise close of session N. Net of tier cost per side; minus SPY (SPY open of session 0 -> SPY close of the exit session).",
    executable: "Official close of session N (1/2/3/5/10), net of tier cost per side, minus SPY.",
    risk: "MAE = min daily low / entry - 1 over sessions 0..N; dd10_N = 1[MAE <= -10%].",
  },
  controls: "Primary: K = 10 stock-days with no code-P filing within +-20 sessions, same entry month, liquidity tier, period; nearest on r5, r20, dd60, log vol20, log dollar volume, prior-day gap (deep2/chart design); charged the event's cost. Chart-pattern tests use controls matched WITHIN the same chart pattern. Robustness variants: 'gap' (+ entry-day gap) and 'volRich' (+ log vol60, volume spike).",
  statistic: "Per-event x = event outcome - mean(controls) for touch/MAE probabilities ('diff'); x = event net excess vs SPY for limit-fill and close exits ('abs'). lib2.companyStats (issuer-clustered t, median, issuer medians, ex-top-5, issuer bootstrap CI). BH over ALL of this agent's discovery tests.",
  embargo: "Discovery: published < 2026-06-15 and every session read < 2026-06-15. Confirmation: 2026-06-15..2026-08-31, sessions < 2026-09-01. Holdout never read.",
  promisingRule: "A pattern is PROMISING if in discovery (a) its hit10_5 diff has BH q < 0.10, n >= 40, >= 25 issuers, positive mean AND positive issuer median of the diff; or (b) its tp10s10n5 or x5 absolute net excess has BH q < 0.10, n >= 40, >= 25 issuers, mean > 0 and issuer median > 0. Only promising patterns get robustness checks (registered before computing) and ONE confirmation evaluation.",
  candidateRule: "A candidate (<= 5) needs: promising in discovery; executable net > 0 (close exit via execLib with mooCutoff 09:28, requireVolume, excludeSuspects, tier x1) in discovery; confirmation same sign with p < 0.10 and positive issuer median; mean ex-top-5 issuers keeps its sign; survives cost x2. Touch-only effects (more large moves without executable profit) are reported as descriptive findings, not candidates.",
  order: "Simple patterns (F01-F20) are computed and reported before combinations (F21).",
  thresholds: TH,
};
const protoStr = JSON.stringify(protocol, null, 1);
const hash = crypto.createHash("sha256").update(protoStr).digest("hex");
const already = myRegistry().length;

let n = 0;
const R = (h) => { if (reg(h)) n++; };
// ---------------- overall (discovery) ----------------
const fOV = "targets-OV overall insider vs controls (discovery)";
const OVsize = 20 + 2 + 24 + 5 + 8 + 2 + 6;
for (const X of TARGETS) for (const N of HORIZONS) R({ id: `targets-OV-om-hit${X}_${N}`, family: fOV, familySize: OVsize,
  statement: `Discovery, open-market filings: P(touch +${X}% within ${N} sessions of the entry open) minus matched controls' touch rate differs from 0 (issuer-clustered).`,
  rationale: "Large-move lens: do insider filings reach large targets more often than volatility/momentum-matched non-event stock-days? Touch is descriptive, not profit." });
for (const N of [5, 10]) R({ id: `targets-OV-om-dd10_${N}`, family: fOV, familySize: OVsize, statement: `Discovery, om: P(MAE <= -10% within ${N} sessions) minus matched controls differs from 0.`, rationale: "Drawdown risk side of the large-move lens." });
for (const X of TARGETS) for (const S of STOPS) for (const N of TP_N) R({ id: `targets-OV-om-tp${X}s${S}n${N}`, family: fOV, familySize: OVsize,
  statement: `Discovery, om: mean net excess vs SPY of the LIMIT-FILL APPROXIMATION (target +${X}%, ${S ? `stop -${S}%` : "no stop"}, else close of session ${N}) differs from 0.`,
  rationale: "Can touches be monetised with a resting limit (approximation with worst-case stop ordering and a 0.5% fill buffer)?" });
for (const N of HORIZONS) R({ id: `targets-OV-om-x${N}`, family: fOV, familySize: OVsize, statement: `Discovery, om: entry open -> close of session ${N}, net excess vs SPY differs from 0.`, rationale: "Executable baseline (deep 2 found ~0/negative at 1-5; included so every exit is in one family)." });
for (const X of TARGETS) for (const N of [5, 10]) R({ id: `targets-OV-all-hit${X}_${N}`, family: fOV, familySize: OVsize, statement: `Discovery, all classes: touch +${X}% within ${N} sessions minus matched controls differs from 0.`, rationale: "Same lens on every purchase filing (offerings and fund allocations included)." });
for (const N of [5, 10]) R({ id: `targets-OV-all-dd10_${N}`, family: fOV, familySize: OVsize, statement: `Discovery, all classes: P(MAE <= -10% within ${N}) minus controls differs from 0.`, rationale: "Risk side, all classes." });
for (const v of ["gap", "volRich"]) for (const k of ["hit10_5", "hit10_10", "dd10_5"]) R({ id: `targets-OVR-om-${v}-${k}`, family: fOV, familySize: OVsize,
  statement: `Discovery, om, control variant ${v}: ${k} event minus controls differs from 0.`,
  rationale: v === "gap" ? "Controls with the same entry-day gap: separates 'news day' range expansion from insider-specific behaviour." : "Controls also matched on vol60 and the volume spike (imbalanced under primary matching)." });
// ---------------- overall confirmation (one pre-registered evaluation) ----------------
const fOC = "targets-OC overall confirmation (single evaluation)";
for (const u of ["om", "all"]) for (const k of ["hit10_5", "dd10_5", "tp10s10n5", "x5"]) R({ id: `targets-OC-${u}-${k}`, family: fOC, familySize: 8,
  statement: `Confirmation (2026-06-15..08-31), ${u}: ${k} (${k.startsWith("hit") || k.startsWith("dd") ? "event minus matched controls" : "absolute net excess vs SPY"}) has the same sign as discovery.`,
  rationale: "Evaluated once, after the discovery analysis, with no tuning." });
// ---------------- patterns (discovery) ----------------
for (const p of P) for (const t of PATTERN_TESTS) R({ id: `targets-P-${p.id}-${t.k}`, family: `targets-${p.family}`, familySize: P.filter((q) => q.family === p.family).length * PATTERN_TESTS.length,
  statement: `Discovery, ${p.universe === "om" ? "open-market filings" : "all classes"}, pattern ${p.id} (${p.label}): ${t.desc} differs from 0.`,
  rationale: `${p.mechanism}${p.chart ? ` Controls matched within chart pattern '${p.chart}'.` : ""}` });
// ---------------- interpretable models ----------------
const fM = "targets-M interpretable models (fit on discovery om, evaluated once on confirmation om)";
for (const y of ["hit10_5", "dd10_5"]) {
  R({ id: `targets-M-logit-${y}-aucLift`, family: fM, familySize: 6, statement: `Confirmation: AUC of a 7-feature logistic model for ${y} (lvol20, ldv20, dd60, r5, CEO/CFO, cluster>=2, log value) minus AUC of the volatility-only logistic (lvol20) > 0.`,
    rationale: "Does insider/chart information add predictive lift for large moves beyond volatility?" });
  R({ id: `targets-M-logit-${y}-topQ`, family: fM, familySize: 6, statement: `Confirmation: in the top quintile of the full model's predicted ${y}, observed rate minus the volatility-only model's predicted rate > 0.`, rationale: "Lift where a trader would act (top quintile)." });
}
R({ id: "targets-M-tree-hit10_5-aucLift", family: fM, familySize: 6, statement: "Confirmation: AUC of a depth<=3 tree (min leaf 150) for hit10_5 minus AUC of the volatility-only logistic > 0.", rationale: "Non-linear interpretable check." });
R({ id: "targets-M-tree-hit10_5-topLeaf", family: fM, familySize: 6, statement: "Confirmation: in the discovery top leaf (highest hit rate, n >= 150), observed hit10_5 minus the volatility-only predicted rate > 0.", rationale: "Does the best tree segment keep its excess?" });

if (!existsOut("protocol.json")) writeOut("protocol.json", { ...protocol, sha256: hash }); // first version is the frozen one
const total = myRegistry().length;
checkpoint("register all discovery hypotheses", { newlyRegistered: n, totalRegistered: total, protocolSha256: hash, registeredBefore: already });
console.log(JSON.stringify({ newlyRegistered: n, totalRegistered: total, patterns: P.length, protocolSha256: hash }));
