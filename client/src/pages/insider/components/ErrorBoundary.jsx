import { Component } from "react";
import { currentTheme, fallbackPalette, shouldResetOnKeyChange } from "../../../utils/insiderUiFallback.js";

/**
 * Page/app-level error boundary for the InsiderTracker UI.
 * (Charts have their own ChartErrorBoundary in charts/LazyCharts.jsx — do not wrap charts here.)
 *
 * Props:
 *  - resetKey  any value; when it changes the error is cleared (e.g. location.pathname)
 *  - fallback  optional node, or render fn ({ reset }) => node
 *  - onError   optional (error, info) => void
 *
 * Users never see error messages or stack traces; details go to console only.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
    this.reset = this.reset.bind(this);
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    const where = typeof window !== "undefined" ? window.location?.pathname : "";
    console.error(`[INSIDER_UI_ERROR] path=${where} name=${error?.name || "Error"}`, error, info?.componentStack);
    try { this.props.onError?.(error, info); } catch { /* never let reporting re-throw */ }
  }

  componentDidUpdate(prevProps) {
    if (shouldResetOnKeyChange(this.state.hasError, prevProps.resetKey, this.props.resetKey)) {
      this.reset();
    }
  }

  reset() {
    this.setState({ hasError: false });
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    const { fallback } = this.props;
    if (typeof fallback === "function") return fallback({ reset: this.reset });
    if (fallback !== undefined) return fallback;

    // Tokens resolve inside .it-root; literal fallbacks cover the case where this
    // renders outside it (top-level boundary) or before insider.css has loaded.
    const p = fallbackPalette(currentTheme());
    const btn = {
      height: 32, padding: "0 12px", borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: "pointer",
      color: `var(--it-text, ${p.text})`, background: `var(--it-panel, ${p.panel})`,
      border: `1px solid var(--it-line, ${p.line})`,
    };
    return (
      <div role="alert" className="it-panel"
        style={{
          margin: 16, padding: "16px 18px", display: "flex", flexWrap: "wrap", alignItems: "center",
          justifyContent: "space-between", gap: 12, borderRadius: 12, fontSize: 13.5,
          color: `var(--it-text, ${p.text})`, background: `var(--it-panel, ${p.panel})`,
          border: `1px solid var(--it-sell-line, ${p.sellLine})`,
        }}>
        <span>
          <strong style={{ color: `var(--it-sell, ${p.sell})`, fontWeight: 600 }}>Something went wrong.</strong>{" "}
          <span style={{ color: `var(--it-text-2, ${p.text2})` }}>This section failed to load.</span>
        </span>
        <span style={{ display: "flex", gap: 8 }}>
          <button type="button" className="it-btn" style={btn} onClick={this.reset}>Try again</button>
          <button type="button" className="it-btn" style={btn} onClick={() => window.location.reload()}>Reload page</button>
        </span>
      </div>
    );
  }
}
