import { useCallback, useEffect, useRef, useState } from "react";
import api from "../lib/api";
import { extractMarketItems, normalizeItem } from "../lib/marketItem";

// Server cache TTL is 60s — polling faster wastes bandwidth without fresher data
const REFRESH_MS = 30_000;
// While timed out with no deals yet (e.g. Render cold start), retry sooner
const FAST_RETRY_MS = 6_000;
// Stop skeleton after this many ms and show fallback; fetch still runs in bg
const CLIENT_TIMEOUT_MS = 2_500;

export default function useHomePremium({
  limit = 300,
  minPrice = 30,
  maxPrice = 10_000,
  minDiscountPct = 10,
} = {}) {
  const [items,      setItems]      = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState(null);
  const [timedOut,   setTimedOut]   = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  const paramsRef = useRef({ limit, minPrice, maxPrice, minDiscountPct });
  paramsRef.current = { limit, minPrice, maxPrice, minDiscountPct };

  // Refs so the poll loop can read latest state without re-running the effect
  const timedOutRef = useRef(false);
  const hasItemsRef = useRef(false);
  useEffect(() => { timedOutRef.current = timedOut; }, [timedOut]);
  useEffect(() => { hasItemsRef.current = items.length > 0; }, [items]);

  const retry = useCallback(() => {
    setTimedOut(false);
    setError(null);
    setRetryCount(c => c + 1);
  }, []);

  useEffect(() => {
    let mounted = true;
    const ctrl = new AbortController();
    let fetchDone = false;

    setLoading(true);
    setTimedOut(false);
    setError(null);

    // After CLIENT_TIMEOUT_MS stop showing the skeleton — fetch still runs in bg
    const timeoutId = setTimeout(() => {
      if (mounted && !fetchDone) {
        setLoading(false);
        setTimedOut(true);
      }
    }, CLIENT_TIMEOUT_MS);

    async function doFetch(isRefresh = false) {
      try {
        if (!isRefresh) setLoading(true);

        // No cache-busting param: /items/home-premium now carries a short
        // private Cache-Control + ETag (see server/routers/items.Routers.js),
        // so identical repeat requests within the cache window are served
        // from the browser cache instead of hitting Render at all.
        const res = await api.get("/items/home-premium", {
          params: paramsRef.current,
          signal: ctrl.signal,
          timeout: 15_000,
        });

        const normalized = extractMarketItems(res?.data)
          .map(normalizeItem)
          .filter(item => {
            if (!item) return false;
            const price    = Number(item.priceCoins || 0);
            const discount = Number(item.discountPct || item.underPct || 0);
            return price > 0 && discount > 0 && (item.name || item.image);
          })
          .sort((a, b) => {
            const da = Number(a.discountPct || a.underPct || 0);
            const db = Number(b.discountPct || b.underPct || 0);
            if (db !== da) return db - da;
            return Number(b.priceCoins || 0) - Number(a.priceCoins || 0);
          });

        if (mounted) {
          setItems(normalized);
          // If deals arrived after a timeout, clear the fallback state
          if (normalized.length > 0) setTimedOut(false);
        }
      } catch (e) {
        if (e?.name === "CanceledError" || e?.name === "AbortError" || e?.code === "ERR_CANCELED") return;
        if (mounted) {
          setError(e?.response?.data?.message || e?.response?.data?.error || e?.message || "Failed to load deals");
          if (!isRefresh) setItems([]);
        }
      } finally {
        if (mounted && !ctrl.signal.aborted) {
          fetchDone = true;
          clearTimeout(timeoutId);
          setLoading(false);
        }
      }
    }

    let pollTimer;
    function scheduleNextPoll() {
      // Cold-start recovery: poll faster while timed out with nothing to show yet
      const delay = (timedOutRef.current && !hasItemsRef.current) ? FAST_RETRY_MS : REFRESH_MS;
      pollTimer = setTimeout(async () => {
        if (!mounted) return;
        // Skip while backgrounded — nothing is watching. onVisible() below
        // fetches immediately when the tab regains focus.
        if (document.visibilityState === "visible") await doFetch(true);
        if (mounted) scheduleNextPoll();
      }, delay);
    }

    function onVisible() {
      if (mounted && document.visibilityState === "visible") doFetch(true);
    }
    document.addEventListener("visibilitychange", onVisible);

    doFetch(false).then(() => { if (mounted) scheduleNextPoll(); });

    return () => {
      mounted = false;
      fetchDone = true;
      clearTimeout(timeoutId);
      clearTimeout(pollTimer);
      document.removeEventListener("visibilitychange", onVisible);
      ctrl.abort();
    };
  }, [retryCount]);

  return { items, loading, error, timedOut, retry };
}
