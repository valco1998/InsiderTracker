import { fetchMarket } from "../controllers/empire.controllers.js";
import {
  beforeEmpireRequest,
  onEmpireSuccess,
  onEmpire429,
  onEmpireError,
} from "./empireRateGuard.js";

export async function safeFetchMarket(params = {}) {
  const check = await beforeEmpireRequest(params);

  if (!check.allowed) {
    if (check.reason === "cache") {
      return check.data;
    }

    if (check.reason === "blocked") {
      const err = new Error("Empire temporarily blocked");
      err.code = "EMPIRE_BLOCKED";
      err.retryAfterMs = check.retryAfterMs || 0;
      throw err;
    }
  }

  try {
    const data = await fetchMarket(params);
    onEmpireSuccess(check.key, data);
    return data;
  } catch (err) {
    const status = err?.response?.status || err?.status || err?.statusCode;

    if (status === 429) {
      onEmpire429();
    } else {
      onEmpireError();
    }

    // If the Empire API is down/rate-limited and the rate guard has stale cache
    // data, return it so alert scans degrade gracefully instead of failing hard.
    if (check.data) {
      console.warn(
        `[safeFetchMarket] API error (status=${status ?? "unknown"}) — falling back to stale cache (${check.data?.items?.length ?? 0} items)`
      );
      return check.data;
    }

    throw err;
  }
}