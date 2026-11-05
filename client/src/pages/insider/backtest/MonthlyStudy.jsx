// Monthly per-buyer purchase study (Backtesting → "Monthly buyer study").
// Every number comes from the server (POST /insider/backtest/monthly-study and
// GET /insider/backtest/owners). Missing data is shown as N/A with its reason and counted —
// never as 0. Gross results are labelled gross; cost scenarios are separate.
import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api from "../../../lib/api";
import { EmptyState, ErrorNote, Panel } from "../components/Common";
import ScrollableTable from "./ScrollableTable";
import InfoTip from "./InfoTip";
import { compactUsd, count, day, price } from "../../../utils/insiderFormat";
import { pct, studyRequest, studyNaText, monthLabel, PURCHASE_TYPE_SHORT, VALUE_EXCLUDED_TEXT, DISCLOSURE_TEXT, STUDY_PRESETS, THRESHOLD_PRESETS } from "../../../utils/insiderBacktest";

const chipOn = { color: "var(--it-text)", borderColor: "var(--it-accent)", background: "var(--it-accent-soft)" };
const tone = (v) => (v == null || Math.abs(v) < 0.0005 ? undefined : v > 0 ? "var(--it-buy)" : "var(--it-sell)");
const Pct = ({ v, d = 2 }) => <span className="it-num" style={{ color: tone(v) }}>{v == null ? "N/A" : pct(v, d)}</span>;
const share = (v) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const TYPES = Object.keys(PURCHASE_TYPE_SHORT);
const cikOf = (s) => String(Number((s.legalOwners || [])[0]?.cik || 0) || "");

function Field({ label, children, help }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="it-label">{label}{help && <InfoTip label={label}>{help}</InfoTip>}</span>
      {children}
    </div>
  );
}

function StudyForm({ f, set, onRun, running, error }) {
  const [monthInput, setMonthInput] = useState("");
  const toggleType = (t) => set({ types: f.types.includes(t) ? f.types.filter((x) => x !== t) : [...f.types, t] });
  return (
    <Panel title="Monthly buyer study" subtitle="One signal when a buyer's purchases at one company, published in one calendar month, pass the threshold">
      <div className="grid grid-cols-1 gap-4 p-4 sm:p-5 lg:grid-cols-2">
        <Field label="Publication months" help="Months of SEC acceptance (New York time). Purchases traded earlier count when their filing was published in the month.">
          <div className="flex flex-wrap gap-1.5">
            {STUDY_PRESETS.map((p) => (
              <button type="button" key={p.label} className="it-chip" aria-pressed={f.months.join() === p.months.join()} style={f.months.join() === p.months.join() ? chipOn : undefined} onClick={() => set({ months: p.months })}>{p.label}</button>
            ))}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {f.months.map((m) => (
              <button type="button" key={m} className="it-chip it-chip-x" onClick={() => set({ months: f.months.filter((x) => x !== m) })} aria-label={`Remove ${monthLabel(m)}`}>{monthLabel(m)} ×</button>
            ))}
            <input type="month" className="it-input it-num" style={{ width: 150, height: 30 }} value={monthInput} onChange={(e) => setMonthInput(e.target.value)} aria-label="Add a month" />
            <button type="button" className="it-btn" style={{ height: 30 }} disabled={!monthInput} onClick={() => { set({ months: [...new Set([...f.months, monthInput])].sort() }); setMonthInput(""); }}>Add</button>
          </div>
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Threshold per buyer and company (USD, strictly above)">
            <div className="flex flex-wrap gap-1.5">
              {THRESHOLD_PRESETS.map((t) => <button type="button" key={t} className="it-chip" aria-pressed={Number(f.thresholdUsd) === t} style={Number(f.thresholdUsd) === t ? chipOn : undefined} onClick={() => set({ thresholdUsd: String(t) })}>{compactUsd(t)}</button>)}
            </div>
            <input className="it-input it-num mt-1.5 w-full" inputMode="decimal" value={f.thresholdUsd} onChange={(e) => set({ thresholdUsd: e.target.value.replace(/[^0-9.]/g, "").slice(0, 14) })} aria-label="Custom threshold" />
          </Field>
          <Field label="Latency after SEC acceptance" help="Time to read the filing and send an order. The entry is the first opening auction after acceptance + latency (09:28 ET market-on-open cut-off).">
            <div className="flex flex-wrap gap-1.5">
              {["0", "60", "300"].map((s) => <button type="button" key={s} className="it-chip" aria-pressed={f.latencySeconds === s} style={f.latencySeconds === s ? chipOn : undefined} onClick={() => set({ latencySeconds: s })}>{s === "0" ? "0 s" : s === "60" ? "60 s" : "5 min"}</button>)}
            </div>
          </Field>
        </div>
        <Field label="Purchase type filter (optional)" help="No purchase is excluded by default. A filter keeps signals that include at least one purchase of the chosen types.">
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className="it-chip" aria-pressed={!f.types.length} style={!f.types.length ? chipOn : undefined} onClick={() => set({ types: [] })}>All types</button>
            {TYPES.map((t) => <button type="button" key={t} className="it-chip" aria-pressed={f.types.includes(t)} style={f.types.includes(t) ? chipOn : undefined} onClick={() => toggleType(t)}>{PURCHASE_TYPE_SHORT[t]}</button>)}
          </div>
          <label className="mt-1.5 flex items-center gap-2 text-[13px] it-dim">
            <input type="checkbox" checked={f.newCapitalOnly} onChange={(e) => set({ newCapitalOnly: e.target.checked })} /> Only signals mostly made of new money (excludes trust/asset exchanges and transfers)
          </label>
        </Field>
        <div className="flex flex-col justify-end gap-2">
          {error && <ErrorNote>{error}</ErrorNote>}
          <button type="button" className="it-btn it-btn-primary w-full sm:w-auto sm:self-end" onClick={onRun} disabled={running}>{running ? "Running study…" : "Run study"}</button>
          <span className="text-[12px] it-dim2 sm:self-end">A first run over many months fetches prices and can take a few minutes; later runs are cached.</span>
        </div>
      </div>
    </Panel>
  );
}

function Kpi({ label, value, sub, color }) {
  return (
    <div className="it-kpi">
      <div className="it-label">{label}</div>
      <div className="it-num mt-1 text-[18px] font-semibold" style={{ color: color || "var(--it-text)" }}>{value}</div>
      {sub && <div className="text-[11px] it-dim2">{sub}</div>}
    </div>
  );
}

function Census({ r, g }) {
  const na = Object.entries(g.counts.naReasons || {});
  const notCounted = Object.entries(r.stats?.notCounted || {});
  return (
    <Panel title="Census" subtitle={`${r.config.months.map(monthLabel).join(", ")} · prices to ${day(r.config.cutoff)} · threshold ${compactUsd(r.config.thresholdUsd)}`}>
      <div className="it-kpis grid grid-cols-2 md:grid-cols-5">
        <Kpi label="Purchases examined" value={count(r.stats?.purchases)} sub="code P, first published in the months" />
        <Kpi label="Signals" value={count(r.counts.inFilter)} sub={r.counts.inFilter !== r.counts.signals ? `of ${count(r.counts.signals)} before the type filter` : "every buyer type"} />
        <Kpi label="Priced" value={count(g.counts.eligible)} sub={g.view === "consolidated" ? `${count(g.counts.mergedDuplicates || 0)} same-stock duplicates merged` : "equal weight per signal"} />
        <Kpi label="N/A" value={count(g.counts.na)} sub="no return computed — reasons below" color={g.counts.na ? "var(--it-warn)" : undefined} />
        <Kpi label="Window incomplete" value={count(g.counts.incompleteByHorizon?.[5] ?? 0)} sub="5-day window not closed by the cutoff" />
      </div>
      <div className="grid grid-cols-1 gap-3 px-5 py-4 text-[12.5px] md:grid-cols-3">
        <div>
          <div className="it-label">SEC coverage</div>
          {r.coverage.map((c) => <div key={c.month} className="it-dim">{monthLabel(c.month)}: {c.complete}/{c.businessDays} days complete{c.partial ? `, ${c.partial} partial` : ""}{c.missing ? `, ${c.missing} missing` : ""}</div>)}
        </div>
        <div>
          <div className="it-label">Why no return (N/A)</div>
          {na.length ? na.map(([k, v]) => <div key={k} className="it-dim">{count(v)} · {studyNaText(k)}</div>) : <div className="it-dim2">None</div>}
        </div>
        <div>
          <div className="it-label">Purchases not counted toward the threshold</div>
          {notCounted.length ? notCounted.map(([k, v]) => <div key={k} className="it-dim">{count(v)} · {VALUE_EXCLUDED_TEXT[k] || k}</div>) : <div className="it-dim2">None</div>}
        </div>
      </div>
    </Panel>
  );
}

function FixedExits({ g }) {
  return (
    <Panel title="Fixed exits — close of day 1…5" subtitle={`Same ${count(g.fixedSample5[1]?.n || 0)} signals for every day (5-day window complete) · entry day = day 1 · gross`}>
      <div className="overflow-x-auto">
        <table className="it-table min-w-[640px]">
          <thead><tr><th>Exit</th><th className="text-right">n</th><th className="text-right">Mean</th><th className="text-right">Median</th><th className="text-right">Positive</th><th className="text-right">SPY same days</th><th className="text-right">Excess</th><th className="text-right">Mean after 25 bp/side</th></tr></thead>
          <tbody>
            {[1, 2, 3, 4, 5].map((k) => { const s = g.fixedSample5[k] || {}; return (
              <tr key={k}><td>Close of day {k}</td><td className="text-right it-num">{count(s.n)}</td><td className="text-right"><Pct v={s.mean} /></td><td className="text-right"><Pct v={s.median} /></td><td className="text-right it-num">{share(s.pctPositive)}</td><td className="text-right"><Pct v={s.spyMean} /></td><td className="text-right"><Pct v={s.excessMean} /></td><td className="text-right"><Pct v={s.netMean?.[25]} /></td></tr>
            ); })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function TargetGrid({ g, grid }) {
  const [H, setH] = useState(5);
  const h = g.horizons[H];
  const focus = new Set(grid.focusTargets.map((t) => t.toFixed(3)));
  const rows = h.tp.filter((t) => focus.has(t.target.toFixed(3)));
  const all = [1, 2, 3, 4, 5].flatMap((k) => g.horizons[k].tp.map((t) => t.mean)).filter((x) => x != null);
  const span = Math.max(0.005, ...all.map((x) => Math.abs(x)));
  const cell = (v) => (v == null ? "var(--it-surface)" : `color-mix(in srgb, ${v >= 0 ? "var(--it-buy)" : "var(--it-sell)"} ${Math.round((Math.abs(v) / span) * 70) + 6}%, transparent)`);
  return (
    <Panel title="Take profit or close of the last day — no stop" subtitle={`${grid.targets.length * grid.horizons.length} combinations, all kept · a target is a theoretical touch on daily bars · gross`}
      right={<div className="flex gap-1">{[1, 2, 3, 4, 5].map((k) => <button type="button" key={k} className="it-chip" aria-pressed={H === k} style={H === k ? chipOn : undefined} onClick={() => setH(k)}>{k} d</button>)}</div>}>
      <div className="overflow-x-auto">
        <table className="it-table min-w-[820px]">
          <thead><tr><th>Target</th><th className="text-right">n</th><th className="text-right">Mean</th><th className="text-right">Median</th><th className="text-right">Reached</th><th className="text-right">Positive</th><th className="text-right">Avg win / loss</th><th className="text-right">Without top 3</th><th className="text-right">95% CI (by company)</th><th className="text-right">0.5% buffer</th></tr></thead>
          <tbody>
            <tr><td>None (close of day {H})</td><td className="text-right it-num">{count(h.close.n)}</td><td className="text-right"><Pct v={h.close.mean} /></td><td className="text-right"><Pct v={h.close.median} /></td><td className="text-right">—</td><td className="text-right it-num">{share(h.close.pctPositive)}</td><td className="text-right it-num"><Pct v={h.close.avgWin} /> / <Pct v={h.close.avgLoss} /></td><td className="text-right"><Pct v={h.close.meanExTop3} /></td><td className="text-right it-num">{h.close.ci95 ? `${pct(h.close.ci95[0])} … ${pct(h.close.ci95[1])}` : "—"}</td><td className="text-right">—</td></tr>
            {rows.map((t) => (
              <tr key={t.target}><td>{(t.target * 100).toFixed(1)}%</td><td className="text-right it-num">{count(t.n)}</td><td className="text-right"><Pct v={t.mean} /></td><td className="text-right"><Pct v={t.median} /></td><td className="text-right it-num">{t.hits ?? "—"}/{t.n || 0}</td><td className="text-right it-num">{share(t.pctPositive)}</td><td className="text-right it-num"><Pct v={t.avgWin} /> / <Pct v={t.avgLoss} /></td><td className="text-right"><Pct v={t.meanExTop3} /></td><td className="text-right it-num">{t.ci95 ? `${pct(t.ci95[0])} … ${pct(t.ci95[1])}` : "—"}</td><td className="text-right"><Pct v={t.buffered?.mean} /></td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-5 pb-4 pt-3">
        <div className="it-label mb-1.5">Mean return, every target × holding period (hover for details)</div>
        <div className="overflow-x-auto">
          <div className="grid min-w-[620px] gap-[2px]" style={{ gridTemplateColumns: `44px repeat(${grid.targets.length}, minmax(12px, 1fr))` }} role="img" aria-label="Heatmap of mean return by target and holding period">
            {[1, 2, 3, 4, 5].map((k) => [
              <div key={`l${k}`} className="text-[11px] it-dim2">{k} d</div>,
              ...g.horizons[k].tp.map((t) => <div key={`${k}-${t.target}`} title={`${(t.target * 100).toFixed(1)}% · ${k} d · mean ${t.mean == null ? "N/A" : pct(t.mean)} · reached ${t.hits ?? 0}/${t.n || 0} · n ${t.n || 0}`} style={{ height: 18, borderRadius: 2, background: cell(t.mean) }} />),
            ])}
          </div>
          <div className="mt-1 flex min-w-[620px] justify-between pl-[46px] text-[11px] it-dim2"><span>1%</span><span>5%</span><span>10%</span><span>15%</span><span>20%</span></div>
        </div>
        {g.winner && <p className="mt-2 text-[12.5px] it-dim">Best of the {count(g.combinations)} combinations <strong>in hindsight</strong>: {(g.winner.target * 100).toFixed(1)}% / {g.winner.horizon} d, mean {pct(g.winner.mean)} (n {g.winner.n}). Picking the best of many combinations after the fact overstates what to expect next time.</p>}
      </div>
    </Panel>
  );
}

function Hindsight({ g, sel }) {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Panel title="Other measures — kept apart from the strategy" subtitle="Not executable results">
        <dl className="grid grid-cols-1 gap-3 px-5 py-4 text-[13px]">
          <div><dt className="it-label">Insider price → entry open (insider mark-to-market, not realised)</dt><dd><Pct v={g.insiderToEntry.mean} /> mean · n {count(g.insiderToEntry.n)}</dd></div>
          <div><dt className="it-label">Best high within 5 days (hindsight)</dt><dd><Pct v={g.hindsight.mfe5.mean} /> mean · peak after {g.hindsight.meanDaysToPeak5 == null ? "—" : g.hindsight.meanDaysToPeak5.toFixed(1)} sessions (entry day = 0)</dd></div>
          <div><dt className="it-label">Best high up to the cutoff (windows of different lengths)</dt><dd><Pct v={g.hindsight.mfeToCutoff.mean} /> mean · n {count(g.hindsight.mfeToCutoff.n)}</dd></div>
        </dl>
      </Panel>
      <Panel title="Following buyers whose earlier signals worked" subtitle={`Point in time · rule TP ${(sel.rule.target * 100).toFixed(1)}% / ${sel.rule.horizon} d · an earlier signal counts only after its 5-day window ended`}>
        <div className="overflow-x-auto">
          <table className="it-table">
            <thead><tr><th>Group at entry</th><th className="text-right">n</th><th className="text-right">Mean</th><th className="text-right">95% CI</th><th className="text-right">Reached</th></tr></thead>
            <tbody>
              {[["selected", "Earlier signals averaged > 0"], ["notSelected", "Earlier signals averaged ≤ 0"], ["noHistory", "No matured earlier signal"]].map(([k, l]) => (
                <tr key={k}><td>{l}</td><td className="text-right it-num">{count(sel[k].n || 0)}</td><td className="text-right"><Pct v={sel[k].mean} /></td><td className="text-right it-num">{sel[k].ci95 ? `${pct(sel[k].ci95[0])} … ${pct(sel[k].ci95[1])}` : "—"}</td><td className="text-right it-num">{share(sel[k].hitRate)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function PerMonth({ perMonth }) {
  const months = Object.keys(perMonth || {});
  if (months.length < 2) return null;
  const t = (g, target) => g.horizons[5].tp.find((x) => Math.abs(x.target - target) < 1e-9);
  return (
    <Panel title="By month" subtitle="Same rules every month — nothing re-selected">
      <div className="overflow-x-auto">
        <table className="it-table min-w-[640px]">
          <thead><tr><th>Month</th><th className="text-right">Signals</th><th className="text-right">Priced (5 d)</th><th className="text-right">Close day 5</th><th className="text-right">TP 4% / 5 d</th><th className="text-right">TP 6.5% / 5 d</th><th className="text-right">Excess vs SPY (day 5)</th></tr></thead>
          <tbody>
            {months.map((m) => { const g = perMonth[m]; return (
              <tr key={m}><td>{monthLabel(m)}</td><td className="text-right it-num">{count(g.counts.signals)}</td><td className="text-right it-num">{count(g.horizons[5].n)}</td><td className="text-right"><Pct v={g.horizons[5].close.mean} /></td><td className="text-right"><Pct v={t(g, 0.04)?.mean} /></td><td className="text-right"><Pct v={t(g, 0.065)?.mean} /></td><td className="text-right"><Pct v={g.horizons[5].close.excessMean} /></td></tr>
            ); })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

const GROUPS = [{ id: "signal", label: "Signal" }, { id: "entry", label: "Entry" }, { id: "returns", label: "Returns" }, { id: "context", label: "Context" }];
function Purchases({ s }) {
  return (
    <div className="flex flex-col gap-2 px-3 py-3 text-[12.5px]">
      {s.purchases.map((p) => (
        <div key={p.rowId} className="rounded-lg px-3 py-2" style={{ background: "var(--it-surface)", border: "1px solid var(--it-line-soft)" }}>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span>Trade <strong className="it-num">{day(p.transactionDate)}</strong></span>
            <span>Published <strong className="it-num">{p.publishedAt.slice(0, 16)} ET</strong></span>
            <span className="it-num">{count(p.shares)} × {p.price == null ? "n/a" : p.price}{p.currency && p.currency !== "USD" ? ` ${p.currency}` : ""}</span>
            <span>{p.valueUsd == null ? <span style={{ color: "var(--it-warn)" }}>not counted: {VALUE_EXCLUDED_TEXT[p.valueExcludedReason] || p.valueExcludedReason}</span> : <span className="it-num">{compactUsd(p.valueUsd)}</span>}</span>
            <span>{PURCHASE_TYPE_SHORT[p.purchaseType]}{p.isNewCapital ? "" : " · not necessarily new money"}</span>
            <span>{p.ownership === "I" ? `Indirect${p.natureOfOwnership ? ` (${p.natureOfOwnership})` : ""}` : "Direct"}</span>
            {p.fx && <span>FX {p.fx.from}→USD {p.fx.rate} ({p.fx.rateDate}, ECB)</span>}
            {p.possibleDuplicate && <span style={{ color: "var(--it-warn)" }}>Possible duplicate of another filer&apos;s report</span>}
            {p.url && <a className="it-link" href={p.url} target="_blank" rel="noreferrer">SEC filing {p.accessionNo}</a>}
          </div>
          {p.purchaseEvidence && <div className="mt-1 it-dim2">“{p.purchaseEvidence.slice(0, 220)}”</div>}
        </div>
      ))}
      {s.priorDisclosure?.filings?.length > 0 && (
        <div className="it-dim">Possible earlier disclosure (content not read): {s.priorDisclosure.filings.slice(0, 6).map((x) => <a key={x.accessionNo} className="it-link mr-2" href={x.url} target="_blank" rel="noreferrer">{x.form} {x.acceptedAt.slice(0, 16)}</a>)}</div>
      )}
    </div>
  );
}

function Signals({ signals }) {
  const [open, setOpen] = useState(null);
  const [shown, setShown] = useState(60);
  const list = signals.slice(0, shown);
  return (
    <Panel title="Signals" subtitle={`${count(signals.length)} · trade date and publication time are separate · click a row for the purchases`}>
      <ScrollableTable groups={GROUPS} label="Monthly study signals — scroll sideways for more columns">
        <table className="it-table bt-table min-w-[1500px]">
          <thead><tr>
            <th className="bt-sticky" data-group-start="signal">Stock</th><th>Buyer</th><th>Type</th><th className="text-right">Known at signal</th><th>Published (ET)</th>
            <th data-group-start="entry">Entry</th><th className="text-right">Open</th>
            <th className="text-right" data-group-start="returns">Day 1</th><th className="text-right">Day 2</th><th className="text-right">Day 3</th><th className="text-right">Day 5</th><th className="text-right">TP 4% / 5 d</th><th className="text-right">TP 6.5% / 5 d</th><th className="text-right">Best high 5 d</th>
            <th data-group-start="context">Insider price</th><th>Earlier disclosure</th>
          </tr></thead>
          <tbody>
            {list.map((s) => { const e = s.evaluation || {}; const isOpen = open === s.id; return [
              <tr key={s.id} onClick={() => setOpen(isOpen ? null : s.id)} style={{ cursor: "pointer" }} aria-expanded={isOpen}>
                <td className="bt-sticky">{s.ticker ? <Link className="it-link" to={`/insider/company/${encodeURIComponent(s.ticker)}`} onClick={(ev) => ev.stopPropagation()}>{s.ticker}</Link> : <span className="it-dim2">—</span>}<div className="text-[11px] it-dim2 truncate" style={{ maxWidth: 140 }}>{s.issuerName}</div></td>
                <td>{cikOf(s) ? <Link className="it-link" to={`/insider/owner/${cikOf(s)}`} onClick={(ev) => ev.stopPropagation()}>{s.buyerName}</Link> : s.buyerName}{s.legalOwners?.length > 1 && <div className="text-[11px] it-dim2">+{s.legalOwners.length - 1} joint filer{s.legalOwners.length > 2 ? "s" : ""}</div>}<div className="text-[11px] it-dim2">{(s.roles || []).join(", ")}</div></td>
                <td className="text-[12px]">{s.purchaseTypes.map((t) => PURCHASE_TYPE_SHORT[t]).join(", ")}{s.tradedBeforeMonth && <div className="text-[11px] it-dim2">traded from {day(s.tradeDateFrom)}</div>}</td>
                <td className="text-right it-num">{compactUsd(s.valueUsdAtSignal)}</td>
                <td className="it-num text-[12.5px]">{s.publishedAt.slice(0, 16)}</td>
                <td className="it-num text-[12.5px]">{e.entryDate ? day(e.entryDate) : "—"}</td>
                <td className="text-right it-num">{e.entryPrice == null ? "—" : price(e.entryPrice)}</td>
                {e.status === "ok" || e.status === "pending" ? <>
                  {[1, 2, 3, 5].map((k) => <td key={k} className="text-right">{e.closes?.[k] == null ? <span className="bt-status">window open</span> : <Pct v={e.closes[k]} />}</td>)}
                  <td className="text-right">{e.focus?.["0.04"] ? <Pct v={e.focus["0.04"].ret} /> : <span className="bt-status">—</span>}</td>
                  <td className="text-right">{e.focus?.["0.065"] ? <Pct v={e.focus["0.065"].ret} /> : <span className="bt-status">—</span>}</td>
                  <td className="text-right">{e.excursion5?.days >= 5 ? <Pct v={e.excursion5.mfe} /> : <span className="bt-status">—</span>}</td>
                </> : <td colSpan={7}><span className="bt-status is-waiting" title={studyNaText(e.naReason)}>N/A · {studyNaText(e.naReason)}</span></td>}
                <td className="it-num text-[12.5px]">{s.insiderAvgPriceUsd == null ? "—" : price(s.insiderAvgPriceUsd)}{e.insider?.toEntryOpen != null && <div className="text-[11px] it-dim2">to entry <Pct v={e.insider.toEntryOpen} d={1} /></div>}</td>
                <td className="text-[12px]">{DISCLOSURE_TEXT[s.priorDisclosure?.status] || "Not checked"}{s.priorDisclosure?.firstAt && <div className="text-[11px] it-dim2">{s.priorDisclosure.firstAt.slice(0, 16)}</div>}</td>
              </tr>,
              isOpen && <tr key={`${s.id}-d`}><td colSpan={16} style={{ padding: 0 }}><Purchases s={s} /></td></tr>,
            ]; })}
          </tbody>
        </table>
      </ScrollableTable>
      {shown < signals.length && <div className="flex justify-center p-3"><button type="button" className="it-btn" onClick={() => setShown((n) => n + 100)}>Show more ({count(signals.length - shown)} left)</button></div>}
    </Panel>
  );
}

function Buyers() {
  const [q, setQ] = useState({ q: "", ticker: "", minUsd: "" });
  const [state, setState] = useState({ data: null, loading: false, error: null });
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try { const { data } = await api.get("/insider/backtest/owners", { params: Object.fromEntries(Object.entries(q).filter(([, v]) => v)) }); setState({ data, loading: false, error: null }); }
    catch (err) { setState({ data: null, loading: false, error: err.response?.data?.error || "Could not load the buyer list." }); }
  }, [q]);
  const rows = state.data?.owners || [];
  return (
    <Panel title="Buyers — track record of following their monthly signals" subtitle="All held months · not the buyer's own profit · ranking needs a minimum sample"
      right={<button type="button" className="it-btn it-btn-primary" onClick={load} disabled={state.loading}>{state.loading ? "Loading…" : state.data ? "Refresh" : "Load buyers"}</button>}>
      <div className="grid grid-cols-1 gap-3 px-5 pt-4 sm:grid-cols-3">
        <input className="it-input" placeholder="Name or CIK" value={q.q} onChange={(e) => setQ({ ...q, q: e.target.value })} aria-label="Buyer name or CIK" />
        <input className="it-input" placeholder="Ticker" value={q.ticker} onChange={(e) => setQ({ ...q, ticker: e.target.value.toUpperCase() })} aria-label="Ticker" />
        <input className="it-input it-num" inputMode="decimal" placeholder="Minimum USD at signal" value={q.minUsd} onChange={(e) => setQ({ ...q, minUsd: e.target.value.replace(/[^0-9.]/g, "") })} aria-label="Minimum USD at signal" />
      </div>
      {state.error && <div className="px-5 pt-3"><ErrorNote>{state.error}</ErrorNote></div>}
      {state.data ? (
        <div className="overflow-x-auto pt-3">
          <table className="it-table min-w-[900px]">
            <thead><tr><th>Buyer (economic group)</th><th className="text-right">Signals</th><th className="text-right">Matured</th><th className="text-right">Companies</th><th>Period</th><th className="text-right">{state.data.rule?.label}</th><th className="text-right">95% CI</th><th className="text-right">Reached 4% / 6.5%</th><th>Ranking</th></tr></thead>
            <tbody>
              {rows.slice(0, 200).map((o) => (
                <tr key={o.group}>
                  <td>{o.primaryCik ? <Link className="it-link" to={`/insider/owner/${Number(o.primaryCik)}`}>{o.name}</Link> : o.name}{o.owners.length > 1 && <div className="text-[11px] it-dim2">{o.owners.length} legal filers · {o.tickers.slice(0, 4).join(", ")}</div>}</td>
                  <td className="text-right it-num">{count(o.signals)}</td><td className="text-right it-num">{count(o.matured)}</td><td className="text-right it-num">{count(o.issuers)}</td>
                  <td className="it-num text-[12px]">{o.from?.slice(0, 10)} – {o.to?.slice(0, 10)}</td>
                  <td className="text-right"><Pct v={o.strategy?.mean} /></td>
                  <td className="text-right it-num text-[12px]">{o.strategy?.ci95 ? `${pct(o.strategy.ci95[0])} … ${pct(o.strategy.ci95[1])}` : "—"}</td>
                  <td className="text-right it-num">{share(o.tp4?.hitRate)} / {share(o.tp65?.hitRate)}</td>
                  <td className="text-[12px]">{o.rankEligible ? "Sample sufficient" : <span className="it-dim2">Insufficient sample</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 200 && <div className="p-3 text-center text-[12px] it-dim2">Showing 200 of {count(rows.length)} — narrow the filters.</div>}
        </div>
      ) : !state.loading && <EmptyState title="Load the buyer list">Computed from every held month with the default rule. The first load can take a few minutes.</EmptyState>}
    </Panel>
  );
}

export default function MonthlyStudy() {
  const [f, setF] = useState({ months: ["2026-10"], thresholdUsd: "1000000", latencySeconds: "60", types: [], newCapitalOnly: false });
  const set = useCallback((p) => setF((x) => ({ ...x, ...p })), []);
  const [view, setView] = useState("signal");
  const [tab, setTab] = useState("study");
  const [state, setState] = useState({ data: null, loading: false, error: null });
  const req = useMemo(() => studyRequest(f), [f]);
  const run = useCallback(async () => {
    if (!req.body) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    try { const { data } = await api.post("/insider/backtest/monthly-study", req.body, { timeout: 0 }); setState({ data, loading: false, error: null }); }
    catch (err) { setState((s) => ({ ...s, loading: false, error: err.response?.data?.error || "The study could not be computed." })); }
  }, [req.body]);
  const r = state.data;
  const g = r?.summary?.[view];
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Monthly study views">
        {[["study", "Study"], ["buyers", "Buyers"]].map(([k, l]) => <button type="button" role="tab" key={k} className="it-chip" aria-selected={tab === k} aria-pressed={tab === k} style={tab === k ? chipOn : undefined} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === "buyers" ? <Buyers /> : <>
        <StudyForm f={f} set={set} onRun={run} running={state.loading} error={req.error || state.error} />
        {state.loading && <div className="it-panel px-4 py-3 text-[12.5px] it-dim" role="status" aria-live="polite">Computing signals, prices and exits on the server…</div>}
        {r?.status === "price_data_restricted" && <ErrorNote>{r.restrictedNote}</ErrorNote>}
        {r && g ? <>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="it-label mr-1">Weighting</span>
            {[["signal", "Equal weight per signal"], ["consolidated", "One per stock and entry day"]].map(([k, l]) => <button type="button" key={k} className="it-chip" aria-pressed={view === k} style={view === k ? chipOn : undefined} onClick={() => setView(k)}>{l}</button>)}
          </div>
          <Census r={r} g={g} />
          <FixedExits g={g} />
          <TargetGrid g={g} grid={r.grid} />
          <Hindsight g={g} sel={r.selection} />
          <PerMonth perMonth={r.perMonth} />
          <Signals signals={r.signals} />
          <details className="it-panel">
            <summary className="cursor-pointer px-5 py-4 text-[14px] font-medium" style={{ color: "var(--it-text)" }}>Methodology — signal, value, entry, exits, samples</summary>
            <dl className="grid grid-cols-1 gap-4 px-5 pb-5 text-[13px] leading-relaxed lg:grid-cols-2">
              {Object.entries(r.methodology).map(([k, v]) => <div key={k}><dt className="it-label">{k}</dt><dd className="mt-0.5 it-dim">{v}</dd></div>)}
            </dl>
          </details>
          <p className="text-[12.5px] it-dim2">An average return per signal is not a monthly portfolio return: a real portfolio needs position sizing, overlapping positions and cash. No taxes. Gross unless marked.</p>
        </> : !state.loading && !r && <div className="it-panel"><EmptyState title="Choose months and run the study.">Signals, prices and every exit rule are computed on the server from stored SEC filings.</EmptyState></div>}
      </>}
    </div>
  );
}
