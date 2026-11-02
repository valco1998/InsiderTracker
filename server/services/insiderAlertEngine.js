// server/services/insiderAlertEngine.js
//
// Decides which NEW, eligible economic transactions alert which followers.
// Every gate must pass (fail closed):
//   • code P or S, matching the follow's types (purchase / sale / both)
//   • issuer CIK equals the follow's CIK; follow enabled
//   • SEC acceptance time known, and
//       ≥ follow.alertsFrom                     (never filings before the follow)
//       ≥ engine start − restart grace           (never earlier backfill)
//       ≥ now − ALERT_MAX_AGE_HOURS              (never stale filings)
//       ≤ now − ALERT_SETTLE_MS                  (related filings get grouped first)
//   • isAlertEligible() — price anomalies / unchecked prices never alert
// Duplicates: one InsiderAlertClaim per (user, alertKey) under a unique index.
// alertKey = the economic transaction's base id, so confirmed duplicate filings
// AND uncertain ("needs_review") duplicates can produce at most one alert.
//
// Defaults: INSIDER_ALERTS_ENABLED=false, INSIDER_ALERTS_DRY_RUN=true.
// Dry-run writes nothing to the database and sends nothing.
import { parseAcceptedAtET } from "./edgar/easternTime.js";
import { isAlertEligible } from "./edgar/priceAnomalies.js";

const TYPE_CODES = { purchase: new Set(["P"]), sale: new Set(["S"]), both: new Set(["P", "S"]) };
export const RESTART_GRACE_MS = 15 * 60_000;

// econ_<hash>_<accession digits> (needs_review) → econ_<hash>
export const alertKeyOf = (tx) => String(tx.economicId || `row_${tx.id}`).replace(/_\d{18}$/, "");

const padCik = (c) => String(Number(c)).padStart(10, "0");

// Pure. → { candidates: [{ watch, tx, alertKey, acceptedAt }], skipped: { reason: count } }
export function selectAlertCandidates({ transactions, watches, now = Date.now(), settleMs, maxAgeMs, notBefore }) {
  const skipped = {};
  const skip = (r) => { skipped[r] = (skipped[r] || 0) + 1; };
  const byCik = new Map();
  for (const w of watches) {
    if (!w.enabled) continue;
    (byCik.get(padCik(w.cik)) || byCik.set(padCik(w.cik), []).get(padCik(w.cik))).push(w);
  }

  const candidates = [];
  for (const tx of transactions) {
    const followers = byCik.get(padCik(tx.issuerCik));
    if (!followers) continue;
    if (tx.code !== "P" && tx.code !== "S") { skip("not_p_or_s"); continue; }
    const acceptedAt = parseAcceptedAtET(tx.acceptedAtET);
    if (!acceptedAt) { skip("no_acceptance_time"); continue; }
    const t = acceptedAt.getTime();
    if (t < notBefore) { skip("before_engine_start"); continue; }
    if (now - t > maxAgeMs) { skip("too_old"); continue; }
    if (now - t < settleMs) { skip("settling"); continue; }
    if (!isAlertEligible(tx).eligible) {
      skip(tx.amendment?.status === "superseded" ? "superseded_by_amendment"
        : tx.formType === "4/A" ? "amendment"
        : tx.priceCheck?.status === "anomaly" ? "price_anomaly" : "price_unchecked");
      continue;
    }

    for (const w of followers) {
      if (!TYPE_CODES[w.types]?.has(tx.code)) { skip("type_filtered"); continue; }
      if (t < new Date(w.alertsFrom).getTime()) { skip("before_follow"); continue; }
      candidates.push({ watch: w, tx, alertKey: alertKeyOf(tx), acceptedAt });
    }
  }

  // One candidate per (user, alertKey) even if data repeats within a run.
  const seen = new Set();
  return {
    candidates: candidates.filter((c) => {
      const k = `${c.watch.userId}:${c.alertKey}`;
      if (seen.has(k)) { skip("duplicate_in_run"); return false; }
      seen.add(k);
      return true;
    }),
    skipped,
  };
}

// deps (injected for tests):
//   getTransactions() → economic transactions
//   findWatches(ciks) → enabled follows for those CIKs
//   claim(c) → true if newly claimed, false if already claimed (unique index)
//   deliver(c) → { alertId } after AlertLog + push; throws on failure
//   markClaim(c, update) → persist delivered / failed
//   isDbReady() / isIngestReady() / isLiveReady() → booleans (missing ⇒ not ready)
export function createAlertEngine({ flags, deps, startedAt = Date.now(), log = console }) {
  const dryRunSeen = new Set();
  let running = false;
  const stats = { runs: 0, delivered: 0, duplicatesSkipped: 0, failed: 0, dryRunMatches: 0, lastRunAt: null, lastSkipped: {}, lastError: null };

  async function runOnce({ now = Date.now() } = {}) {
    if (!flags.enabled) return { skipped: "disabled" };
    if (running) return { skipped: "already_running" };
    if (!deps.isDbReady?.()) return { skipped: "db_not_ready" };
    if (!deps.isIngestReady()) return { skipped: "ingest_not_ready" };
    if (!flags.dryRun && !deps.isLiveReady()) return { skipped: "live_not_ready" };
    running = true;
    stats.runs++;
    stats.lastRunAt = new Date(now).toISOString();
    try {
      const notBefore = Math.max(startedAt - RESTART_GRACE_MS, now - flags.maxAgeMs);
      const recent = deps.getTransactions().filter((tx) => {
        const a = parseAcceptedAtET(tx.acceptedAtET);
        return a && a.getTime() >= notBefore;
      });
      const ciks = [...new Set(recent.map((tx) => padCik(tx.issuerCik)))];
      const watches = ciks.length ? await deps.findWatches(ciks) : [];
      const { candidates, skipped } = selectAlertCandidates({
        transactions: recent, watches, now, settleMs: flags.settleMs, maxAgeMs: flags.maxAgeMs, notBefore,
      });
      stats.lastSkipped = skipped;

      for (const c of candidates) {
        const tag = `user=${c.watch.userId} watch=${c.watch._id} ticker=${c.tx.ticker} econ=${c.alertKey} acc=${c.tx.accessionNo}`;
        if (flags.dryRun) {
          const k = `${c.watch.userId}:${c.alertKey}`;
          if (dryRunSeen.has(k)) continue;
          dryRunSeen.add(k);
          stats.dryRunMatches++;
          log.log(`[INSIDER_ALERT_DRY_RUN] ${tag} code=${c.tx.code} value=${c.tx.value ?? "n/a"}`);
          continue;
        }
        if (!(await deps.claim(c))) {
          stats.duplicatesSkipped++;
          log.log(`[INSIDER_ALERT_DUPLICATE_SKIPPED] ${tag}`);
          continue;
        }
        try {
          const { alertId } = await deps.deliver(c);
          await deps.markClaim(c, { status: "delivered", alertId });
          stats.delivered++;
          log.log(`[INSIDER_ALERT_DELIVERED] ${tag} alertId=${alertId}`);
        } catch (err) {
          // The claim stays: a failed delivery is never retried into a duplicate.
          await deps.markClaim(c, { status: "failed", error: String(err?.message || err).slice(0, 200) }).catch(() => {});
          stats.failed++;
          log.error(`[INSIDER_ALERT_FAILED] ${tag} err=${err?.message}`);
        }
      }
      return { candidates: candidates.length, skipped };
    } catch (err) {
      stats.lastError = err.message;
      log.error(`[INSIDER_ALERT_ENGINE] run failed err=${err.message}`);
      return { error: err.message };
    } finally {
      running = false;
    }
  }

  return { runOnce, getStats: () => ({ ...stats, enabled: flags.enabled, dryRun: flags.dryRun, startedAt: new Date(startedAt).toISOString() }) };
}
