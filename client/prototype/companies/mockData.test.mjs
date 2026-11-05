// PROTOTYPE audit — every mock company, both anchors, filters / sorts / anchor switching.
//   node --test prototype/companies/mockData.test.mjs   (from client/)
// Cross-checks the mock calendar and entry rule against the real server modules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { COMPANIES, NOW, ASOF, SPY_SERIES, perfOf, hasPrice, isSession, msToEt, entryFor } from "./mockData.js";
import { DEFAULTS, applyFilters, sortList } from "./screenLogic.js";
import { isSession as nyseIsSession } from "../../../server/services/backtest/sessionCalendar.js";
import { entryDateFor } from "../../../server/services/backtest/exitRules.js";

const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));
const sessionsBetween = (a, b) => SPY_SERIES.filter((x) => x.d >= a && x.d <= b).length;

test("calendar matches the server NYSE calendar for every day Apr 1 → Nov 30 2026", () => {
  for (let t = Date.parse("2026-04-01T00:00:00Z"); t <= Date.parse("2026-11-30T00:00:00Z"); t += 86_400_000) {
    const d = new Date(t).toISOString().slice(0, 10);
    assert.equal(isSession(d), nyseIsSession(d), d);
  }
});

test("64 companies; intended state mix (pending / missing / stale / delisted are a small deliberate sample)", () => {
  assert.equal(COMPANIES.length, 64);
  const n = (s) => COMPANIES.filter((c) => c.perf.signal.status === s).length;
  const counts = { ok: n("ok"), stale: n("stale"), pending: n("pending"), no_data: n("no_data"), series_ended: n("series_ended"), uncertain_security: n("uncertain_security") };
  assert.deepEqual(counts, { ok: 58, stale: 1, pending: 2, no_data: 1, series_ended: 1, uncertain_security: 1 });
  console.log("signal-anchor states", counts, "latest-anchor pending:", COMPANIES.filter((c) => c.perf.latest.status === "pending").map((c) => c.ticker));
});

test("SEC acceptance times: EDGAR business days 06:00–22:00 ET, never in the future, signal ≤ latest", () => {
  for (const c of COMPANIES) {
    for (const ms of [c.publication.signalAt, c.publication.latestAt, ...c.evidence.counted.map((r) => r.filedMs)]) {
      const { date, time } = msToEt(ms);
      const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
      assert.ok(wd >= 1 && wd <= 5, `${c.ticker} weekend ${date}`);
      assert.ok(!["2026-10-12", "2026-09-07", "2026-07-03"].includes(date), `${c.ticker} federal holiday ${date}`);
      assert.ok(time >= "06:00" && time <= "22:00", `${c.ticker} ${time}`);
      assert.ok(ms <= NOW, `${c.ticker} in the future`);
    }
    assert.ok(c.publication.signalAt <= c.publication.latestAt, c.ticker);
    assert.equal(c.publication.laterFilings === 0, c.publication.signalAt === c.publication.latestAt, `${c.ticker}: no later filings ⇔ latest = signal`);
  }
});

test("pending only when the entry session is after the last completed close — never for old filings", () => {
  for (const c of COMPANIES) for (const anchor of ["signal", "latest"]) {
    const p = perfOf(c, anchor), at = anchor === "latest" ? c.publication.latestAt : c.publication.signalAt;
    const ent = entryFor(at);
    assert.equal(p.status === "pending", ent.date > ASOF, `${c.ticker}/${anchor}`);
    if (p.status === "pending") assert.ok(NOW - at < 24 * 3_600_000, `${c.ticker}/${anchor}: pending but ${(NOW - at) / 3.6e6}h old`);
  }
});

test("entry rule agrees with the server (next-open cases: same date; intraday cases: server's daily rule is the next session)", () => {
  for (const c of COMPANIES) for (const at of new Set([c.publication.signalAt, c.publication.latestAt])) {
    const { date, time } = msToEt(at);
    const ours = entryFor(at);
    const server = entryDateFor(`${date} ${time}:00 ET`).entryDate;
    if (ours.type === "next open") assert.equal(ours.date, server, `${c.ticker} ${date} ${time}`);
    else { assert.equal(ours.date, date); assert.ok(server > date); }
  }
});

test("every priced row is internally consistent (entry, latest, return, SPY, horizons, peak, sparkline)", () => {
  let checked = 0;
  for (const c of COMPANIES) for (const anchor of ["signal", "latest"]) {
    const p = perfOf(c, anchor);
    if (!hasPrice(p)) continue;
    checked++;
    const id = `${c.ticker}/${anchor}`;
    assert.ok(close(p.ret, p.lastClose / p.entryPrice - 1), `${id} ret`);
    assert.ok(close(p.excess, p.ret - p.spyRet), `${id} excess`);
    assert.equal(p.sessions, sessionsBetween(p.entryDate, p.asOf), `${id} sessions`);
    assert.ok(p.asOf <= ASOF && p.entryDate <= p.asOf, id);
    assert.equal(p.status === "stale", p.asOf < ASOF, `${id} stale flag`);
    assert.ok(close(p.spark.post[0], p.entryPrice) && close(p.spark.post.at(-1), p.lastClose), `${id} sparkline endpoints`);
    assert.ok(p.spark.post.length >= 2 && p.spark.post.length <= 61, `${id} sparkline length`);
    assert.ok(p.spark.pre.length > 0, `${id} pre-publication context`);
    for (const [k, n] of [["r1", 1], ["r5", 5], ["r20", 20]]) assert.equal(p[k] == null, p.sessions < n, `${id} ${k}`);
    if (p.r1 != null && p.sessions === 1) assert.ok(close(p.r1, p.ret), `${id} r1 = ret after one session`);
    assert.ok(p.peak >= p.ret - 1e-9, `${id} peak ≥ current return`);
    assert.ok(p.peakDate >= p.entryDate && p.peakDate <= p.asOf, `${id} peak date`);
    assert.equal(p.belowInsider, p.lastClose < c.purchases.insiderAvgPrice, `${id} below insider`);
  }
  assert.ok(checked >= 110, `checked ${checked}`);
});

test("evidence reconciles: counted value = row value; buyers sum; trades before their filing", () => {
  for (const c of COMPANIES) {
    assert.equal(c.evidence.counted.reduce((t, r) => t + r.value, 0), c.purchases.verifiedValue, c.ticker);
    assert.equal(c.buyersList.reduce((t, b) => t + b.value, 0), c.purchases.verifiedValue, c.ticker);
    for (const r of c.evidence.counted) {
      assert.ok(isSession(r.tradeDate), `${c.ticker} trade on a non-session ${r.tradeDate}`);
      assert.ok(r.tradeDate <= msToEt(r.filedMs).date, `${c.ticker} filed before trade`);
      if (!r.later) assert.ok(r.filedMs <= c.publication.signalAt, `${c.ticker} pre-signal row filed after signal`);
    }
  }
});

test("filters, sorting and anchor switching never mix states or lose rows", () => {
  const all = { ...DEFAULTS, period: "90d" };
  const base = applyFilters(COMPANIES, all, true);
  for (const anchor of ["signal", "latest"]) for (const sort of ["published", "buyers", "value", "own", "ret", "excess"]) for (const dir of ["desc", "asc"]) {
    const f = { ...all, anchor, sort, dir };
    const out = sortList(applyFilters(COMPANIES, f, true), f);
    assert.equal(out.length, base.length, `${anchor}/${sort}/${dir} row count`);
    if (sort === "ret" || sort === "excess") {
      const firstNa = out.findIndex((c) => !hasPrice(perfOf(c, anchor)));
      if (firstNa >= 0) assert.ok(out.slice(firstNa).every((c) => !hasPrice(perfOf(c, anchor))), "N/A rows sorted last");
      const vals = out.filter((c) => hasPrice(perfOf(c, anchor))).map((c) => perfOf(c, anchor)[sort === "ret" ? "ret" : "excess"]);
      for (let i = 1; i < vals.length; i++) assert.ok(dir === "desc" ? vals[i - 1] >= vals[i] : vals[i - 1] <= vals[i], `${anchor}/${sort}/${dir} order`);
    }
  }
  for (const perf of ["up", "down", "below_insider", "beat_spy"]) for (const anchor of ["signal", "latest"]) {
    const out = applyFilters(COMPANIES, { ...all, perf, anchor }, true);
    assert.ok(out.every((c) => hasPrice(perfOf(c, anchor))), `${perf}/${anchor} only priced rows`);
  }
  // unlicensed: price filters are ignored, nothing disappears
  assert.equal(applyFilters(COMPANIES, { ...all, perf: "up" }, false).length, base.length);
});
