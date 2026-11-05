// Insider Tracker — fetch policy for the Companies screener (pure; no React).
//
// Regression (2026-11-05): on a cold load the first /insider/companies request
// starts while the feed's dataVersion is still null. The version then arrives
// mid-flight, the effect re-ran, the in-flight response was discarded (run-id
// mismatch) and the replacement was throttled by MIN_REFETCH_MS — ~10 s of
// skeleton. Rules now:
//   • only a KEY change makes a response obsolete (a version change does not);
//   • a request already in flight for this key is awaited, not duplicated;
//   • nothing on screen for this key → never throttled;
//   • retry → immediate fetch.

export const MIN_REFETCH_MS = 10_000;

// key:        current query key ("" = no query)
// dataVersion: snapshot version announced by the feed (null = unknown yet)
// shown:      { key, version } of the data currently on screen (version = response snapshotVersion)
// last:       { key, at } of the last request started
// inFlightKey: key of the request currently in flight (null = none)
// force:      retry requested
// → { action: "none" | "settle" | "await" | "fetch", delay }
export function screenerPlan({ key, dataVersion, shown, last, inFlightKey, force = false, now = Date.now(), minMs = MIN_REFETCH_MS }) {
  if (!key) return { action: "none", delay: 0 };
  if (force) return { action: "fetch", delay: 0 };
  if (inFlightKey === key) return { action: "await", delay: 0 };
  const showing = !!shown && shown.key === key;
  if (showing && dataVersion != null && shown.version === dataVersion) return { action: "settle", delay: 0 };
  if (!showing) return { action: "fetch", delay: 0 };
  const delay = last && last.key === key ? Math.max(0, last.at + minMs - now) : 0;
  return { action: "fetch", delay };
}

// A response is applied only if its query is still the current one and no newer
// request for it has already been applied.
export function acceptResponse({ respKey, currentKey, seq, appliedSeq }) {
  return respKey === currentKey && seq > appliedSeq;
}
