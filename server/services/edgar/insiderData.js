// server/services/edgar/insiderData.js
// Single source for economic transactions: price-checked, amendment-linked,
// filing delay classified, then de-duplicated — computed once per ingest data
// version (see insiderSnapshot.js). Used by the dashboard API and the alert
// engine so both see the same data.
import { getTransactions, getAmendmentFilings, getIngestDataVersion, onIngestBatch, markIngestPublished, getIngestStatus } from "./insiderIngest.js";
import { checkRows, createSnapshotStore } from "./insiderSnapshot.js";
import { createSnapshotStream, describeSnapshot, secFreshness } from "./insiderStream.js";

export { checkRows };

// D3: public SSE notifications of published snapshot versions (GET /api/insider/stream).
export const snapshotStream = createSnapshotStream({
  getCurrent: () => { const s = store.get(); return describeSnapshot(s, s.builtAt); },
  getSecStatus: () => secFreshness(getIngestStatus()),
});

const store = createSnapshotStore({
  source: { getTransactions, getAmendmentFilings, getDataVersion: getIngestDataVersion },
  onBuild: (version, atMs, snap) => {
    // D0: stamps publishedAt on every filing this build made visible.
    markIngestPublished(version, atMs);
    // D3: one small event per new version, shared by all stream clients.
    snapshotStream.publish(describeSnapshot(snap, atMs));
  },
});
// Rebuild right after each ingest batch so requests rarely pay for it.
onIngestBatch(() => { store.get({ fresh: true }); });

// Request path: may be up to minRebuildMs stale while a large backlog is loading.
export const getSnapshot = () => store.get();
export const getSnapshotStats = () => store.stats();

export function getCheckedRows() {
  return store.get({ fresh: true }).raw;
}

// Alert engine: always the current data version.
export function getEconomicTransactions() {
  return store.get({ fresh: true }).economic;
}
