// Insider purchase tracking — one continuous timeline per company from the TRADE
// DATE of the first qualifying purchase (fixed baseline, never reset), with every
// later purchase as an event. Data: GET /api/insider/backtest/run/:id/track/:signalId.
// Retrospective view — kept separate from the publication-based backtest.
import { lazy, Suspense, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import useBacktestTrack from "../../../hooks/useBacktestTrack";
import useTrackCurrent from "../../../hooks/useTrackCurrent";
import { EmptyState, ErrorNote, Panel, Skeleton } from "../components/Common";
import { compactUsd, count, day, acceptedShort, usd, shares as fmtShares } from "../../../utils/insiderFormat";
import { pct } from "../../../utils/insiderBacktest";
import { TRACK_STATUS_TEXT, FLAG_TEXT, PRICE_BASIS_TEXT, DAY_WINDOWS, eventsWithinDays, groupEventsByDay } from "../../../utils/insiderTrack";

const LTrack = lazy(() => import("./BacktestCharts.jsx").then((m) => ({ default: m.TrackChart })));
// Neutral when the value rounds to 0.0 % (as displayed) — no colour for noise.
const tone = (v) => (v == null || Math.abs(v) < 0.0005 ? undefined : v > 0 ? "var(--it-buy)" : "var(--it-sell)");

function Kpi({ label, value, sub, color }) {
  return (
    <div className="it-kpi">
      <div className="it-label">{label}</div>
      <div className="it-num mt-1 text-[17px] font-semibold" style={{ color: color || "var(--it-text)" }}>{value}</div>
      {sub && <div className="text-[11px] it-dim2">{sub}</div>}
    </div>
  );
}

function Events({ events, priced }) {
  return (
    <>
      <div className="it-table-wrap hidden md:block">
        <table className="it-table min-w-[900px]">
          <thead><tr>
            <th scope="col">Trade date</th><th scope="col">Insider</th><th scope="col">Role</th><th scope="col" className="num">Shares</th>
            <th scope="col" className="num" title="Price reported on the Form 4 — reference only, not used for performance">Form 4 price</th>
            <th scope="col" className="num">Value</th><th scope="col">SEC published</th><th scope="col">Cluster</th>
            {priced && <th scope="col" className="num" title="Stock change vs the fixed baseline on the purchase date">vs baseline</th>}
          </tr></thead>
          <tbody>
            {events.map((e, i) => (
              <tr key={`${e.accessionNo}-${i}`} style={e.matchesFilters ? undefined : { opacity: 0.6 }}>
                <td className="it-num whitespace-nowrap">{day(e.date)}</td>
                <td style={{ color: "var(--it-text)" }}>{e.filingUrl ? <a className="hover:underline" href={e.filingUrl} target="_blank" rel="noopener noreferrer">{e.insider}</a> : e.insider}{e.jointFilers ? <span className="it-dim2 text-[11px]"> +{e.jointFilers} joint</span> : null}</td>
                <td className="text-[11.5px] it-dim">{e.roles.join(" · ")}</td>
                <td className="num it-num">{fmtShares(e.shares)}</td>
                <td className="num it-num it-dim">{e.form4Price != null ? usd(e.form4Price) : "—"}{e.priceFlag ? <div className="text-[10px] it-dim2">{e.priceFlag === "price_anomaly" ? "anomaly" : "no price"}</div> : null}</td>
                <td className="num it-num it-buy">{e.valueUsd != null ? compactUsd(e.valueUsd) : "—"}<div className="text-[10px] it-dim2">{e.openMarket ? "open market" : e.purchaseContext === "offering_or_private" ? "offering / private" : "venue not stated"}</div></td>
                <td className="it-num whitespace-nowrap text-[12px] it-dim">{acceptedShort(e.publishedAt)}</td>
                <td className="text-[11.5px] it-dim">{e.cluster != null ? `Cluster ${e.cluster + 1}` : "later purchase"}</td>
                {priced && <td className="num it-num font-medium" style={{ color: tone(e.pctAtEvent) }}>{pct(e.pctAtEvent)}{PRICE_BASIS_TEXT[e.priceBasis] ? <div className="text-[10px] font-normal it-dim2">{PRICE_BASIS_TEXT[e.priceBasis]}</div> : null}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="md:hidden">
        {events.map((e, i) => (
          <li key={`${e.accessionNo}-${i}`} className="px-3.5 py-2.5" style={{ borderBottom: "1px solid var(--it-line-soft)" }}>
            <div className="flex justify-between gap-2">
              <span className="truncate text-[13px]" style={{ color: "var(--it-text)" }}>{e.insider}</span>
              {priced && <span className="it-num shrink-0 font-semibold" style={{ color: tone(e.pctAtEvent) }}>{pct(e.pctAtEvent)}</span>}
            </div>
            <div className="text-[11.5px] it-dim2">{day(e.date)} · {e.roles.join(" · ")} · {e.valueUsd != null ? compactUsd(e.valueUsd) : "—"} · {e.cluster != null ? `cluster ${e.cluster + 1}` : "later purchase"}</div>
          </li>
        ))}
      </ul>
    </>
  );
}

// One row per transaction DATE (daily grouping).
function DayRows({ days, priced }) {
  return (
    <div className="it-table-wrap">
      <table className="it-table min-w-[720px]">
        <thead><tr>
          <th scope="col">Trade date</th><th scope="col" className="num">Purchases</th><th scope="col">Insiders</th><th scope="col" className="num">Value (USD)</th>
          <th scope="col">First SEC publication</th>{priced && <th scope="col" className="num">vs baseline</th>}
        </tr></thead>
        <tbody>
          {days.map((g) => (
            <tr key={g.date}>
              <td className="it-num whitespace-nowrap">{day(g.date)}</td>
              <td className="num it-num">{g.purchases}</td>
              <td className="text-[12px]" style={{ color: "var(--it-text)" }}>{g.insiders.join(", ")}</td>
              <td className="num it-num it-buy">{compactUsd(g.valueUsd)}{g.valueMissing ? <div className="text-[10px] it-dim2">+{g.valueMissing} without USD value</div> : null}</td>
              <td className="it-num whitespace-nowrap text-[12px] it-dim">{acceptedShort(g.firstPublishedAt)}</td>
              {priced && <td className="num it-num font-medium" style={{ color: tone(g.pctAtEvent) }}>{pct(g.pctAtEvent)}{PRICE_BASIS_TEXT[g.priceBasis] ? <div className="text-[10px] font-normal it-dim2">{PRICE_BASIS_TEXT[g.priceBasis]}</div> : null}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const etTime = (iso) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(iso));
const QUOTE_SOURCE = { tiingo_iex_reference: "Tiingo IEX reference price (derived from IEX trading only — not the consolidated last sale)", iex_last_trade: "IEX last trade (IEX exchange only)" };
const QUOTE_STATUS = { no_key: "no TIINGO_API_KEY on the server", invalid_key: "the Tiingo key was rejected", quota: "hourly quote limit reached", rate_limited: "Tiingo rate limit reached", unavailable: "no current quote for this ticker", error: "quote request failed", older_than_close: "the latest quote is older than the last daily close" };

// The one number that matters: (end price − first-purchase-date close) / that close.
function Headline({ jobId, signalId, initial }) {
  const { current: c, updatedAt, error } = useTrackCurrent(jobId, signalId, initial);
  if (!c) return null;
  const live = c.basis === "live_quote";
  return (
    <div className="mx-4 mt-3 grid grid-cols-1 gap-4 rounded-lg p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]" style={{ background: "var(--it-elevated)", border: "1px solid var(--it-line)" }} aria-live="polite">
      <div className="min-w-0">
        <div className="it-label">Start · first insider purchase</div>
        <div className="it-num mt-1 text-[20px] font-semibold" style={{ color: "var(--it-text)" }}>{usd(c.startPrice)}</div>
        <div className="text-[11.5px] it-dim2">{day(c.startDate)} · split-adjusted close (USD)</div>
      </div>
      <div className="min-w-0">
        <div className="it-label">{live ? (c.marketOpen ? "Now · current price" : "Latest quote · market closed") : "Latest · end-of-day close"}</div>
        <div className="it-num mt-1 text-[20px] font-semibold" style={{ color: "var(--it-text)" }}>{usd(c.price)}</div>
        <div className="text-[11.5px] it-dim2">
          {live ? <>{etTime(c.timestamp)} ET · {QUOTE_SOURCE[c.source] || c.source}{c.quoteStatus === "stale_cache" ? " · cached (quote limit)" : ""}</>
            : <>Close of {day(c.closeDate)} — <strong className="it-dim">not live</strong>{QUOTE_STATUS[c.quoteStatus] ? ` (${QUOTE_STATUS[c.quoteStatus]})` : ""}</>}
        </div>
      </div>
      <div className="sm:text-right">
        <div className="it-label">Change since first purchase</div>
        <div className="it-num mt-1 text-[32px] font-semibold leading-none" style={{ color: tone(c.changePct) }}>{pct(c.changePct, 2)}</div>
        <div className="mt-1 text-[11px] it-dim2">{updatedAt ? `checked ${new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(updatedAt))} ET · refreshes every minute` : ""}{error ? ` · ${error}` : ""}</div>
      </div>
    </div>
  );
}

const chipOn = { color: "var(--it-text)", borderColor: "var(--it-accent)", background: "var(--it-accent-soft)" };

export default function TrackPanel({ jobId, signalId, onClose }) {
  const [windowDays, setWindowDays] = useState(null); // null = all purchases
  const [grouping, setGrouping] = useState("purchase");
  const { data: t, loading, error } = useBacktestTrack(jobId, signalId);
  const priced = t?.status === "ok";
  const s = t?.stats;
  // Daily filtering: purchases within the first N calendar days from the first purchase (day 1 = baseline date).
  const shown = useMemo(() => (t?.events ? eventsWithinDays(t.events, t.startDate, windowDays) : []), [t, windowDays]);
  const days = useMemo(() => groupEventsByDay(shown), [shown]);
  return (
    <Panel
      title={t ? `${t.ticker || "—"} · since first insider purchase` : "Insider purchase tracking"}
      subtitle={t ? `${t.issuerName || ""} · baseline ${day(t.startDate)} (trade date) · ${count(t.events?.length)} purchases · ${t.clusters.length} cluster${t.clusters.length === 1 ? "" : "s"}` : "loading…"}
      right={<>
        {t?.ticker && <Link className="it-btn" to={`/insider/company/${encodeURIComponent(t.ticker)}`}>Company</Link>}
        <button className="it-btn" onClick={onClose} aria-label="Close tracking timeline">Close</button>
      </>}>
      {error && <div className="p-3"><ErrorNote>{error}</ErrorNote></div>}
      {loading && <div className="flex flex-col gap-2 p-4"><Skeleton className="h-6" /><Skeleton className="h-[280px]" /></div>}
      {t && (
        <div className="flex flex-col">
          <div className="px-4 pt-3 text-[11.5px] leading-relaxed it-dim2">
            {t.methodology.hindsight} {t.methodology.noReset} Shaded = cluster period · grey dashed “SEC n” = signal published · blue dashed = backtest entry (next session open).
          </div>
          {!priced && (
            <div role="status" className="mx-4 mt-3 rounded-md px-3 py-2 text-[12px] leading-relaxed" style={{ color: "#d7c08f", background: "var(--it-warn-soft)", border: "1px solid rgba(232,176,75,0.25)" }}>
              {t.restrictedNote || TRACK_STATUS_TEXT[t.status] || t.status}
            </div>
          )}
          {priced && (
            <>
              <Headline jobId={jobId} signalId={signalId} initial={t.current} />
              <div className="it-kpis grid grid-cols-2 sm:grid-cols-5" style={{ borderTop: "1px solid var(--it-line-soft)" }}>
                <Kpi label="Peak" value={pct(s.peakPct)} color={tone(s.peakPct)} sub={day(s.peakDate)} />
                <Kpi label="Trough" value={pct(s.troughPct)} color={tone(s.troughPct)} sub={day(s.troughDate)} />
                <Kpi label="Max drawdown" value={pct(s.maxDrawdown)} color="var(--it-sell)" sub="from a peak" />
                <Kpi label={`${t.benchmarkSymbol} same period`} value={pct(s.benchmarkChangePct)} sub={s.benchmarkLastDate ? `to ${day(s.benchmarkLastDate)}` : "—"} />
                <Kpi label="Difference" value={s.benchmarkChangePct != null ? pct(s.changePct - s.benchmarkChangePct) : "—"} color={tone(s.benchmarkChangePct != null ? s.changePct - s.benchmarkChangePct : null)} sub={`vs ${t.benchmarkSymbol}`} />
              </div>
              {(t.flags.length > 0 || t.corporateActions.length > 0) && (
                <ul className="px-4 pt-2 text-[11.5px] leading-relaxed" style={{ color: "var(--it-warn)" }}>
                  {t.flags.map((f) => <li key={f}>{FLAG_TEXT[f] || f}</li>)}
                  {t.corporateActions.map((a) => <li key={a.date} className="it-dim">Corporate action on {day(a.date)} (adjustment ratio {a.ratio}) — prices are split-adjusted, so the timeline stays continuous.</li>)}
                </ul>
              )}
              <div className="px-1 pt-2">
                <Suspense fallback={<Skeleton className="m-4 h-[300px]" />}><LTrack track={t} events={shown} /></Suspense>
              </div>
            </>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 px-4 pb-2 pt-3" style={{ borderTop: "1px solid var(--it-line-soft)" }}>
            <span className="it-label">Insider purchases (SEC Form 4, code P) · by transaction date</span>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Calendar days from the first purchase">
              {DAY_WINDOWS.map((d) => <button key={d} className="it-chip" aria-pressed={windowDays === d} style={windowDays === d ? chipOn : undefined} onClick={() => setWindowDays(d)} title={`Purchases on days 1–${d} (from ${day(t.startDate)})`}>{d}D</button>)}
              <button className="it-chip" aria-pressed={windowDays === null} style={windowDays === null ? chipOn : undefined} onClick={() => setWindowDays(null)}>All</button>
            </div>
            <div className="it-seg" role="group" aria-label="Grouping">
              <button aria-pressed={grouping === "purchase"} onClick={() => setGrouping("purchase")}>Per purchase</button>
              <button aria-pressed={grouping === "day"} onClick={() => setGrouping("day")}>Per day</button>
            </div>
            <span className="text-[11px] it-dim2">{count(shown.length)} of {count(t.events?.length)} purchases · {count(days.length)} transaction date{days.length === 1 ? "" : "s"}</span>
          </div>
          {!shown.length ? <EmptyState title="No purchases in this window." /> : grouping === "day" ? <DayRows days={days} priced={priced} /> : <Events events={shown} priced={priced} />}
          {priced && t.missingSessions?.length > 0 && (
            <div className="px-4 py-2 text-[11px] it-dim2">Trading sessions without a price bar ({t.missingSessions.length}): {t.missingSessions.slice(0, 8).map(day).join(", ")}{t.missingSessions.length > 8 ? " …" : ""} — shown as gaps.</div>
          )}
          <div className="px-4 py-2 text-[11px] leading-relaxed it-dim2" style={{ borderTop: "1px solid var(--it-line-soft)" }}>
            {t.methodology.baseline} {t.methodology.dataEnd}
            {priced ? ` Prices: ${t.prices.provider} files (${t.symbol}, benchmark ${t.benchmarkSymbol}) · licence: ${t.prices.licence}.` : ""}
          </div>
        </div>
      )}
    </Panel>
  );
}
