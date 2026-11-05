// Insider Tracker views: Overview · Transactions · Companies · Analytics.
// (Company detail lives in CompanyView.jsx.)
import { useCallback, useEffect, useState } from "react";

const WIDE_QUERY = "(min-width: 1280px)"; // Tailwind xl — chart and list share a row
function useWide() {
  const [wide, setWide] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(WIDE_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(WIDE_QUERY);
    if (!mq) return undefined;
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}
import { Link } from "react-router-dom";
import { useInsider } from "../InsiderContext";
import KpiStrip from "../components/KpiStrip";
import TopCompaniesList from "../components/TopCompaniesList";
import FilterBar from "../components/FilterBar";
import TransactionsPanel from "../components/TransactionsPanel";
import { Disclaimer, ErrorNote, PageHeader } from "../components/Common";
import { BuySellChart, BuyingTrendChart, TopCompaniesChart, ActivityTimeline, ClusterBuyingUnavailable } from "../charts/LazyCharts";
import { ROW_CAP } from "../../../hooks/useInsiderAnalytics";
import { count } from "../../../utils/insiderFormat";

function AnalyticsNotice({ analytics, onRetry }) {
  if (analytics.error) return <ErrorNote onRetry={onRetry}>{analytics.error}</ErrorNote>;
  if (!analytics.partial) return null;
  return (
    <div className="rounded-md px-3 py-2 text-[11.5px]" style={{ color: "var(--it-warn)", background: "var(--it-warn-soft)", border: "1px solid var(--it-warn-line)" }}>
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
  const { feed, analytics, filters, dataError, retryData } = useInsider();
  const { pickDay, pickTicker } = useCrossFilter();
  const chartsLoading = analytics.loading && analytics.rows.length === 0;
  // API unreachable and nothing loaded yet: one error panel instead of skeletons that never resolve.
  const blocked = !!dataError && !feed.loading;
  // Side by side with the ranked list on wide screens: match its height there.
  const chartHeight = useWide() ? 492 : 300;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Overview"
        description="Insider purchases and sales reported to the SEC on Form 4 — the latest filings, the companies attracting buying, and how activity is trending."
        right={<>
          <Link to="/insider/analytics" className="it-btn">Analytics</Link>
          <Link to="/insider/transactions" className="it-btn it-btn-primary">All transactions</Link>
        </>} />
      <FilterBar />
      {blocked ? (
        <ErrorNote onRetry={retryData}>
          {dataError} Figures and charts will appear once the data loads.
        </ErrorNote>
      ) : (<>
      <KpiStrip totals={feed.totals} status={feed.status} analytics={analytics} filters={filters} loading={feed.loading && !feed.totals} />
      <AnalyticsNotice analytics={analytics} onRetry={analytics.retry} />
      <section className="flex flex-col gap-3" aria-label="Activity">
        <div className="it-section-head"><h2 className="it-eyebrow">Activity</h2><span className="text-[12px] it-dim2">Click a bar to filter that filing day · click a company to filter by ticker</span></div>
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <div className="min-w-0 xl:col-span-2"><BuySellChart rows={analytics.rows} loading={chartsLoading} onPickDay={pickDay} height={chartHeight} /></div>
          <TopCompaniesList rows={analytics.rows} loading={chartsLoading} onPick={pickTicker} n={8} />
        </div>
      </section>
      <TransactionsPanel limit={25} title="Latest reported transactions" maxHeight="none" />
      </>)}
      <Disclaimer />
    </div>
  );
}

export function TransactionsView() {
  const { feed, analytics, filters } = useInsider();
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Transactions" description="Every reported Form 4 purchase (code P) and sale (code S), newest first, with a link to the original SEC filing." />
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
    <div className="flex flex-col gap-5">
      <PageHeader title="Analytics" description="Charts use every matching transaction (purchases and sales). Click a filing-day bar to filter that day, or a company bar to filter by ticker — all charts, KPIs and the transaction table follow. Values exclude superseded filings and unverified price anomalies, exactly like the totals." />
      <FilterBar showType={false} />
      <AnalyticsNotice analytics={analytics} />
      <BuySellChart rows={analytics.rows} loading={chartsLoading} onPickDay={pickDay} height={300} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <BuyingTrendChart rows={analytics.rows} loading={chartsLoading} height={280} />
        <TopCompaniesChart rows={analytics.rows} loading={chartsLoading} onPick={pickTicker} height={280} />
      </div>
      <ActivityTimeline rows={analytics.rows} loading={chartsLoading} height={340} />
      <ClusterBuyingUnavailable />
    </div>
  );
}

// Companies: purchase-focused screener (server-side aggregation, see companies/CompaniesScreener.jsx).
export { default as CompaniesView } from "../companies/CompaniesScreener";
