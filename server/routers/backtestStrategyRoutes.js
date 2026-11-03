// server/routers/backtestStrategyRoutes.js — mounted at /api/insider/strategies
// behind requireAccounts + protectRoute. Saved Backtesting strategies of the signed-in
// user (parameters only). Backtesting itself stays public; only saving needs an account.
//   GET    /        → { ok, strategies: [{ id, name, params, createdAt, updatedAt }] }
//   POST   /        { name, params } → 201 { ok, strategy }
//   PUT    /:id     { name?, params? } → { ok, strategy }
//   DELETE /:id     → { ok }
// params are validated with the SAME rules as a run (normalizeRunConfig) and stored as the
// user entered them (the request body), so nothing is silently re-defaulted.
import express from "express";
import mongoose from "mongoose";
import BacktestStrategy from "../models/BacktestStrategy.model.js";
import { normalizeRunConfig } from "../services/backtest/backtestEngine.js";
import { logError } from "../utils/safeLog.js";

export const MAX_STRATEGIES_PER_USER = 50;
const NAME_MAX = 80;

// Only these request fields are stored (allow-list — no operators or unknown keys reach MongoDB).
const PARAM_KEYS = {
  from: "date", to: "date", minBuyers: "number", minValueUsd: "number", windowDays: "number",
  maxSignalLagDays: "number", maxFilingDelayDays: "number", roles: "roles", openMarketOnly: "boolean",
  minTransactionUsd: "number", horizonSessions: "number", executionLatencySeconds: "number", entrySession: "string",
  commissionBps: "number", slippageBps: "number", minPriorDecline: "number", priorLookbackSessions: "number",
  minMarketCap: "number", maxMarketCap: "number", delistingPolicy: "string", equityHorizon: "string",
};
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// → { params } or { error }
export function sanitizeParams(raw, nowMs = Date.now()) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "params must be an object" };
  const out = {};
  for (const [k, type] of Object.entries(PARAM_KEYS)) {
    const v = raw[k];
    if (v === undefined || v === null || v === "") continue;
    if (type === "date") { if (typeof v !== "string" || !DATE_RE.test(v)) return { error: `${k} must be YYYY-MM-DD` }; out[k] = v; }
    else if (type === "number") { const n = Number(v); if (typeof v === "object" || !Number.isFinite(n)) return { error: `${k} must be a number` }; out[k] = n; }
    else if (type === "boolean") { if (typeof v !== "boolean") return { error: `${k} must be true or false` }; out[k] = v; }
    else if (type === "string") { if (typeof v !== "string" || v.length > 40) return { error: `${k} is invalid` }; out[k] = v; }
    else if (type === "roles") { if (!Array.isArray(v) || v.length > 20 || v.some((r) => typeof r !== "string")) return { error: "roles must be a list" }; out[k] = [...v]; }
  }
  if (!out.from) return { error: "from is required" };
  const n = normalizeRunConfig(out, nowMs); // same validation as a run
  if (n.error) return { error: n.error };
  return { params: out };
}

const cleanName = (v) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "");
const view = (s) => ({ id: String(s._id), name: s.name, params: s.params, createdAt: s.createdAt, updatedAt: s.updatedAt });
const fail = (res, err, where) => {
  logError("BACKTEST_STRATEGY_ERROR", { requestId: res.req?.id, where, userId: res.req?.user?._id, err });
  return res.status(500).json({ ok: false, error: "Internal server error" });
};

export function createBacktestStrategyRouter({ now = () => Date.now() } = {}) {
  const router = express.Router();

  router.get("/", async (req, res) => {
    try {
      const list = await BacktestStrategy.find({ userId: req.user._id }).sort({ updatedAt: -1 }).limit(MAX_STRATEGIES_PER_USER).lean();
      res.set("Cache-Control", "no-store");
      res.json({ ok: true, strategies: list.map(view) });
    } catch (err) { fail(res, err, "list"); }
  });

  router.post("/", async (req, res) => {
    try {
      const name = cleanName(req.body?.name);
      if (!name || name.length > NAME_MAX) return res.status(400).json({ ok: false, error: `Name is required (up to ${NAME_MAX} characters)` });
      const p = sanitizeParams(req.body?.params, now());
      if (p.error) return res.status(400).json({ ok: false, error: p.error });
      if ((await BacktestStrategy.countDocuments({ userId: req.user._id })) >= MAX_STRATEGIES_PER_USER) {
        return res.status(400).json({ ok: false, error: `You can save up to ${MAX_STRATEGIES_PER_USER} strategies` });
      }
      const s = await BacktestStrategy.create({ userId: req.user._id, name, params: p.params });
      console.log(`[BACKTEST_STRATEGY_SAVED] user=${req.user._id} strategy=${s._id}`);
      res.status(201).json({ ok: true, strategy: view(s) });
    } catch (err) { fail(res, err, "create"); }
  });

  router.put("/:id", async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ ok: false, error: "Invalid id" });
      const update = {};
      if (req.body?.name !== undefined) {
        const name = cleanName(req.body.name);
        if (!name || name.length > NAME_MAX) return res.status(400).json({ ok: false, error: `Name is required (up to ${NAME_MAX} characters)` });
        update.name = name;
      }
      if (req.body?.params !== undefined) {
        const p = sanitizeParams(req.body.params, now());
        if (p.error) return res.status(400).json({ ok: false, error: p.error });
        update.params = p.params;
      }
      if (!Object.keys(update).length) return res.status(400).json({ ok: false, error: "Nothing to update" });
      const s = await BacktestStrategy.findOneAndUpdate({ _id: req.params.id, userId: req.user._id }, { $set: update }, { new: true }).lean();
      if (!s) return res.status(404).json({ ok: false, error: "Not found" });
      res.json({ ok: true, strategy: view(s) });
    } catch (err) { fail(res, err, "update"); }
  });

  router.delete("/:id", async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ ok: false, error: "Invalid id" });
      const r = await BacktestStrategy.deleteOne({ _id: req.params.id, userId: req.user._id });
      if (!r.deletedCount) return res.status(404).json({ ok: false, error: "Not found" });
      res.json({ ok: true });
    } catch (err) { fail(res, err, "delete"); }
  });

  return router;
}

export default createBacktestStrategyRouter();
