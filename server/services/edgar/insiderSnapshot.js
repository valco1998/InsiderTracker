// server/services/edgar/insiderSnapshot.js
//
// Processed-data snapshot: the expensive pipeline (price checks → amendment
// linking → filing delay → economic de-duplication → sort → totals) runs ONCE
// per ingest data version instead of on every request. API requests and the
// alert engine read the same snapshot.
//
//   • Rebuilt when the ingest data version changes — immediately after each
//     ingest batch, and at most every minRebuildMs while a backlog is still
//     loading (requests may then see data up to minRebuildMs old).
//   • get({ fresh: true }) always rebuilds a changed version (alert engine).
//   • Snapshot rows are SHARED and must be treated as read-only by consumers.
//
// queryTransactions() reproduces the /api/insider/transactions semantics exactly
// (same validation, filters, ordering, totals) and adds cursor pagination and an
// optional compact view.
import { annotatePriceChecks } from "./priceAnomalies.js";
import { applyAmendments } from "./amendments.js";
import { filingDelay } from "./businessDays.js";
import { groupTransactions, computeTotals } from "./transactionGroups.js";
import { normalizeFiledTicker } from "./form4Parser.js";
import { rowRoleGroups } from "./insiderInsights.js";

// Pure pipeline: price checks → amendment linking → filing delay (fresh objects).
export function checkRows(transactions, amendmentFilings = []) {
  const rows = applyAmendments(annotatePriceChecks(transactions), amendmentFilings);
  // annotatePriceChecks/applyAmendments return fresh objects — safe to extend.
  for (const r of rows) r.filingDelay = filingDelay(r);
  return rows;
}

// Newest filings first; ties by row id in natural order (same as the original route).
const collator = new Intl.Collator(undefined, { numeric: true });
const sortTs = (t) => t.acceptedAtET || t.filingDate || "";
const compareRows = (a, b) => sortTs(b).localeCompare(sortTs(a)) || collator.compare(a.id, b.id);
const compareToKey = (row, key) => key.t.localeCompare(sortTs(row)) || collator.compare(row.id, key.i);

export function buildSnapshot({ transactions, amendmentFilings, version = 0, now = Date.now() }) {
  const t0 = performance.now();
  // Grouping input order is the ingest order, exactly as before — results never
  // depend on the later sort.
  const checked = checkRows(transactions, amendmentFilings);
  const economic = groupTransactions(checked).sort(compareRows);
  const raw = [...checked].sort(compareRows);
  // Row ids are unique; economicId is NOT (two identical rows of one filing share
  // it — they are never merged, both are counted). Lookups therefore key on ids.
  const rawById = new Map(raw.map((r) => [r.id, r]));
  const economicByRowId = new Map();
  const economicById = new Map(); // economicId → [rows]
  for (const e of economic) {
    for (const rep of e.reportedBy || []) economicByRowId.set(rep.rowId, e);
    (economicById.get(e.economicId) || economicById.set(e.economicId, []).get(e.economicId)).push(e);
  }
  return {
    version, builtAt: now, buildMs: performance.now() - t0,
    raw, economic, rawById, economicByRowId, economicById,
    totalsAll: computeTotals(economic),
    compact: new WeakMap(),
  };
}

// onBuild(version, publishedAtMs, snapshot): called after each build — the moment
// data of `version` becomes visible through the API (Phase D0 publication
// timestamp; Phase D3 live-stream notification).
export function createSnapshotStore({ source, minRebuildMs = 2000, now = () => Date.now(), log = console, onBuild = null } = {}) {
  let snap = null;
  const stats = { builds: 0, lastBuildMs: null, lastBuiltAt: null, version: null, rows: 0 };
  function build() {
    const version = source.getDataVersion();
    snap = buildSnapshot({ transactions: source.getTransactions(), amendmentFilings: source.getAmendmentFilings(), version, now: now() });
    Object.assign(stats, { builds: stats.builds + 1, lastBuildMs: Math.round(snap.buildMs * 10) / 10, lastBuiltAt: new Date(snap.builtAt).toISOString(), version, rows: snap.raw.length });
    if (snap.buildMs > 250) log.warn(`[INSIDER_SNAPSHOT] slow rebuild ms=${Math.round(snap.buildMs)} rows=${snap.raw.length}`);
    if (onBuild) {
      try { onBuild(version, now(), snap); } catch (err) { log.warn(`[INSIDER_SNAPSHOT] onBuild failed err=${err.message}`); }
    }
  }
  function get({ fresh = false } = {}) {
    if (!snap) build();
    else if (snap.version !== source.getDataVersion() && (fresh || now() - snap.builtAt >= minRebuildMs)) build();
    return snap;
  }
  return { get, stats: () => ({ ...stats }) };
}

// ── Query ────────────────────────────────────────────────────────────────────
const TYPES = { all: null, purchase: "P", sale: "S" };
const VENUES = new Set(["all", "open_market", "offering_or_private", "unspecified"]);
const CHECKS = new Set(["all", "ok", "anomaly", "missing_price"]);
const VIEWS = new Set(["full", "compact"]);
const TICKER_RE = /^[A-Z0-9.\-]{1,10}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// "BRK-B" (SEC company list) and "BRK.B" (filings) name the same share class.
const canonical = (s) => String(s || "").replace(/-/g, ".");
const tickerMatches = (t, q) => canonical(t.ticker) === q || (t.tickerSymbols || []).some((s) => canonical(s) === q);

export const encodeCursor = (row) => Buffer.from(JSON.stringify({ t: sortTs(row), i: row.id })).toString("base64url");
export function decodeCursor(s) {
  if (typeof s !== "string" || s.length > 200) return null;
  try {
    const k = JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
    return typeof k?.t === "string" && typeof k?.i === "string" && k.i.length <= 64 ? k : null;
  } catch { return null; }
}

// Compact list row: drops the bulky audit text (owners, footnotes, remarks) and
// a reportedBy that only repeats the row itself. Full detail: GET /transactions/:id.
function compactRow(snap, r) {
  let c = snap.compact.get(r);
  if (!c) {
    const { owners, footnotes, remarks, reportedBy, ...rest } = r;
    // roleGroups (additive): CEO / CFO / Director / Officer / 10% Owner / Other,
    // derived from the owners dropped here — clients filter by role without them.
    const base = { ...rest, roleGroups: rowRoleGroups(r) };
    c = reportedBy && reportedBy.length > 1 ? { ...base, reportedBy } : base;
    snap.compact.set(r, c);
  }
  return c;
}

// q: raw query object. → { status: 400, error } | { status: 200, body }
export function queryTransactions(snap, q = {}) {
  const type = String(q.type || "all").toLowerCase();
  const venue = String(q.venue || "all").toLowerCase();
  const check = String(q.check || "all").toLowerCase();
  // Accepts "FLG" and exchange-prefixed input like "NYSE:FLG" (as some filings report it).
  const tickerRaw = String(q.ticker || "").trim();
  const ticker = tickerRaw ? (normalizeFiledTicker(tickerRaw).ticker || tickerRaw.toUpperCase()) : "";
  const from = String(q.from || "");
  const to = String(q.to || "");
  const dedupe = String(q.dedupe ?? "true") !== "false";
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 200, 1), 1000);
  const view = String(q.view || "full").toLowerCase();

  const bad = (error) => ({ status: 400, error });
  if (!(type in TYPES)) return bad("type must be all, purchase or sale");
  if (!VENUES.has(venue)) return bad("venue must be all, open_market, offering_or_private or unspecified");
  if (!CHECKS.has(check)) return bad("check must be all, ok, anomaly or missing_price");
  if (ticker && !TICKER_RE.test(ticker)) return bad("invalid ticker");
  if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to))) return bad("dates must be YYYY-MM-DD");
  if (!VIEWS.has(view)) return bad("view must be full or compact");
  let cursor = null;
  if (q.cursor !== undefined && q.cursor !== "") {
    cursor = decodeCursor(q.cursor);
    if (!cursor) return bad("invalid cursor");
  }

  const all = dedupe ? snap.economic : snap.raw;
  const code = TYPES[type];
  const tq = canonical(ticker);
  const inRange = (d) => !!d && (!from || d >= from) && (!to || d <= to);
  const unfiltered = !code && venue === "all" && check === "all" && !ticker && !from && !to;
  const rows = unfiltered ? all : all.filter((t) =>
    (!code || t.code === code) &&
    (venue === "all" || (t.code === "P" && t.purchaseContext === venue)) &&
    (check === "all" || t.priceCheck?.status === check) &&
    (!ticker || tickerMatches(t, tq)) &&
    (!from && !to ? true : (t.reportedBy || [t]).some((r) => inRange(r.filingDate)))
  );

  // Totals always over economic transactions matching the same filters.
  const totals = dedupe ? (unfiltered ? snap.totalsAll : computeTotals(rows)) : computeTotals(groupTransactions(rows));

  // Cursor: first row strictly after the cursor key in sort order (binary search).
  let start = 0;
  if (cursor) {
    let lo = 0, hi = rows.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (compareToKey(rows[mid], cursor) <= 0) lo = mid + 1; else hi = mid; }
    start = lo;
  }
  const page = rows.slice(start, start + limit);
  const nextCursor = start + limit < rows.length && page.length ? encodeCursor(page[page.length - 1]) : null;

  return {
    status: 200,
    body: {
      total: rows.length,
      rawRowCount: snap.raw.length,
      dedupe,
      totals,
      transactions: view === "compact" ? page.map((r) => compactRow(snap, r)) : page,
      nextCursor,
      view,
    },
  };
}

const ID_RE = /^(econ_[0-9a-f]{16}(_\d{18})?|row_\d{10}-\d{2}-\d{6}:\d{1,4}|\d{10}-\d{2}-\d{6}:\d{1,4})$/;
// Full record by row id ("acc:index" — always unique; returns the filing row and
// the economic transaction it belongs to) or by economicId ("econ_…" / "row_…").
export function getTransactionById(snap, id) {
  if (typeof id !== "string" || !ID_RE.test(id)) return { status: 400, error: "invalid id" };
  const raw = snap.rawById.get(id);
  if (raw) return { status: 200, body: { transaction: raw, economic: snap.economicByRowId.get(id) || null } };
  const matches = snap.economicById.get(id) || [];
  if (matches.length === 1) return { status: 200, body: { transaction: matches[0] } };
  if (matches.length > 1) return { status: 409, error: "economicId is shared by several rows — use a row id", rowIds: matches.map((m) => m.id) };
  return { status: 404, error: "Not found" };
}
