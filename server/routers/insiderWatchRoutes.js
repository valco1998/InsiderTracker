// server/routers/insiderWatchRoutes.js
// Follow / unfollow SEC issuers by ticker. Mounted behind requireAccounts + protectRoute.
import express from "express";
import mongoose from "mongoose";
import InsiderWatch from "../models/InsiderWatch.model.js";
import { lookupTicker as defaultLookup, CompanyLookupUnavailable } from "../services/edgar/companyTickers.js";

export const MAX_WATCHES_PER_USER = 100;
const TYPES = new Set(["purchase", "sale", "both"]);
const TICKER_RE = /^[A-Za-z0-9.-]{1,10}$/;

const view = (w) => ({
  id: String(w._id), ticker: w.ticker, cik: w.cik, companyName: w.companyName,
  types: w.types, enabled: w.enabled, alertsFrom: w.alertsFrom, createdAt: w.createdAt,
});

const fail = (res, err, where) => {
  console.error(`[INSIDER_WATCH_ERROR] where=${where} err=${err?.name}: ${err?.message}`);
  return res.status(500).json({ ok: false, error: "Internal server error" });
};

export function createInsiderWatchRouter({ lookupTicker = defaultLookup } = {}) {
  const router = express.Router();

  router.get("/", async (req, res) => {
    try {
      const watches = await InsiderWatch.find({ userId: req.user._id }).sort({ ticker: 1 }).lean();
      res.json({ ok: true, watches: watches.map(view) });
    } catch (err) { fail(res, err, "list"); }
  });

  router.post("/", async (req, res) => {
    try {
      const ticker = typeof req.body?.ticker === "string" ? req.body.ticker.trim() : "";
      const types = req.body?.types === undefined ? "both" : req.body.types;
      if (!TICKER_RE.test(ticker)) return res.status(400).json({ ok: false, error: "Invalid ticker" });
      if (typeof types !== "string" || !TYPES.has(types)) return res.status(400).json({ ok: false, error: "types must be purchase, sale or both" });

      if ((await InsiderWatch.countDocuments({ userId: req.user._id })) >= MAX_WATCHES_PER_USER) {
        return res.status(400).json({ ok: false, error: `You can follow up to ${MAX_WATCHES_PER_USER} companies` });
      }

      let company;
      try {
        company = await lookupTicker(ticker);
      } catch (err) {
        if (err instanceof CompanyLookupUnavailable) return res.status(503).json({ ok: false, error: "Company lookup is temporarily unavailable" });
        throw err;
      }
      if (!company) return res.status(404).json({ ok: false, error: "Ticker not found in SEC company list" });

      try {
        const watch = await InsiderWatch.create({
          userId: req.user._id, cik: company.cik, ticker: company.ticker, companyName: company.name,
          types, enabled: true, alertsFrom: new Date(),
        });
        console.log(`[INSIDER_WATCH_CREATED] user=${req.user._id} ticker=${company.ticker} cik=${company.cik} types=${types}`);
        res.status(201).json({ ok: true, watch: view(watch) });
      } catch (err) {
        if (err?.code === 11000) return res.status(409).json({ ok: false, error: `Already following ${company.ticker}` });
        throw err;
      }
    } catch (err) { fail(res, err, "create"); }
  });

  router.patch("/:id", async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ ok: false, error: "Invalid id" });
      const { types, enabled } = req.body || {};
      if (types !== undefined && (typeof types !== "string" || !TYPES.has(types))) return res.status(400).json({ ok: false, error: "types must be purchase, sale or both" });
      if (enabled !== undefined && typeof enabled !== "boolean") return res.status(400).json({ ok: false, error: "enabled must be a boolean" });
      if (types === undefined && enabled === undefined) return res.status(400).json({ ok: false, error: "Nothing to update" });

      const watch = await InsiderWatch.findOne({ _id: req.params.id, userId: req.user._id });
      if (!watch) return res.status(404).json({ ok: false, error: "Not found" });
      if (types !== undefined) watch.types = types;
      if (enabled !== undefined) {
        // Re-enabling never back-fills alerts for the paused period.
        if (enabled && !watch.enabled) watch.alertsFrom = new Date();
        watch.enabled = enabled;
      }
      await watch.save();
      res.json({ ok: true, watch: view(watch) });
    } catch (err) { fail(res, err, "update"); }
  });

  router.delete("/:id", async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ ok: false, error: "Invalid id" });
      const r = await InsiderWatch.deleteOne({ _id: req.params.id, userId: req.user._id });
      if (!r.deletedCount) return res.status(404).json({ ok: false, error: "Not found" });
      res.json({ ok: true });
    } catch (err) { fail(res, err, "delete"); }
  });

  return router;
}

export default createInsiderWatchRouter();
