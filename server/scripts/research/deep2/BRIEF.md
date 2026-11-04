# Deep study 2: common brief for every research agent

Read this, then `STAGE0.md` (same folder), then `lib2.mjs`. The project is InsiderTracker (`C:\Users\akiva\insider-tracker`). Run commands from `server/` using Node (there is no Python).

## Goal
Find ONE genuinely useful, repeatable, executable strategy built from SEC Form 4 insider activity and price behaviour, or show convincingly that none exists in this data. Seriousness matters more than speed; do not manufacture a positive backtest. Depth (event-level inspection, economic reasoning) beats breadth (parameter sweeps).

## Hard safety rules (violating any of these is a failure)
- Read-only research. Write only under `server/scripts/research/deep2/<your-area>/` (scripts) and `server/.cache/research/deep2/<your-area>/` (outputs). Do not edit any other file, including `lib2.mjs`, `lib.mjs` or deep-1 scripts. If you need a helper, copy it into your own folder.
- **No network.** Never call `loadDailyBars`, `fetchTrades`, `fetchRawDaily`, `createAlpacaClient` or anything else that hits Alpaca, SEC or any API. Use `lib2.loadBars()`, `lib2.loadEvents()` and `lib2.loadSecRows()` (all cached on disk). The cached after-hours trades are at `.cache/research/deep/ah-trades-cache.json`, with raw dailies in `ah-raw-daily.json` and results in `afterHours.json` (read-only).
- Do not touch MongoDB, `.env` files, servers, ports 5055/5056/5176, background processes, the SEC backfill (`.cache/backfill`), git, the client or any production code. Do not install packages.
- Never set `DEEP2_HOLDOUT`. Events published on or after 2026-09-01 are the seen holdout. Only the auditor evaluates them, after the rules are frozen. Do not read stageC/followups/afterHours fields for holdout events by bypassing `lib2` (for the AH cache, ignore filings published on or after 2026-09-01).

## Protocol
- Periods (in `lib2`):
  - discovery: published < 2026-06-15, with exit < 2026-06-15;
  - confirmation: 2026-06-15 → 2026-08-31, with exit < 2026-09-01.
  - Use `usable(e, H, period)`.
- **Register before you compute.** Call `registerHypothesis({ agent, id, family, familySize, statement, rationale, preRegistered })` for each hypothesis BEFORE computing it, then `recordResult(id, agent, result)`. `familySize` = how many variants you will test in that family; count honestly, including thresholds you try. Use ids prefixed with your agent name.
- Thresholds are chosen on discovery only. Confirmation is looked at once per frozen candidate, not used for tuning. If you tune after seeing confirmation, say so and treat the result as discovery-only.
- Statistics:
  - use `companyStats(rows)` with rows `{ issuer, x }`, where x is per-event net excess return vs SPY;
  - report n, issuers, mean, median, median of issuer means, % positive, clustered t/p, mean excluding the top-5 issuers, and the issuer-bootstrap CI;
  - apply BH across your registered tests (`bhQ`).
- Returns:
  - stage-C events have `entryPrice` (open of the first session ≥ acceptance + 60 s), `costBpsPerSide`, and `h[N]` for N ∈ 1,2,3,5,10,20,40,60 (exit = close of the N-th session after entry; fields gross, net, spy, excess, excessNet, maxDrawdown, maxFavorable, exitDate, exitPrice);
  - for other prices (day-0 close, 4-session exit, prior bars) use `loadBars()` with split-adjusted bars `{d,o,h,l,c,v}`, and always compare with SPY over the same dates;
  - net = gross minus `costBpsPerSide` on each side.
- **No intraday simulation from daily candles.** Allowed fills: official open and official close (auction) prices, plus cached SIP trades. Not allowed: intraday stops, targets, high/low fills, or "entered at the low". If a rule needs intraday paths, write it up as "needs minute data" and stop there.
- Conditioning on the day's own open price and also filling at that open is optimistic. Flag it, and also report a version that fills at that day's close or the next open.
- Economic sense first: state the mechanism for every hypothesis. Look at individual events: print 10 or more winners and losers for any promising rule, and describe their charts (prior 20/60-session path, gap, volume) in words.

## Deliverables (in `.cache/research/deep2/<your-area>/`)
- `findings.md`:
  - what you tested (with the count), what failed, and what is promising;
  - for each candidate:
    - the exact rule: when to buy, when to sell, what invalidates it;
    - discovery and confirmation stats;
    - company concentration;
    - winners vs losers;
    - mechanism;
    - whether it is plausibly just momentum or reversal;
    - whether it is executable.
- `candidates.json`: an array of `{ id, rule (a precise, machine-checkable description), entry, exit, horizon, discovery: companyStats, confirmation: companyStats, notes }`. Keep it to at most 5 candidates.
- Raw event-level CSV/JSON for every candidate (one row per event with all fields used).
- Scripts must be re-runnable: `node scripts/research/deep2/<area>/<name>.mjs`.

End with a short summary (under 400 words) of the findings and candidates.
