// /insider/backtesting — historical insider cluster-buying backtest.
// Everything shown comes from the server run (POST /api/insider/backtest/run):
// real SEC Form 4 signals reconstructed point-in-time, Bank of Israel FX for the
// U.S.-dollar threshold, and returns only when a licensed price provider is configured.
// No placeholder or demo performance is ever rendered — without price data the
// page shows the signals with "Price data required".
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import useBacktest from "../../../hooks/useBacktest";
import TrackPanel from "./TrackPanel";
import { Disclaimer, EmptyState, ErrorNote, Panel, Skeleton } from "../components/Common";
import { compactUsd, count, day, acceptedShort, usd } from "../../../utils/insiderFormat";
import { ROLE_OPTIONS, HORIZON_KEYS, defaultForm, toRunRequest, pct, plainPct, STATUS_TEXT, REASON_TEXT, dataStatus } from "../../../utils/insiderBacktest";

const LEquity = lazy(() => import("./BacktestCharts.jsx").then((m) => ({ default: m.EquityCurveChart })));
const LDist = lazy(() => import("./BacktestCharts.jsx").then((m) => ({ default: m.ReturnDistributionChart })));
// v2: the threshold is in U.S. dollars. Forms saved under v1 (ILS threshold) are never read.
const STORE_KEY = "it.backtestForm.v2";
const HLABEL = { "7d": "7D", "30d": "30D", "90d": "90D", "180d": "180D" };
const chipOn = { color: "var(--it-text)", borderColor: "var(--it-accent)", background: "var(--it-accent-soft)" };

function useForm() {
  const [f, setF] = useState(() => {
    try { sessionStorage.removeItem("it.backtestForm.v1"); } catch { /* storage unavailable */ } // old ILS-threshold form
    try { const v = JSON.parse(sessionStorage.getItem(STORE_KEY) || "null"); return v ? { ...defaultForm(), ...v } : defaultForm(); } catch { return defaultForm(); }
  });
  useEffect(() => { try { sessionStorage.setItem(STORE_KEY, JSON.stringify(f)); } catch { /* storage unavailable */ } }, [f]);
  return [f, (p) => setF((x) => ({ ...x, ...p })), () => setF(defaultForm())];
}

function Field({ label, hint, children }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="it-label">{label}</span>
      {children}
      {hint && <span className="text-[10.5px] leading-snug it-dim2">{hint}</span>}
    </label>
  );
}
const NumInput = ({ value, onChange, ...p }) => (
  <input className="it-input it-num w-full" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, "").slice(0, 14))} {...p} />
);

function StrategyPanel({ f, set, reset, prices, running, onRun, clientError }) {
  const capOk = prices?.available && prices?.capabilities?.marketCap;
  return (
    <Panel title="Strategy" subtitle="Cluster buying · Form 4 code P · trade-date window">
      <form className="flex flex-col gap-3 p-3 sm:p-4" onSubmit={(e) => { e.preventDefault(); onRun(); }}>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Signals from"><input type="date" className="it-input it-num w-full" value={f.from} max={f.to} onChange={(e) => set({ from: e.target.value })} /></Field>
          <Field label="to"><input type="date" className="it-input it-num w-full" value={f.to} min={f.from} onChange={(e) => set({ to: e.target.value })} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Min distinct buyers" hint="SEC CIK; joint filers = 1"><NumInput value={f.minBuyers} onChange={(v) => set({ minBuyers: v })} aria-label="Minimum distinct buyers" /></Field>
          <Field label="Combined value > $ (USD)" hint="All buyers together, Form 4 U.S.-dollar values"><NumInput value={f.minValueUsd} onChange={(v) => set({ minValueUsd: v })} aria-label="Minimum combined purchase value in U.S. dollars" /></Field>
          <Field label="Window (calendar days)" hint="Trade dates, 1-day resolution · strategy default 30">
            <NumInput value={f.windowDays} onChange={(v) => set({ windowDays: v })} aria-label="Rolling window in calendar days" />
            <span className="flex flex-wrap gap-1" role="group" aria-label="Window presets">
              {[1, 2, 3, 7, 30].map((d) => (
                <button type="button" key={d} className="it-chip" aria-pressed={String(f.windowDays) === String(d)} onClick={() => set({ windowDays: String(d) })}
                  style={String(f.windowDays) === String(d) ? chipOn : undefined}>{d}D</button>
              ))}
            </span>
          </Field>
          <Field label="Max lag (days)" hint="Latest trade → publication"><NumInput value={f.maxSignalLagDays} onChange={(v) => set({ maxSignalLagDays: v })} aria-label="Maximum signal lag in days" /></Field>
        </div>
        <div className="flex flex-col gap-1">
          <span className="it-label">Insider roles {f.roles.length ? `(${f.roles.length})` : "(any)"}</span>
          <div className="flex flex-wrap gap-1">
            {ROLE_OPTIONS.map((r) => (
              <button type="button" key={r} className="it-chip" aria-pressed={f.roles.includes(r)} style={f.roles.includes(r) ? chipOn : undefined}
                onClick={() => set({ roles: f.roles.includes(r) ? f.roles.filter((x) => x !== r) : [...f.roles, r] })}>{r}</button>
            ))}
          </div>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-[12.5px] it-dim" title="Code P alone is not assumed to be an exchange purchase">
          <input type="checkbox" checked={f.openMarketOnly} onChange={(e) => set({ openMarketOnly: e.target.checked })} className="h-4 w-4" style={{ accentColor: "var(--it-accent)" }} />
          Open-market purchases only
        </label>
        <details className="rounded-md" style={{ border: "1px solid var(--it-line-soft)" }}>
          <summary className="cursor-pointer px-3 py-2 text-[12px] it-dim">Optional filters & costs</summary>
          <div className="grid grid-cols-2 gap-2 px-3 pb-3">
            <Field label="Min purchase (USD)" hint="Per transaction"><NumInput value={f.minTransactionUsd} onChange={(v) => set({ minTransactionUsd: v })} placeholder="any" /></Field>
            <Field label="Prior decline ≥ %" hint="Over lookback, known at disclosure"><NumInput value={f.priorDeclinePct} onChange={(v) => set({ priorDeclinePct: v })} placeholder="off" disabled={!prices?.available} /></Field>
            <Field label="Lookback (sessions)"><NumInput value={f.priorLookbackSessions} onChange={(v) => set({ priorLookbackSessions: v })} disabled={!prices?.available} /></Field>
            <div />
            <Field label="Market cap min ($M)"><NumInput value={f.minMarketCapM} onChange={(v) => set({ minMarketCapM: v })} placeholder="off" disabled={!capOk} /></Field>
            <Field label="Market cap max ($M)"><NumInput value={f.maxMarketCapM} onChange={(v) => set({ maxMarketCapM: v })} placeholder="off" disabled={!capOk} /></Field>
            <Field label="Commission (bps/side)"><NumInput value={f.commissionBps} onChange={(v) => set({ commissionBps: v })} /></Field>
            <Field label="Slippage (bps/side)" hint="e.g. 10–50 for small caps"><NumInput value={f.slippageBps} onChange={(v) => set({ slippageBps: v })} /></Field>
            <Field label="Delisted / data ended">
              <select className="it-input w-full" value={f.delistingPolicy} onChange={(e) => set({ delistingPolicy: e.target.value })}>
                <option value="exclude">Exclude</option><option value="last_close">Last available close</option>
              </select>
            </Field>
            <Field label="Equity curve horizon">
              <select className="it-input w-full" value={f.equityHorizon} onChange={(e) => set({ equityHorizon: e.target.value })}>
                {HORIZON_KEYS.map((h) => <option key={h} value={h}>{HLABEL[h]}</option>)}
              </select>
            </Field>
            {!capOk && <p className="col-span-2 text-[10.5px] it-dim2">Price-based filters need a price provider{prices?.available ? " that supplies market capitalization" : ""}.</p>}
          </div>
        </details>
        {clientError && <div className="text-[12px]" style={{ color: "var(--it-warn)" }}>{clientError}</div>}
        <div className="flex items-center gap-2">
          <button type="submit" className="it-btn it-btn-primary flex-1 justify-center" disabled={running || !!clientError}>{running ? "Running…" : "Run backtest"}</button>
          <button type="button" className="it-btn" onClick={reset} disabled={running}>Reset</button>
        </div>
      </form>
    </Panel>
  );
}

function Meter({ ratio }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--it-line-soft)" }} aria-hidden="true">
      <div className="h-full rounded-full" style={{ width: `${Math.round((ratio || 0) * 100)}%`, background: ratio >= 1 ? "var(--it-buy)" : "var(--it-warn)" }} />
    </div>
  );
}

function DataPanel({ status, f }) {
  if (status.loading && !status.data) return <Panel title="Data coverage"><div className="flex flex-col gap-2 p-4"><Skeleton className="h-4" /><Skeleton className="h-4" /><Skeleton className="h-4" /></div></Panel>;
  if (status.error) return <ErrorNote>{status.error}</ErrorNote>;
  const d = status.data, r = d.form4.range, b = d.form4.backfill;
  return (
    <Panel title="Data coverage" subtitle="What this backtest can see">
      <div className="grid grid-cols-1 gap-4 p-3 sm:grid-cols-3 sm:p-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="it-label">SEC Form 4 filings</div>
          {r && <>
            <div className="it-num text-[18px] font-semibold" style={{ color: r.complete ? "var(--it-buy)" : "var(--it-warn)" }}>{plainPct(r.ratio)}</div>
            <Meter ratio={r.ratio} />
            <div className="text-[11.5px] it-dim2">{count(r.coveredDays)} of {count(r.businessDays)} SEC business days held ({day(r.from)} – {day(r.to)})</div>
          </>}
          <div className="text-[11px] it-dim2">Backfilled: {d.form4.historicalDays ? `${count(d.form4.historicalDays)} days (${day(d.form4.historicalFrom)} – ${day(d.form4.historicalTo)})` : "none"} · live: {d.form4.liveFrom ? `${day(d.form4.liveFrom)} – ${day(d.form4.liveTo)}` : "—"}</div>
          {b && <div className="text-[11px] it-dim2">Last backfill: {b.state}{b.stoppedReason ? ` (${b.stoppedReason})` : ""} · {count(b.daysComplete)}/{count(b.daysTotal)} days · {count(b.downloaded)} downloaded</div>}
          {r && !r.complete && <code className="mt-1 block overflow-x-auto whitespace-nowrap rounded px-2 py-1 text-[10.5px] it-dim" style={{ background: "var(--it-bg)" }}>npm run backtest:backfill -- --from {f.from} --to {f.to}</code>}
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="it-label">Price files (Backtesting only)</div>
          {d.priceFetch ? <>
            <div className="text-[13px]" style={{ color: "var(--it-text)" }}>{count(d.priceFetch.byStatus.ok || 0)} symbols · fetched {day(d.priceFetch.ranAt?.slice(0, 10))}</div>
            <div className="text-[11px] it-dim2">{d.priceFetch.licence}{d.priceFetch.stoppedReason ? ` · last run stopped: ${d.priceFetch.stoppedReason}` : ""}{d.priceFetch.byStatus.not_found ? ` · ${d.priceFetch.byStatus.not_found} not found` : ""}{d.priceFetch.byStatus.name_mismatch ? ` · ${d.priceFetch.byStatus.name_mismatch} name mismatch` : ""}</div>
          </> : <div className="text-[13px]" style={{ color: "var(--it-warn)" }}>Not fetched</div>}
          <code className="text-[10.5px] it-dim">npm run backtest:prices</code>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="it-label">Historical prices</div>
          <div className="text-[13px]" style={{ color: d.prices.available ? "var(--it-text)" : "var(--it-warn)" }}>{d.prices.available ? `${d.prices.provider} · benchmark ${d.prices.benchmarkSymbol}` : "Price data required"}</div>
          <div className="text-[11px] it-dim2">{d.prices.available ? "Adjusted daily bars from the configured licensed source." : d.prices.reason}</div>
        </div>
      </div>
    </Panel>
  );
}

function Kpi({ label, value, sub, color, title }) {
  return (
    <div className="it-kpi" title={title}>
      <div className="it-label">{label}</div>
      <div className="it-num mt-1 text-[18px] font-semibold" style={{ color: color || "var(--it-text)" }}>{value}</div>
      {sub && <div className="text-[11px] it-dim2">{sub}</div>}
    </div>
  );
}
// Neutral when the value rounds to 0.0 % (as displayed) — no colour for noise.
const tone = (v) => (v == null || Math.abs(v) < 0.0005 ? undefined : v > 0 ? "var(--it-buy)" : "var(--it-sell)");

function ReturnCell({ s, h }) {
  const x = s.horizons?.[h];
  if (!x) return <span className="it-dim2">—</span>;
  if (x.status === "pending") return <span className="text-[11px] it-dim2" title="Forward window not complete yet">pending</span>;
  if (x.status === "excluded") return <span className="text-[11px] it-dim2" title={REASON_TEXT[x.reason] || x.reason}>n/a</span>;
  return (
    <span title={x.flag ? `Flag: ${x.flag}` : undefined}>
      <span className="it-num whitespace-nowrap font-medium" style={{ color: tone(x.net) }}>{pct(x.net)}</span>
      <span className="block text-[10.5px] it-dim2">vs S&P {pct(x.excess)}</span>
    </span>
  );
}

function StatusCell({ s }) {
  if (s.status === "evaluated") return null;
  const text = s.status === "price_data_required" ? "Price data required" : `${s.status === "pending" ? "Pending" : s.status === "filtered" ? "Filtered" : "Excluded"}: ${REASON_TEXT[s.reason] || s.reason}`;
  return <span className="text-[10.5px] it-dim2">{text}</span>;
}

// "Since 1st buy": the company's continuous timeline (tracking.js) — anchored at its earliest cluster.
function SinceFirst({ t }) {
  if (!t) return <span className="it-dim2">—</span>;
  if (t.changePct == null) return <span className="text-[10.5px] it-dim2">{t.status === "price_data_required" ? "needs prices" : t.status === "price_data_restricted" ? "internal only" : "n/a"}</span>;
  return <span className="it-num font-medium" style={{ color: tone(t.changePct) }}><span className="whitespace-nowrap">{pct(t.changePct)}</span><span className="block text-[10.5px] it-dim2" title="First-purchase-date close → latest daily close (open the tracking panel for the current price)">{day(t.priceDate || t.startDate)} → close {day(t.lastDate)}</span></span>;
}

function ResultsTable({ signals, tracks = {}, onTrack }) {
  const [shown, setShown] = useState(50);
  const list = signals.slice(0, shown);
  return (
    <>
      <div className="it-table-wrap hidden md:block">
        <table className="it-table min-w-[1120px]">
          <thead><tr>
            <th scope="col">Company</th><th scope="col" className="num" title="Change of the adjusted close since the first purchase of the company's earliest cluster (baseline never reset)">Since 1st buy</th><th scope="col" className="num">Buyers</th><th scope="col" className="num">Combined purchases</th>
            <th scope="col">Signal published (SEC)</th><th scope="col" title="Open of the first session after publication">Entry (open)</th>
            {HORIZON_KEYS.map((h) => <th key={h} scope="col" className="num">{HLABEL[h]}</th>)}
          </tr></thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.id}>
                <td className="max-w-[260px]">
                  {s.ticker ? <Link to={`/insider/company/${encodeURIComponent(s.ticker)}`} className="it-mono font-semibold hover:underline" style={{ color: "var(--it-text)" }}>{s.ticker}</Link> : <span className="it-mono">—</span>}
                  <div className="truncate text-[11.5px] it-dim2" title={s.issuerName}>{s.issuerName}</div>
                  <StatusCell s={s} />
                  <button className="it-link mt-0.5 block text-[11px]" onClick={() => onTrack(s.id)}>Track since first buy →</button>
                </td>
                <td className="num"><SinceFirst t={tracks[s.issuerCik]} /></td>
                <td className="num it-num" title={s.buyers.map((b) => `${b.name} (${b.roles.join(", ")})`).join("\n")}>{s.uniqueBuyers}<div className="text-[10.5px] it-dim2">{s.purchases} tx</div></td>
                <td className="num it-num it-buy">{compactUsd(s.valueUsd)}<div className="text-[10.5px] it-dim2">{s.purchases} purchase{s.purchases === 1 ? "" : "s"}{s.valuesExcluded ? ` · ${s.valuesExcluded} without USD value` : ""}</div></td>
                <td className="it-num whitespace-nowrap text-[12px]" title={`Trades ${s.windowFrom} – ${s.windowTo}`}>{acceptedShort(s.publishedAt)}
                  <div className="text-[10.5px] it-dim2">trades {day(s.windowFrom)}{s.windowTo !== s.windowFrom ? ` – ${day(s.windowTo)}` : ""}</div>
                </td>
                <td className="it-num whitespace-nowrap it-dim">{day(s.entryDate)}<div className="text-[10.5px]" style={{ color: s.entryPrice != null ? "var(--it-text)" : undefined }}>{s.entryPrice != null ? usd(s.entryPrice) : <span className="it-dim2">no price</span>}</div></td>
                {HORIZON_KEYS.map((h) => <td key={h} className="num"><ReturnCell s={s} h={h} /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="md:hidden">
        {list.map((s) => (
          <li key={s.id} className="px-3.5 py-3" style={{ borderBottom: "1px solid var(--it-line-soft)" }}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {s.ticker ? <Link to={`/insider/company/${encodeURIComponent(s.ticker)}`} className="it-mono font-semibold" style={{ color: "var(--it-text)" }}>{s.ticker}</Link> : <span className="it-mono">—</span>}
                <div className="truncate text-[11.5px] it-dim2">{s.issuerName}</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="it-num font-semibold it-buy">{compactUsd(s.valueUsd)}</div>
                <div className="it-num text-[11px] it-dim2">{s.uniqueBuyers} buyers · {s.purchases} purchases</div>
              </div>
            </div>
            <div className="mt-1 text-[11.5px] it-dim2">Published {acceptedShort(s.publishedAt)} · entry {day(s.entryDate)}{s.entryPrice != null ? ` @ ${usd(s.entryPrice)}` : ""}</div>
            <div className="mt-1.5 grid grid-cols-4 gap-1 text-center">
              {HORIZON_KEYS.map((h) => <div key={h}><div className="it-label">{HLABEL[h]}</div><ReturnCell s={s} h={h} /></div>)}
            </div>
            <StatusCell s={s} />
            <div className="mt-1 flex items-center justify-between text-[11.5px]">
              <button className="it-link" onClick={() => onTrack(s.id)}>Track since first buy →</button>
              <SinceFirst t={tracks[s.issuerCik]} />
            </div>
          </li>
        ))}
      </ul>
      {signals.length > shown && (
        <div className="flex justify-center p-3" style={{ borderTop: "1px solid var(--it-line-soft)" }}>
          <button className="it-btn" onClick={() => setShown((n) => n + 50)}>Show {Math.min(50, signals.length - shown)} more of {count(signals.length - shown)}</button>
        </div>
      )}
    </>
  );
}

// Separates the four things that can be incomplete (never folded into one number).
function DataStatus({ result }) {
  const d = dataStatus(result);
  const Chip = ({ ok, children, title }) => (
    <span className="it-chip" title={title} style={ok ? { color: "var(--it-buy)" } : { color: "var(--it-warn)", borderColor: "rgba(232,176,75,0.35)", background: "var(--it-warn-soft)" }}>{children}</span>
  );
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px]" aria-label="Data status">
      <span className="it-label mr-1">Data status</span>
      <Chip ok={d.secComplete} title="SEC Form 4 daily indexes held for the whole range (incl. warm-up)">{d.secComplete ? "SEC history complete" : `SEC history partial (${d.secCovered})`}</Chip>
      <Chip ok={d.pricesMissing === 0 && d.pricesAvailable} title="Signals without usable historical prices (no symbol / no data / no entry price)">{!d.pricesAvailable ? "No price data" : d.pricesMissing ? `${d.pricesMissing} signal${d.pricesMissing === 1 ? "" : "s"} without prices` : "Prices for all signals"}</Chip>
      <Chip ok={d.pendingWindows === 0} title="Forward windows that have not elapsed yet (never estimated)">{d.pendingWindows ? `${d.pendingWindows} forward window${d.pendingWindows === 1 ? "" : "s"} not complete yet` : "All forward windows complete"}</Chip>
      <span className="it-dim2">All values in U.S. dollars.</span>
    </div>
  );
}

function Results({ result, jobId }) {
  const [trackId, setTrackId] = useState(null);
  const openTrack = (id) => { setTrackId(id); setTimeout(() => document.getElementById("bt-track")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); };
  const [h, setH] = useState(result.config.equityHorizon || "90d");
  const st = result.stats?.byHorizon?.[h];
  const priced = result.status === "complete";
  const cov = result.coverage;
  return (
    <div className="flex flex-col gap-3">
      <div role="status" className="rounded-md px-3 py-2 text-[12px] leading-relaxed"
        style={priced ? { color: "var(--it-text-2)", background: "var(--it-accent-soft)", border: "1px solid rgba(59,158,255,0.25)" } : { color: "#d7c08f", background: "var(--it-warn-soft)", border: "1px solid rgba(232,176,75,0.25)" }}>
        <strong className="font-semibold">{priced ? "Historical backtest." : result.status === "price_data_required" ? "Price data required." : result.status === "price_data_restricted" ? "Internal use only." : result.status}</strong>{" "}
        {STATUS_TEXT[result.status]}
        {!cov.complete && <> <strong className="font-semibold" style={{ color: "var(--it-warn)" }}>Partial data:</strong> SEC Form 4 filings are held for {count(cov.coveredDays)} of {count(cov.businessDays)} business days ({day(cov.from)} – {day(cov.to)}, incl. a {result.config.windowDays + 5}-day warm-up), so signals in missing periods are absent.</>}
      </div>
      <DataStatus result={result} />

      <div className="it-panel">
        <div className="it-kpis grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8">
          <Kpi label="Signals" value={count(result.signals.length)} sub={`${day(result.config.from)} – ${day(result.config.to)}`} />
          <Kpi label="Evaluated" value={priced ? count(result.stats.evaluated) : "—"} sub={priced ? `${count(result.signals.length - result.stats.evaluated)} not evaluated` : "needs prices"} />
          {priced && st ? <>
            <Kpi label={`Win rate · ${HLABEL[h]}`} value={plainPct(st.winRate)} sub={`${count(st.n)} complete · ${count(st.pending)} pending`} />
            <Kpi label="Average" value={pct(st.mean)} color={tone(st.mean)} sub="net of costs" />
            <Kpi label="Median" value={pct(st.median)} color={tone(st.median)} />
            <Kpi label="S&P 500 (avg)" value={pct(st.benchmarkMean)} sub={result.benchmark?.symbol} />
            <Kpi label="Excess vs S&P" value={pct(st.excessMean)} color={tone(st.excessMean)} sub={`median ${pct(st.excessMedian)}`} />
            <Kpi label="Max drawdown" value={result.equity ? pct(result.equity.maxDrawdown) : "—"} color="var(--it-sell)" sub={`portfolio · ${HLABEL[result.equity?.horizon || h]}`} />
          </> : (
            <div className="col-span-2 flex items-center px-4 py-3 text-[12px] it-dim2 sm:col-span-2 xl:col-span-6">
              Performance metrics (win rate, average / median return, S&P 500 comparison, drawdown) appear only after a run with historical price data. No values are estimated.
            </div>
          )}
        </div>
        {priced && (
          <div className="flex items-center gap-2 px-3 py-2" style={{ borderTop: "1px solid var(--it-line-soft)" }}>
            <span className="it-label">Horizon</span>
            <div className="it-seg" role="group" aria-label="Return horizon">
              {HORIZON_KEYS.map((k) => <button key={k} aria-pressed={h === k} onClick={() => setH(k)}>{HLABEL[k]}</button>)}
            </div>
            <span className="text-[11px] it-dim2">{st?.sessions} trading sessions from the entry open</span>
          </div>
        )}
      </div>

      {priced && result.equity && (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          <Panel title="Equity curve vs S&P 500" subtitle={`Equal-weight open positions · ${HLABEL[result.equity.horizon]} holding · ${count(result.equity.positions)} positions`} className="xl:col-span-2">
            <Suspense fallback={<Skeleton className="m-4 h-[280px]" />}><LEquity equity={result.equity} benchmarkSymbol={result.benchmark?.symbol} /></Suspense>
          </Panel>
          <Panel title={`Return distribution · ${HLABEL[h]}`} subtitle="Net return per signal (5-point bins)">
            <Suspense fallback={<Skeleton className="m-4 h-[240px]" />}><LDist signals={result.signals} horizon={h} /></Suspense>
          </Panel>
        </div>
      )}

      {trackId && <div id="bt-track"><TrackPanel jobId={jobId} signalId={trackId} onClose={() => setTrackId(null)} /></div>}

      <Panel title="Signals" subtitle={`${count(result.signals.length)} historical cluster${result.signals.length === 1 ? "" : "s"} · published by SEC acceptance time`}>
        {result.signals.length ? <ResultsTable signals={result.signals} tracks={result.tracks} onTrack={openTrack} /> : (
          <EmptyState title="No signals in this range.">{cov.complete ? "No cluster met the strategy in the held SEC data." : "Most of this range has not been backfilled from SEC yet."}</EmptyState>
        )}
      </Panel>
    </div>
  );
}

function Methodology({ m }) {
  if (!m) return null;
  return (
    <details className="it-panel">
      <summary className="cursor-pointer px-4 py-3 text-[13px] font-medium" style={{ color: "var(--it-text)" }}>Methodology — signal, entry, exit and overlap rules</summary>
      <dl className="grid grid-cols-1 gap-3 px-4 pb-4 text-[12px] leading-relaxed lg:grid-cols-2">
        {Object.entries(m).map(([k, v]) => (
          <div key={k}><dt className="it-label">{k}</dt><dd className="mt-0.5 it-dim">{v}</dd></div>
        ))}
      </dl>
    </details>
  );
}

export default function BacktestPage() {
  const [f, set, reset] = useForm();
  const req = useMemo(() => toRunRequest(f), [f]);
  const range = useMemo(() => (req.body ? { from: req.body.from, to: req.body.to } : null), [req.body]);
  const { status, reloadStatus, run, start } = useBacktest(range);
  const running = run.state === "running";
  useEffect(() => { if (run.state === "done") reloadStatus(); }, [run.state, reloadStatus]);
  const p = run.progress;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-[16px] font-semibold tracking-tight" style={{ color: "var(--it-text)" }}>Backtesting</h1>
          <p className="text-[12px] it-dim2">Did past clusters of insider purchases precede returns? Reconstructed from what was public at the time.</p>
        </div>
        <span className="it-chip" style={{ color: "var(--it-warn)", borderColor: "rgba(232,176,75,0.35)", background: "var(--it-warn-soft)" }}>Historical simulation · not live signals</span>
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          <StrategyPanel f={f} set={set} reset={reset} prices={status.data?.prices} running={running} onRun={() => req.body && start(req.body)} clientError={req.error} />
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <DataPanel status={status} f={f} />
          {running && (
            <div className="it-panel flex flex-col gap-2 px-4 py-3" role="status" aria-live="polite">
              <div className="flex justify-between text-[12px] it-dim"><span>Running backtest · {p?.stage || "starting"}</span>{p?.total ? <span className="it-num">{count(p.done)} / {count(p.total)}</span> : null}</div>
              <div className="h-1.5 overflow-hidden rounded-full" style={{ background: "var(--it-line-soft)" }}>
                <div className="it-skel h-full" style={{ width: p?.total ? `${Math.max(5, (p.done / p.total) * 100)}%` : "35%" }} />
              </div>
            </div>
          )}
          {run.state === "error" && <ErrorNote>{run.error}</ErrorNote>}
          {run.result ? <Results key={run.jobId} result={run.result} jobId={run.jobId} /> : !running && (
            <div className="it-panel"><EmptyState title="Configure the strategy and run the backtest.">Results are computed on the server from stored SEC filings. Nothing is shown until a run finishes.</EmptyState></div>
          )}
          <Methodology m={status.data?.methodology} />
        </div>
      </div>
      <Disclaimer />
    </div>
  );
}
