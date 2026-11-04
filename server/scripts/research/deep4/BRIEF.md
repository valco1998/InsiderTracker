# Deep study 4: common brief for every agent

Goal: learn whether the **historical purchasing behaviour of individual insiders** (not "copy every buy", and not buyer position, which deep 3 refuted) can be turned into a repeatable, executable strategy. Output explicit strategy candidates, walk-forward backtests and honest verdicts.

Read first: `../deep2/BRIEF.md` (hard safety rules apply unchanged), `../deep3/BRIEF.md` (touch vs realised definitions, known facts), `./lib4.mjs`, `./PROGRESS.md`, and the findings in `server/.cache/research/deep{2,3}/*/findings.md`. Do not repeat what they established.

## Hard rules
- Read-only, cache-only, **no network**, no Alpaca/SEC calls, no MongoDB, no server, no git writes. Write only inside `server/scripts/research/deep4/<area>/` and `server/.cache/research/deep4/<area>/`.
- Subagents cannot write `.md`: return findings text in the final message; the lead saves it.
- Use `lib4.mjs` for periods, the leak guard and the registry. **Register every hypothesis/strategy (with family size) before computing its result.** Registration is idempotent.
- Never set `DEEP4_EXPOSED`, `DEEP2_HOLDOUT` or `DEEP3_HOLDOUT`. Only the auditor does, once, after the lead freezes.
- Confirmation-segment events (published 2026-06-15 → 08-31) are readable only after you wrote `server/.cache/research/deep4/<your-agent>/frozen.json` (exact rules + sha256 of your scripts). Run confirmation **once** per frozen candidate.

## Periods (lib4)
| Segment | Published | Use |
|---|---|---|
| design | < 2026-06-15; learning outcomes must end < 2026-06-15 | discovery, model/rule design, design-period walk-forward |
| confirm | 2026-06-15 → 2026-08-31 | one run of frozen candidates (outcomes may mature in Sep) |
| exposed | ≥ 2026-09-01 | seen in deep 1–3; auditor runs once; never "independent" |

## Point-in-time definitions
- **Decision time** t = SEC acceptance + 60 s. Public-trader entry = official open of the first session ≥ t (MOO cut-off 09:28 ET, as deep 2/3 `execLib.entryOf`). Strategies that wait for confirmation use only bars completed before their entry timestamp, entering at a later open.
- **Features** may use only: filings accepted before t; bars with date < entry date (or ≤ the last completed session before t); outcomes of earlier events whose full outcome window ended before date(t) (`maturedBy`). Trade-date information that only became public at acceptance is fine at t, never before.
- **Identity:** people via the app rule (`person` in `.cache/research/deep3/dataquality/p-filings.json`); joint filers once; economic dedupe. Insider history before 2025-12-01 is unknown (left-censored), state it.
- **Purchase class:** classification v2 (deep2 behavior). Primary universe = open-market, valued, priced.
- **Prices:** split-adjusted daily bars `.cache/research/daily-bars.json` (2025-10-01 → 2026-11-03). Form-4 prices are as-traded: convert with `execLib.adjFactor`. Never use deep-1 stage-C `priceVsTradePrevClose` / `insiderPremium` / `priceLevel` / `priceVsPrevClose` (look-ahead).
- **Calendar-day horizons** 5/10/20/30: exit at the official close of the last session ≤ entry date + D calendar days. Outcome is *censored* if that date > 2026-11-03.
- **Two outcomes:** (A) insider hypothetical mark-to-market from the reported price on the trade date, labelled unrealised; (B) public-trader executable return from the entry above. Touch ≠ limit fill ≠ realised net (deep-3 definitions). Costs: liquidity tier 5/15/35/75/100 bps per side, ×2 sensitivity. Always report SPY-relative and versus matched non-insider stock-days (deep2 `chart/common.mjs` method; deep3 targets `controls-primary.json` can be reused).
- **Statistics:** issuer-clustered (`companyStats`), month-level dispersion, ex-top-5 issuers, global Benjamini–Hochberg across the deep-4 registry. Overlapping 30-day positions: report the effective number of independent months/issuers.
- **Complexity limits:** trees depth ≤ 3, leaves ≥ 100 events and ≥ 40 issuers; regularised linear/logistic models with a fixed, pre-declared feature list; hyperparameters chosen only by time-ordered CV inside each training window; no unrestricted threshold grids (thresholds from design-period quantiles, declared in advance).

## Deliverable format per agent
- Event-level CSV/JSON behind every table; `candidates.json` (≤ 3 per agent; exact rules: qualifying events, price/volume conditions, liquidity floor, publication-time restriction, entry, sizing, per-company cap, exit, holding period, risk limits, costs).
- Final message: tests with family counts, tables, ≥ 10 winners and ≥ 10 losers for anything promising, a per-candidate verdict (VALIDATED FOR FURTHER PAPER TESTING / PROMISING BUT UNVALIDATED / REJECTED / INSUFFICIENT DATA) and the `findings.md` text.
