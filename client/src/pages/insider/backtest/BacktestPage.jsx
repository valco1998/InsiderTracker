// /insider/backtesting — historical insider cluster-buying backtest.
// Everything shown comes from the server run (POST /api/insider/backtest/run):
// real SEC Form 4 signals reconstructed point-in-time, Bank of Israel FX for the
// U.S.-dollar threshold, and returns only when a licensed price provider is configured.
// No placeholder or demo performance is ever rendered — without price data the
// page shows the signals with "Price data required".
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import useBacktest from "../../../hooks/useBacktest";
import TrackPanel from "./TrackPanel";
import { Disclaimer, EmptyState, ErrorNote, PageHeader, Panel, Skeleton } from "../components/Common";
import { compactUsd, count, day, usd } from "../../../utils/insiderFormat";
import { ROLE_OPTIONS, HORIZON_KEYS, defaultForm, toRunRequest, pct, plainPct, dataStatus, pubStatusText, pubStatusShort, publicationSummary, SESSION_LABEL, PROVIDER_LABEL, ENTRY_BASIS_LABEL, METRIC_HELP, publishedParts, etParts, freshness, buyersText, IPO_LABEL, IPO_HELP } from "../../../utils/insiderBacktest";
import InfoTip from "./InfoTip";
import ScrollableTable from "./ScrollableTable";
import { HorizonPanel, CoveragePanel } from "./HistoricalPanels";
import usePublicationNow from "../../../hooks/usePublicationNow";
import useIpoContext from "../../../hooks/useIpoContext";

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
      {hint && <span className="text-[12px] leading-snug it-dim2">{hint}</span>}
    </label>
  );
}
const NumInput = ({ value, onChange, ...p }) => (
  <input className="it-input it-num w-full" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, "").slice(0, 14))} {...p} />
);

// Current settings at a glance (exact form values — nothing is re-defaulted here).
function StrategySummary({ f }) {
  const usdText = (v) => (v === "" || v == null ? "—" : `$${Number(v).toLocaleString("en-US")}`);
  const pills = [
    ["Period", `${f.from ? day(f.from) : "—"} – ${f.to ? day(f.to) : "—"}`],
    ["Buyers", `≥ ${f.minBuyers || "—"}`],
    ["Combined", `> ${usdText(f.minValueUsd)}`],
    ["Window", `${f.windowDays || "—"} days`],
    ["Max lag", `${f.maxSignalLagDays || "—"} days`],
    ["Roles", f.roles.length ? f.roles.join(", ") : "Any"],
  ];
  if (f.openMarketOnly) pills.push(["Purchases", "Open-market only"]);
  if (f.minTransactionUsd) pills.push(["Min purchase", usdText(f.minTransactionUsd)]);
  return pills.map(([k, v]) => <span key={k} className="bt-pill">{k} <strong className="it-num">{v}</strong></span>);
}

function StrategyPanel({ f, set, reset, prices, running, onRun, clientError, hasResult }) {
  const capOk = prices?.available && prices?.capabilities?.marketCap;
  const [open, setOpen] = useState(!hasResult);
  useEffect(() => { if (hasResult) setOpen(false); }, [hasResult]);
  return (
    <section className="it-panel" aria-label="Strategy">
      <div className="flex flex-wrap items-start gap-4 px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2"><h2 className="it-panel-title">Strategy</h2><span className="text-[12.5px] it-dim2">Cluster buying · Form 4 code P · trade-date window</span></div>
          <div className="mt-2.5 flex flex-wrap gap-1.5"><StrategySummary f={f} /></div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" className="it-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="bt-strategy-form">{open ? "Hide settings" : "Edit strategy"}</button>
          <button type="button" className="it-btn it-btn-primary" onClick={onRun} disabled={running || !!clientError}>{running ? "Running…" : "Run backtest"}</button>
        </div>
      </div>
      {clientError && <div className="px-5 pb-3 text-[13px]" style={{ color: "var(--it-warn)" }}>{clientError}</div>}
      {open && (
      <form id="bt-strategy-form" className="flex flex-col gap-4 px-5 pb-5 pt-4" style={{ borderTop: "1px solid var(--it-line-soft)" }} onSubmit={(e) => { e.preventDefault(); onRun(); }}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Signals from"><input type="date" className="it-input it-num w-full" value={f.from} max={f.to} onChange={(e) => set({ from: e.target.value })} /></Field>
          <Field label="to"><input type="date" className="it-input it-num w-full" value={f.to} min={f.from} onChange={(e) => set({ to: e.target.value })} /></Field>
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
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="it-label">Insider roles {f.roles.length ? `(${f.roles.length})` : "(any)"}</span>
            <div className="flex flex-wrap gap-1.5">
              {ROLE_OPTIONS.map((r) => (
                <button type="button" key={r} className="it-chip" aria-pressed={f.roles.includes(r)} style={f.roles.includes(r) ? chipOn : undefined}
                  onClick={() => set({ roles: f.roles.includes(r) ? f.roles.filter((x) => x !== r) : [...f.roles, r] })}>{r}</button>
              ))}
            </div>
            <label className="mt-1 flex cursor-pointer items-center gap-2 text-[13px] it-dim" title="Code P alone is not assumed to be an exchange purchase">
              <input type="checkbox" checked={f.openMarketOnly} onChange={(e) => set({ openMarketOnly: e.target.checked })} className="h-4 w-4" style={{ accentColor: "var(--it-accent)" }} />
              Open-market purchases only
            </label>
          </div>
        </div>
        <details className="rounded-lg" style={{ border: "1px solid var(--it-line-soft)" }}>
          <summary className="cursor-pointer px-4 py-2.5 text-[13px] font-medium it-dim">Advanced · optional filters & costs</summary>
          <div className="grid grid-cols-1 gap-4 px-4 pb-4 pt-1 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Min purchase (USD)" hint="Per transaction"><NumInput value={f.minTransactionUsd} onChange={(v) => set({ minTransactionUsd: v })} placeholder="any" /></Field>
            <Field label="Prior decline ≥ %" hint="Over lookback, known at disclosure"><NumInput value={f.priorDeclinePct} onChange={(v) => set({ priorDeclinePct: v })} placeholder="off" disabled={!prices?.available} /></Field>
            <Field label="Lookback (sessions)"><NumInput value={f.priorLookbackSessions} onChange={(v) => set({ priorLookbackSessions: v })} disabled={!prices?.available} /></Field>
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
            {!capOk && <p className="text-[12px] it-dim2 sm:col-span-2 lg:col-span-4">Price-based filters need a price provider{prices?.available ? " that supplies market capitalization" : ""}.</p>}
          </div>
        </details>
        <div className="flex items-center gap-2">
          <button type="submit" className="it-btn it-btn-primary" disabled={running || !!clientError}>{running ? "Running…" : "Run backtest"}</button>
          <button type="button" className="it-btn it-btn-ghost" onClick={reset} disabled={running}>Reset to defaults</button>
        </div>
      </form>
      )}
    </section>
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
    <Panel title="Data & SEC coverage" subtitle="What this backtest can see — partial history means signals from missing days are absent">
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

// ---- Results: plain-English columns. Display only — every number comes from the server unchanged. ----
const isAwaiting = (s) => String(s || "").startsWith("awaiting");
const entryOf = (m) => m?.entry || null;
const entryPrice = (e) => (e ? e.splitAdjustedPrice ?? e.price : null);
const provName = (p) => PROVIDER_LABEL[p] || p || "—";
const FRESH_COLOR = { recent: "var(--it-buy)", closed: "var(--it-text-3)", old: "var(--it-warn)", unavailable: "var(--it-text-3)" };

// INFORMATIONAL chip for purchases that may be IPO allocations (evidence on hover / tap / focus).
function IpoChip({ c }) {
  if (!c || !IPO_LABEL[c.status]) return null;
  const verified = c.status === "verified";
  const flagged = (c.purchases || []).filter((p) => p.level === "verified" || p.level === "possible");
  return (
    <InfoTip label={IPO_LABEL[c.status]} triggerClass={`bt-ipo-chip ${verified ? "is-verified" : "is-possible"}`} trigger={<>{verified ? "IPO allocation" : "Possible IPO allocation"}</>}>
      <span className="block">{IPO_HELP[c.status]}</span>
      {c.offering && <span className="mt-1 block">IPO prospectus ({c.offering.form}, filed {day(c.offering.filingDate)}): ${c.offering.offeringPrice.toFixed(2)} per share.</span>}
      <span className="mt-1 block">{flagged.length} of {(c.purchases || []).length} purchases · {compactUsd(c.flaggedValueUsd)} at the offering price.</span>
      <span className="mt-1 block it-dim2">{IPO_HELP.note}</span>
    </InfoTip>
  );
}

// Why a value is missing — a short label (full reason on hover), never 0 %.
function Status({ status }) {
  return <span className={`bt-status ${isAwaiting(status) ? "is-waiting" : ""}`} title={pubStatusText(status)}>{pubStatusShort(status)}</span>;
}

// A return (%) with its colour; missing data is a labelled status.
function ReturnValue({ m, size = "lg" }) {
  if (!m) return <span className="bt-status">…</span>;
  if (m.status !== "ok") return <Status status={m.status} />;
  const cls = size === "lg" ? "text-[17px] font-semibold" : "text-[13.5px] font-medium";
  return <span data-metric={size === "lg" ? "primary" : "regular"} className={`it-num whitespace-nowrap ${cls}`} style={{ color: tone(m.changePct) ?? "var(--it-text)" }}>{pct(m.changePct, 2)}</span>;
}

// Entry trade: the dollar amount first, readable time and session underneath.
function EntryPrice({ m, metric, small = false }) {
  const e = entryOf(m);
  if (!e) return m ? <Status status={m.status} /> : <span className="bt-status">…</span>;
  const t = etParts(e.time, { year: false });
  const split = e.splitFactor && e.splitFactor !== 1;
  const tip = `${t.date}, ${etParts(e.time, { seconds: true }).time} · ${SESSION_LABEL[e.session] || e.session} · ${ENTRY_BASIS_LABEL[e.basis] || e.basis} via ${provName(e.provider)}${split ? ` · traded at ${usd(e.price)}, adjusted for a ${e.splitFactor}-for-1 split` : ""}`;
  return (
    <span className="block whitespace-nowrap" title={tip}>
      <span data-metric={metric} className={`it-num ${small ? "text-[13.5px]" : "text-[14.5px] font-medium"}`} style={{ color: "var(--it-text)" }}>{usd(entryPrice(e))}</span>
      {split && <span className="ml-1 text-[10.5px] it-dim2">split-adjusted</span>}
      <span className="bt-sub">{t.date}, {t.time}</span>
      {!small && <span className="bt-tag">{SESSION_LABEL[e.session] || e.session}{e.basis === "iex_minute_bar" ? " · approx." : ""}</span>}
    </span>
  );
}

// Latest price with the age of that trade (not the page's refresh time).
function LatestPrice({ l, market }) {
  if (!l) return <span className="bt-status">…</span>;
  const f = freshness(l, market);
  if (f.level === "unavailable") return <span className="bt-status" title={pubStatusText(l.status)}>Price unavailable</span>;
  const t = etParts(l.time, { year: false });
  return (
    <span className="block whitespace-nowrap" title={`${f.note}. ${METRIC_HELP.latestPrice}${l.stale ? " Cached value." : ""}`}>
      <span data-metric="latest" className="it-num text-[14.5px] font-medium" style={{ color: "var(--it-text)" }}>{usd(l.price)}</span>
      <span className="bt-sub">{t.date}, {t.time}</span>
      <span className="bt-sub" style={{ color: f.level === "old" ? "var(--it-warn)" : undefined }}><span className="bt-dot" style={{ background: FRESH_COLOR[f.level] }} aria-hidden="true" />{f.label}</span>
    </span>
  );
}

// "Return Since First Insider Buy": the separate first-purchase timeline.
function SinceFirst({ t }) {
  if (!t) return <span className="bt-status">—</span>;
  if (t.changePct == null) return <span className="bt-status">{t.status === "price_data_required" ? "Needs price data" : t.status === "price_data_restricted" ? "Internal only" : "Not available"}</span>;
  return (
    <span className="it-num" title={`${METRIC_HELP.sinceFirstBuy} ${day(t.priceDate || t.startDate)} → close of ${day(t.lastDate)}.`}>
      <span data-metric="sinceFirst" className="whitespace-nowrap text-[13.5px]" style={{ color: tone(t.changePct) ?? "var(--it-text)" }}>{pct(t.changePct)}</span>
      <span className="bt-sub">Since {day(t.priceDate || t.startDate)}</span>
    </span>
  );
}

function Th({ children, help, group, className = "", style }) {
  return <th scope="col" className={className} style={style} data-group-start={group}>{children}{help && <InfoTip label={children}>{help}</InfoTip>}</th>;
}
// Column groups for the horizontal jump bar (each starts at <th data-group-start>).
const COLUMN_GROUPS = [{ id: "overview", label: "Overview" }, { id: "prices", label: "Prices" }, { id: "insiders", label: "Insider Activity" }];

function ResultsTable({ signals, tracks = {}, rows = {}, market, ipo = {}, onTrack }) {
  const [shown, setShown] = useState(50);
  const list = signals.slice(0, shown);
  return (
    <>
      <div className="hidden md:block">
        <ScrollableTable groups={COLUMN_GROUPS} label="Signals table — scroll sideways for more columns">
        <table className="it-table bt-table min-w-[1380px]">
          <thead><tr>
            <Th className="bt-sticky" group="overview">Company</Th>
            <Th className="num bt-col-primary" help={METRIC_HELP.returnSinceSignal}>Return Since Signal</Th>
            <Th help={METRIC_HELP.signal}>Signal Published</Th>
            <Th className="num bt-sep" group="prices" help={METRIC_HELP.firstPrice}>First Price After Signal</Th>
            <Th className="num" help={METRIC_HELP.latestPrice}>Latest Stock Price</Th>
            <Th className="num" help={METRIC_HELP.regularMarketReturn}>Regular Market Return</Th>
            <Th className="num" help={METRIC_HELP.regularEntry}>Regular Market Entry Price</Th>
            <Th className="num bt-sep" group="insiders">Insider Buyers</Th>
            <Th className="num">Total Insider Purchases</Th>
            <Th className="num" help={METRIC_HELP.sinceFirstBuy}>Return Since First Insider Buy</Th>
          </tr></thead>
          <tbody>
            {list.map((s) => {
              const r = rows[s.id];
              const pub = publishedParts(s.publishedAt);
              return (
                <tr key={s.id} data-ticker={s.ticker || ""}>
                  <td className="bt-sticky w-[210px] min-w-[210px] max-w-[210px]">
                    {s.ticker ? <Link to={`/insider/company/${encodeURIComponent(s.ticker)}`} className="it-mono text-[14px] font-semibold hover:underline" style={{ color: "var(--it-text)" }}>{s.ticker}</Link> : <span className="it-mono text-[14px]">No ticker</span>}
                    <span className="bt-sub truncate" title={s.issuerName}>{s.issuerName}</span>
                    <button className="it-link mt-1 inline-block text-[12px]" onClick={() => onTrack(s.id)} aria-label={`View details for ${s.ticker || s.issuerName}`}>View details →</button>
                  </td>
                  <td className="num bt-col-primary">
                    <ReturnValue m={r?.primary} />
                    <span className="bt-sub">Since {pub.date}</span>
                  </td>
                  <td className="whitespace-nowrap" title={`SEC acceptance ${s.publishedAt} · insider trades ${s.windowFrom} – ${s.windowTo}`}>
                    <span className="text-[13px]" style={{ color: "var(--it-text)" }}>{pub.date}</span>
                    <span className="bt-sub">{pub.time}</span>
                  </td>
                  <td className="num bt-sep"><EntryPrice m={r?.primary} metric="entry" /></td>
                  <td className="num">{r?.status === "no_ticker" ? <span className="bt-status">No ticker</span> : <LatestPrice l={r?.latest} market={market} />}</td>
                  <td className="num"><ReturnValue m={r?.regular} size="sm" /></td>
                  <td className="num"><EntryPrice m={r?.regular} metric="regEntry" small /></td>
                  <td className="num it-num bt-sep" title={s.buyers.map((b) => `${b.name} (${b.roles.join(", ")})`).join("\n")}>
                    <span data-metric="buyers" className="whitespace-nowrap"><span style={{ color: "var(--it-text)" }}>{s.uniqueBuyers} buyer{s.uniqueBuyers === 1 ? "" : "s"}</span><span className="it-dim2"> · {s.purchases} purchase{s.purchases === 1 ? "" : "s"}</span></span>
                  </td>
                  <td className="num it-num">
                    <span style={{ color: "var(--it-text)" }}>{compactUsd(s.valueUsd)}</span>
                    <span className="bt-sub">{s.valuesExcluded ? `${s.valuesExcluded} without USD value` : `${day(s.windowFrom)}${s.windowTo !== s.windowFrom ? ` – ${day(s.windowTo)}` : ""}`}</span>
                    <IpoChip c={ipo[s.id]} />
                  </td>
                  <td className="num"><SinceFirst t={tracks[s.issuerCik]} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </ScrollableTable>
      </div>
      <ul className="md:hidden">
        {list.map((s) => {
          const r = rows[s.id];
          const pub = publishedParts(s.publishedAt);
          const pe = entryOf(r?.primary);
          const f = freshness(r?.latest, market);
          return (
            <li key={s.id} data-ticker={s.ticker || ""} className="px-4 py-4" style={{ borderBottom: "1px solid var(--it-line-soft)" }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {s.ticker ? <Link to={`/insider/company/${encodeURIComponent(s.ticker)}`} className="it-mono text-[15px] font-semibold" style={{ color: "var(--it-text)" }}>{s.ticker}</Link> : <span className="it-mono text-[15px]">No ticker</span>}
                  <span className="it-dim block text-[13px] leading-snug line-clamp-2 break-words">{s.issuerName}</span>
                  <span className="bt-sub">Signal published {pub.date}, {pub.time}</span>
                </div>
                <div className="shrink-0 text-right">
                  <span className="block text-[11px] it-dim2">Return Since Signal</span>
                  <ReturnValue m={r?.primary} />
                  <span className="bt-sub">Since {pub.short}</span>
                </div>
              </div>
              {r && r.status !== "no_ticker" && (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="bt-card-stat">
                    <span className="block text-[11px] it-dim2">First Price After Signal</span>
                    {pe ? <>
                      <span data-metric="entry" className="it-num text-[15px] font-medium" style={{ color: "var(--it-text)" }}>{usd(entryPrice(pe))}</span>
                      <span className="bt-sub">{etParts(pe.time, { year: false }).date}, {etParts(pe.time).time}</span>
                      <span className="bt-sub">{SESSION_LABEL[pe.session] || pe.session}</span>
                    </> : <Status status={r.primary?.status} />}
                  </div>
                  <div className="bt-card-stat">
                    <span className="block text-[11px] it-dim2">Latest Stock Price</span>
                    {f.level !== "unavailable" ? <>
                      <span data-metric="latest" className="it-num text-[15px] font-medium" style={{ color: "var(--it-text)" }}>{usd(r.latest.price)}</span>
                      <span className="bt-sub">{etParts(r.latest.time, { year: false }).date}, {etParts(r.latest.time).time}</span>
                      <span className="bt-sub" style={{ color: f.level === "old" ? "var(--it-warn)" : undefined }}><span className="bt-dot" style={{ background: FRESH_COLOR[f.level] }} aria-hidden="true" />{f.label}</span>
                    </> : <span className="bt-status">Price unavailable</span>}
                  </div>
                </div>
              )}
              <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[12px]">
                <span className="it-dim2">Regular Market Return <span className="ml-1"><ReturnValue m={r?.regular} size="sm" /></span></span>
                <span className="it-dim2">{buyersText(s.uniqueBuyers, s.purchases)} · <span className="it-num" style={{ color: "var(--it-text-2)" }}>{compactUsd(s.valueUsd)}</span> total</span>
                <IpoChip c={ipo[s.id]} />
              </div>
              <div className="mt-2 flex items-center justify-between gap-3">
                <button className="it-btn min-h-[40px]" onClick={() => onTrack(s.id)} aria-label={`View details for ${s.ticker || s.issuerName}`}>View details →</button>
                <span className="text-right text-[11.5px] it-dim2">Since first insider buy <SinceFirst t={tracks[s.issuerCik]} /></span>
              </div>
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

// Plain-English guide to the two returns, shown above the results.
function HowToRead() {
  return (
    <div className="it-panel px-4 py-3 text-[13px] leading-relaxed" style={{ color: "var(--it-text-2)" }}>
      <div className="mb-1.5 font-semibold" style={{ color: "var(--it-text)" }}>How to read these results</div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 md:grid-cols-3">
        <div><dt className="font-medium" style={{ color: "var(--it-text)" }}>Signal</dt><dd>{METRIC_HELP.signal}</dd></div>
        <div><dt className="font-medium" style={{ color: "var(--it-text)" }}>Return Since Signal</dt><dd>{METRIC_HELP.returnSinceSignal}</dd></div>
        <div><dt className="font-medium" style={{ color: "var(--it-text)" }}>Regular Market Return</dt><dd>{METRIC_HELP.regularMarketReturn}</dd></div>
      </dl>
      <p className="mt-2 text-[12px] it-dim2">{METRIC_HELP.disclaimer} The latest price is the last trade on the IEX exchange, not the full U.S. market; its age is shown next to it. Very recent signals show “Awaiting SIP data” for about 15 minutes.</p>
    </div>
  );
}

// What is incomplete, kept separate: SEC history coverage and signals without price data.
function DataStatus({ result, rows, pub }) {
  const d = dataStatus(result);
  const sum = publicationSummary(rows);
  const Chip = ({ ok, children, title }) => (
    <span className="it-chip" title={title} style={ok ? { color: "var(--it-buy)" } : { color: "var(--it-warn)", borderColor: "var(--it-warn-line)", background: "var(--it-warn-soft)" }}>{children}</span>
  );
  const missing = sum.total - sum.withData;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px]" aria-label="Data status">
      <span className="it-label mr-1">Data status</span>
      <Chip ok={d.secComplete} title="SEC Form 4 daily indexes held for the whole range (incl. warm-up)">{d.secComplete ? "SEC history complete" : `SEC history partial (${d.secCovered})`}</Chip>
      {rows && <Chip ok={missing === 0} title="Signals without a Return Since Signal yet (awaiting SIP data, no trade yet, or unavailable) — labelled, never estimated">{missing ? `${missing} signal${missing === 1 ? "" : "s"} without a result yet` : "Price data for all signals"}</Chip>}
      {pub?.providers && <Chip ok={!pub.providers.alpacaDisabled} title="Backtesting market data: Alpaca (primary — SIP trades for entries, IEX for the latest price), Tiingo fallback">{pub.providers.alpacaDisabled ? `Alpaca unavailable (${pub.providers.alpacaDisabled === "auth_failed" ? "credentials rejected" : "not configured"}) — Tiingo fallback` : "Alpaca market data"}</Chip>}
      <span className="it-dim2">All values in U.S. dollars.</span>
    </div>
  );
}

function Results({ result, jobId }) {
  const [trackId, setTrackId] = useState(null);
  const openTrack = (id) => { setTrackId(id); setTimeout(() => document.getElementById("bt-track")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); };
  const pub = usePublicationNow(jobId);
  const ipo = useIpoContext(jobId);
  const market = pub.data?.market?.session;
  const rows = pub.data?.rows;
  const sum = publicationSummary(rows);
  const reg = publicationSummary(rows, "regular");
  const cov = result.coverage;
  return (
    <div className="bt-results flex flex-col gap-5">
      {(pub.data?.restrictedNote || !cov.complete) && (
        <div role="status" className="rounded-xl px-4 py-3 text-[13px] leading-relaxed" style={{ color: "var(--it-text-2)", background: "var(--it-warn-soft)", border: "1px solid var(--it-warn-line)" }}>
          {pub.data?.restrictedNote ? <>{pub.data.restrictedNote} </> : null}
          {!cov.complete && <><strong className="font-semibold" style={{ color: "var(--it-warn)" }}>Partial data:</strong> SEC Form 4 filings are held for {count(cov.coveredDays)} of {count(cov.businessDays)} business days ({day(cov.from)} – {day(cov.to)}), so signals in missing periods are absent.</>}
        </div>
      )}
      <DataStatus result={result} rows={rows} pub={pub.data} />

      <div className="it-panel">
        <div className="it-panel-head"><h2 className="it-panel-title">Performance overview</h2><span className="text-[12.5px] it-dim2">Return Since Signal = first eligible trade after SEC publication → latest price</span></div>
        <div className="it-kpis grid grid-cols-2 sm:grid-cols-5">
          <Kpi label="Signals" value={count(result.signals.length)} sub={`${day(result.config.from)} – ${day(result.config.to)}`} />
          <Kpi label="Signals with prices" value={rows ? count(sum.withData) : "…"} sub={rows ? `${count(sum.total - sum.withData)} waiting or unavailable` : "loading"} />
          <Kpi label="Avg. return since signal" value={pct(sum.average, 2)} color={tone(sum.average)} sub={sum.median == null ? "" : `median ${pct(sum.median, 2)}`} />
          <Kpi label="Avg. regular market return" value={pct(reg.average, 2)} color={tone(reg.average)} sub={reg.withData ? `median ${pct(reg.median, 2)} · ${count(reg.withData)} signals` : ""} />
          <Kpi label="Signals up since signal" value={sum.positiveShare == null ? "—" : plainPct(sum.positiveShare)} sub={pub.updatedAt ? `prices checked ${etParts(new Date(pub.updatedAt).toISOString()).time}` : ""} />
        </div>
      </div>

      <HorizonPanel rows={rows || {}} />
      <HowToRead />

      {trackId && <div id="bt-track"><TrackPanel jobId={jobId} signalId={trackId} pubNow={rows?.[trackId]} signal={result.signals.find((x) => x.id === trackId)} checkedAt={pub.updatedAt} market={market} ipo={ipo.data?.signals?.[trackId]} onClose={() => setTrackId(null)} /></div>}

      <Panel title="Signals" subtitle={`${count(result.signals.length)} qualifying cluster${result.signals.length === 1 ? "" : "s"} · prices re-checked every minute`}>
        {pub.error && <div className="p-3"><ErrorNote>{pub.error}</ErrorNote></div>}
        {result.signals.length ? <ResultsTable signals={result.signals} tracks={result.tracks} rows={rows || {}} market={market} ipo={ipo.data?.signals || {}} onTrack={openTrack} /> : (
          <EmptyState title="No signals in this range.">{cov.complete ? "No cluster met the strategy in the held SEC data." : "Most of this range has not been backfilled from SEC yet."}</EmptyState>
        )}
      </Panel>
      <CoveragePanel result={result} rows={rows || {}} />
    </div>
  );
}

function Methodology({ m }) {
  if (!m) return null;
  return (
    <details className="it-panel">
      <summary className="cursor-pointer px-5 py-4 text-[14px] font-medium" style={{ color: "var(--it-text)" }}>Methodology — signal, entry, exit and overlap rules</summary>
      <dl className="grid grid-cols-1 gap-4 px-5 pb-5 text-[13px] leading-relaxed lg:grid-cols-2">
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
    <div className="flex flex-col gap-5">
      <PageHeader title="Backtesting"
        description="Did past clusters of insider purchases precede returns? Every signal is reconstructed from what was public at its SEC publication time."
        badge={<span className="it-badge it-badge-warn">Historical simulation — not live signals</span>} />
      <StrategyPanel f={f} set={set} reset={reset} prices={status.data?.prices} running={running} onRun={() => req.body && start(req.body)} clientError={req.error} hasResult={!!run.result} />
      <div className="flex min-w-0 flex-col gap-5">
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
          <DataPanel status={status} f={f} />
          <Methodology m={status.data?.methodology} />
      </div>
      <Disclaimer />
    </div>
  );
}
