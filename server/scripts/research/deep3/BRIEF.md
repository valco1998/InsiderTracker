# Deep study 3: common brief for every research agent

Read this first. Then read `../deep2/BRIEF.md`: all of its **hard safety rules and protocol apply unchanged** (read-only, no network, own folders only, no DEEP2_HOLDOUT, register before computing, discovery-only thresholds, no intraday simulation from daily candles, company-aware statistics). Then read `../deep2/STAGE0.md`, `../deep2/lib2.mjs` and `PROGRESS.md` (this folder). Read the deep-2 findings in `server/.cache/research/deep2/{behavior,chart,execution,audit}/findings.md`. Do not repeat what they already established; build on it.

## Folders
- Scripts: `server/scripts/research/deep3/<area>/`.
- Outputs: `server/.cache/research/deep3/<area>/`.
- Registry for deep 3: call lib2's `registerHypothesis` / `recordResult`, but write to the deep-3 registry. Copy those two functions into your own `common.mjs`, pointing at `server/.cache/research/deep3/registry.jsonl` and `registry-results.jsonl`, with ids prefixed by your agent name.
- Subagents cannot write `.md` files. Put the content of `findings.md` in your final text report, and the lead saves it.

## Known facts you must respect
- **Periods (lib2):**
  - discovery: published < 2026-06-15;
  - confirmation: up to 2026-08-31;
  - seen holdout: ≥ 2026-09-01, locked; only the auditor touches it.
- **Information is priced into the opening gap.** Insider events gap +1.5–3% more than matched controls. After the open, the residual is only about +0.2–0.3% on days 0–1. The average round trip costs about 0.7%. Measure everything **from a price a public trader could get** (the official open of the first session ≥ acceptance + 60 s, or an official close), never from the insider's transaction price.
- **Look-ahead to avoid:** deep-1 stage-C fields `priceVsTradePrevClose`, `insiderPremium` and `priceLevel` mix raw and split-adjusted prices (they encode future reverse splits). Do not use them; use bars, or `execLib.adjFactor`, for as-traded prices.
- **Purchase classes:** use classification v2 from `.cache/research/deep2/behavior/filing-class.json` / `rows-classified.json` (classes: open-market, entity, offering/plan, unknown) wherever "genuine purchase" matters. It covers non-holdout filings only. Classify holdout filings with the same frozen code (`scripts/research/deep2/behavior/classify.mjs` logic, copied into your folder) only if needed, and never evaluate outcomes there.
- **Identity:** distinct insiders are people, not filings. Joint filers and fund vehicles reporting the same economic transaction count once. Use stage-C/economic dedupe (`dedupe` field; `snap.economic` is already deduped economically), `insiderCik` and the related-owner logic. Document your rule.

## Touch vs realised profit (the user insists on this distinction)
- **Touch:** the stock's split-adjusted daily **high** reached entry × (1 + X) within N sessions (X ∈ 5/10/15/20%), counted from a publicly obtainable entry price. A touch is a descriptive probability, **not** a profit.
- **Time to target:** sessions from entry to the first session whose high ≥ the target. Also report time to the maximum high within the window, the maximum favourable excursion (MFE), and the maximum adverse excursion (MAE, from daily lows).
- **Realised, executable:** exit at an official close (N = 1, 2, 3, 5, 10), net of costs (tier ×1 and ×2), minus SPY.
- **Limit take-profit approximation (secondary, clearly labelled):** a resting sell limit at entry × (1 + X) is filled at max(open, target) on the first session where high ≥ target × 1.005 (0.5% buffer against odd-lot or bad prints). If the same session's low also breaches a stop, assume the stop filled first (worst case). Otherwise exit at the close of N.
- **Baselines:** touch probabilities depend heavily on volatility. Always compare with matched non-event stock-days (same month, same liquidity tier, similar 20-session volatility and prior 5/20-session return), copying `deep2/chart/common.mjs`, and with the all-insider-purchase baseline. Report the insider minus baseline difference in hit rate, with issuer-clustered uncertainty.

## Output requirements
- `candidates.json`: at most 5, each with an exact rule (entry, exit, invalidation), discovery and confirmation `companyStats`, hit rates against baselines, and an executable net result.
- Event-level CSV/JSON for every table that supports a conclusion.
- A final text report with:
  - every test with its family count;
  - tables;
  - winners **and** losers (at least 10 each for anything promising), with chart descriptions (prior 60 sessions, gap, volume, path after);
  - a summary under 500 words.
