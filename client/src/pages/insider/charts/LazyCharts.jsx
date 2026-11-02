// Lazy entry points: ECharts and the chart components load in one separate
// chunk the first time a chart is rendered.
import { lazy, Suspense } from "react";
import { Skeleton } from "../components/Common";

const load = () => import("./InsiderCharts.jsx");
const pick = (name) => lazy(() => load().then((m) => ({ default: m[name] })));

const LBuySell = pick("BuySellChart");
const LTrend = pick("BuyingTrendChart");
const LTop = pick("TopCompaniesChart");
const LTimeline = pick("ActivityTimeline");

export function ChartSkeleton({ height = 280, title }) {
  return (
    <section className="it-panel" aria-busy="true" aria-label={title ? `Loading ${title}` : "Loading chart"}>
      <div className="it-panel-head"><Skeleton className="h-3 w-40" /><Skeleton className="h-6 w-28" /></div>
      <div className="flex items-end gap-2 px-4 pb-4 pt-3" style={{ height }}>
        {[38, 62, 45, 80, 55, 70, 30, 66].map((h, i) => <Skeleton key={i} className="flex-1" style={{ height: `${h}%` }} />)}
      </div>
    </section>
  );
}

// `loading` → skeleton until the analytics dataset has rows (avoids an empty-state flash).
function wrap(C, title, defaultHeight) {
  return function LazyChart({ loading, ...props }) {
    const h = props.height || defaultHeight;
    if (loading) return <ChartSkeleton height={h} title={title} />;
    return <Suspense fallback={<ChartSkeleton height={h} title={title} />}><C {...props} /></Suspense>;
  };
}

export const BuySellChart = wrap(LBuySell, "buying vs selling", 280);
export const BuyingTrendChart = wrap(LTrend, "buying trend", 240);
export const TopCompaniesChart = wrap(LTop, "top companies", 300);
export const ActivityTimeline = wrap(LTimeline, "activity timeline", 300);
export { ClusterBuyingUnavailable } from "./ClusterNote.jsx";
