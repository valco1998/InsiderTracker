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
import { createScreener, screenCompanies } from "../services/edgar/companyScreener.js";
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
export function companiesHandler({ snapshot = getSnapshot, ingestStatus = getIngestStatus, issuersOf = createScreener(), now = () => Date.now() } = {}) {
  return (req, res, next) => {
    try {
      const snap = snapshot();
      const r = screenCompanies({ issuers: issuersOf(snap), query: req.query, ingest: ingestStatus(), now: now() });
      if (r.error) return res.status(400).json({ error: r.error });
      res.set("Cache-Control", "no-cache");
      res.json({ ...r, snapshotVersion: snap.version });
    } catch (err) { next(err); }
  };
}

export function transactionsEtag(version, query, status) {
  const h = crypto.createHash("sha1").update(JSON.stringify(query ?? {})).update("\n").update(JSON.stringify(status ?? null)).digest("base64url");
  return `W/"v${version}-${h.slice(0, 22)}"`;
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
  const etag = transactionsEtag(snap.version, req.query, status);
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

router.get("/companies", companiesHandler());

// Historical insider-buying backtest (backtestRoutes.js).
router.use("/backtest", createBacktestRouter());

router.get("/status", (_req, res) => {
  res.json({ ...getIngestStatus(), snapshot: getSnapshotStats(), stream: snapshotStream.getStats() });
});

export default router;
