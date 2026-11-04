// deep4/panel/history.test.mjs — unit tests for history.mjs (hand-built fixtures + randomized leakage check on the real panel).
//   node --max-old-space-size=6144 scripts/research/deep4/panel/history.test.mjs
import assert from "node:assert/strict";
import { createHistory } from "./history.mjs";
import { loadPanel } from "./data.mjs";
import { writePretty } from "./panelLib.mjs";

const results = []; let failed = 0;
const test = (name, fn) => { try { fn(); results.push({ name, ok: true }); } catch (e) { failed++; results.push({ name, ok: false, error: String(e.message).slice(0, 400) }); } };
const close = (a, b, eps = 1e-12) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

// ---------------- fixtures ----------------
const R = (o) => ({ isPrimary: 1, primaryRole: "CEO", cik: 1, decisionAt: null, ...o, dupKey: o.dupKey || `${o.person}|${o.cik ?? 1}|${o.key}` });
const fx = [
  R({ key: "p1a", person: "P1", publishedAt: "2026-01-05 10:00:00", B_end30: "2026-02-04", B_xsNet30: 0.10, B_hit10_30: 1, A_end30: "2026-02-03", A_xs30: 0.2, A_hit10_30: 1, B_end5: "2026-01-12", B_xsNet5: 0.01, B_hit10_5: 0 }),
  R({ key: "p1b", person: "P1", publishedAt: "2026-01-20 10:00:00", B_end30: "2026-02-19", B_xsNet30: -0.05, B_hit10_30: 0, A_end30: "2026-02-18", A_xs30: -0.1, A_hit10_30: 0, B_end5: "2026-01-26", B_xsNet5: -0.02, B_hit10_5: 0 }),
  R({ key: "p1dup", person: "P1", publishedAt: "2026-01-20 10:05:00", dupKey: "P1|1|p1b", isPrimary: 0, B_end30: "2026-02-19", B_xsNet30: -0.05, B_hit10_30: 0 }),
  R({ key: "p1na", person: "P1", publishedAt: "2026-01-22 10:00:00", B_end30: "2026-02-20", B_xsNet30: null, B_hit10_30: null }), // outcome unavailable (no bar / embargo)
  R({ key: "p1c", person: "P1", publishedAt: "2026-02-25 10:00:00", B_end30: "2026-03-27", B_xsNet30: 0.30, B_hit10_30: 1 }),
  R({ key: "p2a", person: "P2", cik: 2, primaryRole: "Director", publishedAt: "2026-01-02 12:00:00", B_end30: "2026-02-02", B_xsNet30: 0.02, B_hit10_30: 0 }),
  R({ key: "p2b", person: "P2", cik: 2, primaryRole: "Director", publishedAt: "2026-01-06 12:00:00", B_end30: "2026-02-05", B_xsNet30: 0.04, B_hit10_30: 1 }),
  R({ key: "p3a", person: "P3", cik: 1, primaryRole: "Director", publishedAt: "2026-01-07 12:00:00", B_end30: "2026-02-06", B_xsNet30: -0.10, B_hit10_30: 0 }),
];
const H = createHistory(fx, { minPool: 3 });

test("outcome ending the day before date(t) is visible; ending ON date(t) is not", () => {
  const h = H.historyAt("P1", "2026-02-19 09:00:00");
  // p1b ends ON date(t) → pending; p1na ends after date(t) → pending (an immature outcome never reveals whether it will exist)
  assert.equal(h.matured.n, 1); close(h.matured.meanRaw, 0.10); assert.equal(h.matured.pending, 2); assert.equal(h.matured.unavailable, 0);
  assert.equal(h.prior.n, 4); // p1a, p1b, p1dup, p1na (published before t)
});
test("a matured but unavailable outcome (null value) is counted as unavailable, never as a value", () => {
  const h = H.historyAt("P1", "2026-02-21");
  assert.equal(h.matured.n, 2); assert.equal(h.matured.unavailable, 1); assert.equal(h.matured.pending, 0);
});
test("outcome becomes visible the next day", () => {
  const h = H.historyAt("P1", "2026-02-20 00:00:00");
  assert.equal(h.matured.n, 2); close(h.matured.meanRaw, 0.025); close(h.matured.hit10, 0.5);
});
test("end date == date(t) late in the day is still invisible", () => {
  const h = H.historyAt("P1", "2026-02-04 23:59:59");
  assert.equal(h.matured.n, 0); assert.equal(h.matured.pending, 3); // p1a (ends 02-04 = date(t)), p1b, p1na
});
test("publishedAt == t is not prior; excludeKey / excludeDupKey work", () => {
  assert.equal(H.historyAt("P1", "2026-01-20 10:00:00").prior.n, 1);
  assert.equal(H.historyAt("P1", "2026-01-20 10:01:00", { excludeKey: "p1b" }).prior.n, 1);
  assert.equal(H.historyAt("P1", "2026-01-20 10:06:00", { excludeKey: "p1b", excludeDupKey: "P1|1|p1b" }).prior.n, 1);
});
test("dedupe keeps one row per dupKey; dedupe=false counts duplicates", () => {
  assert.equal(H.historyAt("P1", "2026-03-01").matured.n, 2);
  assert.equal(H.historyAt("P1", "2026-03-01", { dedupe: false }).matured.n, 3);
});
test("date-only t means the start of that day", () => {
  assert.equal(H.historyAt("P1", "2026-02-05").matured.n, 1);
  assert.equal(H.historyAt("P1", "2026-02-04").matured.n, 0);
});
test("outcome A uses A_end30 (matures earlier than B)", () => {
  const h = H.historyAt("P1", "2026-02-04 08:00:00", { outcome: "A", metric: "xs" });
  assert.equal(h.matured.n, 1); close(h.matured.meanRaw, 0.2);
  assert.equal(H.historyAt("P1", "2026-02-04 08:00:00").matured.n, 0); // B for the same t: still pending
});
test("horizon 5 uses B_end5", () => {
  const h = H.historyAt("P1", "2026-01-27", { horizon: 5 });
  assert.equal(h.matured.n, 2); close(h.matured.meanRaw, -0.005);
});
test("fixed EB prior: estimate = mu + (mean - mu) * n / (n + sigma2/tau2)", () => {
  const prior = { mu: 0.0, sigma2: 0.04, tau2: 0.01, lo: -1, hi: 1 };
  const h = H.historyAt("P1", "2026-02-20", { prior });
  const n = 2, m = 0.025, k = 4; close(h.eb.estimate, 0 + (m - 0) * n / (n + k)); close(h.eb.weight, n / (n + k));
  const h0 = H.historyAt("P9", "2026-02-20", { prior }); assert.equal(h0.matured.n, 0); close(h0.eb.estimate, 0);
});
test("point-in-time pool prior only uses outcomes matured before date(t)", () => {
  assert.equal(H.poolPriorAt("2026-02-03").n, 1); // p2a (02-02)
  assert.equal(H.poolPriorAt("2026-02-06").n, 3); // + p1a (02-04), p2b (02-05); p3a ends 02-06 = date(t) → excluded
  assert.equal(H.poolPriorAt("2026-02-07").n, 4);
  assert.equal(H.poolPriorAt("2026-02-21").n, 5); // + p1b (02-19); p1dup deduped; p1na unavailable
  const pp = H.poolPriorAt("2026-02-21"); assert.equal(pp.ok, true); assert.equal(pp.groups, 3);
});
test("pool prior below minPool → no shrinkage object (eb null)", () => {
  const h = H.historyAt("P1", "2026-02-05"); assert.equal(h.eb, null);
});
test("issuer-level history aggregates every person at the issuer", () => {
  const h = H.issuerHistoryAt(1, "2026-02-21");
  assert.equal(h.matured.n, 3); // p1a, p1b, p3a (cik 1); p1dup deduped; p1na unavailable
  close(h.matured.meanRaw, (0.10 - 0.05 - 0.10) / 3);
});
test("role-level history aggregates by primary role", () => {
  assert.equal(H.roleHistoryAt("Director", "2026-02-21").matured.n, 3); // p2a, p2b, p3a
  assert.equal(H.roleHistoryAt("CEO", "2026-02-21").matured.n, 2);
});
test("historyForEvent excludes the event and its dupKey", () => {
  const ev = { ...fx[4], decisionAt: "2026-02-25 10:01:00" };
  const h = H.historyForEvent(ev);
  assert.equal(h.person.prior.n, 4); assert.equal(h.person.matured.n, 2);
});

// ---------------- randomized leakage check on the real design panel ----------------
const P = loadPanel({ agent: "panel", segments: ["design"] });
const HR = createHistory(P.rows);
let checked = 0, items = 0, viol = 0, priorMismatch = 0, priorCompared = 0; const ex = [];
let s = 12345; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const evs = P.rows.filter((r) => r.decisionAt);
for (let q = 0; q < 1500; q++) {
  const r = evs[Math.floor(rnd() * evs.length)];
  for (const H0 of [5, 30]) for (const outcome of ["B", "A"]) {
    const metric = outcome === "B" ? "xsNet" : "xs";
    const h = HR.historyForEvent(r, { horizon: H0, outcome, metric, detail: true });
    for (const part of ["person", "issuer", "role"]) for (const it of h[part].matured.items) {
      items++;
      const src = HR.rows.find((x) => x.key === it.key);
      if (!(it.end < r.decisionAt.slice(0, 10)) || !(src.publishedAt < r.decisionAt) || it.key === r.key || src.dupKey === r.dupKey) { viol++; if (ex.length < 5) ex.push({ ev: r.key, it }); }
    }
  }
  if (r.isPrimary === 1 && r.dupSize === 1 && r.pConcurrent === 0) { priorCompared++; const h = HR.historyForEvent(r, { dedupe: false }); if (h.person.prior.n !== r.pPrior) priorMismatch++; }
  checked++;
}
test("real panel: no matured item ends on/after date(t) or is the event itself (1,500 random events x 2 horizons x A/B x 3 levels)", () => { assert.equal(viol, 0, JSON.stringify(ex)); });
test("real panel: person prior count equals the panel's pPrior (single, primary events)", () => { assert.equal(priorMismatch, 0, `${priorMismatch} of ${priorCompared}`); });

const out = { ranAt: new Date().toISOString(), passed: results.filter((r) => r.ok).length, failed, results, realPanel: { eventsChecked: checked, maturedItemsChecked: items, violations: viol, priorCompared, priorMismatch } };
writePretty("history-test.json", out);
console.log(JSON.stringify(out, null, 1));
if (failed) process.exitCode = 1;
