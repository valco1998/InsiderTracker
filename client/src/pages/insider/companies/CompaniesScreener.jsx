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
import { Disclaimer, EmptyState, ErrorNote, Panel, Skeleton } from "../components/Common";
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

function ScreenerFilters({ filters: f, patch, reset }) {
  const n = activeScreenerFilters(f);
  const basis = BASIS_OPTIONS.find((b) => b.key === f.basis);
  return (
    <div className="flex flex-col gap-3 px-3 py-3 sm:px-4" style={{ borderBottom: "1px solid var(--it-line-soft)" }} role="search" aria-label="Screen companies by insider purchases">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <Field label="Period">
          <div className="it-seg it-scroll-x max-w-full" role="group" aria-label="Period">
            {PERIOD_OPTIONS.map((p) => <button key={p.key} aria-pressed={f.period === p.key} onClick={() => patch({ period: p.key })}>{p.label}</button>)}
          </div>
        </Field>
        <Field label="Date basis">
          <div className="it-seg" role="group" aria-label="Date basis">
            {BASIS_OPTIONS.map((b) => <button key={b.key} aria-pressed={f.basis === b.key} title={b.hint} onClick={() => patch({ basis: b.key })}>{b.label}</button>)}
          </div>
        </Field>
        {f.period === "custom" && (
          <Field label={`Custom range (${basis.label.toLowerCase()})`}>
            <input type="date" className="it-input it-num w-[150px]" aria-label="From date" value={f.from} max={f.to || undefined} onChange={(e) => patch({ from: e.target.value })} />
            <span className="it-dim2 text-xs">to</span>
            <input type="date" className="it-input it-num w-[150px]" aria-label="To date (empty = today)" value={f.to} min={f.from || undefined} onChange={(e) => patch({ to: e.target.value })} />
          </Field>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <Field label="Unique insider buyers">
          <select className="it-input w-[150px]" aria-label="Minimum unique insider buyers" value={String(f.minBuyers)}
            onChange={(e) => patch({ minBuyers: e.target.value === "custom" ? "custom" : Number(e.target.value) })}>
            {BUYER_OPTIONS.map((b) => <option key={b} value={b}>At least {b} buyer{b === 1 ? "" : "s"}</option>)}
            <option value="custom">Custom minimum…</option>
          </select>
          {f.minBuyers === "custom" && (
            <input className="it-input it-num w-20" inputMode="numeric" placeholder="Min" aria-label="Custom minimum unique buyers" value={f.customBuyers}
              onChange={(e) => patch({ customBuyers: e.target.value.replace(/\D/g, "").slice(0, 4) })} />
          )}
        </Field>
        <Field label="Total purchase value">
          <select className="it-input w-[130px]" aria-label="Minimum total purchase value" value={f.value} onChange={(e) => patch({ value: e.target.value })}>
            {VALUE_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.key === "custom" ? "Custom range…" : o.label}</option>)}
          </select>
          {f.value === "custom" && (
            <>
              <input className="it-input it-num w-28" inputMode="decimal" placeholder="Min $" aria-label="Minimum total purchase value in dollars" value={f.minValue}
                onChange={(e) => patch({ minValue: e.target.value.replace(/[^0-9.]/g, "").slice(0, 14) })} />
              <input className="it-input it-num w-28" inputMode="decimal" placeholder="Max $" aria-label="Maximum total purchase value in dollars" value={f.maxValue}
                onChange={(e) => patch({ maxValue: e.target.value.replace(/[^0-9.]/g, "").slice(0, 14) })} />
            </>
          )}
        </Field>
        <Field label="Search">
          <input className="it-input w-44" placeholder="Ticker or company" aria-label="Search ticker or company" value={f.q} onChange={(e) => patch({ q: e.target.value.slice(0, 80) })} />
        </Field>
        <Field label="Sort by">
          <select className="it-input w-[200px]" aria-label="Sort companies" value={f.sort} onChange={(e) => patch({ sort: e.target.value, dir: "desc" })}>
            {SORT_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Check checked={f.openMarket} onChange={(v) => patch({ openMarket: v })}
          title="Only purchases whose filing describes open-market execution. Form 4 code P alone does not mean the shares were bought on an exchange.">Open-market purchases only</Check>
        <Check checked={f.clusterOnly} onChange={(v) => patch({ clusterOnly: v })}
          title="3 or more different insiders bought within any 30-day trade-date window overlapping the period">Cluster buying only</Check>
        <Check checked={f.showSales} onChange={(v) => patch({ showSales: v })} title="Show insider sales as separate columns (never subtracted from purchases)">Show sales columns</Check>
        {n > 0 && <button className="it-link text-[12px]" onClick={reset}>Reset filters ({n})</button>}
      </div>
    </div>
  );
}

function CoverageNote({ coverage, window: w }) {
  if (!coverage || coverage.complete) return null;
  return (
    <div role="status" className="rounded-md px-3 py-2 text-[11.5px] leading-relaxed" style={{ color: "#d7c08f", background: "var(--it-warn-soft)", border: "1px solid rgba(232,176,75,0.18)" }}>
      <strong className="font-semibold" style={{ color: "var(--it-warn)" }}>Partial data.</strong>{" "}
      {String(coverage.note || "").replace(/^Partial data:s*/, "")} Totals below cover only the loaded days and are not complete statistics for {day(w.from)} – {day(w.to)}.
    </div>
  );
}

function ClusterChip({ c }) {
  if (!c) return <span className="it-dim2">—</span>;
  return (
    <span className="it-chip" style={{ color: "var(--it-buy)", borderColor: "rgba(38,194,129,0.35)" }}
      title={`${c.peakBuyers} distinct buyers within 30 days · trade dates ${c.from} – ${c.to}. Factual pattern, not a recommendation.`}>
      Cluster · {c.peakBuyers}
    </span>
  );
}

const COLS = [
  { key: "buyers", label: "Unique buyers", title: "Distinct insiders (SEC CIK) with a code P purchase" },
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
  const { data, loading, error } = useCompanyScreener(q.params || null, dataVersion);

  const onSort = useCallback((key) => patch(filters.sort === key ? { dir: filters.dir === "desc" ? "asc" : "desc" } : { sort: key, dir: "desc" }), [filters.sort, filters.dir, patch]);
  const initial = loading && !data;
  const list = data?.companies || [];
  const basisLabel = data?.window?.basis === "filingDate" ? "SEC filing date" : "trade date";
  const subtitle = data
    ? `${count(data.total)} compan${data.total === 1 ? "y" : "ies"} · ${compactUsd(data.totals.purchaseValue)} reported purchases · ${day(data.window.from)} – ${day(data.window.to)} by ${basisLabel}${data.coverage.complete ? "" : " · partial data"}`
    : "loading…";

  return (
    <div className="flex flex-col gap-3">
      <Panel title="Companies · insider purchases" subtitle={subtitle}
        right={data && (
          <span className="it-chip" title={data.coverage.note}
            style={data.coverage.complete ? { color: "var(--it-buy)" } : { color: "var(--it-warn)", borderColor: "rgba(232,176,75,0.35)", background: "var(--it-warn-soft)" }}>
            {data.coverage.complete ? "Complete" : "Partial data"}
          </span>
        )}>
        <ScreenerFilters filters={filters} patch={patch} reset={reset} />
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[11.5px] sm:px-4" style={{ borderBottom: "1px solid var(--it-line-soft)" }}>
          <span className="it-dim">{describeScreen(filters)}</span>
          <span className="it-dim2">
            Basis: <strong className="font-medium it-dim">{filters.basis === "filingDate" ? "SEC filing date (when reported)" : "Trade date (when insiders bought)"}</strong>
            {loading && data ? " · updating…" : ""}
          </span>
        </div>
        {q.error && <div className="px-4 py-2 text-[12px]" style={{ color: "var(--it-warn)" }}>{q.error}</div>}
        {error && <div className="p-3"><ErrorNote>{error}</ErrorNote></div>}
        {data && !data.coverage.complete && <div className="px-3 pt-3 sm:px-4"><CoverageNote coverage={data.coverage} window={data.window} /></div>}
        {initial ? (
          <div className="flex flex-col gap-2 p-3">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-7 w-full" />)}</div>
        ) : !error && list.length === 0 ? (
          <EmptyState title="No companies match this screen.">
            Lower the minimum buyers or value, widen the period{data && !data.coverage.complete ? " (only part of the period is loaded)" : ""}, or reset the filters.
          </EmptyState>
        ) : (
          <div className="pt-2">
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
