// deep4/behavior/02_styleRules.mjs — DECLARE the style rules: thresholds = design-segment quantiles over primary purchases.
// FEATURES ONLY (no outcome field is read). Writes style-rules.json once; refuses to overwrite it (rules are frozen).
//   node --max-old-space-size=6144 scripts/research/deep4/behavior/02_styleRules.mjs
import path from "node:path";
import { loadDesign, isPrimaryPurchase, writeJson, exists, checkpoint, sha256File, SCRIPTS, r4, group } from "./common.mjs";
import { computeThresholds, labelsOf, ALL_LABELS, LABEL_TEXT, EPISODE_GAP_DAYS, STYLE_RULES_FILE } from "./styles.mjs";

// Revisions (all made before ANY outcome field was read by this agent):
const REVISIONS = [
  { at: "2026-11-04T22:52Z", what: "FOLLOW := null whenever ctxTrunc30 = 1 (first version labelled truncated-window purchases 1 when a buyer was seen and null otherwise, which forced a 100% December rate: selection bias). Feature-only reason; thresholds unchanged." },
];
if (exists(STYLE_RULES_FILE)) { console.log("style-rules.json already exists: rules are frozen, not recomputed"); process.exit(0); }
const { rows } = loadDesign();
const prim = rows.filter(isPrimaryPurchase);
const th = computeThresholds(prim);
// base rates (features only)
const base = {}, byMonth = {};
for (const k of ALL_LABELS) { const v = prim.map((r) => labelsOf(r, th)[k]).filter((x) => x === 0 || x === 1); base[k] = { n: v.length, rate: r4(v.reduce((a, b) => a + b, 0) / v.length) }; }
for (const [m, rs] of [...group(prim, (r) => r.month).entries()].sort()) { byMonth[m] = {}; for (const k of ALL_LABELS) { const v = rs.map((r) => labelsOf(r, th)[k]).filter((x) => x === 0 || x === 1); byMonth[m][k] = v.length ? r4(v.reduce((a, b) => a + b, 0) / v.length) : null; } }
const out = {
  declaredAt: new Date().toISOString(), agent: "behavior", segment: "design (published < 2026-06-15), primary purchases (open-market class v2, valued, priced, isPrimary)",
  note: "Declared from feature quantiles BEFORE any outcome was read; used unchanged for profiles, family A, strategies and the confirmation run.",
  thresholds: th, labels: LABEL_TEXT, episodeRule: `per person and issuer, a purchase starts a new episode when the person's previous purchase at that issuer was > ${EPISODE_GAP_DAYS} calendar days earlier (acceptance dates)`,
  revisions: REVISIONS, baseRates: base, baseRatesByMonth: byMonth, script: { file: "02_styleRules.mjs", sha256: sha256File(path.join(SCRIPTS, "02_styleRules.mjs")), styles: sha256File(path.join(SCRIPTS, "styles.mjs")) },
};
writeJson(STYLE_RULES_FILE, out);
checkpoint("02_styleRules", { thresholds: th });
console.log(JSON.stringify(out, null, 1));
