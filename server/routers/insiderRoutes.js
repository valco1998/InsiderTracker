// server/routers/insiderRoutes.js
// Read-only API over ingested SEC Form 4 transactions (public data).
//
// By default rows are ECONOMIC transactions: confirmed duplicate reports by
// related filers are grouped (see transactionGroups.js) and every original
// filing is listed in `reportedBy`. `?dedupe=false` returns raw filing rows.
// `totals` are always computed over economic transactions (no double counting).
//
// Served from the processed-data snapshot (insiderSnapshot.js) — nothing is
// recomputed per request. Additive options:
//   ?cursor=<nextCursor>  next page (stable while new filings arrive)
//   ?view=compact         list rows without owners / footnotes / remarks
//   GET /transactions/:id full record of one row (economicId or raw row id)
//   GET /stream           Server-Sent Events: snapshot version notifications (Phase D3)
//   GET /companies        purchase-focused companies screener (companyScreener.js)
//   /backtest/*           historical backtest (backtestRoutes.js)
//
// Phase D3 caching: /transactions carries a weak ETag derived from the snapshot
// version, the query and the attached ingest status — a matching If-None-Match
// is answered 304 BEFORE the page is queried or serialized. `snapshotVersion`
// (additive) lets a client correlate a response with stream events.
import crypto from "node:crypto";
import express from "express";
import { getIngestStatus } from "../services/edgar/insiderIngest.js";
import { getSnapshot, getSnapshotStats, snapshotStream } from "../services/edgar/insiderData.js";
import { queryTransactions, getTransactionById } from "../services/edgar/insiderSnapshot.js";
import { lookupTicker as defaultLookupTicker, CompanyLookupUnavailable } from "../services/edgar/companyTickers.js";
import { companyInsights, rowsForCompany } from "../services/edgar/insiderInsights.js";
import { describeMarketData } from "../services/stockData/stockDataProvider.js";
import { createScreener, screenCompanies, parseScreenerQuery, companyEvidence } from "../services/edgar/companyScreener.js";
import { createBacktestRouter } from "./backtestRoutes.js";

const router = express.Router();
const COMPANY_TICKER_RE = /^[A-Z0-9.-]{1,10}$/;

// Company intelligence (unique buyers / sellers by trade date, role groups,
// cluster buying, SEC coverage of the window, chart symbol). Computed from the
// published snapshot — read-only, no SEC requests except the existing 24 h-cached
// SEC company list used to resolve ticker → issuer CIK.
export function companyInsightsHandler({ lookupTicker = defaultLookupTicker, snapshot = getSnapshot, ingestStatus = getIngestStatus } = {}) {
  return async (req, res, next) => {
    try {
      const ticker = String(req.params.ticker || "").toUpperCase();
      if (!COMPANY_TICKER_RE.test(ticker)) return res.status(400).json({ error: "invalid ticker" });
      let company = null, lookupError = null;
      try { company = await lookupTicker(ticker); }
      catch (err) {
        if (!(err instanceof CompanyLookupUnavailable)) throw err;
        lookupError = "SEC company list temporarily unavailable — matched by filed ticker";
      }
      const snap = snapshot();
      const rows = rowsForCompany(snap.economic, { cik: company?.cik ?? null, ticker });
      if (!company && !rows.length) return res.status(404).json({ error: "Ticker not found in SEC's company list and no Form 4 data is held for it" });
      const r = companyInsights({
        rows,
        company: {
          ticker: company?.ticker || ticker,
          cik: company?.cik ?? (rows[0]?.issuerCik ? String(rows[0].issuerCik).padStart(10, "0") : null),
          name: company?.name || rows[0]?.issuerName || null,
          exchange: company?.exchange ?? null,
          inSecCompanyList: !!company,
          lookupError,
        },
        query: req.query,
        ingest: ingestStatus(),
        reportOwners: (rowId) => snap.rawById?.get(rowId)?.owners,
      });
      if (r.error) return res.status(400).json({ error: r.error });
      res.set("Cache-Control", "no-cache");
      res.json({ ...r, market: describeMarketData(), snapshotVersion: snap.version });
    } catch (err) { next(err); }
  };
}

// Companies screener (purchase-focused): per-issuer unique buyers / purchase
// value / dates over a trade-date or filing-date window, with SEC coverage.
// Read-only over the published snapshot; the issuer index is rebuilt once per
// snapshot version.
//
// Results are memoized in a small LRU keyed by everything screenCompanies'
// output depends on: snapshot version, the normalized options (which include
// the Eastern "today" and, for 1d filing-date windows, the 24 h cut-off), and
// the coverage inputs taken from the ingest status. A weak ETag over the same
// key answers If-None-Match with 304 BEFORE anything is screened or serialized.
const COMPANIES_CACHE_MAX = 50;

export function companiesCacheKey(version, opt, ingest, now) {
  const pollMs = ingest?.pollIntervalMs || 60_000;
  const livePollOk = !!ingest?.lastPollAt && now - Date.parse(ingest.lastPollAt) <= pollMs * 3;
  return JSON.stringify([version, opt, {
    coverage: ingest?.coverage || [], noIndexDays: ingest?.noIndexDays || [],
    latestIndexDay: ingest?.recovery?.latestExpectedDay ?? null, livePollOk,
  }]);
}

export function companiesHandler({ snapshot = getSnapshot, ingestStatus = getIngestStatus, issuersOf = createScreener(), now = () => Date.now() } = {}) {
  const cache = new Map(); // key → screenCompanies result, LRU order
  return (req, res, next) => {
    try {
      const snap = snapshot();
      const ingest = ingestStatus();
      const nowMs = now();
      // ?win=… makes screenCompanies treat the query itself as parsed options — keep that path uncached.
      const opt = req.query.win ? null : parseScreenerQuery(req.query, nowMs);
      if (opt?.error) return res.status(400).json({ error: opt.error });
      let r, key = null;
      if (opt) {
        key = companiesCacheKey(snap.version, opt, ingest, nowMs);
        const etag = `W/"c${snap.version}-${crypto.createHash("sha1").update(key).digest("base64url").slice(0, 22)}"`;
        res.set("Cache-Control", "no-cache");
        res.set("ETag", etag);
        if (ifNoneMatch(req.get("If-None-Match"), etag)) return res.status(304).end();
        r = cache.get(key);
        if (r) cache.delete(key); // refresh LRU position
      }
      if (!r) r = screenCompanies({ issuers: issuersOf(snap), query: req.query, ingest, now: nowMs });
      if (r.error) { res.removeHeader("ETag"); return res.status(400).json({ error: r.error }); }
      if (key) {
        cache.set(key, r);
        while (cache.size > COMPANIES_CACHE_MAX) cache.delete(cache.keys().next().value);
      }
      res.set("Cache-Control", "no-cache");
      res.json({ ...r, snapshotVersion: snap.version });
    } catch (err) { next(err); }
  };
}

// GET /api/insider/companies/:cik/evidence — the SEC rows behind one screener row (same query params).
export function companyEvidenceHandler({ snapshot = getSnapshot, issuersOf = createScreener(), now = () => Date.now() } = {}) {
  return (req, res, next) => {
    try {
      const snap = snapshot();
      const r = companyEvidence({ issuers: issuersOf(snap), cik: req.params.cik, query: req.query, now: now() });
      if (r.error) return res.status(400).json({ error: r.error });
      if (r.notFound) return res.status(404).json({ error: "Company not found in the loaded SEC data" });
      res.set("Cache-Control", "no-cache");
      res.json({ ...r, snapshotVersion: snap.version });
    } catch (err) { next(err); }
  };
}

export function transactionsEtag(version, query, status) {
  const h = crypto.createHash("sha1").update(JSON.stringify(query ?? {})).update("\n").update(JSON.stringify(status ?? null)).digest("base64url");
  return `W/"v${version}-${h.slice(0, 22)}"`;
}

// Query with keys in a fixed order: the response depends only on the values.
export function normalizeQuery(query) {
  const q = query ?? {};
  return Object.fromEntries(Object.keys(q).sort().map((k) => [k, q[k]]));
}

// The part of the ingest status the ETag tracks: the fields the client renders
// (StatusBar / KpiStrip / feed polling: processing, queueLength, lastPollError,
// pollIntervalMs, filingsStored, coverage, dataVersion) — NOT the telemetry that
// changes on every SEC request (edgar / latency / cache / throttle counters).
// lastPollAt changes on every 60 s poll; it is tracked in 5-minute buckets so an
// unchanged snapshot revalidates as 304 while the "Last SEC poll" fallback (the
// stream heartbeat carries the live value) is never more than one bucket behind.
export const LAST_POLL_BUCKET_MS = 5 * 60_000;
export function etagStatus(status) {
  if (!status) return null;
  const lastPoll = status.lastPollAt ? Date.parse(status.lastPollAt) : NaN;
  return {
    dataVersion: status.dataVersion ?? null,
    processing: status.processing ?? null,
    queueLength: status.queueLength ?? null,
    lastPollError: status.lastPollError ?? null,
    pollIntervalMs: status.pollIntervalMs ?? null,
    filingsStored: status.filingsStored ?? null,
    coverage: status.coverage ?? null,
    lastPollBucket: Number.isFinite(lastPoll) ? Math.floor(lastPoll / LAST_POLL_BUCKET_MS) : null,
  };
}

// RFC 9110 §13.1.2 If-None-Match with weak comparison, evaluated by the origin.
// (Express's req.fresh refuses whenever the request says Cache-Control: no-cache,
// which fetch() adds to every manual conditional request — the origin may still answer 304.)
export function ifNoneMatch(header, etag) {
  if (!header || !etag) return false;
  const opaque = (t) => t.trim().replace(/^W\//, "");
  if (header.trim() === "*") return true;
  return header.split(",").some((t) => opaque(t) === opaque(etag));
}

router.get("/transactions", (req, res) => {
  const snap = getSnapshot();
  const status = getIngestStatus();
  const etag = transactionsEtag(snap.version, normalizeQuery(req.query), etagStatus(status));
  res.set("Cache-Control", "no-cache"); // always revalidate; never served stale from a cache
  res.set("ETag", etag);
  if (ifNoneMatch(req.get("If-None-Match"), etag)) return res.status(304).end();
  const r = queryTransactions(snap, req.query);
  if (r.status !== 200) { res.removeHeader("ETag"); return res.status(r.status).json({ error: r.error }); }
  res.json({ ...r.body, snapshotVersion: snap.version, status });
});

router.get("/transactions/:id", (req, res) => {
  const r = getTransactionById(getSnapshot(), req.params.id);
  if (r.status !== 200) return res.status(r.status).json({ error: r.error, ...(r.rowIds ? { rowIds: r.rowIds } : {}) });
  res.json(r.body);
});

router.get("/stream", (req, res) => snapshotStream.handle(req, res));

router.get("/company/:ticker/insights", companyInsightsHandler());

// One issuer index (per snapshot version) shared by the screener and its evidence rows.
const sharedIssuers = createScreener();
router.get("/companies", companiesHandler({ issuersOf: sharedIssuers }));
router.get("/companies/:cik/evidence", companyEvidenceHandler({ issuersOf: sharedIssuers }));

// Historical insider-buying backtest (backtestRoutes.js).
router.use("/backtest", createBacktestRouter());

router.get("/status", (_req, res) => {
  res.json({ ...getIngestStatus(), snapshot: getSnapshotStats(), stream: snapshotStream.getStats() });
});

export default router;
