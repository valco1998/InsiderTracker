// Insider Tracker — pure helpers for Phase D3 live updates (no React).
//
// Why refreshes re-fetch the loaded window instead of merging only the first
// page: a new snapshot can change rows that are already loaded further down —
// an older row becomes "superseded by 4/A", or a related filer's report regroups
// an older separate row into a new economic transaction (its row id vanishes).
// Keeping old rows below a fresh head would then show stale labels or count a
// trade twice. reconcileRows() keeps the cost low instead: unchanged rows keep
// their previous object, so memoized table rows do not re-render.

// next rows (server order) with every row that is unchanged reusing prev's object.
// Rows are de-duplicated by id (ids are unique; economicId is not).
export function reconcileRows(prev, next) {
  const before = new Map();
  for (const r of prev) before.set(r.id, r);
  const seen = new Set();
  const out = [];
  let same = prev.length === next.length;
  for (let i = 0; i < next.length; i++) {
    const r = next[i];
    if (seen.has(r.id)) { same = false; continue; }
    seen.add(r.id);
    const old = before.get(r.id);
    const keep = old && (old === r || JSON.stringify(old) === JSON.stringify(r)) ? old : r;
    if (keep !== prev[i]) same = false;
    out.push(keep);
  }
  return same ? prev : out; // identical list → identical array (no state change)
}

// Ids in `next` that were not shown before (genuinely new to this query).
export function newRowIds(prevRows, next) {
  const seen = new Set(prevRows.map((r) => r.id));
  return next.filter((r) => !seen.has(r.id)).map((r) => r.id);
}

// Append a page, skipping ids already loaded (Load More).
export function appendUnique(prev, page) {
  const seen = new Set(prev.map((r) => r.id));
  const add = page.filter((r) => !seen.has(r.id) && seen.add(r.id));
  return add.length ? [...prev, ...add] : prev;
}

// Version announced by the stream vs the version of the data on screen.
// DIFFERENT (not only greater) means new data: a restarted server may count
// from a lower version. Unknown served version → refresh.
export function versionChanged(announced, served) {
  if (!Number.isFinite(announced)) return false;
  return served == null || announced !== served;
}

// One refresh in flight at a time; triggers during a run collapse into ONE
// trailing run; runs are at least minGapMs apart. run() returns a promise.
export function createRefreshScheduler(run, { minGapMs = 1500, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let inFlight = false, queued = false, last = -Infinity, timer = null, stopped = false;
  async function trigger() {
    if (stopped) return;
    if (inFlight) { queued = true; return; }
    const wait = last + minGapMs - now();
    if (wait > 0) {
      if (!timer) timer = setTimer(() => { timer = null; trigger(); }, wait);
      return;
    }
    inFlight = true;
    last = now();
    try { await run(); } catch { /* run reports its own errors */ }
    finally {
      inFlight = false;
      if (queued && !stopped) { queued = false; trigger(); }
    }
  }
  return {
    trigger,
    stop() { stopped = true; if (timer) { clearTimer(timer); timer = null; } },
    get busy() { return inFlight; },
  };
}
