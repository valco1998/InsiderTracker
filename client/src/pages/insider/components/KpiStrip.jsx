// KPI overview. Values: server `totals` for the active filters; unique
// companies / insiders are derived from the analytics dataset (labelled).
// Layout: three hero cards (purchases, sales, net with the buy/sell value mix)
// and a row of supporting figures. Every number and tooltip is unchanged.
import { memo, useMemo } from "react";
import { compactUsd, count, day, signedCompactUsd } from "../../../utils/insiderFormat";
import { uniqueCounts } from "../../../utils/insiderAggregate";
import { AnimatedNumber, Skeleton } from "./Common";

const int = (v) => count(v == null ? null : Math.round(v));

const ICONS = {
  buy: <path d="M7 17 17 7M9 7h8v8" />,
  sell: <path d="M7 7l10 10M17 9v8H9" />,
  net: <path d="M4 12h16M12 4v16" />,
};

function HeroKpi({ kind, label, value, format, sub, color, title, loading, children, className = "" }) {
  return (
    <div className={`it-kcard ${className}`} title={title}>
      <div className="it-kcard-label">
        <span className={`it-kcard-icon is-${kind}`} aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">{ICONS[kind]}</svg>
        </span>
        <span className="min-w-0">{label}</span>
      </div>
      {loading ? <Skeleton className="mt-4 h-8 w-32" /> : (
        <div className="it-kcard-value it-num truncate" style={{ color: color || "var(--it-text)" }}>
          <AnimatedNumber value={value} format={format} />
        </div>
      )}
      {loading ? <Skeleton className="mt-2 h-3 w-24" /> : sub && <div className="it-kcard-sub it-num truncate">{sub}</div>}
      {children}
    </div>
  );
}

function Stat({ label, value, format, sub, title, loading }) {
  return (
    <div className="it-stat" title={title}>
      <div className="it-label truncate">{label}</div>
      {loading ? <Skeleton className="mt-1.5 h-5 w-20" /> : (
        <div className="it-stat-value it-num truncate"><AnimatedNumber value={value} format={format} /></div>
      )}
      {sub && <div className="it-stat-sub mt-0.5 truncate text-[12px] it-dim2">{sub}</div>}
    </div>
  );
}

// Share of reported purchase vs sale value (presentation of the same totals).
function ValueMix({ buy, sell }) {
  const total = (buy || 0) + (sell || 0);
  if (!total) return null;
  const b = Math.round((buy / total) * 1000) / 10;
  const s = Math.round((100 - b) * 10) / 10;
  return (
    <div aria-label={`Purchases ${b}% and sales ${s}% of reported value`}>
      <div className="it-mix" aria-hidden="true">
        {buy > 0 && <span className="is-buy" style={{ width: `${b}%` }} />}
        {sell > 0 && <span className="is-sell" style={{ width: `${s}%` }} />}
      </div>
      <div className="it-mix-legend it-num">
        <span><i style={{ background: "var(--it-buy-fill)" }} />Purchases {b}%</span>
        <span><i style={{ background: "var(--it-sell-fill)" }} />Sales {s}%</span>
      </div>
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
    <section className="flex flex-col gap-3" aria-label="Key figures">
      <div className="it-section-head">
        <h2 className="it-eyebrow">Summary</h2>
        <span className="min-w-0 truncate text-[12px] it-dim2">{periodLabel(filters, status)} · by filing date{filters.type !== "all" ? ` · ${filters.type === "purchase" ? "purchases" : "sales"} only` : ""}{filters.ticker ? ` · ${filters.ticker}` : ""}</span>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <HeroKpi kind="buy" label="Reported purchases" loading={loading} value={t?.purchaseValue} format={compactUsd} color="var(--it-buy)"
          sub={t ? `${count(t.purchases)} transactions` : null} title="Sum of shares × reported price for P transactions. Price anomalies and superseded filings excluded." />
        <HeroKpi kind="sell" label="Reported sales" loading={loading} value={t?.saleValue} format={compactUsd} color="var(--it-sell)"
          sub={t ? `${count(t.sales)} transactions` : null} title="Sum of shares × reported price for S transactions. Price anomalies and superseded filings excluded." />
        <HeroKpi kind="net" label="Net reported" loading={loading} value={net} format={signedCompactUsd} className="col-span-2 lg:col-span-1"
          color={net == null ? undefined : net >= 0 ? "var(--it-buy)" : "var(--it-sell)"} sub="purchases − sales"
          title="Reported purchase value minus reported sale value for the current filters.">
          {!loading && t && <ValueMix buy={t.purchaseValue} sell={t.saleValue} />}
        </HeroKpi>
      </div>
      <div className="it-panel">
        <div className="it-stats">
          <Stat label="Transactions" loading={loading} value={t?.count} format={int}
            sub={t ? `${count(t.lateFilings)} late filings` : null} title="Economic transactions (duplicate reports by related filers counted once)" />
          <Stat label="Companies · insiders" loading={!analyticsReady} value={uniques.companies} format={int}
            sub={analyticsReady ? `${count(uniques.insiders)} reporting insiders${analytics.partial ? " · partial" : ""}` : null}
            title={`Distinct issuers and primary reporting insiders for the current filters${analytics.partial ? ` — computed from the first ${count(analytics.rows.length)} of ${count(analytics.total)} transactions` : ""}.`} />
          <Stat label={newestDay ? `Form 4 filed ${day(newestDay.day).replace(/, \d{4}$/, "")}` : "Latest SEC index"} loading={loading && !status} value={newestDay?.listed ?? null} format={int}
            sub={newestDay ? `${count(newestDay.parsed)} parsed${newestDay.failed ? ` · ${newestDay.failed} failed` : ""}` : "no index yet"}
            title="Form 4 filings listed in the newest SEC daily index (all transaction codes, before P/S filtering)" />
        </div>
        {t && (t.priceAnomalies > 0 || t.supersededByAmendment > 0) && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t px-4 py-2.5 text-[12px] leading-relaxed it-dim2 sm:px-5" style={{ borderColor: "var(--it-line-soft)" }}>
            {t.priceAnomalies > 0 && <span style={{ color: "var(--it-sell)" }}>{t.priceAnomalies} price-anomaly transaction{t.priceAnomalies === 1 ? "" : "s"} ({compactUsd(t.anomalyValueExcluded)} as reported) excluded from values until verified.</span>}
            {t.supersededByAmendment > 0 && <span>{t.supersededByAmendment} superseded by Form 4/A excluded (the amendment is counted).</span>}
            {t.confirmedGroups > 0 && <span>{t.confirmedGroups} duplicate reports grouped · {t.needsReview} flagged for review{t.valueMissing ? ` · ${t.valueMissing} without price` : ""}</span>}
          </div>
        )}
      </div>
    </section>
  );
}

export default memo(KpiStrip);
