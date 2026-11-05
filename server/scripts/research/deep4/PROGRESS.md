# Deep study 4: progress and restart procedure

Last updated: 2026-11-04 (lead). Update at every stage change.

Question: can a repeatable strategy be **learned** from individual insiders' historical buying behaviour (not copying trades, not buyer position)?

Earlier studies (complete, never redo): deep 1, deep 2 (no edge after the open; the gap holds the information), deep 3 (buyer position refuted; all 5 leads failed). Reusable: `deep2/lib2.mjs`, `deep2/execution/execLib.mjs`, `deep2/chart/common.mjs`, `deep3/dataquality/validate.mjs`, `p-filings.json`, classification v2.

## Stages
| Stage | Owner | Status | Outputs |
|---|---|---|---|
| S0 protocol (`lib4.mjs`, BRIEF, this file) | lead | done | `deep4/` |
| S1 point-in-time panel, outcomes A/B, controls, shared strategy + walk-forward libraries (phases 1–2) | agent `panel` | **done** 2026-11-05: 6,663 design filings, 134 features, controls, libraries, selfcheck 21/21; lead froze panel code and built `panel-confirm.json`; findings.md saved | `.cache/research/deep4/panel/` |
| S2a insider profiles, behaviour-selection (family A) and adaptive track record (family C) (phase 3, 4.1/4.5/4.6, 6, 7) | agent `behavior` | **done**: 108 tests; no candidate; family A and C rejected in confirmation; findings.md saved | `.cache/research/deep4/behavior/` |
| S2b learned models, interactions, trees, regularised models, regimes, technical confirmation (family B), monthly walk-forward (phases 4.2–4.7, 5, 6, 7) | agent `learn` | **done**: 129 tests; S1/S2/S3 rejected; predictability is generic (controls-trained model); findings.md saved | `.cache/research/deep4/learn/` |
| S3 lead freeze (`frozen-rules.json` + sha256), then adversarial audit + one exposed-period run | lead + agent `audit4` | **done**: lead froze `frozen-rules.json` (sha256 5da97a99…3e4b7); audit CONFIRMED NO; 23 frozen rules all failed the single exposed-period run; control artefact found (A8); findings.md saved | `.cache/research/deep4/audit/` |
| S4 visual report | lead | **done**: https://claude.ai/artifact/Cf3WMk5vhXyCLvw4UcUjXv, built by `deep4/report/build.mjs` | `.cache/research/deep4/report.html` |

## Restart procedure
1. Read this file and `BRIEF.md`.
2. Finished agents have their findings saved by the lead in `.cache/research/deep4/<area>/findings.md`.
3. Interrupted agent: resume via SendMessage if its id is valid; else start a new one with the same brief plus "resume: inspect your output folder and the registry first; do not re-register or recompute finished work".
4. Never set `DEEP4_EXPOSED` except in the single auditor run after `frozen-rules.json` exists.

## Agent ids
- panel: a5d18426126e1d5f9 (done)
- behavior: abd26e69bd66a8ad3 (done)
- learn: aa1b2b1ffbd5e4f82 (done)
- audit4: a5130afa61b184d9f (done)

ALL STAGES COMPLETE (2026-11-05). Registry: 341 deep-4 results, all registered first.

## Interruption log
(none yet)
