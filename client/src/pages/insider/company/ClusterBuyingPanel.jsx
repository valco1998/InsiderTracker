// Cluster buying for one company — a FACTUAL pattern, not a recommendation:
// at least `threshold` distinct insiders (SEC CIK; joint filers count once)
// reported Form 4 code-P purchases whose trade dates fall within a rolling
// 30-calendar-day window. Overlapping qualifying windows are shown as one
// cluster. Detected only within the SEC data loaded on the server.
import { memo } from "react";
import { compactUsd, count, day } from "../../../utils/insiderFormat";
import { Skeleton } from "../components/Common";

const THRESHOLDS = [2, 3, 4, 5];

function ClusterBuyingPanel({ insights, loading, threshold, onThreshold }) {
  const c = insights?.clusters;
  return (
    <section className="it-panel flex min-w-0 flex-col" aria-label="Cluster buying">
      <header className="it-panel-head flex-wrap gap-2">
        <div className="min-w-0">
          <h2 className="it-panel-title">Cluster buying</h2>
          <div className="text-[11px] it-dim2">≥ {threshold} distinct insiders buying within 30 days (trade dates)</div>
        </div>
        <label className="flex items-center gap-2 text-[12px] it-dim">
          Min. buyers
          <select className="it-input" style={{ height: 28, width: 64 }} value={threshold} onChange={(e) => onThreshold(Number(e.target.value))}>
            {THRESHOLDS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
      </header>
      {loading && !c ? <div className="p-4"><Skeleton className="h-16" /></div> : c && (
        <div className="flex flex-col">
          {c.list.length === 0 ? (
            <div className="px-4 py-6 text-center text-[12px] it-dim2">
              No cluster: fewer than {threshold} distinct insiders bought within any 30-day window
              {c.dataFrom ? ` in the loaded data (trade dates ${day(c.dataFrom)} – ${day(c.dataTo)})` : ""}.
            </div>
          ) : (
            <ul>
              {c.list.map((k) => (
                <li key={`${k.from}-${k.to}`} className="px-4 py-3" style={{ borderBottom: "1px solid var(--it-line-soft)" }}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="it-num text-[13px] font-semibold" style={{ color: "var(--it-text)" }}>{day(k.from)} – {day(k.to)}</span>
                      {k.active && <span className="it-chip" style={{ color: "var(--it-buy)" }} title="The cluster's latest purchase is within the last 30 days">Within last 30 days</span>}
                      {k.spanDays > c.windowDays && <span className="it-chip" title={`Overlapping 30-day windows merged; at most ${k.peakBuyers} distinct buyers inside any single window`}>{k.spanDays}-day span</span>}
                    </div>
                    <span className="it-num it-buy font-semibold">{k.value ? compactUsd(k.value) : "—"}</span>
                  </div>
                  <div className="mt-1 text-[12px] it-dim">
                    <span className="it-num">{count(k.distinctBuyers)}</span> distinct buyers · <span className="it-num">{count(k.transactions)}</span> purchases
                    {k.valueMissing ? ` · ${k.valueMissing} without price` : ""}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {k.roles.map((r) => <span key={r.role} className="it-chip">{r.role} · {r.buyers}</span>)}
                  </div>
                  <ul className="mt-2 flex flex-col gap-0.5 text-[11.5px]">
                    {k.buyers.map((b) => (
                      <li key={b.name + b.roles.join()} className="flex flex-wrap justify-between gap-2">
                        <span style={{ color: "var(--it-text-2)" }}>{b.name} <span className="it-dim2">· {b.roles.join(" · ")}</span></span>
                        <span className="whitespace-nowrap">
                          {b.filings.slice(0, 2).map((f, i) => f.url && <a key={f.accessionNo} className="it-link" href={f.url} target="_blank" rel="noopener noreferrer">{i ? " · " : ""}Form 4 {day(f.filingDate)} ↗</a>)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
          <div className="px-4 py-2 text-[11px] it-dim2">
            {c.note}{insights.coverage && !insights.coverage.complete ? ` Detected only within loaded SEC data${c.dataFrom ? ` (trade dates ${day(c.dataFrom)} – ${day(c.dataTo)})` : ""}.` : ""}
          </div>
        </div>
      )}
    </section>
  );
}

export default memo(ClusterBuyingPanel);
