// Top companies as a ranked list (Overview). Same data as the Analytics chart:
// utils/insiderAggregate.topCompanies over the analytics rows (anomalies and
// superseded filings excluded). Row → cross-filter by ticker; arrow → company page.
import { memo, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { topCompanies } from "../../../utils/insiderAggregate";
import { compactUsd, count } from "../../../utils/insiderFormat";
import { EmptyState, Skeleton } from "./Common";

const monogram = (c) => (c.ticker || c.name || "?").replace(/[^A-Za-z0-9]/g, "").slice(0, 4).toUpperCase();

function TopCompaniesList({ rows, loading, onPick, n = 8 }) {
  const [side, setSide] = useState("P");
  const top = useMemo(() => topCompanies(rows, side, n), [rows, side, n]);
  const field = side === "P" ? "buyValue" : "sellValue";
  const max = top[0]?.[field] || 1;
  const fill = side === "P" ? "var(--it-buy-fill)" : "var(--it-sell-fill)";

  return (
    <section className="it-panel flex h-full min-w-0 flex-col" aria-label="Top companies">
      <header className="it-panel-head flex-wrap">
        <div className="min-w-0">
          <h2 className="it-panel-title">Top companies</h2>
          <div className="text-[12px] it-dim2">By reported {side === "P" ? "purchase" : "sale"} value · anomalies &amp; superseded excluded</div>
        </div>
        <div className="it-seg" role="group" aria-label="Side">
          {[{ k: "P", l: "Purchases" }, { k: "S", l: "Sales" }].map((o) => (
            <button key={o.k} aria-pressed={side === o.k} onClick={() => setSide(o.k)}>{o.l}</button>
          ))}
        </div>
      </header>

      {loading ? (
        <ul className="it-rank" aria-busy="true" aria-label="Loading top companies">
          {Array.from({ length: n }, (_, i) => (
            <li key={i} className="flex items-center gap-3 px-2 py-3"><Skeleton className="h-3 w-4" /><Skeleton className="h-8 w-8" /><div className="flex flex-1 flex-col gap-2"><Skeleton className="h-3 w-2/3" /><Skeleton className="h-1.5 w-full" /></div></li>
          ))}
        </ul>
      ) : !top.length ? (
        <EmptyState title="No data for these filters">No reported {side === "P" ? "purchases" : "sales"} with a value for the current filters.</EmptyState>
      ) : (
        <ol className="it-rank">
          {top.map((c, i) => {
            const v = c[field];
            const txs = side === "P" ? c.buyCount : c.sellCount;
            return (
              <li key={c.key} className="it-rank-row">
                <button className="it-rank-main" onClick={() => c.ticker && onPick?.(c.ticker)} disabled={!c.ticker}
                  title={c.ticker ? `Filter by ${c.ticker}` : c.name}>
                  <span className="it-rank-n">{i + 1}</span>
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span className="it-mono-badge" aria-hidden="true">{monogram(c)}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13.5px] font-semibold" style={{ color: "var(--it-text)" }}>{c.ticker || "—"}</span>
                      <span className="block truncate text-[12px] it-dim2">{c.name}</span>
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block it-num text-[14px] font-semibold" style={{ color: "var(--it-text)" }}>{compactUsd(v)}</span>
                    <span className="block it-num text-[11.5px] it-dim2">{count(txs)} tx · {count(c.insiders)} insider{c.insiders === 1 ? "" : "s"}</span>
                  </span>
                  <span className="it-rank-bar" aria-hidden="true"><span style={{ width: `${Math.max(2, (v / max) * 100)}%`, background: fill }} /></span>
                </button>
                {c.ticker && (
                  <Link to={`/insider/company/${encodeURIComponent(c.ticker)}`} className="it-rank-go" aria-label={`Open ${c.ticker} company page`} title={`Open ${c.ticker}`}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export default memo(TopCompaniesList);
