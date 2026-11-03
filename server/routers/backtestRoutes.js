// server/routers/backtestRoutes.js — mounted at /api/insider/backtest
// Historical insider-buying backtest (read-only over stored SEC data).
//   GET  /status            data availability: historical Form 4 coverage, backfill
//                           progress, FX table, price provider, defaults, methodology
//                           (?from&to adds coverage of that range)
//   POST /run               starts a run → 202 { jobId }   (one run at a time)
//   GET  /run/:id           { state: running|done|error, progress, result? }
//   GET  /run/:id/track/:signalId
//                           continuous purchase-date timeline of that signal's
//                           company (tracking.js) — baseline never reset
//   GET  /run/:id/publication-now
//                           PRIMARY METRIC per signal: SEC publication → now
//                           (Alpaca SIP trade at/after publication, any session + first regular-session trade → latest price; Tiingo fallback)
//                           + strategy { config, summary, reliability } and rows[id].strategy:
//                           the run's user strategy (acceptance + latency → N-session exit, SPY)
//   GET  /run/:id/event-study/:signalId
//                           later SEC publications of that company, each from its own acceptance
//   GET  /coverage?from&to   historical SEC Form 4 coverage by month
//   GET  /run/:id/ipo-context  INFORMATIONAL: possible IPO allocations per signal (SEC filings only)
//   GET  /run/:id/track/:signalId/current
//                           headline only: first-purchase-date close → current
//                           price (Tiingo IEX quote, cached) or the latest daily close
// Jobs live in memory only (latest MAX_JOBS, JOB_TTL_MS).
//
// Price-data licence guard: unless the configured price data is licensed for
// public display (STOCK_DATA_LICENSE=public), prices and everything derived from
// them (returns, statistics, equity curve, tracking timeline) are only returned
// to requests from this machine (loopback, no proxy headers). Everyone else gets
// the SEC-only view with status "price_data_restricted".
import crypto from "node:crypto";
import express from "express";
import { createBacktestService } from "../services/backtest/backtestEngine.js";
import { getTransactions, getAmendmentFilings, getCoverage, getIngestStatus } from "../services/edgar/insiderIngest.js";

const MAX_JOBS = 10;
const JOB_TTL_MS = 30 * 60_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Loopback socket and no proxy headers (trust proxy is off in insider-mvp.js; a
// reverse proxy on the same host would add X-Forwarded-For / Forwarded).
export function isLocalRequest(req) {
  const ip = String(req.socket?.remoteAddress || "");
  const loopback = ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
  const proxied = !!(req.get?.("x-forwarded-for") || req.get?.("forwarded") || req.get?.("x-real-ip"));
  return loopback && !proxied;
}
const pricesVisible = (req, licence) => licence === "public" || isLocalRequest(req);

const RESTRICTED_NOTE = "Price data is licensed for internal use only — returns are shown only on the machine running the server.";
// Run result without any price-derived value.
export function redactRunResult(r) {
  if (!r || r.status !== "complete") {
    if (!r?.tracks) return r;
    return { ...r, tracks: Object.fromEntries(Object.entries(r.tracks).map(([k, t]) => [k, { ...t, changePct: null, startPrice: null, lastPrice: null, lastDate: null, status: t.status === "ok" ? "price_data_restricted" : t.status }])) };
  }
  return {
    ...r, status: "price_data_restricted", restrictedNote: RESTRICTED_NOTE, stats: null, equity: null, benchmark: null,
    signals: r.signals.map(({ entryPrice, entryRawOpen, horizons, drawdown, priorReturn, marketCap, symbol, ...s }) => ({ ...s, status: "price_data_restricted", horizons: {} })),
    tracks: Object.fromEntries(Object.entries(r.tracks || {}).map(([k, t]) => [k, { ...t, changePct: null, startPrice: null, lastPrice: null, lastDate: null, status: "price_data_restricted" }])),
  };
}
export function redactTrack(t) {
  if (!t || t.status !== "ok") return t;
  return {
    ...t, status: "price_data_restricted", restrictedNote: RESTRICTED_NOTE, baseline: t.baseline ? { date: t.baseline.date, requestedDate: t.baseline.requestedDate } : null,
    stats: null, series: [], corporateActions: [], current: null, events: (t.events || []).map(({ pctAtEvent, priceDate, ...e }) => e),
  };
}

const liveSource = () => {
  const s = getIngestStatus();
  return { transactions: getTransactions(), amendmentFilings: getAmendmentFilings(), coverage: getCoverage(), noIndexDays: s.noIndexDays || [], dataVersion: s.dataVersion };
};

export function createBacktestRouter({ service = createBacktestService({ live: liveSource }), now = () => Date.now(), log = console } = {}) {
  const router = express.Router();
  const jobs = new Map();
  let running = null;

  const prune = () => {
    for (const [id, j] of jobs) if (j.state !== "running" && now() - j.createdAt > JOB_TTL_MS) jobs.delete(id);
    while (jobs.size > MAX_JOBS) { const oldest = [...jobs.entries()].find(([, j]) => j.state !== "running"); if (!oldest) break; jobs.delete(oldest[0]); }
  };

  router.get("/status", (req, res, next) => {
    try {
      const from = DATE_RE.test(req.query.from || "") ? req.query.from : null;
      const to = DATE_RE.test(req.query.to || "") ? req.query.to : null;
      res.set("Cache-Control", "no-cache");
      res.json({ ...service.status(from && to && from <= to ? { from, to } : {}), running: running ? { jobId: running } : null });
    } catch (err) { next(err); }
  });

  router.post("/run", (req, res) => {
    const n = service.normalize(req.body || {});
    if (n.error) return res.status(400).json({ error: n.error });
    if (running) {
      // Same settings already running (another tab, a double click): share that job.
      if (jobs.get(running)?.configKey === JSON.stringify(n.config)) return res.status(202).json({ jobId: running, shared: true });
      return res.status(409).json({ error: "A backtest is already running", jobId: running });
    }
    prune();
    const id = crypto.randomUUID();
    const job = { id, state: "running", createdAt: now(), configKey: JSON.stringify(n.config), progress: { stage: "queued", done: 0, total: 0 }, result: null, error: null };
    jobs.set(id, job);
    running = id;
    const t0 = now();
    service.run(n.config, { onProgress: (p) => { job.progress = p; } })
      .then((result) => {
        job.result = result; job.state = "done";
        log.log(`[BACKTEST_RUN] job=${id} status=${result.status} signals=${result.signals.length} from=${n.config.from} to=${n.config.to} durationMs=${now() - t0}`);
      })
      .catch((err) => {
        job.state = "error"; job.error = "Backtest failed — see server log.";
        log.error(`[BACKTEST_RUN_FAILED] job=${id} durationMs=${now() - t0} error=${String(err?.message || err).slice(0, 200)}`);
      })
      .finally(() => { if (running === id) running = null; });
    res.status(202).json({ jobId: id });
  });

  router.get("/run/:id", (req, res) => {
    const j = jobs.get(String(req.params.id));
    if (!j) return res.status(404).json({ error: "Unknown or expired backtest job" });
    res.set("Cache-Control", "no-store");
    let result = j.state === "done" ? j.result : null;
    if (result && !pricesVisible(req, result.prices?.licence)) result = redactRunResult(result);
    res.json({ jobId: j.id, state: j.state, progress: j.progress, error: j.error, result });
  });

  router.get("/run/:id/track/:signalId", async (req, res) => {
    const j = jobs.get(String(req.params.id));
    if (!j) return res.status(404).json({ error: "Unknown or expired backtest job" });
    if (j.state !== "done") return res.status(409).json({ error: "The backtest run has not finished" });
    const t0 = now();
    try {
      const t = await service.track({ result: j.result, signalId: String(req.params.signalId) });
      if (!t) return res.status(404).json({ error: "Unknown signal in this run" });
      res.set("Cache-Control", "no-store");
      res.json(pricesVisible(req, t.prices?.licence) ? t : redactTrack(t));
      log.log(`[BACKTEST_TRACK] job=${j.id} cik=${t.issuerCik} status=${t.status} events=${t.eventCount} durationMs=${now() - t0}`);
    } catch (err) {
      log.error(`[BACKTEST_TRACK_FAILED] job=${j.id} error=${String(err?.message || err).slice(0, 200)}`);
      res.status(500).json({ error: "Could not build the tracking timeline" });
    }
  });

  router.get("/run/:id/publication-now", async (req, res) => {
    const j = jobs.get(String(req.params.id));
    if (!j) return res.status(404).json({ error: "Unknown or expired backtest job" });
    if (j.state !== "done") return res.status(409).json({ error: "The backtest run has not finished" });
    try {
      const r = await service.publicationNow({ result: j.result });
      res.set("Cache-Control", "no-store");
      if (pricesVisible(req, j.result.prices?.licence)) return res.json(r);
      // Licence: no prices or derived changes for non-local viewers.
      const restrict = (m) => ({ status: m?.status === "ok" ? "price_data_restricted" : m?.status || "unavailable" });
      res.json({ generatedAt: r.generatedAt, market: r.market, restrictedNote: RESTRICTED_NOTE, rows: Object.fromEntries(Object.entries(r.rows).map(([k, v]) => [k, {
        symbol: v.symbol, publishedAt: v.publishedAt, elapsedMs: v.elapsedMs, status: restrict(v).status, primary: restrict(v.primary), regular: restrict(v.regular),
        // Strategy timing is SEC-derived (no market data) and stays visible; prices/returns do not.
        strategy: v.strategy ? { ...restrict(v.strategy), secAcceptedAt: v.strategy.secAcceptedAt, availableAt: v.strategy.availableAt, horizonSessions: v.strategy.horizonSessions } : undefined,
      }])), strategy: r.strategy ? { config: r.strategy.config, summary: null } : undefined });
    } catch (err) {
      log.error(`[BACKTEST_PUBLICATION_NOW_FAILED] job=${j.id} error=${String(err?.message || err).slice(0, 200)}`);
      res.status(500).json({ error: "Could not compute SEC publication → now" });
    }
  });

  // EVENT STUDY: SEC publications for the signal's company that came AFTER the signal,
  // each measured from its own acceptance (run's execution rules). Separate from the
  // signal's returns. Licence: non-local viewers get the SEC events without prices.
  router.get("/run/:id/event-study/:signalId", async (req, res) => {
    const j = jobs.get(String(req.params.id));
    if (!j) return res.status(404).json({ error: "Unknown or expired backtest job" });
    if (j.state !== "done") return res.status(409).json({ error: "The backtest run has not finished" });
    const t0 = now();
    try {
      const r = await service.eventStudy({ result: j.result, signalId: String(req.params.signalId) });
      if (!r) return res.status(404).json({ error: "Unknown signal in this run" });
      res.set("Cache-Control", "no-store");
      log.log(`[BACKTEST_EVENT_STUDY] job=${j.id} signal=${String(req.params.signalId).slice(0, 40)} events=${r.eventsShown} durationMs=${now() - t0}`);
      if (pricesVisible(req, j.result.prices?.licence)) return res.json(r);
      res.json({ ...r, restrictedNote: RESTRICTED_NOTE, summary: null, events: r.events.map((e) => ({ ...e, strategy: { status: e.strategy?.status === "ok" ? "price_data_restricted" : e.strategy?.status, horizonSessions: e.strategy?.horizonSessions } })) });
    } catch (err) {
      log.error(`[BACKTEST_EVENT_STUDY_FAILED] job=${j.id} error=${String(err?.message || err).slice(0, 200)}`);
      res.status(500).json({ error: "Could not compute the event study" });
    }
  });

  // Historical SEC Form 4 coverage by month (no market data).
  router.get("/coverage", (req, res) => {
    const from = String(req.query.from || ""), to = String(req.query.to || "");
    if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) return res.status(400).json({ error: "from and to must be YYYY-MM-DD with from ≤ to" });
    try { res.set("Cache-Control", "no-store"); res.json({ from, to, months: service.coverageByMonth({ from, to }) }); }
    catch (err) { log.error(`[BACKTEST_COVERAGE_FAILED] error=${String(err?.message || err).slice(0, 200)}`); res.status(500).json({ error: "Could not compute coverage" }); }
  });

  // INFORMATIONAL: possible IPO allocations among each signal's purchases (public SEC
  // filings only — no market data, so no licence restriction).
  router.get("/run/:id/ipo-context", async (req, res) => {
    const j = jobs.get(String(req.params.id));
    if (!j) return res.status(404).json({ error: "Unknown or expired backtest job" });
    if (j.state !== "done") return res.status(409).json({ error: "The backtest run has not finished" });
    try {
      res.set("Cache-Control", "no-store");
      res.json(await service.ipoContext({ result: j.result }));
    } catch (err) {
      log.error(`[BACKTEST_IPO_CONTEXT_FAILED] job=${j.id} error=${String(err?.message || err).slice(0, 200)}`);
      res.status(500).json({ error: "Could not classify IPO-related purchases" });
    }
  });

  router.get("/run/:id/track/:signalId/current", async (req, res) => {
    const j = jobs.get(String(req.params.id));
    if (!j) return res.status(404).json({ error: "Unknown or expired backtest job" });
    if (j.state !== "done") return res.status(409).json({ error: "The backtest run has not finished" });
    try {
      const c = await service.current({ result: j.result, signalId: String(req.params.signalId) });
      if (!c) return res.status(404).json({ error: "Unknown signal in this run" });
      res.set("Cache-Control", "no-store");
      res.json(pricesVisible(req, c.prices?.licence) ? c : { ...c, status: c.status === "ok" ? "price_data_restricted" : c.status, current: null, restrictedNote: RESTRICTED_NOTE });
    } catch (err) {
      log.error(`[BACKTEST_CURRENT_FAILED] job=${j.id} error=${String(err?.message || err).slice(0, 200)}`);
      res.status(500).json({ error: "Could not load the current price" });
    }
  });

  return router;
}

export default createBacktestRouter;
