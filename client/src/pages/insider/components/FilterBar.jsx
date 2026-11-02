// Filters → the same API params as before (type, ticker, from/to filing date,
// venue=open_market). Desktop: inline toolbar. Mobile: dates in a bottom sheet.
import { useEffect, useState } from "react";
import { useInsider } from "../InsiderContext";
import { day } from "../../../utils/insiderFormat";

const TYPE_TABS = [
  { key: "all", label: "All" },
  { key: "purchase", label: "Purchases" },
  { key: "sale", label: "Sales" },
];

const cleanTicker = (v) => v.toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 10);

function DateFields({ filters, setFilter }) {
  return (
    <>
      <label className="flex flex-col gap-1">
        <span className="it-label">Filed from</span>
        <input type="date" className="it-input" value={filters.from} max={filters.to || undefined} onChange={(e) => setFilter({ from: e.target.value })} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="it-label">Filed to</span>
        <input type="date" className="it-input" value={filters.to} min={filters.from || undefined} onChange={(e) => setFilter({ to: e.target.value })} />
      </label>
    </>
  );
}

function OpenMarket({ filters, setFilter }) {
  return (
    <label className="flex h-8 cursor-pointer items-center gap-2 text-[12.5px] it-dim" title="Purchases whose filing footnotes describe open-market execution (sales are hidden)">
      <input type="checkbox" checked={filters.openMarketOnly} onChange={(e) => setFilter({ openMarketOnly: e.target.checked })} className="h-4 w-4" style={{ accentColor: "var(--it-accent)" }} />
      Open-market purchases only
    </label>
  );
}

export function TypeTabs({ value, onChange }) {
  return (
    <div className="it-seg" role="tablist" aria-label="Transaction type">
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

  useEffect(() => {
    if (!sheet) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setSheet(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet]);

  return (
    <div className="it-panel flex flex-col gap-2 p-2.5 sm:p-3">
      <div className="flex flex-wrap items-end gap-2.5 sm:gap-3">
        {showType && <TypeTabs value={filters.type} onChange={(type) => setFilter({ type })} />}
        <label className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-none">
          <span className="it-label">Ticker</span>
          <input value={tickerInput} onChange={(e) => setTickerInput(cleanTicker(e.target.value))} placeholder="e.g. AAPL"
            className="it-input it-mono w-full sm:w-32" inputMode="text" autoCapitalize="characters" spellCheck={false} aria-label="Filter by ticker" />
        </label>
        <div className="hidden items-end gap-3 sm:flex"><DateFields filters={filters} setFilter={setFilter} /></div>
        <div className="hidden sm:block"><OpenMarket filters={filters} setFilter={setFilter} /></div>
        {/* wrapper carries the responsive display — .it-btn sets its own display */}
        <span className="sm:hidden">
          <button className="it-btn" onClick={() => setSheet(true)} aria-haspopup="dialog">
            Dates{filters.from || filters.to || filters.openMarketOnly ? " ●" : ""}
          </button>
        </span>
        {dirty && <button onClick={clearFilters} className="it-btn sm:ml-auto">Clear</button>}
      </div>
      {active.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {active.map((a) => (
            <button key={a.k} className="it-chip hover:border-[color:var(--it-line-strong)]" onClick={() => setFilter({ [a.k]: a.k === "openMarketOnly" ? false : "" })} aria-label={`Remove filter ${a.text}`}>
              {a.text} <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
      )}

      {sheet && (
        <>
          <div className="it-backdrop sm:hidden" onClick={() => setSheet(false)} />
          <div className="it-sheet flex flex-col gap-3 p-4 sm:hidden" role="dialog" aria-modal="true" aria-label="Date filters">
            <div className="flex items-center justify-between">
              <span className="it-panel-title">Filing date</span>
              <button className="it-btn" onClick={() => setSheet(false)}>Done</button>
            </div>
            <div className="grid grid-cols-2 gap-3"><DateFields filters={filters} setFilter={setFilter} /></div>
            <OpenMarket filters={filters} setFilter={setFilter} />
          </div>
        </>
      )}
    </div>
  );
}
