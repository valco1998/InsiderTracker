// Lazy entry points: ECharts and the chart components load in one separate
// chunk the first time a chart is rendered.
import { Component, lazy, Suspense } from "react";
import { EmptyState, Skeleton } from "../components/Common";

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

// Chart-level error boundary: one failing chart (render/setOption error or a
// failed lazy-chunk load) is replaced by a panel instead of unmounting the
// whole dashboard. Retry remounts the chart with a fresh ECharts instance.
export class ChartErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.retry = () => this.setState({ error: null });
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error(`[CHART_ERROR] chart="${this.props.title}" phase=render message=${error?.message}`);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section className="it-panel" role="alert" data-chart-error={this.props.title}>
        <div className="flex flex-col items-center justify-center" style={{ minHeight: this.props.height }}>
          <EmptyState title="Chart unavailable">
            The {this.props.title} chart could not be displayed. The rest of the dashboard is unaffected.
          </EmptyState>
          <button type="button" className="it-btn mb-6" onClick={this.retry}>Retry</button>
        </div>
      </section>
    );
  }
}

// `loading` → skeleton until the analytics dataset has rows (avoids an empty-state flash).
function wrap(C, title, defaultHeight) {
  return function LazyChart({ loading, ...props }) {
    const h = props.height || defaultHeight;
    if (loading) return <ChartSkeleton height={h} title={title} />;
    return (
      <ChartErrorBoundary title={title} height={h}>
        <Suspense fallback={<ChartSkeleton height={h} title={title} />}><C {...props} /></Suspense>
      </ChartErrorBoundary>
    );
  };
}

export const BuySellChart = wrap(LBuySell, "buying vs selling", 280);
export const BuyingTrendChart = wrap(LTrend, "buying trend", 240);
export const TopCompaniesChart = wrap(LTop, "top companies", 300);
export const ActivityTimeline = wrap(LTimeline, "activity timeline", 300);
export { ClusterBuyingUnavailable } from "./ClusterNote.jsx";
