// Companies — purchase-focused insider screener (GET /api/insider/companies).
// Every number is computed server-side from the published SEC snapshot:
// unique buyers by reporting-owner CIK (joint filers once), code P purchases
// only, superseded Form 4/A rows and price anomalies excluded from values,
// confirmed duplicate reports counted once. Sales are never subtracted; sale
// columns are optional. "Partial data" is shown whenever the SEC daily indexes
// behind the selected window are not all loaded.
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useInsider } from "../InsiderContext";
import useCompanyScreener from "../../../hooks/useCompanyScreener";
import { Disclaimer, EmptyState, ErrorNote, PageHeader, Panel, Skeleton } from "../components/Common";
import { compactUsd, count, day } from "../../../utils/insiderFormat";
import {
  BASIS_OPTIONS, BUYER_OPTIONS, DEFAULT_SCREENER_FILTERS, PERIOD_OPTIONS, SORT_OPTIONS, VALUE_OPTIONS,
  activeScreenerFilters, describeScreen, normalizeScreenerFilters, screenerQuery,
} from "../../../utils/insiderScreener";

const STORE_KEY = "it.companiesScreen.v1";
const PAGE = 100;
const MAX_LIMIT = 500;

function useScreenerFilters() {
  const [filters, setFilters] = useState(() => {
    try { return normalizeScreenerFilters(JSON.parse(sessionStorage.getItem(STORE_KEY) || "null")); } catch { return { ...DEFAULT_SCREENER_FILTERS }; }
  });
  useEffect(() => { try { sessionStorage.setItem(STORE_KEY, JSON.stringify(filters)); } catch { /* storage unavailable */ } }, [filters]);
  const patch = useCallback((p) => setFilters((f) => ({ ...f, ...p })), []);
  const reset = useCallback(() => setFilters({ ...DEFAULT_SCREENER_FILTERS }), []);
  return { filters, patch, reset };
}

function Field({ label, children, className = "" }) {
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <span className="it-label">{label}</span>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

function Check({ checked, onChange, children, title }) {
  return (
    <label className="flex h-8 cursor-pointer items-center gap-2 whitespace-nowrap text-[12.5px] it-dim" title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4" style={{ accentColor: "var(--it-accent)" }} />
      {children}
    </label>
  );
}

// Filter controls are shared by the desktop toolbar and the phone "Filters" sheet
// (same pattern as components/FilterBar.jsx), so state and behaviour are identical.
function PeriodSeg({ f, patch }) {
  return (
    <div className="it-seg it-scroll-x max-w-full" role="group" aria-label="Period">
      {PERIOD_OPTIONS.map((p) => <button key={p.key} aria-pressed={f.period === p.key} onClick={() => patch({ period: p.key })}>{p.label}</button>)}
    </div>
  );
}

function BasisField({ f, patch, fill = false }) {
  return (
    <Field label="Date basis">
      <div className={`it-seg${fill ? " it-seg-fill w-full" : ""}`} role="group" aria-label="Date basis">
        {BASIS_OPTIONS.map((b) => <button key={b.key} aria-pressed={f.basis === b.key} title={b.hint} onClick={() => patch({ basis: b.key })}>{b.label}</button>)}
      </div>
    </Field>
  );
}

function CustomRangeField({ f, patch, fill = false }) {
  if (f.period !== "custom") return null;
  const basis = BASIS_OPTIONS.find((b) => b.key === f.basis);
  const w = fill ? "min-w-0 flex-1" : "w-[150px]";
  return (
    <Field label={`Custom range (${basis.label.toLowerCase()})`}>
      <input type="date" className={`it-input it-num ${w}`} aria-label="From date" value={f.from} max={f.to || undefined} onChange={(e) => patch({ from: e.target.value })} />
      <span className="it-dim2 text-xs">to</span>
      <input type="date" className={`it-input it-num ${w}`} aria-label="To date (empty = today)" value={f.to} min={f.from || undefined} onChange={(e) => patch({ to: e.target.value })} />
    </Field>
  );
}

function BuyersField({ f, patch, fill = false }) {
  return (
    <Field label="Unique insider buyers">
      <select className={`it-input ${fill ? "min-w-0 flex-1" : "w-auto min-w-[150px]"}`} aria-label="Minimum unique insider buyers" value={String(f.minBuyers)}
        onChange={(e) => patch({ minBuyers: e.target.value === "custom" ? "custom" : Number(e.target.value) })}>
        {BUYER_OPTIONS.map((b) => <option key={b} value={b}>At least {b} buyer{b === 1 ? "" : "s"}</option>)}
        <option value="custom">Custom minimum…</option>
      </select>
      {f.minBuyers === "custom" && (
        <input className="it-input it-num w-20" inputMode="numeric" placeholder="Min" aria-label="Custom minimum unique buyers" value={f.customBuyers}
          onChange={(e) => patch({ customBuyers: e.target.value.replace(/\D/g, "").slice(0, 4) })} />
      )}
    </Field>
  );
}

function ValueField({ f, patch, fill = false }) {
  const w = fill ? "min-w-0 flex-1" : "w-28";
  return (
    <Field label="Total purchase value">
      <select className={`it-input ${fill ? "w-full" : "w-[130px]"}`} aria-label="Minimum total purchase value" value={f.value} onChange={(e) => patch({ value: e.target.value })}>
        {VALUE_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.key === "custom" ? "Custom range…" : o.label}</option>)}
      </select>
      {f.value === "custom" && (
        <>
          <input className={`it-input it-num ${w}`} inputMode="decimal" placeholder="Min $" aria-label="Minimum total purchase value in dollars" value={f.minValue}
            onChange={(e) => patch({ minValue: e.target.value.replace(/[^0-9.]/g, "").slice(0, 14) })} />
          <input className={`it-input it-num ${w}`} inputMode="decimal" placeholder="Max $" aria-label="Maximum total purchase value in dollars" value={f.maxValue}
            onChange={(e) => patch({ maxValue: e.target.value.replace(/[^0-9.]/g, "").slice(0, 14) })} />
        </>
      )}
    </Field>
  );
}

function SearchField({ f, patch, fill = false }) {
  return (
    <Field label="Search">
      <input className={`it-input ${fill ? "w-full" : "w-44"}`} placeholder="Ticker or company" aria-label="Search ticker or company" value={f.q} onChange={(e) => patch({ q: e.target.value.slice(0, 80) })} />
    </Field>
  );
}

function SortField({ f, patch, fill = false }) {
  return (
    <Field label="Sort by">
      <select className={`it-input ${fill ? "w-full" : "w-[200px]"}`} aria-label="Sort companies" value={f.sort} onChange={(e) => patch({ sort: e.target.value, dir: "desc" })}>
        {SORT_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
    </Field>
  );
}

function Checks({ f, patch }) {
  return (
    <>
      <Check checked={f.openMarket} onChange={(v) => patch({ openMarket: v })}
        title="Only purchases whose filing describes open-market execution. Form 4 code P alone does not mean the shares were bought on an exchange.">Open-market purchases only</Check>
      <Check checked={f.clusterOnly} onChange={(v) => patch({ clusterOnly: v })}
        title="3 or more different insiders bought within any 30-day trade-date window overlapping the period">Cluster buying only</Check>
      <Check checked={f.showSales} onChange={(v) => patch({ showSales: v })} title="Show insider sales as separate columns (never subtracted from purchases)">Show sales columns</Check>
    </>
  );
}

function ScreenerFilters({ filters: f, patch, reset }) {
  const n = activeScreenerFilters(f);
  const [sheet, setSheet] = useState(false);
  // Phone button count: active screen filters plus non-default sheet-only settings.
  const sheetCount = n + (f.basis !== DEFAULT_SCREENER_FILTERS.basis ? 1 : 0) + (f.showSales ? 1 : 0);
  const p = { f, patch };

  useEffect(() => {
    if (!sheet) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setSheet(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet]);

  return (
    <div style={{ borderBottom: "1px solid var(--it-line-soft)" }} role="search" aria-label="Screen companies by insider purchases">
      {/* desktop / tablet (md+) — same layout as before */}
      <div className="hidden flex-col gap-3 px-3 py-3 sm:px-4 md:flex">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <Field label="Period"><PeriodSeg {...p} /></Field>
          <BasisField {...p} />
          <CustomRangeField {...p} />
        </div>
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <BuyersField {...p} />
          <ValueField {...p} />
          <SearchField {...p} />
          <SortField {...p} />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Checks {...p} />
          {n > 0 && <button className="it-link text-[12px]" onClick={reset}>Reset filters ({n})</button>}
        </div>
      </div>

      {/* phone — period stays visible, everything else lives in a bottom sheet */}
      <div className="flex items-center gap-2 p-3 md:hidden">
        <div className="min-w-0 flex-1"><PeriodSeg {...p} /></div>
        <button className="it-btn shrink-0" onClick={() => setSheet(true)} aria-haspopup="dialog" aria-expanded={sheet}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
          Filters{sheetCount ? ` · ${sheetCount}` : ""}
        </button>
      </div>

      {sheet && (
        <>
          <div className="it-backdrop md:hidden" onClick={() => setSheet(false)} />
          <div className="it-sheet flex flex-col gap-4 p-4 pb-6 md:hidden" role="dialog" aria-modal="true" aria-label="Screen filters">
            <div className="flex items-center justify-between">
              <span className="it-panel-title">Filters</span>
              <button className="it-btn it-btn-primary" onClick={() => setSheet(false)}>Done</button>
            </div>
            <BasisField {...p} fill />
            <CustomRangeField {...p} fill />
            <BuyersField {...p} fill />
            <ValueField {...p} fill />
            <SearchField {...p} fill />
            <SortField {...p} fill />
            <div className="flex flex-col"><Checks {...p} /></div>
            {n > 0 && <button className="it-btn" onClick={() => { reset(); setSheet(false); }}>Reset filters ({n})</button>}
          </div>
        </>
      )}
    </div>
  );
}

function CoverageNote({ coverage, window: w }) {
  if (!coverage || coverage.complete) return null;
  return (
    <div role="status" className="rounded-md px-3 py-2 text-[11.5px] leading-relaxed" style={{ color: "var(--it-warn)", background: "var(--it-warn-soft)", border: "1px solid var(--it-warn-line)" }}>
      <strong className="font-semibold" style={{ color: "var(--it-warn)" }}>Partial data.</strong>{" "}
      {String(coverage.note || "").replace(/^Partial data:s*/, "")} Totals below cover only the loaded days and are not complete statistics for {day(w.from)} – {day(w.to)}.
    </div>
  );
}

function ClusterChip({ c }) {
  if (!c) return <span className="it-dim2">—</span>;
  return (
    <span className="it-chip" style={{ color: "var(--it-buy)", borderColor: "var(--it-buy-line)" }}
      title={`${c.peakBuyers} distinct buyers within 30 days · trade dates ${c.from} – ${c.to}. Factual pattern, not a recommendation.`}>
      Cluster · {c.peakBuyers}
    </span>
  );
}

const COLS = [
  { key: "buyers", label: "Unique buyers", title: "Distinct buyers (SEC reporting-owner CIK) with a code P purchase. Joint filers count once — including related filers (e.g. funds of one investment firm) reporting the same purchase in separate Form 4s." },
  { key: "transactions", label: "Purchases", title: "Number of purchase transactions" },
  { key: "value", label: "Purchase value", title: "Total reported purchase value (shares × price)" },
  { key: "recent", label: "Latest purchase", title: "Most recent trade date", date: true },
];

function SortHead({ col, sort, onSort }) {
  const on = sort.key === col.key;
  return (
    <th scope="col" className={col.date ? "" : "num"} title={col.title} aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button onClick={() => onSort(col.key)}>{col.label}<span aria-hidden="true" style={{ opacity: on ? 1 : 0.25 }}>{on && sort.dir === "asc" ? "▲" : "▼"}</span></button>
    </th>
  );
}

const ScreenerTable = memo(function ScreenerTable({ companies, sort, onSort, showSales }) {
  return (
    <>
      <div className="it-table-wrap hidden md:block">
        <table className={`it-table ${showSales ? "min-w-[1080px]" : "min-w-[880px]"}`}>
          <thead>
            <tr>
              <th scope="col">Company</th>
              {COLS.map((c) => <SortHead key={c.key} col={c} sort={sort} onSort={onSort} />)}
              <th scope="col" title="Most recent SEC filing date of these purchases">Latest SEC filing</th>
              <th scope="col" title="3+ unique buyers within 30 days">Cluster</th>
              {showSales && <th scope="col" className="num">Sellers</th>}
              {showSales && <th scope="col" className="num">Sale value</th>}
            </tr>
          </thead>
          <tbody>
            {companies.map((c) => (
              <tr key={c.key}>
                <td className="max-w-[320px]">
                  {c.ticker ? <Link to={`/insider/company/${encodeURIComponent(c.ticker)}`} className="it-mono font-semibold hover:underline" style={{ color: "var(--it-text)" }}>{c.ticker}</Link> : <span className="it-mono">—</span>}
                  <div className="truncate text-[11.5px] it-dim2" title={c.name}>{c.name}</div>
                </td>
                <td className="num it-num font-semibold it-buy" title={c.topBuyers.map((b) => `${b.name} (${b.roles.join(", ")})`).join("\n")}>{count(c.uniqueBuyers)}</td>
                <td className="num it-num it-dim">{count(c.purchaseTransactions)}
                  {c.openMarketPurchases > 0 && c.openMarketPurchases < c.purchaseTransactions && <div className="text-[10.5px] it-dim2">{c.openMarketPurchases} open-mkt</div>}
                </td>
                <td className="num it-num it-buy">{c.purchaseValue ? compactUsd(c.purchaseValue) : <span className="it-dim2">—</span>}
                  {c.purchaseValueMissing > 0 && <div className="text-[10.5px] it-dim2" title="Purchases without a usable reported price (not in the total)">+{c.purchaseValueMissing} n/a</div>}
                </td>
                <td className="it-num whitespace-nowrap it-dim">{day(c.latestPurchaseDate)}</td>
                <td className="it-num whitespace-nowrap it-dim">{day(c.latestFilingDate)}</td>
                <td><ClusterChip c={c.cluster} /></td>
                {showSales && <td className="num it-num it-dim">{c.uniqueSellers ? count(c.uniqueSellers) : "—"}</td>}
                {showSales && <td className="num it-num it-sell">{c.saleValue ? compactUsd(c.saleValue) : <span className="it-dim2">—</span>}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="md:hidden">
        {companies.map((c) => (
          <li key={c.key} style={{ borderBottom: "1px solid var(--it-line-soft)" }}>
            <Link to={c.ticker ? `/insider/company/${encodeURIComponent(c.ticker)}` : "#"} className="block px-3.5 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2"><span className="it-mono font-semibold" style={{ color: "var(--it-text)" }}>{c.ticker || "—"}</span><ClusterChip c={c.cluster} /></div>
                  <div className="truncate text-[11.5px] it-dim2">{c.name}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="it-num font-semibold it-buy">{c.purchaseValue ? compactUsd(c.purchaseValue) : "—"}</div>
                  <div className="it-num text-[11px] it-dim2">{count(c.uniqueBuyers)} buyer{c.uniqueBuyers === 1 ? "" : "s"} · {count(c.purchaseTransactions)} purchase{c.purchaseTransactions === 1 ? "" : "s"}</div>
                </div>
              </div>
              <div className="mt-1 flex justify-between gap-2 text-[11.5px] it-dim2">
                <span className="it-num">Bought {day(c.latestPurchaseDate)}</span>
                <span className="it-num">Filed {day(c.latestFilingDate)}</span>
              </div>
              {showSales && c.saleTransactions > 0 && <div className="mt-0.5 text-[11px] it-dim2">Sales (not subtracted): {count(c.uniqueSellers)} seller{c.uniqueSellers === 1 ? "" : "s"} · <span className="it-sell">{c.saleValue ? compactUsd(c.saleValue) : "—"}</span></div>}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
});

export default function CompaniesScreener() {
  const { dataVersion } = useInsider();
  const { filters, patch, reset } = useScreenerFilters();
  // Typing in search / custom inputs is debounced before querying.
  const [debounced, setDebounced] = useState(filters);
  useEffect(() => { const t = setTimeout(() => setDebounced(filters), 250); return () => clearTimeout(t); }, [filters]);
  const [limit, setLimit] = useState(PAGE);
  const q = useMemo(() => screenerQuery(debounced, { limit }), [debounced, limit]);
  useEffect(() => { setLimit(PAGE); }, [debounced]);
  // retry() comes from useCompanyScreener (forces a refetch of the current query).
  const { data, loading, error, retry } = useCompanyScreener(q.params || null, dataVersion);

  const onSort = useCallback((key) => patch(filters.sort === key ? { dir: filters.dir === "desc" ? "asc" : "desc" } : { sort: key, dir: "desc" }), [filters.sort, filters.dir, patch]);
  const initial = loading && !data;
  const failed = !!error && !data && !loading; // nothing to show: full error state, no table
  const list = data?.companies || [];
  const basisLabel = data?.window?.basis === "filingDate" ? "SEC filing date" : "trade date";
  const subtitleText = data
    ? `${count(data.total)} compan${data.total === 1 ? "y" : "ies"} · ${compactUsd(data.totals.purchaseValue)} reported purchases · ${day(data.window.from)} – ${day(data.window.to)} by ${basisLabel}${data.coverage.complete ? "" : " · partial data"}`
    : failed ? "Could not load" : "loading…";
  // Panel truncates subtitles; let it wrap so phones show the whole summary. Below md it reserves
  // three lines (its loaded height at ~390px) so results arriving do not push the list down.
  const subtitle = <span className="block min-h-[3lh] whitespace-normal md:min-h-0">{subtitleText}</span>;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Companies" description="Companies ranked by reported insider purchases (Form 4 code P). Buyers are counted once per joint-filing group, so related funds of one firm are not shown as independent buyers." />
      <Panel title="Insider purchases by company" subtitle={subtitle}
        right={data && (
          <span className="it-chip" title={data.coverage.note}
            style={data.coverage.complete ? { color: "var(--it-buy)" } : { color: "var(--it-warn)", borderColor: "var(--it-warn-line)", background: "var(--it-warn-soft)" }}>
            {data.coverage.complete ? "Complete" : "Partial data"}
          </span>
        )}>
        <ScreenerFilters filters={filters} patch={patch} reset={reset} />
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[11.5px] sm:px-4" style={{ borderBottom: "1px solid var(--it-line-soft)" }}>
          <span className="it-dim">{describeScreen(filters)}</span>
          <span className="it-dim2">
            <span className="hidden md:inline">Basis: <strong className="font-medium it-dim">{filters.basis === "filingDate" ? "SEC filing date (when reported)" : "Trade date (when insiders bought)"}</strong></span>
            {loading && data ? <><span className="hidden md:inline"> · </span>updating…</> : ""}
          </span>
        </div>
        {q.error && <div className="px-4 py-2 text-[12px]" style={{ color: "var(--it-warn)" }}>{q.error}</div>}
        {error && data && !loading && (
          <div role="status" className="mx-3 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md px-3 py-2 text-[12px] sm:mx-4"
            style={{ color: "var(--it-warn)", background: "var(--it-warn-soft)", border: "1px solid var(--it-warn-line)" }}>
            <span>Could not refresh — showing the previous results. {error}</span>
            <button className="it-link text-[12px] font-medium" onClick={retry}>Retry</button>
          </div>
        )}
        {data && !data.coverage.complete && <div className="px-3 pt-3 sm:px-4"><CoverageNote coverage={data.coverage} window={data.window} /></div>}
        {failed ? (
          <div className="p-3 sm:p-4"><ErrorNote onRetry={retry}>{error}</ErrorNote></div>
        ) : initial || (!data && !q.error) ? (
          // Keys: the skeleton and the table are distinct nodes (no DOM reuse that would register
          // as a moved element), and the skeleton is a viewport tall so content below stays put.
          <div key="skeleton" className="flex min-h-[100vh] flex-col gap-2 p-3">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-7 w-full" />)}</div>
        ) : list.length === 0 ? (
          <EmptyState title="No companies match this screen.">
            Lower the minimum buyers or value, widen the period{data && !data.coverage.complete ? " (only part of the period is loaded)" : ""}, or reset the filters.
          </EmptyState>
        ) : (
          <div key="table" className="pt-2">
            <ScreenerTable companies={list} sort={{ key: filters.sort, dir: filters.dir }} onSort={onSort} showSales={filters.showSales} />
            {data && data.total > list.length && (
              <div className="flex justify-center p-3" style={{ borderTop: "1px solid var(--it-line-soft)" }}>
                {limit < MAX_LIMIT
                  ? <button className="it-btn" onClick={() => setLimit((n) => Math.min(MAX_LIMIT, n + PAGE))}>Show {Math.min(PAGE, data.total - list.length)} more of {count(data.total - list.length)}</button>
                  : <span className="text-[12px] it-dim2">Showing the first {count(list.length)} of {count(data.total)} — narrow the filters to see the rest.</span>}
              </div>
            )}
          </div>
        )}
        {data && (
          <div className="px-3 py-2 text-[11px] leading-relaxed it-dim2 sm:px-4" style={{ borderTop: "1px solid var(--it-line-soft)" }}>
            {data.definitions.uniqueBuyers} {data.definitions.purchaseValue} {data.definitions.purchase} Cluster: {data.definitions.cluster}
          </div>
        )}
      </Panel>
      <Disclaimer />
    </div>
  );
}
