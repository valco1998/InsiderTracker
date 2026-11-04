# Deep study 3: progress and restart procedure

Last updated: 2026-11-04 (lead). Update this file at every stage change.

## Status of earlier work (complete, do not redo)
- **Deep 1:** complete. Its report is published. It has a known look-ahead in `priceVsTradePrevClose` / `insiderPremium` / `priceLevel` (deep-2 audit A5).
- **Deep 2:** complete. It was interrupted by the 5-hour limit, then resumed and finished.
  - behaviour: 51 tests;
  - chart: 155 tests;
  - execution: 623 tests and simulations;
  - frozen rules F1–F3 (sha256 4b1ac11d…1a0f);
  - the auditor ran the seen holdout once, and all three failed;
  - report published.
  - Outputs: `.cache/research/deep2/*`.
- **Reusable assets:**
  - `deep2/lib2.mjs` (cache-only, leak guard, registry, companyStats);
  - `deep2/execution/execLib.mjs` (execution framework);
  - `deep2/chart/common.mjs` (matched controls);
  - `.cache/research/deep2/behavior/rows-classified.json` + `filing-class.json` (classification v2), `timelines.json`.

## Deep 3 scope (new questions only)
1. **Monthly buyer-position sequences (highest priority).** Point-in-time buyer #k; amounts, roles, holdings; touches of +5/10/15/20% and time to reach them; MFE/MAE; executable net returns at 1/2/3/5/10 sessions; the largest purchase in a sequence.
2. **Touch, hit-rate and time-to-target lens on other patterns,** with volatility-matched baselines.
3. **Full data inventory and data quality,** plus the exact scope of any download that would materially help (for approval).
4. Freeze → adversarial audit → seen holdout once → report.

## Stages

| Stage | Owner | Status | Outputs |
|---|---|---|---|
| S0 inventory check, brief, progress file | lead | done | `deep3/BRIEF.md`, this file |
| S1a buyer-sequence research (calendar month + rolling 30 days) | agent `sequence` (role A) | **done**: 293 tests, no candidates; 3 frozen leads failed confirmation; `findings.md` saved | `.cache/research/deep3/sequence/` |
| S1b targets, price action, other patterns | agent `targets` (role B) | **done**: 349 tests, no candidates (othersPlanOnly and C5 failed confirmation); `findings.md` saved | `.cache/research/deep3/targets/` |
| S1c data integrity, inventory, validation module, download scope | agent `dataquality` (roles E+F) | **done**: 34 issues, validate.mjs (52/52 checks), ranked download scope; `findings.md` saved | `.cache/research/deep3/dataquality/` |
| S2 strategy families A (intraday) and B (2–5 days), full metrics via execLib, then freeze with hash | agent `strategy` (roles C+D) + lead | pending: starts after S1 | `.cache/research/deep3/strategy/`, `frozen-rules.json`, `frozen.log` |
| S3 adversarial audit; one run on the previously exposed Sep–Nov period | agent `audit3` (role G) | **done**: overall CONFIRMED NO; all five leads failed the exposed period; findings.md saved. Five leads frozen at 2026-11-04 (frozen-rules.json sha256 3ca2c3c4…6f72d21). A separate S2 strategy agent was skipped: both research agents already produced full strategy metrics through execLib for every lead, so it would only repeat that work | `.cache/research/deep3/audit/` |
| S4 visual report with case-study charts | lead | **done**: published as a private artifact (https://claude.ai/artifact/LF9LgDXM5mHixGAouTeRRD), built by scripts/research/deep3/report/build.mjs | `.cache/research/deep3/report.html` (artifact) |

Experiments completed in deep 3: about 683 registered tests (sequence 293, targets 349, audit3 37; dataquality 0) plus the inventory and audit. ALL STAGES COMPLETE. Registry: `.cache/research/deep3/registry.jsonl` and `registry-results.jsonl`.

## Unresolved data issues
- No minute bars, quotes, or premarket trades. After-hours trades are cached only for 614 filings.
- 1,512 purchase filings are unpriced (646 no ticker, 845 no entry bar, 21 no price data). The `dataquality` agent quantifies how many are recoverable and what that would cost.
- The SEC backfill is stalled at 2025-12-24 (progress updated 2026-11-04 00:18Z). It is observed only, never touched.
- The holdout (published ≥ 2026-09-01) has been seen twice (deep 1 in aggregate; the deep-2 frozen rules). The deep-3 holdout evaluation is "seen holdout" and cannot validate anything independently.

## Restart procedure after a usage-limit interruption
1. Read this file and `deep3/BRIEF.md`.
2. Check which agents finished: look for `findings.md` (or the lead-saved copy) in `.cache/research/deep3/<area>/`.
3. For an interrupted agent: resume it with SendMessage if its id is still valid. Otherwise start a new agent with the same brief and the instruction "resume: inspect your output folder and the registry first; do not re-register or recompute finished work".
4. Never set `DEEP2_HOLDOUT`/`DEEP3_HOLDOUT` except in the single auditor run, and only after `frozen-rules.json` exists.

## Team mapping (user roles A–G)
- A, insider sequence: `sequence`.
- B, price action: `targets`.
- C + D, strategy and execution: `strategy` (after S1, reusing deep-2 execLib).
- E + F, statistical validation and data integrity: `dataquality` (its validate.mjs is shared with the others).
- G: `audit3`.

Roles are combined where the work overlaps, to avoid redundant agents.

## Interruption log
- 2026-11-04 ~19:45: all three S1 agents hit the 5-hour limit while still reading the brief. Nothing was lost, because no output existed yet. They were resumed after the reset with the added requirements:
  - rolling 30-day sequences;
  - touch / limit fill / executable kept separate;
  - full strategy metrics;
  - extra pattern families;
  - the corporate-action audit.

## Resume commands (from server/)
- Check outputs: `ls .cache/research/deep3/*/` and `wc -l .cache/research/deep3/registry*.jsonl`.
- An agent with outputs but no final report: resume it via SendMessage ("resume from your checkpoint files; do not re-register").
- Re-run finished scripts with `node scripts/research/deep3/<area>/<script>.mjs`. Registration is idempotent.
