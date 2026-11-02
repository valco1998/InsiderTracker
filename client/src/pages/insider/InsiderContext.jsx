// Shared state for every /insider view: filters, the main paginated feed (the
// only thing that polls), the account, and the analytics dataset for charts.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import useInsiderAccount from "../../hooks/useInsiderAccount";
import useInsiderFeed from "../../hooks/useInsiderFeed";
import useInsiderAnalytics from "../../hooks/useInsiderAnalytics";
import { useLiveStream } from "../../hooks/useInsiderStream";

const Ctx = createContext(null);

export const DEFAULT_FILTERS = { type: "all", ticker: "", from: "", to: "", openMarketOnly: false };

export function InsiderProvider({ children }) {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [tickerInput, setTickerInput] = useState("");
  const [accountOpen, setAccountOpen] = useState(false);
  const account = useInsiderAccount();

  // Debounce ticker typing.
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.ticker === tickerInput ? f : { ...f, ticker: tickerInput })), 350);
    return () => clearTimeout(t);
  }, [tickerInput]);

  const setFilter = useCallback((patch) => {
    if ("ticker" in patch) setTickerInput(patch.ticker);
    setFilters((f) => ({ ...f, ...patch }));
  }, []);
  const clearFilters = useCallback(() => { setTickerInput(""); setFilters(DEFAULT_FILTERS); }, []);

  // Exactly the parameters the original dashboard sent.
  const feedParams = useMemo(() => {
    const p = { type: filters.type, view: "compact" };
    if (filters.ticker) p.ticker = filters.ticker;
    if (filters.from) p.from = filters.from;
    if (filters.to) p.to = filters.to;
    if (filters.openMarketOnly) p.venue = "open_market";
    return p;
  }, [filters]);

  // Charts always show purchases AND sales, so `type` is not sent.
  const analyticsParams = useMemo(() => {
    const p = {};
    if (filters.ticker) p.ticker = filters.ticker;
    if (filters.from) p.from = filters.from;
    if (filters.to) p.to = filters.to;
    if (filters.openMarketOnly) p.venue = "open_market";
    return p;
  }, [filters]);

  // Phase D3: one SSE connection for all views (stable object — no context re-renders).
  const live = useLiveStream();
  const feed = useInsiderFeed(feedParams, { live });
  // Published snapshot version the data reflects (falls back to the ingest version).
  const dataVersion = feed.version ?? feed.status?.dataVersion ?? null;
  const analytics = useInsiderAnalytics(analyticsParams, dataVersion);

  const unfiltered = filters.type === "all" && !filters.ticker && !filters.from && !filters.to && !filters.openMarketOnly;
  // Newest SEC acceptance time — only knowable from the unfiltered newest-first feed.
  const [latestFiling, setLatestFiling] = useState(null);
  useEffect(() => {
    if (unfiltered && feed.rows[0]?.acceptedAtET) setLatestFiling(feed.rows[0].acceptedAtET);
  }, [unfiltered, feed.rows]);

  const value = useMemo(() => ({
    filters, setFilter, clearFilters, tickerInput, setTickerInput, unfiltered,
    feedParams, feed, analytics, dataVersion, latestFiling, live,
    account, accountOpen, setAccountOpen,
  }), [filters, setFilter, clearFilters, tickerInput, unfiltered, feedParams, feed, analytics, dataVersion, latestFiling, live, account, accountOpen]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useInsider() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useInsider must be used inside <InsiderProvider>");
  return v;
}
