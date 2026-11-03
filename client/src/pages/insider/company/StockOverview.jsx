// Stock overview for the company page — TradingView's official, free embeddable
// widgets (quote, advanced chart with volume, fundamentals).
//
// Data source & limits (stated in the UI, never hidden):
//   • Prices, volume, market cap, P/E and EPS are TradingView's data inside
//     TradingView-hosted widgets; this app neither receives nor stores them.
//   • Stock data in the widgets is DELAYED (exchange licensing). Some symbols /
//     exchanges are not available in widgets.
//   • TradingView widgets cannot plot external data, so insider markers on the
//     price chart need a licensed market-data provider on our server (none is
//     configured — see server/services/stockData/stockDataProvider.js). Insider
//     buys/sells by trade date are charted from SEC data on this page instead.
//   • The TradingView attribution link is part of the embed and is kept.
// Nothing is scraped and no undocumented API is used.
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "../theme";

const TV_SCRIPT = (name) => `https://s3.tradingview.com/external-embedding/embed-widget-${name}.js`;

// Range buttons → advanced-chart range + bar interval.
const RANGES = [
  { key: "1D", range: "1D", interval: "5" },
  { key: "1W", range: "5D", interval: "30" },
  { key: "1M", range: "1M", interval: "60" },
  { key: "3M", range: "3M", interval: "D" },
  { key: "1Y", range: "12M", interval: "D" },
  { key: "5Y", range: "60M", interval: "W" },
];
// S&P 500 comparison via the SPY ETF (tracks the S&P 500; index symbols can be restricted in widgets).
const SP500 = { symbol: "AMEX:SPY", label: "S&P 500 (SPY)" };

// Injects one TradingView embed script into its own container; recreated only
// when the serialized config changes (no re-injection on unrelated re-renders).
const TradingViewEmbed = memo(function TradingViewEmbed({ widget, config, height, title }) {
  const ref = useRef(null);
  const json = JSON.stringify(config);
  useEffect(() => {
    const host = ref.current;
    if (!host) return undefined;
    host.innerHTML = "";
    const inner = document.createElement("div");
    inner.className = "tradingview-widget-container__widget";
    inner.style.height = "100%";
    inner.style.width = "100%";
    const script = document.createElement("script");
    script.type = "text/javascript";
    script.src = TV_SCRIPT(widget);
    script.async = true;
    script.innerHTML = json;
    host.appendChild(inner);
    host.appendChild(script);
    return () => { host.innerHTML = ""; };
  }, [widget, json]);
  return <div ref={ref} className="tradingview-widget-container" style={{ height, width: "100%" }} aria-label={title} />;
});

function Attribution({ symbol }) {
  const [ex, tk] = symbol.split(":");
  return (
    <div className="tradingview-widget-copyright flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-[11px] it-dim2" style={{ borderTop: "1px solid var(--it-line-soft)" }}>
      <span>
        Market data and charts by{" "}
        <a className="it-link" href={`https://www.tradingview.com/symbols/${ex}-${tk.replace(/\./g, "_")}/`} rel="noopener nofollow" target="_blank">TradingView</a>
        {" "}· <strong style={{ color: "var(--it-warn)" }}>delayed</strong> for stocks · not SEC data
      </span>
      <span>Insider markers on the price chart need a licensed market-data provider (not configured).</span>
    </div>
  );
}

export default function StockOverview({ insights, loading }) {
  const tv = insights?.tradingView;
  const [range, setRange] = useState("1Y");
  const [compare, setCompare] = useState(false);
  const r = RANGES.find((x) => x.key === range) || RANGES[4];
  const [theme] = useTheme(); // TradingView widgets follow the app theme

  const chartConfig = useMemo(() => (tv?.symbol ? {
    autosize: true, symbol: tv.symbol, interval: r.interval, range: r.range, timezone: "America/New_York",
    theme, style: "1", locale: "en", backgroundColor: theme === "dark" ? "rgba(17,24,39,1)" : "rgba(255,255,255,1)", gridColor: theme === "dark" ? "rgba(148,163,184,0.07)" : "rgba(15,23,42,0.05)",
    hide_top_toolbar: false, hide_side_toolbar: true, hide_legend: false, allow_symbol_change: false,
    save_image: false, calendar: false, withdateranges: false, support_host: "https://www.tradingview.com",
    ...(compare ? { compareSymbols: [{ symbol: SP500.symbol, position: "SameScale" }] } : {}),
  } : null), [tv?.symbol, r.interval, r.range, compare, theme]);

  const infoConfig = useMemo(() => (tv?.symbol ? { symbol: tv.symbol, width: "100%", locale: "en", colorTheme: theme, isTransparent: true } : null), [tv?.symbol, theme]);
  const fundConfig = useMemo(() => (tv?.symbol ? { isTransparent: true, largeChartUrl: "", displayMode: "compact", width: "100%", height: "100%", colorTheme: theme, symbol: tv.symbol, locale: "en" } : null), [tv?.symbol, theme]);

  if (loading && !insights) {
    return <section className="it-panel"><div className="it-skel m-4" style={{ height: 360 }} aria-hidden="true" /></section>;
  }
  if (!tv?.supported) {
    return (
      <section className="it-panel" aria-label="Stock overview">
        <header className="it-panel-head"><h2 className="it-panel-title">Stock overview</h2><span className="it-chip">No chart</span></header>
        <div className="px-4 py-4 text-[12.5px] leading-relaxed it-dim">
          A price chart is not available for this security: {tv?.reason || "no listed ticker found"}.
          Insider data below comes directly from SEC Form 4 filings and is unaffected.
        </div>
      </section>
    );
  }

  return (
    <section className="it-panel overflow-hidden" aria-label={`Stock overview ${tv.symbol}`}>
      <TradingViewEmbed widget="symbol-info" config={infoConfig} height={170} title={`${tv.symbol} delayed quote`} />
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2" style={{ borderTop: "1px solid var(--it-line-soft)" }}>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Chart range">
          {RANGES.map((x) => (
            <button key={x.key} className={`it-chip${x.key === range ? " active" : ""}`} aria-pressed={x.key === range} onClick={() => setRange(x.key)}
              style={x.key === range ? { color: "var(--it-text)", borderColor: "var(--it-accent)", background: "var(--it-accent-soft)" } : undefined}>
              {x.key}
            </button>
          ))}
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-[12px] it-dim">
          <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
          Compare with {SP500.label}
        </label>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div style={{ height: 460 }} className="min-w-0">
          <TradingViewEmbed widget="advanced-chart" config={chartConfig} height="100%" title={`${tv.symbol} price and volume chart (delayed)`} />
        </div>
        <div className="min-w-0 border-t xl:border-l xl:border-t-0" style={{ height: 460, borderColor: "var(--it-line-soft)" }}>
          <TradingViewEmbed widget="financials" config={fundConfig} height="100%" title={`${tv.symbol} fundamentals: market cap, P/E, EPS`} />
        </div>
      </div>
      <Attribution symbol={tv.symbol} />
    </section>
  );
}
