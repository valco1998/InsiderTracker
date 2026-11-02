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

const router = express.Router();

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

router.get("/status", (_req, res) => {
  res.json({ ...getIngestStatus(), snapshot: getSnapshotStats(), stream: snapshotStream.getStats() });
});

export default router;
