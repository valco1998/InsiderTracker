// Company detail: everything reported on Form 4 for one ticker in the loaded
// SEC coverage window. Uses GET /insider/transactions?ticker= (existing API)
// plus GET /insider/company/:ticker/insights (unique buyers by trade date,
// role groups, cluster buying, SEC coverage, chart symbol).
// Stock prices / volume / market cap / P/E / EPS come only from TradingView's
// official embeddable widgets (delayed, labelled) — never computed or stored here.
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useInsider } from "../InsiderContext";
import useInsiderAnalytics from "../../../hooks/useInsiderAnalytics";
import { FollowButton } from "../InsiderAccountPanel";
import { DesktopTable, MobileCards, TableSkeleton, useSortedRows } from "../components/TransactionTable";
import { Disclaimer, EmptyState, ErrorNote, Panel, Skeleton } from "../components/Common";
import { BuySellChart, ActivityTimeline } from "../charts/LazyCharts";
import { byInsider } from "../../../utils/insiderAggregate";
import { compactUsd, count, day, signedCompactUsd } from "../../../utils/insiderFormat";
import { periodLabel } from "../components/KpiStrip";
import useCompanyInsights from "../../../hooks/useCompanyInsights";
import StockOverview from "../company/StockOverview";
import InsiderBuyersPanel from "../company/InsiderBuyersPanel";
import ClusterBuyingPanel from "../company/ClusterBuyingPanel";
import CompanyFilters, { useCompanyFilters } from "../company/CompanyFilters";
import { filterCompanyRows } from "../../../utils/insiderCompanyFilters";

const TICKER_RE = /^[A-Z0-9.-]{1,10}$/;

function Stat({ label, value, sub, color }) {
  return (
    <div className="it-kpi">
      <div className="it-label">{label}</div>
      <div className="it-num mt-1 text-[18px] font-semibold" style={{ color: color || "var(--it-text)" }}>{value}</div>
      {sub && <div className="text-[11px] it-dim2">{sub}</div>}
    </div>
  );
}

export default function CompanyView() {
  const raw = (useParams().ticker || "").toUpperCase();
  const ticker = TICKER_RE.test(raw) ? raw : "";
  const { dataVersion, account, feed } = useInsider();
  const params = useMemo(() => (ticker ? { ticker } : null), [ticker]);
  const data = useInsiderAnalytics(params || { ticker: "_" }, dataVersion, { enabled: !!ticker });
  const rows = data.rows;
  const insiders = useMemo(() => byInsider(rows), [rows]);
  const [days, setDays] = useState(30);
  const [threshold, setThreshold] = useState(3);
  const insights = useCompanyInsights(ticker, { days, threshold }, dataVersion);
  const { filters, patch, reset } = useCompanyFilters();
  const filtered = useMemo(() => filterCompanyRows(rows, filters), [rows, filters]);
  const [shown, setShown] = useState(100);
  useEffect(() => { setShown(100); }, [filters, ticker]);
  const { sorted, sort, toggle } = useSortedRows(filtered.slice(0, shown));
  const loading = data.loading && rows.length === 0;
  const t = data.totals;
  const head = rows[0];
  const company = insights.data?.company;

  if (!ticker) {
    return <Panel title="Company"><EmptyState title="Invalid ticker.">Tickers are 1–10 letters, digits, dots or dashes.</EmptyState></Panel>;
  }

  return (
    <div className="flex flex-col gap-3">
      <nav className="text-[12px] it-dim2" aria-label="Breadcrumb">
        <Link to="/insider/companies" className="it-link">Companies</Link> <span aria-hidden="true">/</span> <span className="it-mono">{ticker}</span>
      </nav>

      <section className="it-panel">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: "1px solid var(--it-line-soft)" }}>
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <h1 className="it-mono text-[22px] font-semibold leading-none" style={{ color: "var(--it-text)" }}>{ticker}</h1>
              {head && <FollowButton t={head} account={account} />}
            </div>
            <div className="mt-1 truncate text-[13px] it-dim">{loading && !company ? <Skeleton className="h-3 w-48" /> : head?.issuerName || company?.name || "No reported purchases or sales in the loaded window"}</div>
          </div>
          <div className="text-right text-[11px] it-dim2">
            {(head?.issuerCik || company?.cik) && <div className="it-num">CIK {head?.issuerCik || company.cik}{company?.exchange ? ` · ${company.exchange}` : ""}</div>}
            <div>{periodLabel({}, feed.status)}</div>
          </div>
        </div>
        {loading ? (
          <div className="grid grid-cols-2 gap-3 p-4 lg:grid-cols-5">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : t && (
          <div className="it-kpis grid grid-cols-2 lg:grid-cols-5">
            <Stat label="Reported purchases" value={compactUsd(t.purchaseValue)} sub={`${count(t.purchases)} transactions`} color="var(--it-buy)" />
            <Stat label="Reported sales" value={compactUsd(t.saleValue)} sub={`${count(t.sales)} transactions`} color="var(--it-sell)" />
            <Stat label="Net reported" value={signedCompactUsd(t.purchaseValue - t.saleValue)} sub="purchases − sales" />
            <Stat label="Reporting insiders" value={count(insiders.length)} sub="primary filers" />
            <Stat label="Late filings" value={count(t.lateFilings)} sub={t.priceAnomalies ? `${t.priceAnomalies} anomaly excluded` : "Form 4 due in 2 business days"} />
          </div>
        )}
      </section>

      {data.error && <ErrorNote>{data.error}</ErrorNote>}

      {insights.status === 404 ? (
        <Panel title="Stock overview"><EmptyState title={`${ticker} is not on SEC's company ticker list.`}>No chart or insider statistics are available for this symbol. Check the ticker (SEC uses e.g. BRK-B for class shares).</EmptyState></Panel>
      ) : (
        <>
          <StockOverview insights={insights.data} loading={insights.loading} />
          <div className="grid grid-cols-1 gap-3 2xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <InsiderBuyersPanel insights={insights.data} loading={insights.loading} error={insights.error} days={days} onDays={setDays} />
            <ClusterBuyingPanel insights={insights.data} loading={insights.loading} threshold={threshold} onThreshold={setThreshold} />
          </div>
        </>
      )}

      {!loading && rows.length === 0 && !data.error ? (
        <Panel><EmptyState title={`No reported open-market purchases or sales for ${ticker}.`}>Only the most recent SEC daily indexes are loaded. Check the ticker, or follow the company to be alerted on its next Form 4.</EmptyState></Panel>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <BuySellChart rows={rows} loading={loading} height={240} />
            <ActivityTimeline rows={rows} loading={loading} height={240} />
          </div>

          <Panel title="Insiders" subtitle="Identities and roles as stated in the filings">
            {loading ? <TableSkeleton rows={4} /> : (
              <div className="overflow-x-auto">
                <table className="it-table min-w-[680px]">
                  <thead><tr><th scope="col">Insider</th><th scope="col">Role</th><th scope="col" className="num">Purchases</th><th scope="col" className="num">Sales</th><th scope="col">Last trade</th><th scope="col">Latest filing</th></tr></thead>
                  <tbody>
                    {insiders.map((p) => (
                      <tr key={p.key}>
                        <td style={{ color: "var(--it-text)" }}>{p.name}</td>
                        <td className="max-w-[260px] text-[11.5px] it-dim">{p.role || "—"}</td>
                        <td className="num it-num it-buy">{p.buyCount ? `${compactUsd(p.buyValue)} · ${p.buyCount}` : <span className="it-dim2">—</span>}</td>
                        <td className="num it-num it-sell">{p.sellCount ? `${compactUsd(p.sellValue)} · ${p.sellCount}` : <span className="it-dim2">—</span>}</td>
                        <td className="it-num whitespace-nowrap it-dim">{day(p.lastTrade)}</td>
                        <td>{p.lastFilingUrl ? <a className="it-link text-xs" href={p.lastFilingUrl} target="_blank" rel="noopener noreferrer">{day(p.lastFiled)} ↗</a> : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel title="Transaction history" subtitle={loading ? "loading…" : `${count(rows.length)} reported transactions${data.partial ? ` (first ${count(rows.length)} of ${count(data.total)})` : ""}`}>
            {loading ? <TableSkeleton /> : (
              <>
                <CompanyFilters filters={filters} patch={patch} reset={reset} shown={filtered.length} total={rows.length} />
                {filtered.length === 0 ? (
                  <EmptyState title="No transactions match these filters.">Trade-date periods use the transaction date reported on Form 4.</EmptyState>
                ) : (
                  <>
                    <DesktopTable rows={sorted} account={account} sort={sort} toggle={toggle} />
                    <MobileCards rows={sorted} account={account} />
                  </>
                )}
                {filtered.length > shown && (
                  <div className="flex justify-center p-3" style={{ borderTop: "1px solid var(--it-line-soft)" }}>
                    <button className="it-btn" onClick={() => setShown((n) => n + 100)}>Show {Math.min(100, filtered.length - shown)} more</button>
                  </div>
                )}
              </>
            )}
          </Panel>
        </>
      )}
      <Disclaimer />
    </div>
  );
}
