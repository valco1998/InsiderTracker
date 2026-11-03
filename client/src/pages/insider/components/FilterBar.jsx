// Filters → the same API params as before (type, ticker, from/to filing date,
// venue=open_market). Desktop: one toolbar row (type, ticker search, filing-date
// presets + range, open-market switch). Mobile: type + search inline, the rest in a
// bottom sheet. Presets only fill the existing from/to filing-date filters.
import { useEffect, useState } from "react";
import { useInsider } from "../InsiderContext";
import { day } from "../../../utils/insiderFormat";

const TYPE_TABS = [
  { key: "all", label: "All" },
  { key: "purchase", label: "Purchases" },
  { key: "sale", label: "Sales" },
];

const cleanTicker = (v) => v.toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 10);

// Today's date on the SEC calendar (US Eastern), as YYYY-MM-DD.
const todayET = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const minusDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
const PRESETS = [
  { key: "7", label: "7D", days: 7, title: "Filed in the last 7 days" },
  { key: "30", label: "30D", days: 30, title: "Filed in the last 30 days" },
  { key: "90", label: "90D", days: 90, title: "Filed in the last 90 days" },
  { key: "all", label: "All", days: null, title: "All loaded filings" },
];
function activePreset(filters) {
  if (filters.to) return null;
  if (!filters.from) return "all";
  const today = todayET();
  return PRESETS.find((p) => p.days && minusDays(today, p.days) === filters.from)?.key ?? null;
}

function Presets({ filters, setFilter, fill = false }) {
  const active = activePreset(filters);
  return (
    <div className={`it-seg ${fill ? "it-seg-fill" : ""}`} role="group" aria-label="Filing date range">
      {PRESETS.map((p) => (
        <button key={p.key} aria-pressed={active === p.key} title={p.title}
          onClick={() => setFilter({ from: p.days ? minusDays(todayET(), p.days) : "", to: "" })}>{p.label}</button>
      ))}
    </div>
  );
}

function DateRange({ filters, setFilter }) {
  return (
    <div className="it-daterange" role="group" aria-label="Custom filing-date range">
      <span className="it-daterange-label">Filed</span>
      <input type="date" aria-label="Filed from" value={filters.from} max={filters.to || undefined} onChange={(e) => setFilter({ from: e.target.value })} />
      <span className="it-daterange-sep" aria-hidden="true">–</span>
      <input type="date" aria-label="Filed to" value={filters.to} min={filters.from || undefined} onChange={(e) => setFilter({ to: e.target.value })} />
    </div>
  );
}

function DateFields({ filters, setFilter }) {
  return (
    <>
      <label className="flex min-w-0 flex-col gap-1">
        <span className="it-label">Filed from</span>
        <input type="date" className="it-input w-full" value={filters.from} max={filters.to || undefined} onChange={(e) => setFilter({ from: e.target.value })} />
      </label>
      <label className="flex min-w-0 flex-col gap-1">
        <span className="it-label">Filed to</span>
        <input type="date" className="it-input w-full" value={filters.to} min={filters.from || undefined} onChange={(e) => setFilter({ to: e.target.value })} />
      </label>
    </>
  );
}

function OpenMarket({ filters, setFilter }) {
  const on = !!filters.openMarketOnly;
  return (
    <label className="it-toggle" data-on={on} title="Purchases whose filing footnotes describe open-market execution (sales are hidden)">
      <input type="checkbox" checked={on} onChange={(e) => setFilter({ openMarketOnly: e.target.checked })} />
      <span className="it-switch" aria-hidden="true" />
      Open-market purchases only
    </label>
  );
}

function TickerSearch({ tickerInput, setTickerInput, className = "" }) {
  return (
    <div className={`it-field ${className}`}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      <input value={tickerInput} onChange={(e) => setTickerInput(cleanTicker(e.target.value))} placeholder="Filter by ticker"
        className="it-input it-mono w-full" inputMode="text" autoCapitalize="characters" spellCheck={false} aria-label="Filter by ticker" />
      {tickerInput && (
        <button className="it-field-clear" onClick={() => setTickerInput("")} aria-label="Clear ticker filter">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      )}
    </div>
  );
}

export function TypeTabs({ value, onChange, className = "" }) {
  return (
    <div className={`it-seg ${className}`} role="tablist" aria-label="Transaction type">
      {TYPE_TABS.map((t) => (
        <button key={t.key} role="tab" aria-selected={value === t.key} onClick={() => onChange(t.key)}>{t.label}</button>
      ))}
    </div>
  );
}

export default function FilterBar({ showType = true }) {
  const { filters, setFilter, clearFilters, tickerInput, setTickerInput } = useInsider();
  const [sheet, setSheet] = useState(false);
  const active = [
    filters.ticker && { k: "ticker", text: filters.ticker },
    filters.from && { k: "from", text: `from ${day(filters.from)}` },
    filters.to && { k: "to", text: `to ${day(filters.to)}` },
    filters.openMarketOnly && { k: "openMarketOnly", text: "open market" },
  ].filter(Boolean);
  const dirty = active.length > 0 || filters.type !== "all";
  const sheetCount = (filters.from ? 1 : 0) + (filters.to ? 1 : 0) + (filters.openMarketOnly ? 1 : 0);

  useEffect(() => {
    if (!sheet) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setSheet(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet]);

  return (
    <div className="it-panel">
      {/* desktop / tablet — wrapper carries the responsive display (.it-toolbar sets its own) */}
      <div className="hidden sm:block"><div className="it-toolbar">
        {showType && <TypeTabs value={filters.type} onChange={(type) => setFilter({ type })} />}
        <TickerSearch tickerInput={tickerInput} setTickerInput={setTickerInput} className="w-48" />
        <span className="mx-0.5 hidden h-6 w-px lg:block" style={{ background: "var(--it-line)" }} aria-hidden="true" />
        <Presets filters={filters} setFilter={setFilter} />
        <DateRange filters={filters} setFilter={setFilter} />
        <OpenMarket filters={filters} setFilter={setFilter} />
        {dirty && <button onClick={clearFilters} className="it-btn it-btn-ghost ml-auto">Reset filters</button>}
      </div></div>

      {/* phone */}
      <div className="flex flex-col gap-2.5 p-3 sm:hidden">
        {showType && <TypeTabs value={filters.type} onChange={(type) => setFilter({ type })} className="it-seg-fill" />}
        <div className="flex items-center gap-2">
          <TickerSearch tickerInput={tickerInput} setTickerInput={setTickerInput} className="min-w-0 flex-1" />
          <button className="it-btn shrink-0" onClick={() => setSheet(true)} aria-haspopup="dialog">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
            Filters{sheetCount ? ` · ${sheetCount}` : ""}
          </button>
        </div>
      </div>

      {dirty && (
        <div className={`${active.length ? "flex" : "flex sm:hidden"} flex-wrap items-center gap-1.5 px-3 pb-3 sm:px-3.5`} style={{ marginTop: -2 }}>
          {active.map((a) => (
            <button key={a.k} className="it-chip it-chip-x" onClick={() => setFilter({ [a.k]: a.k === "openMarketOnly" ? false : "" })} aria-label={`Remove filter ${a.text}`}>
              {a.text}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          ))}
          {dirty && <button onClick={clearFilters} className="it-link ml-1 text-[12.5px] sm:hidden">Reset all</button>}
        </div>
      )}

      {sheet && (
        <>
          <div className="it-backdrop sm:hidden" onClick={() => setSheet(false)} />
          <div className="it-sheet flex flex-col gap-4 p-4 pb-6 sm:hidden" role="dialog" aria-modal="true" aria-label="Filters">
            <div className="flex items-center justify-between">
              <span className="it-panel-title">Filters</span>
              <button className="it-btn it-btn-primary" onClick={() => setSheet(false)}>Done</button>
            </div>
            <div className="flex flex-col gap-2">
              <span className="it-label">Filing date</span>
              <Presets filters={filters} setFilter={setFilter} fill />
            </div>
            <div className="grid grid-cols-2 gap-3"><DateFields filters={filters} setFilter={setFilter} /></div>
            <OpenMarket filters={filters} setFilter={setFilter} />
            {dirty && <button onClick={() => { clearFilters(); setSheet(false); }} className="it-btn">Reset all filters</button>}
          </div>
        </>
      )}
    </div>
  );
}
