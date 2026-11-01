// server/utils/withRetry.js
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getStatus(err) {
  return err?.response?.status ?? err?.status ?? null;
}

function getRetryAfterMs(err) {
  const ra = err?.response?.headers?.["retry-after"] ?? err?.retryAfter ?? null;
  if (ra == null) return null;

  const asNum = Number(ra);
  if (Number.isFinite(asNum)) return Math.max(0, asNum * 1000);

  const asDate = Date.parse(String(ra));
  if (!Number.isNaN(asDate)) return Math.max(0, asDate - Date.now());

  return null;
}

export default async function withRetry(
  fn,
  {
    retries = 6,
    baseDelayMs = 400,
    maxDelayMs = 10_000,
    jitter = 0.2,
    shouldRetry,
    onRetry,
  } = {}
) {
  const defaultShouldRetry = (err) => {
    const s = getStatus(err);
    if (s === 429) return true;
    if (s >= 500 && s <= 599) return true;

    const code = err?.code;
    return (
      code === "ECONNRESET" ||
      code === "ETIMEDOUT" ||
      code === "ENOTFOUND" ||
      code === "EAI_AGAIN"
    );
  };

  const okToRetry = shouldRetry ?? defaultShouldRetry;

  let attempt = 0;
  while (true) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= retries || !okToRetry(err)) throw err;

      const status = getStatus(err);
      const retryAfterMs = getRetryAfterMs(err);

      const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      const delay = retryAfterMs ?? exp;

      const j = delay * jitter * (Math.random() * 2 - 1);
      const finalDelay = Math.max(0, Math.round(delay + j));

      onRetry?.({ attempt, status, delayMs: finalDelay, error: err });

      await sleep(finalDelay);
      attempt++;
    }
  }
}