// User-strategy results for the run's OWN settings (display only — every number comes from
// GET /insider/backtest/run/:id/publication-now → strategy + rows[].strategy):
//   • actionable return over the selected horizon of N trading sessions: entry = first
//     eligible trade at/after SEC acceptance + latency (session rule), exit = close of the
//     N-th session, gross and net of costs, SPY over the same entry/exit;
//   • data quality: missing entry / exit prices, immature horizons, excluded records, SEC
//     coverage — missing values are counted, never shown as 0 %;
//   • reliability verdict (server) — incomplete data is never presented as reliable;
//   • side-by-side comparison of runs over the SAME date range, with an overfitting warning.
import { useState } from "react";
import { Link } from "react-router-dom";
import { Panel } from "../components/Common";
import InfoTip from "./InfoTip";
import ScrollableTable from "./ScrollableTable";
import { compactUsd, count, day, usd } from "../../../utils/insiderFormat";
import { pct, plainPct, publishedParts, etParts, SESSION_LABEL, ENTRY_SESSION_LABEL, strategyStatusShort, strategyStatusText, missingBreakdown, RELIABILITY_TEXT, comparableRuns, OVERFITTING_WARNING, buyersText } from "../../../utils/insiderBacktest";

const tone = (v) => (v == null || Math.abs(v) < 0.0005 ? undefined : v > 0 ? "var(--it-buy)" : "var(--it-sell)");
const latencyText = (s) => (s == null ? "—" : s < 60 ? `${s} s` : s % 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s / 60} min`);

function Kpi({ label, value, sub, color, help }) {
  return (
    <div className="it-kpi">
      <div className="it-label">{label}{help && <InfoTip label={label}>{help}</InfoTip>}</div>
      <div className="it-num mt-1 text-[18px] font-semibold" style={{ color: color || "var(--it-text)" }}>{value}</div>
      {sub && <div className="text-[11px] it-dim2">{sub}</div>}
    </div>
  );
}

function Reliability({ rel }) {
  if (!rel) return null;
  if (rel.verdict === "indicative") {
    return <div className="px-5 py-2.5 text-[12.5px]" style={{ color: "var(--it-text-2)", borderBottom: "1px solid var(--it-line-soft)" }}>Sample and coverage are sufficient for an indicative historical result — still a backtest, not a forecast.</div>;
  }
  return (
    <div role="status" className="px-5 py-2.5 text-[12.5px] leading-relaxed" style={{ color: "var(--it-text-2)", background: "var(--it-warn-soft)", borderBottom: "1px solid var(--it-warn-line)" }}>
      <strong className="font-semibold" style={{ color: "var(--it-warn)" }}>Not statistically reliable.</strong>{" "}
      {rel.reasons.map((r) => RELIABILITY_TEXT[r] || r).join(" · ")}. Read these figures as a description of the held data only.
    </div>
  );
}

function Cell({ r, children }) {
  if (!r) return <span className="bt-status">…</span>;
  if (r.status !== "ok") return <span className="bt-status" title={strategyStatusText(r.status)}>{strategyStatusShort(r.status)}</span>;
  return children;
}

const COLUMN_GROUPS = [{ id: "signal", label: "Signal" }, { id: "prices", label: "Entry & exit" }, { id: "returns", label: "Returns" }];

function SignalsTable({ signals, rows, onTrack }) {
  const [shown, setShown] = useState(50);
  const list = signals.slice(0, shown);
  return (
    <>
      <div className="hidden md:block">
        <ScrollableTable groups={COLUMN_GROUPS} label="Strategy signals — scroll sideways for more columns">
          <table className="it-table bt-table min-w-[1280px]">
            <thead><tr>
              <th scope="col" className="bt-sticky" data-group-start="signal">Company</th>
              <th scope="col" className="num">Buyers · purchases</th>
              <th scope="col" className="num">Combined value</th>
              <th scope="col">SEC published</th>
              <th scope="col" className="num" data-group-start="prices">Entry</th>
              <th scope="col" className="num">Exit</th>
              <th scope="col" className="num" data-group-start="returns">Gross</th>
              <th scope="col" className="num">Net</th>
              <th scope="col" className="num">SPY</th>
              <th scope="col" className="num">Excess</th>
            </tr></thead>
            <tbody>
              {list.map((s) => {
                const r = rows[s.id]?.strategy;
                const pub = publishedParts(s.publishedAt, { seconds: true });
                return (
                  <tr key={s.id} data-ticker={s.ticker || ""}>
                    <td className="bt-sticky w-[190px] min-w-[190px] max-w-[190px]">
                      {s.ticker ? <Link to={`/insider/company/${encodeURIComponent(s.ticker)}`} className="it-mono text-[14px] font-semibold hover:underline" style={{ color: "var(--it-text)" }}>{s.ticker}</Link> : <span className="it-mono text-[14px]">No ticker</span>}
                      <span className="bt-sub truncate" title={s.issuerName}>{s.issuerName}</span>
                      <button className="it-link mt-1 inline-block text-[12px]" onClick={() => onTrack(s.id)}>Timeline & snapshot →</button>
                    </td>
                    <td className="num it-num"><span style={{ color: "var(--it-text)" }}>{buyersText(s.uniqueBuyers, s.purchases)}</span><span className="bt-sub">trades {day(s.windowFrom)}{s.windowTo !== s.windowFrom ? ` – ${day(s.windowTo)}` : ""}</span></td>
                    <td className="num it-num"><span style={{ color: "var(--it-text)" }}>{compactUsd(s.valueUsd)}</span>{s.valuesExcluded ? <span className="bt-sub">{s.valuesExcluded} without USD value</span> : null}</td>
                    <td className="whitespace-nowrap"><span className="text-[13px]" style={{ color: "var(--it-text)" }}>{pub.date}</span><span className="bt-sub">{pub.time}</span></td>
                    <td className="num"><Cell r={r?.entry ? { status: "ok" } : r}>
                      <span className="it-num text-[13.5px]" style={{ color: "var(--it-text)" }} title={r?.entry?.splitFactor && r.entry.splitFactor !== 1 ? `traded at ${usd(r.entry.price)}, split-adjusted` : undefined}>{usd(r?.entry?.adjustedPrice ?? r?.entry?.splitAdjustedPrice ?? r?.entry?.price)}</span>
                      {r?.entry && <span className="bt-sub">{etParts(r.entry.time, { year: false, seconds: true }).date}, {etParts(r.entry.time, { seconds: true }).time}</span>}
                      {r?.entry && <span className="bt-sub">{SESSION_LABEL[r.entry.session] || r.entry.session}{r.entry.basis === "iex_minute_bar" ? " · approx." : ""}</span>}
                    </Cell></td>
                    <td className="num">{r?.exit ? <>
                      <span className="it-num text-[13.5px]" style={{ color: "var(--it-text)" }}>{r.exit.price != null ? usd(r.exit.price) : "—"}</span>
                      <span className="bt-sub">close {day(r.exit.date)}</span>
                    </> : <span className="bt-status">—</span>}</td>
                    <td className="num"><Cell r={r}><span className="it-num text-[14px] font-semibold" style={{ color: tone(r?.gross) }}>{pct(r?.gross, 2)}</span></Cell></td>
                    <td className="num"><Cell r={r}><span className="it-num text-[14px]" style={{ color: tone(r?.net) }}>{pct(r?.net, 2)}</span></Cell></td>
                    <td className="num">{r?.status === "ok" ? (r.benchmark != null ? <span className="it-num">{pct(r.benchmark, 2)}</span> : <span className="bt-status" title={strategyStatusText(r.benchmarkStatus)}>{strategyStatusShort(r.benchmarkStatus)}</span>) : "—"}</td>
                    <td className="num">{r?.status === "ok" && r.excess != null ? <span className="it-num" style={{ color: tone(r.excess) }}>{pct(r.excess, 2)}</span> : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollableTable>
      </div>
      <ul className="md:hidden">
        {list.map((s) => {
          const r = rows[s.id]?.strategy;
          const pub = publishedParts(s.publishedAt);
          return (
            <li key={s.id} className="px-4 py-3.5" style={{ borderBottom: "1px solid var(--it-line-soft)" }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="it-mono text-[15px] font-semibold" style={{ color: "var(--it-text)" }}>{s.ticker || "No ticker"}</span>
                  <span className="it-dim block truncate text-[12.5px]">{s.issuerName}</span>
                  <span className="bt-sub">SEC {pub.date}, {pub.time}</span>
                </div>
                <div className="shrink-0 text-right">
                  <span className="block text-[11px] it-dim2">Net</span>
                  <Cell r={r}><span className="it-num text-[16px] font-semibold" style={{ color: tone(r?.net) }}>{pct(r?.net, 2)}</span></Cell>
                  {r?.status === "ok" && <span className="bt-sub">gross {pct(r.gross, 2)} · SPY {pct(r.benchmark, 2)}</span>}
                </div>
              </div>
              <div className="mt-2 text-[12px] it-dim2">{buyersText(s.uniqueBuyers, s.purchases)} · {compactUsd(s.valueUsd)}{r?.entry ? ` · entry ${usd(r.entry.adjustedPrice ?? r.entry.price)} ${etParts(r.entry.time, { year: false }).date}` : ""}{r?.exit ? ` · exit ${day(r.exit.date)}` : ""}</div>
              <button className="it-btn mt-2 min-h-[40px]" onClick={() => onTrack(s.id)}>Timeline & snapshot →</button>
            </li>
          );
        })}
      </ul>
      {signals.length > shown && (
        <div className="flex justify-center p-3" style={{ borderTop: "1px solid var(--it-line-soft)" }}>
          <button className="it-btn" onClick={() => setShown((n) => n + 50)}>Show {Math.min(50, signals.length - shown)} more of {count(signals.length - shown)}</button>
        </div>
      )}
    </>
  );
}

export function StrategyResults({ result, rows = {}, strategy, onTrack }) {
  const cfg = strategy?.config;
  const sum = strategy?.summary;
  const miss = missingBreakdown(sum?.missing);
  const cov = result.coverage;
  const horizon = cfg?.horizonSessions ?? result.config.horizonSessions;
  return (
    <Panel title={`Strategy return · ${horizon} trading session${horizon === 1 ? "" : "s"}`}
      subtitle={cfg ? `Entry after SEC acceptance + ${latencyText(cfg.executionLatencySeconds)} (${ENTRY_SESSION_LABEL[cfg.entrySession] || cfg.entrySession}) · exit at the close of session ${horizon} · costs ${cfg.costPerSideBps} bps per side · vs SPY` : "loading…"}>
      <Reliability rel={strategy?.reliability} />
      <div className="it-kpis grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Signals" value={count(result.signals.length)} sub={sum ? `${count(sum.n)} with a complete ${horizon}-session return` : "loading"} />
        <Kpi label="Avg. gross" value={pct(sum?.grossMean, 2)} color={tone(sum?.grossMean)} sub={sum?.grossMedian == null ? "" : `median ${pct(sum.grossMedian, 2)}`} help="Before costs: exit close ÷ entry trade − 1. Price return only (no dividends)." />
        <Kpi label="Avg. net" value={pct(sum?.netMean, 2)} color={tone(sum?.netMean)} sub={sum?.netMedian == null ? "" : `median ${pct(sum.netMedian, 2)}`} help="After the estimated commission + slippage on entry and exit." />
        <Kpi label="Win rate (net)" value={sum?.winRate == null ? "—" : plainPct(sum.winRate)} sub={sum?.n ? `best ${pct(sum.best, 1)} · worst ${pct(sum.worst, 1)}` : ""} />
        <Kpi label="SPY same periods" value={pct(sum?.benchmarkMean, 2)} sub={sum?.benchmarkN != null ? `n = ${count(sum.benchmarkN)} · strategy net ${pct(sum.netMeanWithBenchmark, 2)} on these` : ""} help="SPY bought at its first eligible trade at/after each stock entry and sold at the close of the same exit session, no costs. Computed only for signals with a SPY comparison (n); the strategy's net average on the same signals is shown beside it." />
        <Kpi label="Avg. excess vs SPY" value={pct(sum?.excessMean, 2)} color={tone(sum?.excessMean)} sub={sum?.benchmarkN != null ? `n = ${count(sum.benchmarkN)}${sum.excessWinRate == null ? "" : ` · beat SPY ${plainPct(sum.excessWinRate)}`}` : ""} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5 px-5 py-2.5 text-[11.5px]" style={{ borderTop: "1px solid var(--it-line-soft)" }} aria-label="Data quality">
        <span className="it-label mr-1">Data quality</span>
        <span className="it-chip" title="SEC Form 4 business days held for the range (incl. window warm-up)" style={cov.complete ? { color: "var(--it-buy)" } : { color: "var(--it-warn)" }}>SEC coverage {plainPct(cov.ratio, 1)} ({count(cov.coveredDays)}/{count(cov.businessDays)} days)</span>
        <span className="it-chip" title="Signals with a complete entry → exit price pair">Price coverage {strategy?.reliability?.priceCoverage == null ? "—" : plainPct(strategy.reliability.priceCoverage, 0)}</span>
        <span className="it-chip" title="No eligible trade after publication">{count(miss.missingEntry)} missing entry</span>
        <span className="it-chip" title="No daily bar for the exit session (halt, delisting, symbol change)">{count(miss.missingExit)} missing exit</span>
        <span className="it-chip" title="Exit session has not closed yet — excluded, never counted as 0 %">{count(miss.immature)} immature</span>
        <span className="it-chip" title="No ticker on the Form 4 / unsupported symbol">{count(miss.excluded)} excluded</span>
        {miss.loading > 0 && <span className="it-chip">{count(miss.loading)} loading</span>}
        <span className="it-dim2">Missing returns are excluded from averages — never treated as 0 %.</span>
      </div>
      {result.signals.length ? <SignalsTable signals={result.signals} rows={rows} onTrack={onTrack} /> : null}
    </Panel>
  );
}

const cfgText = (c) => [
  `≥ ${c.minBuyers} buyer${c.minBuyers === 1 ? "" : "s"}`, `≥ ${compactUsd(c.minValueUsd)}`, `${c.windowDays} d window`,
  `${c.horizonSessions} sessions`, `${latencyText(c.executionLatencySeconds)} latency`, c.entrySession === "extended" ? "ext. hours" : "regular hrs",
  c.roles?.length ? c.roles.join("/") : "all roles", c.maxFilingDelayDays != null ? `filed ≤ ${c.maxFilingDelayDays} d` : null, c.openMarketOnly ? "open market" : null,
  `${c.costPerSideBps} bps/side`,
].filter(Boolean).join(" · ");

export function StrategyComparison({ list, range, currentJobId, onRemove, onClear }) {
  const { same, other } = comparableRuns(list, range);
  if (!list.length) return null;
  const covDiff = new Set(same.map((x) => x.secCoverage?.ratio)).size > 1;
  return (
    <Panel title="Compare strategies" subtitle={`Same historical range only: ${range ? `${day(range.from)} – ${day(range.to)}` : "—"} · up to 6 recent runs in this browser tab`}
      right={<button className="it-btn it-btn-ghost" onClick={onClear}>Clear</button>}>
      <div role="note" className="px-5 py-2.5 text-[12.5px] leading-relaxed" style={{ color: "var(--it-text-2)", background: "var(--it-warn-soft)", borderBottom: "1px solid var(--it-warn-line)" }}>
        <strong className="font-semibold" style={{ color: "var(--it-warn)" }}>Overfitting warning.</strong> {OVERFITTING_WARNING}
      </div>
      {same.length < 2 && <p className="px-5 py-3 text-[12.5px] it-dim2">Run another configuration over the same dates to compare it here.</p>}
      {same.length > 0 && (
        <div className="it-scroll-x">
          <table className="it-table min-w-[1100px]">
            <thead><tr>
              <th scope="col">Configuration</th><th scope="col" className="num">Signals</th><th scope="col" className="num">n (complete)</th>
              <th scope="col" className="num">Avg. net</th><th scope="col" className="num">Median net</th><th scope="col" className="num">Avg. gross</th>
              <th scope="col" className="num">Win rate</th><th scope="col" className="num">SPY</th><th scope="col" className="num">Excess</th>
              <th scope="col" className="num">SEC coverage</th><th scope="col">Reliability</th><th scope="col" />
            </tr></thead>
            <tbody>
              {same.map((x) => {
                const s = x.summary || {};
                return (
                  <tr key={x.jobId} style={x.jobId === currentJobId ? { background: "var(--it-accent-soft)" } : undefined}>
                    <td className="text-[12px]" style={{ color: "var(--it-text)" }}>{x.label ? <strong>{x.label} · </strong> : null}{cfgText(x.config)}</td>
                    <td className="num it-num">{count(x.signals)}</td>
                    <td className="num it-num">{count(s.n)}</td>
                    <td className="num it-num" style={{ color: tone(s.netMean) }}>{pct(s.netMean, 2)}</td>
                    <td className="num it-num">{pct(s.netMedian, 2)}</td>
                    <td className="num it-num">{pct(s.grossMean, 2)}</td>
                    <td className="num it-num">{s.winRate == null ? "—" : plainPct(s.winRate)}</td>
                    <td className="num it-num">{pct(s.benchmarkMean, 2)}</td>
                    <td className="num it-num" style={{ color: tone(s.excessMean) }}>{pct(s.excessMean, 2)}</td>
                    <td className="num it-num">{x.secCoverage ? plainPct(x.secCoverage.ratio, 1) : "—"}</td>
                    <td className="text-[11.5px]" style={{ color: x.reliability?.verdict === "indicative" ? "var(--it-text-2)" : "var(--it-warn)" }} title={(x.reliability?.reasons || []).map((r) => RELIABILITY_TEXT[r] || r).join("\n")}>{x.reliability?.verdict === "indicative" ? "Indicative" : "Not reliable"}</td>
                    <td className="num"><button className="it-link text-[12px]" onClick={() => onRemove(x.jobId)} aria-label="Remove from comparison">Remove</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {covDiff && <p className="px-5 py-2 text-[12px]" style={{ color: "var(--it-warn)" }}>SEC coverage differs between these runs (the backfill progressed) — differences may come from data, not settings. Re-run them to compare on identical data.</p>}
      {other.length > 0 && <p className="px-5 py-2 text-[11.5px] it-dim2">{other.length} earlier run{other.length === 1 ? "" : "s"} used a different date range and {other.length === 1 ? "is" : "are"} not compared.</p>}
    </Panel>
  );
}
