# Insider-buying research (offline)

Research scripts only. They never change the app, the live alert system, FCM, MongoDB or the
SEC backfill. Run them from `server/`:

```
npm run research:rapp       # RAPP case study: returns after each filing, 1/5/10/20/30/60 sessions
npm run research:patterns   # all purchase filings + app signals, pattern families, IS/OOS, FDR
```

Inputs: the stored SEC Form 4 history (`server/.cache/backfill/form4`, read-only) and Alpaca
SIP daily bars (split-adjusted; `ALPACA_API_KEY_ID` / `ALPACA_API_SECRET_KEY` in `server/.env`),
cached in `server/.cache/research/daily-bars.json` (refreshed once per day).

Outputs (git-ignored, `server/.cache/research/`, because they are derived from market data whose
redistribution licence is not verified):

| File | Content |
|---|---|
| `events.csv` | one row per purchase filing: SEC publication (ET), features known at that time, entry date / open, per-horizon gross, net, SPY, excess, max drawdown, max favorable move |
| `signals.csv` | the same for every default-strategy signal (2 buyers, ≥ $250k, 30 days) |
| `patterns.json` | every pattern variant × horizon: all / in-sample / out-of-sample statistics, FDR q-values, verdicts, monthly consistency |
| `report.md` | the summary tables |
| `rapp-horizons.json` | the RAPP case study |

## Rules (no look-ahead)

- **Event** = one Form 4 filing with code-P purchases, evaluated at T = its SEC acceptance time.
- **Known at T**: only purchases whose filings were accepted by T, with point-in-time duplicate
  grouping (`signals.groupVersions`) and identities built from those rows only.
- **Price features** (prior 5/10/20-session return, price vs prior close, 20-day dollar volume)
  use closes strictly before the transaction date.
- **Entry**: open of the first NYSE session whose 09:30 ET open is at or after T + 60 s.
- **Exit**: close of the N-th session after the entry session (N = 1, 5, 10, 20, 30, 60).
  Exits after the last complete session are `pending`; missing bars are counted, never filled.
- **Costs** per side by liquidity (20-day average dollar volume): ≥ $50M 5 bps, $5–50M 15,
  $1–5M 35, < $1M 75, unknown 100.
- **Benchmarks**: SPY, and IWM (Russell 2000) over the same entry open → exit close.
- **Statistics**: t-statistics with standard errors clustered by issuer; Benjamini–Hochberg
  q-values over all in-sample tests (variants × horizons); a result counts as *validated* only
  when in-sample q < 0.10 **and** out-of-sample has the same sign with p < 0.05.
- **Split**: in-sample = published before 2026-08-01, out-of-sample = on or after.

## Known limitations

- Daily open/close (not trade-level) for thousands of events; dividends not included.
- Tickers without bars (renamed, delisted, OTC) are excluded and counted.
- About 9 months of SEC history, one market regime; long horizons are mostly pending for recent
  events.
- Venue is only what the filing states; most filings do not state it.

## Deep study (`scripts/research/deep/`)

Read-only against the store; outputs go to `.cache/research/deep/`.

| Script | Purpose |
|---|---|
| `deepResearch.mjs` | Stages A–G with checkpoints (`stageA.json` … `stageG.json`); `--force=D` re-runs from a stage. A audit · B company behaviour · C features (`features.mjs`) + returns · D train-only discovery (30 pre-registered hypotheses, quintiles, interactions, tree, ridge; every test in `registry.jsonl`) · E validation/test promotion (`registry-results.jsonl`) · G report data |
| `followups.mjs` | Opening gap (stock gap − SPY gap) vs placebo 10 sessions earlier, by group, split, publication time and month → `followups.json` |
| `afterHoursStudy.mjs` | After-close filings: first representative SIP trade ≥ 60 s after acceptance → next open / closes, raw basis with split factor; trades cached → `afterHours.json` |
| `printAfterHours.mjs` | Console summary of the after-hours study |
| `buildReport.mjs` + `reportTemplate.html` | Builds `report.html` from saved outputs (no recomputation) |

Differences from the first study: train < 2026-06-15 ≤ validation < 2026-09-01 ≤ test, embargo by
exit date; promotion uses the excess over the same-month mean of all insider purchases
("abnormal"), because the whole universe drifted negative vs SPY over the year. Promotion rule:
train q < 0.10, n ≥ 60, ≥ 30 issuers → validation same sign p < 0.05 → test.

## Deep study 2 (`scripts/research/deep2/`)

Multi-agent follow-up: an insider-behaviour, a chart/momentum and an execution specialist, followed by an independent auditor. Start with `STAGE0.md` (audit of deep 1, data inventory, plan) and `BRIEF.md` (rules).
- `lib2.mjs` is cache-only: no network.
- It hides events published on or after 2026-09-01 unless `frozen-rules.json` exists and `DEEP2_HOLDOUT=1` is set.
- It refuses results for unregistered hypotheses.

Per-area scripts are in `behavior/`, `chart/`, `execution/` (`execLib.mjs` = reusable execution framework) and `audit/`. Outputs and `findings.md` files are in `.cache/research/deep2/<area>/`. The report is built from `report/body.html` + `report/_style.html` → `.cache/research/deep2/report.html`.

Note: deep-1 fields `priceVsTradePrevClose`, `insiderPremium` and `priceLevel` mix raw and split-adjusted prices and encode future reverse splits (audit A5). Do not use them.

## Deep study 3 (`scripts/research/deep3/`)

Buyer-sequence research (buyer #k per calendar month and rolling 30 days), +5/10/15/20% touch and time-to-target analysis against matched controls, full data inventory and integrity audit (with `dataquality/validate.mjs`, a statistics helper), an adversarial audit, and a report.

- Start with `PROGRESS.md` (stages, restart procedure) and `BRIEF.md`.
- Outputs and `findings.md` files are in `.cache/research/deep3/<area>/`.
- Build the report with `node scripts/research/deep3/report/build.mjs`.
