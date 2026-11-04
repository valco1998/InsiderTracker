# Deep study 2: Stage 0 (audit, inventory, gaps, plan, feasibility)

Written 2026-11-04, before any deep-2 result was computed. The protocol constants are in `lib2.mjs`.

## 1. Audit of deep study 1

What it did: 2,523 tests on 9,324 priced purchase filings. The tests covered 30 pre-registered hypotheses, feature quintiles, tertile interactions, a depth-3 tree and a ridge model. Entry was the next regular open, with exits at 1/2/3/5/10/20/40/60 sessions. It judged results "abnormal" against same-month insider buys. Follow-ups covered the opening gap with a placebo, and an after-hours sample (614 filings).

| # | Weakness | Consequence |
|---|---|---|
| 1 | Venue is stated in only 25% of filings; 71% are "unspecified" | The "open market" groups miss most real open-market buys, and "all purchases" mixes in offerings, placements and fund allocations |
| 2 | Holdings change unused (`sharesOwnedAfter` exists on 99.8% of rows) | The best-documented insider-trading predictor in the literature, the % increase in the insider's position, was never tested |
| 3 | Insider **sales** unused (86,494 S rows in the store) | Net buying vs selling context, sellers at the same company, and an insider buying after a sale were all untested |
| 4 | Regime control only (same-month mean); no characteristic-matched control | Cannot say whether an effect is insider information or ordinary momentum, reversal, volatility or size |
| 5 | Only one entry rule for most events (next regular open, no conditioning) | Same-day open→close, gap-conditioned entries, and entries after the open's information were untested. 4-session exit missing |
| 6 | Per-event statistics only | No portfolio view: overlapping positions, capacity, equity curve, drawdown, turnover |
| 7 | Concentration checked only through clustered standard errors | No leave-top-issuers-out test, no median of issuer means, no share of issuers positive |
| 8 | After-hours study: one exploratory sample, 16:00–20:00 trades only; 16/614 windows truncated; no premarket; no quotes | Spreads unknown; overnight filings (20:00–09:30) never tested |
| 9 | The holdout (Sep–Nov) has been seen in aggregate by 2,523 tests, the gap study and the AH study | **It is no longer independent.** Deep-2 calls it "seen holdout"; only forward paper trading (or older backfilled history) is independent |
| 10 | Company sequences were summarised only as flags (cluster, escalation, …) | No per-company timeline reconstruction; no "reaction memory" (how the stock reacted to the previous filing) |
| 11 | Survivorship: 1,512 filings unpriced (no ticker / no bar) | Probably flatters results; still uncorrectable with current data |

Things deep 1 got right, which are kept:
- point-in-time event construction;
- entry ≥ acceptance + 60 s;
- liquidity-tiered costs;
- issuer-clustered t-statistics;
- chronological splits with an exit-date embargo;
- the full registry of tests.

## 2. Data inventory (verified 2026-11-04)

| Data | Coverage | Notes |
|---|---|---|
| SEC Form 4 store | 2025-12-01 → 2026-11-02, 227 days; 18,415 P rows, 86,494 S rows | Includes holdings after the trade, ownership D/I, nature of ownership, footnotes (64% of P rows), remarks, 10b5-1 flag, acceptance time, amendments, dedupe |
| Purchase-filing events (deep-1 stage C) | 10,836 filings; 9,324 priced; 59 features; horizons 1/2/3/5/10/20/40/60 | Features use only bars strictly before entry |
| Daily bars (Alpaca SIP, split-adjusted) | 2,427 symbols, 2025-10-01 → 2026-11-03 | Official open and close auction prints are usable as MOO/MOC fills; intraday paths are not |
| After-hours SIP trades | 614 filings published 16:00–19:55 ET, trades from acceptance to 20:00 ET | 43,743 trades; deep-1 exploratory sample |
| Raw daily bars for the AH sample | Same 614 | Split factors |
| App entry cache (`.cache/prices/_publication-entries.v1.json`) | Signals only (small) | First trade after publication for app signals |
| **Not available** | — | Minute bars (fetchable from Alpaca Basic: **approval needed**). Bid/ask quotes (the shared client has no quotes method). Market cap, sector, earnings dates, short interest, options. History before Dec 2025 (the backfill is still running: progress at 2025-12-24, last file written 02:18 today, last update 00:18Z; **observed only**) |

## 3. Important untested directions

1. **Purchase classification v2.** Is the trade price inside the trade date's daily low–high range? Footnote language (weighted average / range of prices → open market; offering / placement / underwritten / subscription → not). Fund or entity filers. Then re-ask every question on true open-market buys only.
2. **Conviction relative to holdings.** % increase in the position; the first purchase vs adding to a large position; buying with no prior holdings.
3. **Sales context.** Other insiders selling at the same company before or after; a buyer who sold earlier; the net buy/sell ratio at the issuer.
4. **Insider effect vs momentum.** Compare each event with matched non-event days of the same and similar stocks (same month, similar 5/20-day return, drawdown, volatility, liquidity). Report the insider-specific residual.
5. **Gap-conditioned entries.** Expected gap from the filing type vs the actual open, and continuation vs reversal from the open. Includes MOO→MOC same day and open→2/3/4/5 days.
6. **Company memory.** How the stock reacted to the previous insider filing at the same company, the n-th filing in a sequence, time since the last filing, and per-company timelines with chart reconstruction.
7. **Portfolio realism.** Concurrency limits, capacity (≤ 1% of 20-day dollar volume), equity curve, maximum drawdown, cost stress (×2), one-session delay.
8. **Track A, regular session.** Same-session trades on filings published 09:30–15:59. **Needs minute bars or trades (approval).**
9. **Track A, premarket.** Filings published 20:00–09:30. **Needs premarket trades (approval).**
10. **A clean out-of-sample period.** Older history from the backfill (approval, and only after the running backfill finishes) plus a forward paper test.

## 4. Prioritised plan (stages with checkpoints)

| Stage | Work | Owner | Output |
|---|---|---|---|
| 1 | Classification v2, holdings %, sales context, company memory, timelines, case studies | Insider-behaviour specialist | `deep2/behavior/` |
| 1 | Matched-control design (insider vs momentum), gap-conditioning, winner/loser chart structure | Chart/technical specialist | `deep2/chart/` |
| 1 | Execution framework: Track A (AH→open, AH→close, MOO→MOC) and Track B (2/3/4/5 days); costs, stress, delay, capacity, portfolio drawdowns | Execution specialist | `deep2/execution/` |
| 2 | Combine stage-1 candidates (discovery period only), confirm on Jun 15 – Aug 31, freeze rules with a hash | Quant lead (main session) | `frozen-rules.json` |
| 3 | Independent audit: code review for look-ahead, multiple-testing accounting, then a single evaluation on the seen holdout (Sep–Nov) | Statistical auditor | `deep2/audit/` |
| 4 | Report, raw event-level results, forward paper-trading spec | Main session | `deep2/report.html` |

Validation rules:
- Discovery uses events published before 2026-06-15 (exit before then).
- Confirmation uses 2026-06-15 → 2026-08-31 (exit before 09-01).
- The holdout is locked in code until `frozen-rules.json` exists and `DEEP2_HOLDOUT=1` is set.
- Every hypothesis is registered with its family size before its result is computed.
- A candidate needs all of the following:
  - discovery: BH q < 0.10 within its agent's registry, n ≥ 40, ≥ 25 issuers;
  - confirmation: same sign, p < 0.10, positive median of issuer means;
  - mean excluding the top-5 issuers keeps its sign;
  - net of costs.
- Nothing is called "independently validated". The best possible label is "survived the seen holdout; awaiting forward test".

## 5. Feasibility

| Experiment | With current data? |
|---|---|
| Classification v2, holdings, sales, company memory, timelines | Yes |
| Matched controls, gap conditioning, chart structure | Yes (daily) |
| Track B, 2–5 sessions, open entry, close exit | Yes (daily auction prices) |
| Track A: AH entry → next open or close | Yes, for the 614 cached filings only (already seen in deep 1) |
| Track A: MOO→MOC same session | Yes (auction prints; the conditional-on-open variant is flagged as optimistic) |
| Track A: regular-session entry after an intraday filing; stops and targets | **No.** Needs minute bars or trades (approval) |
| Premarket entry; extended-hours spreads | **No.** Needs a download (approval) and quotes (not in the client) |
| Clean out-of-sample history | **No.** Needs an older backfill (approval) or forward paper trading |
