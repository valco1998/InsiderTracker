// KPI overview. Values: server `totals` for the active filters; unique
// companies / insiders are derived from the analytics dataset (labelled).
import { memo, useMemo } from "react";
import { compactUsd, count, day, signedCompactUsd } from "../../../utils/insiderFormat";
import { uniqueCounts } from "../../../utils/insiderAggregate";
import { AnimatedNumber, Skeleton } from "./Common";

const int = (v) => count(v == null ? null : Math.round(v));

function Kpi({ label, value, format, sub, color, title, loading }) {
  return (
    <div className="it-kpi" title={title}>
      <div className="it-label truncate">{label}</div>
      {loading ? <Skeleton className="mt-2 h-6 w-24" /> : (
        <div className="it-num mt-1 truncate text-[20px] font-semibold leading-tight" style={{ color: color || "var(--it-text)" }}>
          <AnimatedNumber value={value} format={format} />
        </div>
      )}
      {sub && <div className="mt-0.5 truncate text-[11px] it-dim2">{sub}</div>}
    </div>
  );
}

export function periodLabel(filters, status) {
  if (filters.from || filters.to) {
    return `Filed ${filters.from ? day(filters.from) : "…"} – ${filters.to ? day(filters.to) : "latest"}`;
  }
  const cov = status?.coverage || [];
  if (!cov.length) return "All loaded filings";
  return `SEC daily indexes ${day(cov[cov.length - 1].day)} – ${day(cov[0].day)}`;
}

function KpiStrip({ totals, status, analytics, filters, loading }) {
  const code = filters.type === "purchase" ? "P" : filters.type === "sale" ? "S" : null;
  const uniques = useMemo(() => uniqueCounts(code ? analytics.rows.filter((r) => r.code === code) : analytics.rows), [analytics.rows, code]);
  const analyticsReady = !analytics.loading || analytics.rows.length > 0;
  const net = totals ? totals.purchaseValue - totals.saleValue : null;
  const newestDay = status?.coverage?.[0];
  const t = totals;
  return (
    <section className="it-panel" aria-label="Key figures">
      <div className="it-panel-head">
        <h2 className="it-panel-title">Overview</h2>
        <span className="min-w-0 truncate text-[11px] it-dim2">{periodLabel(filters, status)} · by filing date{filters.type !== "all" ? ` · ${filters.type === "purchase" ? "purchases" : "sales"} only` : ""}{filters.ticker ? ` · ${filters.ticker}` : ""}</span>
      </div>
      <div className="it-kpis grid grid-cols-2 lg:grid-cols-6">
        <Kpi label="Reported purchases" loading={loading} value={t?.purchaseValue} format={compactUsd} color="var(--it-buy)"
          sub={t ? `${count(t.purchases)} transactions` : null} title="Sum of shares × reported price for P transactions. Price anomalies and superseded filings excluded." />
        <Kpi label="Reported sales" loading={loading} value={t?.saleValue} format={compactUsd} color="var(--it-sell)"
          sub={t ? `${count(t.sales)} transactions` : null} title="Sum of shares × reported price for S transactions. Price anomalies and superseded filings excluded." />
        <Kpi label="Net reported" loading={loading} value={net} format={signedCompactUsd}
          color={net == null ? undefined : net >= 0 ? "var(--it-buy)" : "var(--it-sell)"} sub="purchases − sales" />
        <Kpi label="Transactions" loading={loading} value={t?.count} format={int}
          sub={t ? `${count(t.lateFilings)} late filings` : null} title="Economic transactions (duplicate reports by related filers counted once)" />
        <Kpi label="Companies · insiders" loading={!analyticsReady} value={uniques.companies} format={int}
          sub={analyticsReady ? `${count(uniques.insiders)} reporting insiders${analytics.partial ? " · partial" : ""}` : null}
          title={`Distinct issuers and primary reporting insiders for the current filters${analytics.partial ? ` — computed from the first ${count(analytics.rows.length)} of ${count(analytics.total)} transactions` : ""}.`} />
        <Kpi label={newestDay ? `Form 4 filed ${day(newestDay.day).replace(/, \d{4}$/, "")}` : "Latest SEC index"} loading={loading && !status} value={newestDay?.listed ?? null} format={int}
          sub={newestDay ? `${count(newestDay.parsed)} parsed${newestDay.failed ? ` · ${newestDay.failed} failed` : ""}` : "no index yet"}
          title="Form 4 filings listed in the newest SEC daily index (all transaction codes, before P/S filtering)" />
      </div>
      {t && (t.priceAnomalies > 0 || t.supersededByAmendment > 0) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t px-4 py-2 text-[11px] it-dim2" style={{ borderColor: "var(--it-line-soft)" }}>
          {t.priceAnomalies > 0 && <span style={{ color: "#f3a3a6" }}>{t.priceAnomalies} price-anomaly transaction{t.priceAnomalies === 1 ? "" : "s"} ({compactUsd(t.anomalyValueExcluded)} as reported) excluded from values until verified.</span>}
          {t.supersededByAmendment > 0 && <span>{t.supersededByAmendment} superseded by Form 4/A excluded (the amendment is counted).</span>}
          {t.confirmedGroups > 0 && <span>{t.confirmedGroups} duplicate reports grouped · {t.needsReview} flagged for review{t.valueMissing ? ` · ${t.valueMissing} without price` : ""}</span>}
        </div>
      )}
    </section>
  );
}

export default memo(KpiStrip);
