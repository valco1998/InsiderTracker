// Insider Tracker — Companies screener (GET /api/insider/companies).
// One request per query; refetched when the published snapshot version changes
// (live updates via the shared SSE/feed dataVersion), at most once per
// MIN_REFETCH_MS for the same query. Previous data stays on screen while refreshing.
// Fetch policy (and the cold-load regression it fixes): utils/insiderScreenerFetch.js.
import { useCallback, useEffect, useRef, useState } from "react";
import api from "../lib/api";
import { acceptResponse, screenerPlan } from "../utils/insiderScreenerFetch";

export default function useCompanyScreener(params, dataVersion = null) {
  const key = params ? JSON.stringify(params) : "";
  const [state, setState] = useState({ key: "", data: null, loading: !!params, error: null });
  const [nonce, setNonce] = useState(0);        // bumped to re-evaluate (retry / version moved mid-flight)
  const keyRef = useRef(key);
  keyRef.current = key;
  const versionRef = useRef(dataVersion);
  versionRef.current = dataVersion;
  const seq = useRef(0);
  const appliedSeq = useRef(0);
  const inFlight = useRef(null);                // { key, seq }
  const shown = useRef(null);                   // { key, version } of the data on screen
  const last = useRef({ key: "", at: 0 });      // last request started
  const force = useRef(false);

  useEffect(() => {
    const plan = screenerPlan({
      key, dataVersion, shown: shown.current, last: last.current,
      inFlightKey: inFlight.current?.key ?? null, force: force.current,
    });
    force.current = false;
    if (plan.action === "none") return undefined;
    if (plan.action === "settle") {
      setState((s) => (s.loading || s.key !== key ? { ...s, key, loading: false } : s));
      return undefined;
    }
    // Keep the previous result visible (also across query changes) to avoid flashing.
    setState((s) => ({ ...s, key, loading: true, error: null }));
    if (plan.action === "await") return undefined; // the running request for this key will be applied

    const timer = setTimeout(async () => {
      const id = ++seq.current;
      const startVersion = versionRef.current;
      inFlight.current = { key, seq: id };
      last.current = { key, at: Date.now() };
      let data = null, error = null;
      try {
        ({ data } = await api.get("/insider/companies", { params: JSON.parse(key) }));
      } catch (err) {
        error = err.response?.data?.error || "Could not load the companies screen.";
      }
      if (inFlight.current?.seq === id) inFlight.current = null;
      if (!acceptResponse({ respKey: key, currentKey: keyRef.current, seq: id, appliedSeq: appliedSeq.current })) return;
      appliedSeq.current = id;
      if (error) {
        setState((s) => ({ ...s, key, loading: false, error }));
        return;
      }
      const version = data.snapshotVersion ?? null;
      shown.current = { key, version };
      setState({ key, data, loading: false, error: null });
      // A newer version was announced while this request ran and the response predates it:
      // re-evaluate once (throttled by the policy, since data is now on screen).
      if (versionRef.current !== startVersion && versionRef.current != null && version !== versionRef.current) setNonce((n) => n + 1);
    }, plan.delay);
    return () => clearTimeout(timer);
  }, [key, dataVersion, nonce]);

  // Immediate refetch of the current query (error-state Retry button).
  const retry = useCallback(() => { force.current = true; setNonce((n) => n + 1); }, []);

  return { ...state, retry };
}
