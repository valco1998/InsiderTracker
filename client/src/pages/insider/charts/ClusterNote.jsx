// Cluster buying — intentionally disabled (documented). No ECharts dependency.
export function ClusterBuyingUnavailable() {
  return (
    <section className="it-panel">
      <header className="it-panel-head"><h2 className="it-panel-title">Cluster buying</h2><span className="it-chip">Unavailable</span></header>
      <div className="px-4 py-4 text-[12px] leading-relaxed it-dim2">
        Not shown. A trustworthy cluster signal needs several distinct insiders buying the same issuer within a defined window, and
        the current data covers only the last few SEC daily indexes with related-filer grouping still flagged for review in some cases.
        It will be enabled once the backend provides a cluster aggregate with a documented window.
      </div>
    </section>
  );
}
