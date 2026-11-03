# Insider Tracker — Historical Insider-Buying Backtest

Page: `/insider/backtesting` · API: `/api/insider/backtest/*` · Code: `server/services/backtest/`

The backtest evaluates whether historical **clusters of SEC Form 4 insider purchases**
were followed by stock returns. It uses real data only. Without a licensed price
source it shows the real signals in a **"Price data required"** state and computes no
performance numbers.

## User-defined strategies (2026-11-03) — read this first

There is no fixed trading strategy. Every parameter is the user's choice; the form's
starting values (2 buyers, $250,000, 30 days, 20 sessions, 60 s) are examples only.

| Parameter | Field | Notes |
|---|---|---|
| Date range | `from`, `to` | Publication dates (SEC acceptance, ET) |
| Min distinct buyers | `minBuyers` | 1 – 100,000. SEC CIK; joint filers / confirmed duplicate reports = 1 |
| Min combined value (USD) | `minValueUsd` | **At least** (≥) — sum of all qualifying purchases of all buyers |
| Rolling window | `windowDays` | 1 – 3,650 calendar days of **trade dates** (grouping only) |
| Max filing delay | `maxFilingDelayDays` | **Optional, off by default.** Per purchase: trade date → SEC acceptance (calendar days) |
| Max signal lag | `maxSignalLagDays` | **Optional, off by default** (was 30 by default before 2026-11-03) |
| Roles | `roles` | `[]` = all roles |
| Horizon | `horizonSessions` | 1 – 756 NYSE **trading sessions** (not calendar days) |
| Execution latency | `executionLatencySeconds` | 0 – 86,400 s added to the SEC acceptance (default 60) |
| Entry session | `entrySession` | `regular` (default) or `extended` |
| Costs | `commissionBps`, `slippageBps` | Per side; net = exit×(1−c) ÷ (entry×(1+c)) − 1 |

**Aggregation.** Within an issuer and window: each distinct insider counts once; every
purchase transaction is counted and its USD value summed (10 purchases by one insider = 1
buyer, 10 purchases, the combined value). Late filings count unless the optional
filing-delay filter is set.

**Point in time (no lookahead).** At every SEC acceptance time T the engine rebuilds only
what was public at T (amendments from their own acceptance, identities and price checks
from filings public then). A signal is recorded the FIRST time the conditions hold and is
dated T. Its `snapshot.purchases` are frozen; later filings never change it. Additional
purchases of the same cluster (also by existing buyers) extend the cluster but never
create a duplicate signal; they are listed in `hindsight.laterPurchases` (labelled
hindsight). Ids are deterministic: signal `cik:T`, cluster `cik:firstTradeDate`.

**Timestamps kept distinct (per signal row, `rows[id].strategy`):** insider trade dates
(`windowFrom/windowTo`, grouping only) → `secAcceptedAt` → `availableAt` = acceptance +
latency (also `detectedAt`; SEC acceptance is not assumed to equal public availability) →
`entrySearchStart` (next regular open for the regular rule) → `entry.time` (first
eligible Alpaca SIP trade ≥ start) → `exit.time` (official close of the N-th session
after the entry date; holidays, early closes and DST per `sessionCalendar.js`).
The insider's purchase date is never an entry date.

**Returns.** Gross and net (after costs), SPY over the same entry/exit (SPY bought at its
first eligible trade at/after the stock entry, sold at the same exit close), excess = net −
SPY. Split-adjusted; dividends not included. Missing data is a status, never 0 %:
`immature`, `no_bar` (missing exit), missing entry (`no_entry`, `awaiting_*`),
`no_ticker`. The summary counts each reason; `reliability` is `not_reliable` whenever SEC
coverage is incomplete, fewer than 30 signals are complete, > 20 % lack prices, most
horizons are immature, or SPY is missing for some.

**Reuse / caching.** A strategy entry reuses the acceptance-based entry already cached
when that one is at/after the strategy start (no request). Results are cached per exact
run configuration + data version, so a changed parameter is always recomputed.

**Endpoints.** `GET /run/:id/publication-now` → `strategy { config, summary, reliability }`
and `rows[id].strategy`; `GET /run/:id/event-study/:signalId` → later SEC publications of
that company, each measured from its own acceptance with the same rules (separate from the
signal); `GET|POST|PUT|DELETE /api/insider/strategies` (signed-in users; params
validated like a run; collection `backteststrategies`, index `{userId:1, updatedAt:-1}`
is NOT created automatically — autoIndex is off).

**Company timeline.** Every code-P purchase is an event with insider, roles, trade date,
SEC acceptance, shares and USD value, `signalRole` (`signal_snapshot` /
`subsequent_publication` / …) and `publicationSession` (first session that opened at/after
the acceptance — where the chart plots it). Without daily CSV files the chart uses Alpaca
split-adjusted SIP daily closes (closes only; no intraday reaction is drawn).

**Comparison.** The page keeps up to 6 recent runs per browser tab and compares only those
with the same date range, with sample sizes, SEC coverage and an overfitting warning.

## Architecture

| Concern | Module |
|---|---|
| Historical Form 4 ingestion (resumable backfill) | `services/backtest/form4Backfill.js`, CLI `scripts/backfillForm4.mjs` |
| Historical Form 4 store, coverage, merge with live ingest | `services/backtest/form4History.js` |
| Form 4 price currency check (USD only) | `services/edgar/currency.js` (rule in `priceAnomalies.js`) |
| Targeted historical prices (Tiingo, Backtesting only) | `services/stockData/tiingoClient.js`, `services/backtest/priceFetch.js`, CLI `scripts/fetchSignalPrices.mjs` |
| Purchase-date tracking timelines | `services/backtest/tracking.js` |
| U.S. session calendar | `services/backtest/sessionCalendar.js` |
| Point-in-time signal detection | `services/backtest/signals.js` |
| Price provider abstraction | `services/stockData/stockDataProvider.js` |
| Return calculations, statistics, equity curve | `services/backtest/returns.js` |
| Orchestration and methodology | `services/backtest/backtestEngine.js` |
| API (status, run job, poll) | `routers/backtestRoutes.js` (mounted from `insiderRoutes.js`) |
| Frontend | `client/src/pages/insider/backtest/*`, `hooks/useBacktest.js`, `utils/insiderBacktest.js` |

Filings go through the same pipeline as the live dashboard: the Form 4 parser, price
checks, Form 4/A linking and duplicate grouping.

## Rules (also returned by `GET /api/insider/backtest/status` → `methodology`)

**Signal.** A signal needs at least *N* (default 2) **distinct** reporting owners, with
Form 4 code **P** purchases whose trade dates fall in one rolling *W*-calendar-day window
(default 30):
- Owners are identified by SEC CIK. Joint filers on one Form 4 count as one owner.
- The combined reliable value of all buyers must be **strictly greater** than
  **$250,000 (U.S. dollars)**. The threshold is not applied per person. All values are
  Form 4 amounts in USD (shares × reported price); there is no currency conversion.
- **Currency check.** The Form 4 has no currency field.
  - A footnote saying the price was converted to U.S. dollars counts as USD.
  - A foreign-currency price with no conversion statement is "currency unverified".
    Example: "SALE PRICE OF MXN$68.18".
  - An unverified row keeps its buyer and transaction count, but its value is excluded
    from every USD total. That covers the screener, company pages, totals and the backtest.
- Purchases with a price anomaly, no price or an unverified currency count as buyers but
  add nothing to the value.
- API requests still carrying the old `minValueIls` field are refused (HTTP 400), never
  reinterpreted. The page stores its form under a new key (`it.backtestForm.v2`), so an
  old ILS form is never reloaded.
- The cluster's latest trade date must be within *L* days (default 30) of publication.

**No lookahead.** A signal is dated at the **SEC acceptance time** of the filing that
first made the condition true. Only filings accepted at or before that moment are used:
- Duplicates are known from their first report.
- A Form 4/A replaces the original only from the amendment's acceptance.
- Joint-filer identities are rebuilt from public filings only.
- The peer-price outlier check uses only peers that were public at the time.

The test `NO LOOKAHEAD` in `signals.test.js` re-runs detection on data truncated at
every signal time and requires identical results.

**Overlap.** One cluster produces one signal. After a signal, purchases dated within *W*
days after the cluster's latest purchase extend the same cluster. A new signal for the
same company needs a qualifying window made only of purchases dated after that.

**Entry.** Entry is at the **open** of the first regular U.S. session that opens at or
after the acceptance time:
- Before 09:30 ET on a trading day → that day.
- During the session, after the close, or on a weekend or holiday → the next session.
- Adjusted open = open × adjClose / close.

**Exit and horizons.** Horizons are counted in trading sessions, with the entry session
as session 1. The exit is the **close** of the last session:

| Horizon | Sessions |
|---|---|
| 7D | 5 |
| 30D | 21 |
| 90D | 63 |
| 180D | 126 |

**Costs.** Commission and slippage are optional, in basis points **per side**:
`net = exit×(1−c) / (entry×(1+c)) − 1`.

**Benchmark.** The provider's S&P 500 proxy (default `SPY`) is bought at the same open
and sold at the same close, without costs. Excess = net − benchmark.

**Missing data.**
- No bar on the entry session → excluded.
- Exit after the last available price → **pending** (never estimated).
- Stock history ends while the market continues → excluded as delisted/data ended. With
  the `last_close` option it is valued at the last close instead, and flagged.
- A missing exit bar uses the latest bar from the previous 5 sessions (flagged).
- Survivorship bias is avoided only if the price source includes delisted securities.

**Equity curve.** Equal-weight, daily-rebalanced portfolio of the positions open for the
selected horizon, with cash (0 %) when none are open. Costs are charged on entry and exit
days. The benchmark curve is buy-and-hold over the same sessions. Maximum drawdown is
computed from this curve; per-signal drawdown runs to the longest complete horizon.

**Optional filters.**
- Roles: CEO, CFO, COO, CTO, VP, Director, 10% Owner, Other officer, Other.
- Open-market only.
- Minimum purchase size (USD).
- Prior price decline: lookback measured to the last close known at disclosure.
- Market capitalization: from the provider's `market_cap` column at the last close known
  at disclosure. Signals without the data are excluded, never guessed.

## Data and commands (run in `server/`)

```bash
# Historical Form 4 filings — resumable; Ctrl+C stops safely
npm run backtest:backfill -- --from 2024-01-01 --to 2024-12-31 --rps 2
```

Backfill notes:
- Needs `SEC_USER_AGENT` in `server/.env`.
- SEC fair access allows at most 10 requests/second in total, and the live server
  already uses up to 5. Keep `--rps` at 2 (maximum 5).
- About 300–500 Form 4s per business day. One year is roughly 100k requests, about
  14 hours at 2 rps. Run it in chunks; reruns skip completed days.
- Filings already held by the live ingest are reused, not downloaded again.
- Storage: `server/.cache/backfill/form4/` (git-ignored; one shard per day plus
  `progress.json`).

```bash
# 3. Prices — a licensed export as CSV files (see below)
#    server/.env:
STOCK_DATA_PROVIDER=csv
STOCK_DATA_DIR=C:\path\to\licensed-daily-bars
STOCK_DATA_BENCHMARK=SPY
```

`STOCK_DATA_DIR` layout:
- `<SYMBOL>.csv` with columns `date,open,high,low,close,adj_close,volume[,market_cap]`.
- Optional `symbols.csv` with columns `cik,symbol,from,to`, a historical ticker map for
  delisted and renamed issuers. Without it, the ticker reported on the Form 4 at filing
  time is used.

## Historical price sources — evaluation

TradingView's embeddable widgets have **no** historical-data API, and their content may
only be displayed inside the widget. They are not a data source.

Candidates, based on my knowledge of these vendors. **Verify current pricing and license
terms with each vendor before buying.** Displaying vendor-derived numbers to users
usually requires a commercial or redistribution licence, not a personal one.

| Source | Adjusted OHLCV | Delisted | Historical tickers / CIK | Notes |
|---|---|---|---|---|
| Nasdaq Data Link — Sharadar (SEP/SFP + TICKERS) | yes | yes | yes, incl. CIK | Survivorship-free U.S. equities; commercial display needs a separate licence |
| Polygon.io (now Massive) | yes | yes (`active=false`) | ticker events, CIK in ticker details | Paid tiers; business plan for public display |
| Tiingo EOD | yes | partial | limited | Low cost; commercial/redistribution licence on request |
| EODHD | yes | yes (delisted list) | partial | Check redistribution terms |
| CRSP via WRDS | yes (gold standard) | yes | PERMNO ↔ CIK links | Academic licence; no redistribution |
| Yahoo Finance / Stooq / scraped sites | — | — | — | Terms prohibit or don't grant this use — not used |

Recommendation for a public product: Sharadar or Polygon with a display licence.
Export to the CSV layout above, or add an API provider to the registry in
`stockDataProvider.js` once its terms and credential are approved.

## Known limitations

- Results are only as complete as the backfilled Form 4 history. The page and API show
  coverage, and a "Partial data" warning for gaps (including a 35-day warm-up before the
  start date).
- The session calendar covers standard NYSE holidays and known special closures. With
  price data, the benchmark's bars are authoritative.
- Peer-price checks are point-in-time. The other price checks are intrinsic to each
  filing.
- Runs are in-memory jobs (one at a time, kept for 30 minutes).

## Insider purchase tracking (continuous timeline from the first purchase)

An **additional, retrospective view**. The publication-based backtest above is
unchanged. Open it from any signal row ("Track since first buy") on `/insider/backtesting`.

- **Start:** the TRADE date of the first purchase (`windowFrom`) of the company's
  earliest qualifying cluster in the run. Cluster rules are unchanged: at least 2
  distinct insiders, combined value above $250,000 (USD), a rolling 30-day window,
  code P, with identity, amendment and de-duplication handling as before.
- **Baseline:** the split- and dividend-adjusted market close on that date. If there is
  no bar that day, the closest earlier session within 5 sessions is used and flagged.
  Form 4 prices are reference only.
- **No reset:** later purchases are events on the same line, including those that
  extended the cluster (`clusterTo`) and those of later independent clusters.
  Cluster periods are shaded.
- **Markers:** the date the SEC published each signal (grey dashed line, labelled
  "SEC n") and the backtest entry (blue dashed line).
- **Change:** `adjClose / baseline adjClose − 1` for every session through the latest bar.
  The panel also shows peak, trough, max drawdown and the benchmark over the same sessions.
- **Splits:** adjusted prices keep the line continuous. Jumps in the adjustment factor
  are reported as corporate actions.
- **Delisting or vendor gaps:** if the price history stops more than 5 sessions before
  the market's latest session, the line ends and is flagged, never extrapolated.

Code:
- `services/backtest/tracking.js`
- `backtestEngine.track()` and the per-company summaries in run results (`tracks`)
- `GET /api/insider/backtest/run/:id/track/:signalId`
- `client/src/pages/insider/backtest/TrackPanel.jsx`, plus `TrackChart` in `BacktestCharts.jsx`

## Historical prices: targeted Tiingo fetch

```bash
# server/.env (you add these; the key is never logged)
TIINGO_API_KEY=...                 # server-side only; used ONLY by npm run backtest:prices
STOCK_DATA_PROVIDER=csv            # the server reads the saved files; STOCK_DATA_DIR defaults to server/.cache/prices
STOCK_DATA_LICENSE=internal        # default; "public" ONLY with written Tiingo display/redistribution rights
# optional quotas (defaults keep a margin under the Starter plan):
# TIINGO_REQUESTS_PER_HOUR=45  TIINGO_REQUESTS_PER_DAY=950  TIINGO_SYMBOLS_PER_MONTH=450  STOCK_DATA_BENCHMARK=SPY

# server/
npm run backtest:prices -- --dry-run   # shows exactly which tickers and ranges would be fetched
npm run backtest:prices                # downloads them (resumable; up-to-date files are skipped)
```

What the fetch does:
- **Only what the signals need:** it fetches only the tickers that have signals, from
  120 days before each company's first purchase to today, plus SPY. That is 2 requests
  per ticker (ticker info, then prices).
- **Identity guard against reused tickers:** if Tiingo's company name doesn't match
  SEC's, nothing is written (`name_mismatch`; override with `--allow-name-mismatch`).
  Signals without a ticker on the Form 4, or a ticker shared by two SEC issuers, are skipped.
- **Output:** the existing CSV provider format, plus a `<SYMBOL>.meta.json` per ticker
  (source, vendor name, range, fetch time, licence) and `_fetch-manifest.json`.

- **Quotas:** enforced before every request, using a ledger in `_tiingo-usage.json`.
  The Starter plan allows 500 unique symbols per month, 1,000 requests per day and 50 per
  hour; the defaults are 450, 950 and 45. When a quota runs out, an HTTP 429 arrives or the
  key is rejected, the run stops and lists the remaining symbols as `not_attempted`.
- **Invalid responses:** non-JSON or malformed responses are errors. Rows without a close
  or adjusted close are dropped, never repaired. A failed refresh never overwrites the
  previous good file.
- **Refreshes:** always re-download the whole needed range, so re-adjustments after splits
  and dividends are picked up (Tiingo's own guidance).

**Isolation.** Tiingo is used only by `npm run backtest:prices`. The web server never
contacts Tiingo and cannot even load the client module; `isolation.test.js` checks the
server's import graph and the client source. Company pages, the screener, live data and
alerts never read these prices, and the company page's `market` field keeps reporting
"no licensed market-data provider".

**Licence guard.** With `STOCK_DATA_LICENSE=internal` (the default), the API returns prices
and everything derived from them only to requests from the server's own machine
(loopback, no proxy headers). That covers backtest returns, statistics, the equity curve
and the tracking line. The check runs on the server; everyone else gets the SEC-only view,
marked "internal use only".

**Tiingo licence (checked against tiingo.com/about/pricing, Nov 2026):**
- **Starter ($0):** "Internal Use Only — you may only use the data for your own personal
  use"; displaying or sharing with another person or organization is not allowed.
- **Internal commercial use:** listed at $50/month. Redistribution or display is sold
  separately through Tiingo Sales.
- **Storage:** Tiingo's knowledge base recommends downloading histories once and caching
  them locally; no published limit on local retention was found. The terms-of-service page
  was not reachable, so confirm with Tiingo before relying on this.
- **Public display:** showing prices or derived returns to other people needs a
  redistribution or display licence. Do not set `STOCK_DATA_LICENSE=public` without one.

## Tracking headline: first-purchase-date close → current price

Shown at the top of the tracking panel.
- **Start:** the split-adjusted close on the first purchase's Form 4 transaction date.
  That is the actual close divided by any later stock splits; dividends are not folded in.
- **End:** the current price, with its exact timestamp in New York time.
- **Change:** (end − start) ÷ start × 100. It refreshes about every minute while the
  panel is open. Later purchases never change the start.

- **Current price source:** Tiingo IEX endpoint `GET /iex/<ticker>`, called from the
  server only (`services/backtest/liveQuote.js`, used only by the backtest engine).
  - Without a signed IEX market-data agreement, IEX's own last trade and bid/ask are null.
    The price is then Tiingo's derived reference price (`tngoLast`), which reflects IEX
    trading only. It is labelled as such and is not the consolidated last sale across
    all U.S. exchanges.
  - With an IEX agreement, the IEX last trade is used and labelled "IEX last trade".
  - A consolidated real-time last sale needs a vendor/plan with consolidated real-time
    entitlements, which Tiingo's IEX API does not provide.
- **Budget:** quotes are cached per symbol (`TIINGO_QUOTE_TTL_SECONDS`, default 120) and
  capped (`TIINGO_QUOTES_PER_HOUR`, default 30), within the Starter plan's 50 requests per
  hour. The results table uses daily closes and never requests quotes.
- **Fallback:** with no key, a rejected key, the quota reached, no quote, or a quote older
  than the last daily close, the end price is the latest end-of-day close. It is labelled
  "Close of <date> — not live" with the reason.
- **Licence guard:** the current price is internal-only like all price data. Non-local
  requests get no price.

## Primary metrics: SEC Publication → NOW and Regular Hours → NOW (Alpaca)

The Backtesting table shows two numbers for each qualifying signal. The fixed
7D/30D/90D/180D columns are not shown (the server still computes them), and nothing is
ever shown as "pending".

**Market data provider (Backtesting only):** Alpaca Market Data API v2
(`https://data.alpaca.markets`, Basic plan) is the primary source and Tiingo is the
fallback. Credentials go in `server/.env` as `ALPACA_API_KEY_ID` / `ALPACA_API_SECRET_KEY`.
They are never sent to the browser or written to logs. Every price records its provider.
- Code: `services/stockData/alpacaClient.js`, `services/backtest/backtestPrices.js` and
  `services/backtest/entrySelection.js`. `isolation.test.js` enforces that only
  Backtesting reaches these modules.
- Alpaca Basic, verified:
  - SIP (consolidated) trades and bars back to 2016, **except the most recent 15
    minutes** (HTTP 403);
  - the latest trade is available from the **IEX feed only**;
  - 200 requests per minute. We cap at `ALPACA_REQUESTS_PER_MINUTE` (default 150) and
    batch latest trades 100 symbols per request.

### SEC Publication → NOW (primary)
- **Entry:** the first *eligible* SIP trade with a timestamp at or after the SEC
  acceptance time, in any session: pre-market (04:00–09:30 ET), regular, or after-hours
  (until 20:00 ET).
  - Timestamps are compared at nanosecond precision. A trade earlier in the same second
    as publication is never used.
  - Ineligible prints are skipped: odd lots (condition `I`; set
    `BACKTEST_INCLUDE_ODD_LOTS=1` to include them), plus report-only and
    non-representative conditions — official open/close reports `Q`/`M`, average-price
    `B`/`W`, cash/next-day/seller `C`/`N`/`R`, prior-reference `P`/`Z`/`L`/`U`/`4`/`7`/`9`,
    contingent `V`, and cross/derivative `H`.
  - Recorded: price, exact timestamp, session, size, exchange, conditions, provider and
    basis (`sip_trade`).
- **Change:** ((latest ÷ split-adjusted entry) − 1) × 100.

### Regular Hours → NOW (secondary)
- **Entry:** the first eligible regular-session trade (09:30 to the close, including
  early closes) at or after publication.
  - Signals published outside the session start at the next session's 09:30 ET. The NYSE
    holiday calendar and DST are handled in `sessionCalendar.js`.
  - Prints flagged as extended-hours (`T`, `U`) are excluded, so the entry is normally
    the opening print (`O`).

### Latest price, splits and missing data
- **Latest price:** the Alpaca IEX last trade, with its own timestamp, age and provider.
  It is **IEX only, not the consolidated tape**. The fallback is the Tiingo IEX
  reference price, marked "cached" when stale.
  - A latest price older than the entry is never used ("Awaiting newer price").
- **Splits:** the entry is converted to today's share terms. The factor is the raw ÷
  split-adjusted daily close of the entry day from Alpaca, or else the Tiingo daily
  split factors.
- **Recent signals:**
  - **"Awaiting SIP data":** published less than 16 minutes ago. No request is made, the
    403 is not permanent, and the entry is retried every 5 minutes.
  - **"Awaiting regular-session trade":** the secondary metric before the next open.
  - **"No trade yet":** no eligible trade since publication.
  - A missing value is a labelled status. It is never 0 % and never a price from before
    publication.
- **Cache:** final entries are stored in
  `server/.cache/prices/_publication-entries.v1.json`. Awaiting and error states are
  re-checked automatically.

### Fallback (Tiingo) — a minute-bar approximation
Tiingo is used only when Alpaca cannot answer: not configured, credentials rejected
(401), or a request error. It is never used to fill an "awaiting" state.
- The Tiingo entry is the open of the first IEX 1-minute bar that **starts** at or after
  publication **with volume > 0**. It is labelled "IEX 1-min bar open (approx.)": a
  minute open is not a guaranteed executable trade, and Tiingo has no extended-hours
  bars.

**Bug fixed on 2026-11-03:** Tiingo IEX minute bars are forward-filled with volume 0,
even across days. The old cache (`_publication-starts.json`, no volume check) had 5 of
18 starts on such filler bars: NXG, NPB, STC, DSM and NMCO.
- Starts now require volume > 0.
- Cached records are revalidated on read, and the new cache is
  `_publication-starts.v2.json`. The old file is kept for audit and never read.
- Regression tests: `backtestPrices.test.js`.

**Licence:** prices remain visible only on this computer (loopback; `STOCK_DATA_LICENSE`
is not `public`). Other viewers get statuses only. No new public API was added. Alpaca's
market-data redistribution / display terms must be checked before any subscriber-facing
use.

**Separate from the first-purchase metric:** "Since 1st buy" and the first-purchase
timeline are unchanged. Its headline quote still comes from Tiingo.

## Joint filers across duplicate reports; IPO-allocation labels (2026-11-03)

**Buyer identity.** The strategy counts distinct reporting owners, with joint filers
counted as one. Related filers sometimes report the same shares in separate Form 4s,
for example two fund families in one joint filing where one reports the other's
purchase as an indirect holding. `transactionGroups.js` merges such reports only with
relationship evidence and an indirect holder. The merged row's identity now also
includes the reporting owners of its confirmed duplicate reports (`identityRowAt` in
`signals.js`):
- Point-in-time: a duplicate report links owners only from its own SEC acceptance.
- Unrelated investors are never linked. Without a confirmed duplicate, nothing changes.
- Effect on the real data: ASPE (ARCH Venture Fund X and XIV, one joint filing) is one
  buyer and no longer qualifies (20 → 19 signals). The other 19 signals are unchanged.

**Latest price for every ticker row.** The latest IEX trade is requested in one batch
for all rows, including rows still waiting for their first eligible trade. Returns
still need a valid entry. The response also carries `market.session`
(pre/regular/post/closed) and the session of the latest trade, so the page can show
"Market closed · last trade …", "Pre-market · …" or "Stale · …". It never says "live".

**IPO allocations (informational).** `ipoContext.js` labels code-P purchases that may
be IPO allocations. It is never decided by price alone, and nothing is excluded.
- **Verified:** an IPO prospectus (424B4/424B1, "initial public offering" with "no
  public market"), a purchase from 3 days before to 10 days after it at exactly the
  offering price, **and** an explicit statement (a Form 4 footnote, or the prospectus
  naming the buyer as purchasing in the offering).
- **Possible:** the same without the explicit statement.
- **None:** no IPO prospectus around the purchase, or a different price.
- **Unknown:** the SEC lookup failed; it is retried.
- Data: SEC submissions index and prospectus text, through its own 2 req/s EDGAR
  client, cached in `server/.cache/ipo-context.v1.json`.
- API: `GET /api/insider/backtest/run/:id/ipo-context`.
- Limitations: follow-on offerings and private placements are not classified here;
  name matching in prospectus text is conservative (it needs two meaningful words).

## Performance architecture (2026-11-03)

- **Background pricing.** A page poll (`GET /run/:id/publication-now`) answers from cached
  prices only. Entries that still need an Alpaca lookup come back as `lookup_queued`
  ("Loading price…") and go to a de-duplicated background queue
  (`BACKTEST_PRICING_CONCURRENCY`, default 3) that runs under the same Alpaca limiter.
  - The response carries `pricing` progress; the page polls every 4 s while it is
    working, otherwise every 60 s, and never overlaps polls.
  - Concurrent identical polls share one computation.
  - The precompute CLI still prices inline (`background: false`).
- **Batched split factors.** The factor (raw ÷ split-adjusted SIP daily close on the
  entry day) comes from the batched daily-close caches (`alpaca-daily-raw` /
  `alpaca-daily-split`, 100 symbols per request) instead of 2 requests per signal.
- **Alpaca limiter.** Page requests (latest prices, daily closes) may use a reserve of
  20/min above the background cap, never above 190/min (Alpaca allows 200).
- **History and runs.**
  - Unchanged history shards are never re-parsed.
  - The snapshot is rebuilt at most every `BACKTEST_SNAPSHOT_MIN_REBUILD_MS` (30 s)
    while only historical shards change (a running backfill); a live-ingest change
    rebuilds at once.
  - Identical runs (same settings, data version and day) are served from cache.
  - An identical run submitted while running joins that job.
- **Entry cache I/O.** Writes are coalesced (≤ 1 per 500 ms, flushed when the queue
  drains or a CLI run ends); the file is re-checked for other processes' writes at most
  once per second.
- **Unchanged:** results are identical to the previous implementation — verified on 122
  real signals (204 entries, 540 horizon results, 0 differences) and on synthetic data
  (`backtestScale.test.js`).

## At signal vs by cluster end (hindsight)

- **At signal:** each signal's `uniqueBuyers`, `purchases` and `valueUsd` are what was
  public when the strategy was first met (no lookahead). Entry and returns start here.
- **By cluster end (`signal.hindsight`):** the same cluster (first window day →
  `clusterTo`, same filters including open-market only) as reported by every filing held
  now, including buyers and purchases filed after the signal.
  - Display only: computed after detection; never used for signals, entries or returns.
  - Shown in the table as "… by cluster end" (muted, dotted underline) and in Details
    under "By cluster end — hindsight".
- **Why the Companies screener can differ:** it totals every code-P purchase in its own
  window (default: trade dates in the last 30 days), from 1 buyer up, with no
  point-in-time cut. Backtesting counts only what was public at publication.
