// Phase D2 — SEC circuit breaker. A FAKE fetch and a controllable clock drive
// createEdgarClient(); no network. Responses are scripted per request.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createEdgarClient, parseRetryAfter, EdgarThrottledError } from "./edgarClient.js";

const URL_A = "https://www.sec.gov/Archives/edgar/data/1/0000000001-26-000001.txt";

function harness(script, opts = {}) {
  let t = Date.parse("2026-11-03T15:00:00Z");
  const clock = { now: () => t, advance: (ms) => { t += ms; } };
  const calls = [];
  // script: array of responses consumed per network call; a function gets the call index.
  const fetchImpl = async (url) => {
    calls.push(String(url));
    const r = typeof script === "function" ? script(calls.length - 1, t) : script.shift() ?? { status: 200 };
    if (r instanceof Error) throw r;
    const headers = new Map(Object.entries(r.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    return { status: r.status, ok: r.status >= 200 && r.status < 300, headers: { get: (k) => headers.get(k.toLowerCase()) ?? null }, text: async () => r.body ?? "ok" };
  };
  const lines = [];
  const log = { log: (m) => lines.push(m), warn: (m) => lines.push(m), error: (m) => lines.push(m) };
  const client = createEdgarClient({
    fetchImpl, now: clock.now, sleep: async (ms) => clock.advance(ms), userAgent: () => "InsiderTracker test@example.com",
    maxRps: 5, throttle429Ms: 60_000, throttle403Ms: 600_000, throttleMaxMs: 3_600_000, log, ...opts,
  });
  return { client, clock, calls, lines };
}

const rejectsThrottled = (p, check = () => true) => assert.rejects(p, (err) => err instanceof EdgarThrottledError && err.throttled === true && check(err));

test("parseRetryAfter: delta-seconds, HTTP date, invalid", () => {
  const now = Date.parse("2026-11-03T15:00:00Z");
  assert.equal(parseRetryAfter("120", now), 120_000);
  assert.equal(parseRetryAfter("Tue, 03 Nov 2026 15:00:30 GMT", now), 30_000);
  assert.equal(parseRetryAfter("Tue, 03 Nov 2026 14:00:00 GMT", now), 0, "past date → 0, never negative");
  assert.equal(parseRetryAfter("soon", now), null);
  assert.equal(parseRetryAfter(null, now), null);
});

test("429 honours Retry-After, pauses ALL SEC requests without network calls, then one probe closes the breaker", async () => {
  const { client, clock, calls } = harness([{ status: 429, headers: { "Retry-After": "30" } }, { status: 200, body: "B" }, { status: 200, body: "C" }]);
  await rejectsThrottled(client.getText(URL_A), (e) => e.status === 429 && e.retryAfterMs === 30_000 && !e.circuitOpen);
  assert.equal(calls.length, 1, "a 429 is never retried inside the call");

  // Any other SEC URL is refused locally while paused.
  clock.advance(10_000);
  await rejectsThrottled(client.getText("https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent"), (e) => e.circuitOpen && e.retryAfterMs > 0 && e.retryAfterMs <= 20_000);
  assert.equal(calls.length, 1, "no request reached SEC during the pause");
  let s = client.getStats().breaker;
  assert.equal(s.state, "open");
  assert.equal(s.lastStatus, 429);
  assert.equal(s.lastRetryAfterMs, 30_000);
  assert.equal(s.blockedRequests, 1);

  clock.advance(20_000);
  assert.equal(client.getStats().breaker.state, "half_open");
  assert.equal(await client.getText(URL_A), "B", "probe succeeds");
  s = client.getStats().breaker;
  assert.equal(s.state, "closed");
  assert.equal(s.consecutiveThrottles, 0);
  assert.equal(s.throttleEvents, 1);
  assert.ok(s.totalPausedMs >= 30_000);
  assert.equal(await client.getText(URL_A), "C");
});

test("403 without Retry-After pauses 10 min; a throttled probe doubles the pause (capped)", async () => {
  const { client, clock, calls } = harness([{ status: 403 }, { status: 403 }, { status: 403 }, { status: 200 }], { throttleMaxMs: 1_800_000 });
  await rejectsThrottled(client.getText(URL_A), (e) => e.status === 403 && e.retryAfterMs === 600_000);
  clock.advance(600_000);
  await rejectsThrottled(client.getText(URL_A), (e) => e.status === 403 && e.retryAfterMs === 1_200_000);
  clock.advance(1_200_000);
  await rejectsThrottled(client.getText(URL_A), (e) => e.status === 403 && e.retryAfterMs === 1_800_000, "capped at throttleMaxMs");
  assert.equal(client.getStats().breaker.consecutiveThrottles, 3);
  clock.advance(1_800_000);
  assert.equal(await client.getText(URL_A), "ok");
  assert.equal(calls.length, 4, "exactly one request per pause window");
  assert.equal(client.getStats().breaker.state, "closed");
});

test("half-open: concurrent callers send only ONE probe", async () => {
  const { client, clock, calls } = harness((i) => (i === 0 ? { status: 429, headers: { "Retry-After": "5" } } : { status: 200 }));
  await rejectsThrottled(client.getText(URL_A));
  clock.advance(5000);
  const origFetchCount = calls.length;
  const probe = client.getText(URL_A); // in flight (not awaited yet)
  await rejectsThrottled(client.getText(URL_A), (e) => e.circuitOpen);
  assert.equal(await probe, "ok");
  assert.equal(calls.length, origFetchCount + 1);
  assert.equal(client.getStats().breaker.state, "closed");
});

test("a network error on the probe does not close the breaker; the next call probes again", async () => {
  const { client, clock, calls } = harness([{ status: 429, headers: { "Retry-After": "1" } }, new Error("ECONNRESET"), { status: 200 }]);
  await rejectsThrottled(client.getText(URL_A));
  clock.advance(1000);
  await assert.rejects(client.getText(URL_A, { retries: 0 }), /ECONNRESET/);
  assert.equal(client.getStats().breaker.state, "half_open", "still not proven healthy");
  assert.equal(await client.getText(URL_A), "ok");
  assert.equal(client.getStats().breaker.state, "closed");
  assert.equal(calls.length, 3);
});

test("5xx is still retried with backoff and 404 is returned as-is — neither opens the breaker", async () => {
  const { client, calls } = harness([{ status: 503 }, { status: 502 }, { status: 200, body: "X" }, { status: 404 }]);
  assert.equal(await client.getText(URL_A), "X");
  assert.equal(calls.length, 3);
  await assert.rejects(client.getText(URL_A), (e) => e.status === 404 && !e.throttled);
  const s = client.getStats();
  assert.equal(s.breaker.state, "closed");
  assert.equal(s.breaker.throttleEvents, 0);
  assert.equal(s.retries, 2);
});

test("fair access: requests are spaced at 1/maxRps and non-SEC hosts are refused", async () => {
  const stamps = [];
  const { client, clock } = harness((_i, t) => { stamps.push(t); return { status: 200 }; });
  for (let i = 0; i < 4; i++) await client.getText(URL_A);
  const gaps = stamps.slice(1).map((t, i) => t - stamps[i]);
  assert.ok(gaps.every((g) => g >= 200), `gaps ${gaps}`);
  await assert.rejects(client.getText("https://example.com/x"), /refusing non-SEC URL/);
  void clock;
});
