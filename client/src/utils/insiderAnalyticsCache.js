// Insider Tracker — refetch policy for the analytics dataset (pure; no React).
//
// The analytics hook pages the whole filtered dataset (up to 5,000 rows), so a
// refetch on every snapshot version would be expensive while the backlog loads.
// It is therefore throttled per query — EXCEPT when what is cached is empty.
//
// Regression (2026-11-02): after a server restart the API briefly serves and
// publishes an EMPTY snapshot (version 0, before the filing cache is loaded).
// The empty result was cached, and when the real version arrived seconds later
// the throttle (timed from that empty fetch) kept 0 rows on screen for up to
// MIN_REFETCH_MS — KPI "Companies · insiders" 0 / 0 and "No data" charts while
// the transaction table had already recovered. An empty dataset has nothing to
// protect, so it is never throttled.

export const MIN_REFETCH_MS = 30_000;

// → null: cached data is current, no fetch
// → 0:    fetch now
// → ms:   fetch after this delay (throttled)
export function refetchDelay(cached, dataVersion, now = Date.now(), minMs = MIN_REFETCH_MS) {
  if (!cached) return 0;
  if (cached.version === dataVersion) return null;
  if (!cached.rows || cached.rows.length === 0) return 0; // nothing to protect: recover immediately
  return Math.max(0, cached.fetchedAt + minMs - now);
}
