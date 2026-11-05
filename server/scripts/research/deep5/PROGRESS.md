# Deep study 5: insider cluster buying and 180-day peaks — progress and restart

Last updated: 2026-11-05 (lead).

## Stages
| Stage | Status | Command / output |
|---|---|---|
| 0 coverage audit | done | `node scripts/research/deep5/coverage/coverage.mjs` → `.cache/research/deep5/coverage/coverage.json`. User approved "run now, then propose data" (2026-11-05). |
| 1 pre-registration | done | `prereg.json`, sha256 4a7de147… logged in `.cache/research/deep5/prereg.log` before any outcome was computed |
| 2 build (rows → clusters → outcomes → controls) | done | `node --max-old-space-size=6144 scripts/research/deep5/build.mjs` (≈15 s) |
| 3 selfcheck | done 9/9 | `node --max-old-space-size=6144 scripts/research/deep5/selfcheck.mjs` |
| 4 analysis + frozen strategies | done | `node --max-old-space-size=6144 scripts/research/deep5/analyze.mjs` → `stats.json`, `tests.csv`, `frozen-strategies.json` |
| 5 independent audit | done: construction reproduced exactly; P4-A also passes BH (wording fixed); SPY gap = universe effect; peak gap = volatility | `scripts/research/deep5/audit/`, `.cache/research/deep5/audit/findings.md` |
| 6 report | done: https://claude.ai/artifact/YKm47qwqTZCRExaBMBojQb | `node scripts/research/deep5/report/build.mjs` → `.cache/research/deep5/report.html` |

## Deviations from prereg (logged)
- Subgroup tests require ≥ 10 events on each side (added after seeing group sizes, before reading p-values): G6 (4), G8 (2), G9 (1) → INSUFFICIENT DATA.

## Build fixes made before any result was read
- Prior-return features were named r30/r60 and were overwritten by forward horizon returns (matching would have used future data) → renamed pr30/pr60.
- Split check: a price far from the bar close is accepted only if a standard split factor puts it inside the day's range.
- Owner linking on identical transactions restricted to indirect holdings; exact duplicate rows within a filing dropped; purchases within 5 sessions of a new listing excluded (IPO allocations).

## Restart
All stages are deterministic and cache-only; rerun stages 2 → 4 → 6 in order. Never modify `prereg.json` (its hash is logged).
