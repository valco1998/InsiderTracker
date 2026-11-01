// server/routers/insiderRoutes.js
// Read-only API over ingested SEC Form 4 transactions (public data).
//
// By default rows are ECONOMIC transactions: confirmed duplicate reports by
// related filers are grouped (see transactionGroups.js) and every original
// filing is listed in `reportedBy`. `?dedupe=false` returns raw filing rows.
// `totals` are always computed over economic transactions (no double counting).
import express from "express";
import { getIngestStatus } from "../services/edgar/insiderIngest.js";
import { groupTransactions, computeTotals } from "../services/edgar/transactionGroups.js";
import { getCheckedRows } from "../services/edgar/insiderData.js";

const router = express.Router();

const TYPES = { all: null, purchase: "P", sale: "S" };
const VENUES = new Set(["all", "open_market", "offering_or_private", "unspecified"]);
const CHECKS = new Set(["all", "ok", "anomaly", "missing_price"]);
const TICKER_RE = /^[A-Z0-9.\-]{1,10}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

router.get("/transactions", (req, res) => {
  const type = String(req.query.type || "all").toLowerCase();
  const venue = String(req.query.venue || "all").toLowerCase();
  const check = String(req.query.check || "all").toLowerCase();
  const ticker = String(req.query.ticker || "").trim().toUpperCase();
  const from = String(req.query.from || "");
  const to = String(req.query.to || "");
  const dedupe = String(req.query.dedupe ?? "true") !== "false";
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 1000);

  if (!(type in TYPES)) return res.status(400).json({ error: "type must be all, purchase or sale" });
  if (!VENUES.has(venue)) return res.status(400).json({ error: "venue must be all, open_market, offering_or_private or unspecified" });
  if (!CHECKS.has(check)) return res.status(400).json({ error: "check must be all, ok, anomaly or missing_price" });
  if (ticker && !TICKER_RE.test(ticker)) return res.status(400).json({ error: "invalid ticker" });
  if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to))) {
    return res.status(400).json({ error: "dates must be YYYY-MM-DD" });
  }

  // Price checks need every row (peer comparison), so run them on the full set.
  const raw = getCheckedRows();
  // Group BEFORE filtering so a group is never split by a filter.
  const economic = groupTransactions(raw);
  const all = dedupe ? economic : raw;

  const code = TYPES[type];
  const inRange = (d) => !!d && (!from || d >= from) && (!to || d <= to);
  const rows = all.filter((t) =>
    (!code || t.code === code) &&
    (venue === "all" || (t.code === "P" && t.purchaseContext === venue)) &&
    (check === "all" || t.priceCheck?.status === check) &&
    (!ticker || t.ticker === ticker) &&
    (!from && !to ? true : (t.reportedBy || [t]).some((r) => inRange(r.filingDate)))
  );

  // Newest filings first; within a filing keep document order.
  rows.sort((a, b) =>
    (b.acceptedAtET || b.filingDate || "").localeCompare(a.acceptedAtET || a.filingDate || "") ||
    a.id.localeCompare(b.id, undefined, { numeric: true })
  );

  // Totals always over economic transactions matching the same filters.
  const economicMatching = dedupe ? rows : groupTransactions(rows);
  res.json({
    total: rows.length,
    rawRowCount: raw.length,
    dedupe,
    totals: computeTotals(economicMatching),
    transactions: rows.slice(0, limit),
    status: getIngestStatus(),
  });
});

router.get("/status", (_req, res) => {
  res.json(getIngestStatus());
});

export default router;
