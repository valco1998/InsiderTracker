// Insider Tracker views: Overview · Transactions · Companies · Analytics.
// (Company detail lives in CompanyView.jsx.)
import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useInsider } from "../InsiderContext";
import KpiStrip from "../components/KpiStrip";
import FilterBar from "../components/FilterBar";
import TransactionsPanel from "../components/TransactionsPanel";
import { Disclaimer, EmptyState, ErrorNote, Panel, Skeleton } from "../components/Common";
import { BuySellChart, BuyingTrendChart, TopCompaniesChart, ActivityTimeline, ClusterBuyingUnavailable } from "../charts/LazyCharts";
import { byCompany } from "../../../utils/insiderAggregate";
import { ROW_CAP } from "../../../hooks/useInsiderAnalytics";
import { compactUsd, count, day, signedCompactUsd } from "../../../utils/insiderFormat";

function AnalyticsNotice({ analytics }) {
  if (analytics.error) return <ErrorNote>{analytics.error}</ErrorNote>;
  if (!analytics.partial) return null;
  return (
    <div className="rounded-md px-3 py-2 text-[11.5px]" style={{ color: "#d7c08f", background: "var(--it-warn-soft)", border: "1px solid rgba(232,176,75,0.18)" }}>
      Charts are partial: computed from the {count(analytics.rows.length)} most recent of {count(analytics.total)} transactions (limit {count(ROW_CAP)}). Narrow the filing-date range for complete figures.
    </div>
  );
}

function useCrossFilter() {
  const { setFilter } = useInsider();
  const pickDay = useCallback((d) => setFilter({ from: d, to: d }), [setFilter]);
  const pickTicker = useCallback((t) => setFilter({ ticker: t }), [setFilter]);
  return { pickDay, pickTicker };
}

export function OverviewView() {
  const { feed, analytics, filters } = useInsider();
  const { pickDay, pickTicker } = useCrossFilter();
  const chartsLoading = analytics.loading && analytics.rows.length === 0;
  return (
    <div className="flex flex-col gap-3">
      <FilterBar />
      <KpiStrip totals={feed.totals} status={feed.status} analytics={analytics} filters={filters} loading={feed.loading && !feed.totals} />
      <AnalyticsNotice analytics={analytics} />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2"><BuySellChart rows={analytics.rows} loading={chartsLoading} onPickDay={pickDay} /></div>
        <TopCompaniesChart rows={analytics.rows} loading={chartsLoading} onPick={pickTicker} n={8} height={280} />
      </div>
      <TransactionsPanel limit={25} title="Latest reported transactions" maxHeight="none" />
      <Disclaimer />
    </div>
  );
}

export function TransactionsView() {
  const { feed, analytics, filters } = useInsider();
  return (
    <div className="flex flex-col gap-3">
      <FilterBar />
      <KpiStrip totals={feed.totals} status={feed.status} analytics={analytics} filters={filters} loading={feed.loading && !feed.totals} />
      <TransactionsPanel />
      <Disclaimer />
    </div>
  );
}

export function AnalyticsView() {
  const { analytics } = useInsider();
  const { pickDay, pickTicker } = useCrossFilter();
  const chartsLoading = analytics.loading && analytics.rows.length === 0;
  return (
    <div className="flex flex-col gap-3">
      <FilterBar showType={false} />
      <p className="text-[11.5px] it-dim2">
        Charts use every matching transaction (purchases and sales). Click a filing-day bar to filter that day, or a company bar to filter by ticker —
        all charts, KPIs and the transaction table follow. Values exclude superseded filings and unverified price anomalies, exactly like the totals.
      </p>
      <AnalyticsNotice analytics={analytics} />
      <BuySellChart rows={analytics.rows} loading={chartsLoading} onPickDay={pickDay} height={300} />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <BuyingTrendChart rows={analytics.rows} loading={chartsLoading} height={280} />
        <TopCompaniesChart rows={analytics.rows} loading={chartsLoading} onPick={pickTicker} height={280} />
      </div>
      <ActivityTimeline rows={analytics.rows} loading={chartsLoading} height={340} />
      <ClusterBuyingUnavailable />
    </div>
  );
}

const SORTS = [
  { key: "buyValue", label: "Purchases", num: true },
  { key: "sellValue", label: "Sales", num: true },
  { key: "net", label: "Net", num: true },
  { key: "count", label: "Transactions", num: true },
  { key: "insiders", label: "Insiders", num: true },
  { key: "lastFiled", label: "Last filed", num: false },
];

export function CompaniesView() {
  const { analytics } = useInsider();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState({ key: "buyValue", dir: "desc" });
  const companies = useMemo(() => byCompany(analytics.rows), [analytics.rows]);
  const list = useMemo(() => {
    const needle = q.trim().toUpperCase();
    const f = needle ? companies.filter((c) => (c.ticker || "").toUpperCase().includes(needle) || (c.name || "").toUpperCase().includes(needle)) : companies;
    const k = sort.key, m = sort.dir === "asc" ? 1 : -1;
    return [...f].sort((a, b) => (typeof a[k] === "number" ? (a[k] - b[k]) : String(a[k] || "").localeCompare(String(b[k] || ""))) * m || String(a.ticker).localeCompare(String(b.ticker)));
  }, [companies, q, sort]);
  const [shown, setShown] = useState(100);
  const toggle = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));
  const loading = analytics.loading && analytics.rows.length === 0;

  return (
    <div className="flex flex-col gap-3">
      <FilterBar showType={false} />
      <AnalyticsNotice analytics={analytics} />
      <Panel title="Companies" subtitle={loading ? "loading…" : `${count(companies.length)} issuers with reported purchases or sales`}
        right={<input className="it-input w-40 sm:w-56" placeholder="Search ticker or name" value={q} onChange={(e) => { setQ(e.target.value); setShown(100); }} aria-label="Search companies" />}>
        {loading ? (
          <div className="flex flex-col gap-2 p-3">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-7 w-full" />)}</div>
        ) : list.length === 0 ? <EmptyState title="No companies match.">Try another search or clear the filters.</EmptyState> : (
          <>
            <div className="it-table-wrap">
              <table className="it-table min-w-[760px]">
                <thead>
                  <tr>
                    <th scope="col">Company</th>
                    {SORTS.map((s) => (
                      <th key={s.key} scope="col" className={s.num ? "num" : ""} aria-sort={sort.key === s.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                        <button onClick={() => toggle(s.key)}>{s.label}<span aria-hidden="true" style={{ opacity: sort.key === s.key ? 1 : 0.25 }}>{sort.key === s.key && sort.dir === "asc" ? "▲" : "▼"}</span></button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {list.slice(0, shown).map((c) => (
                    <tr key={c.key} className={c.net > 0 ? "it-r-buy" : c.net < 0 ? "it-r-sell" : ""}>
                      <td className="max-w-[300px]">
                        {c.ticker ? <Link to={`/insider/company/${encodeURIComponent(c.ticker)}`} className="it-mono font-semibold hover:underline" style={{ color: "var(--it-text)" }}>{c.ticker}</Link> : <span className="it-mono">—</span>}
                        <div className="truncate text-[11.5px] it-dim2" title={c.name}>{c.name}</div>
                      </td>
                      <td className="num it-num it-buy">{c.buyValue ? compactUsd(c.buyValue) : <span className="it-dim2">—</span>}<div className="text-[10.5px] it-dim2">{c.buyCount ? `${c.buyCount} tx` : ""}</div></td>
                      <td className="num it-num it-sell">{c.sellValue ? compactUsd(c.sellValue) : <span className="it-dim2">—</span>}<div className="text-[10.5px] it-dim2">{c.sellCount ? `${c.sellCount} tx` : ""}</div></td>
                      <td className="num it-num" style={{ color: "var(--it-text)" }}>{signedCompactUsd(c.net)}</td>
                      <td className="num it-num it-dim">{count(c.count)}</td>
                      <td className="num it-num it-dim">{count(c.insiders)}</td>
                      <td className="it-num whitespace-nowrap it-dim">{day(c.lastFiled)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {list.length > shown && (
              <div className="flex justify-center p-3" style={{ borderTop: "1px solid var(--it-line-soft)" }}>
                <button className="it-btn" onClick={() => setShown((n) => n + 100)}>Show {Math.min(100, list.length - shown)} more of {count(list.length - shown)}</button>
              </div>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}
