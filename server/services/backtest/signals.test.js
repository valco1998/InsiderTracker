// Point-in-time cluster signals — buyers, USD $250,000 threshold, rolling window,
// SEC publication timing, late filings, amendments, duplicates, joint filers,
// prices, currency, overlapping signals, no lookahead. SYNTHETIC data
// (default purchase: 3,000 shares × $50 = $150,000).
import { test } from "node:test";
import assert from "node:assert/strict";
import { OWNERS as O, tx, signalsFor } from "./testFixtures.js";
import { ownerBacktestRoles, rowBacktestRoles, normalizeSignalConfig, DEFAULTS } from "./signals.js";

const ids = (r) => r.signals.map((s) => `${s.publishedAt}|${s.uniqueBuyers}|${s.valueUsd}`);

test("two distinct insiders signal; one insider buying many times never does", () => {
  const one = [1, 2, 3, 4, 5].map((d) => tx({ owners: [O.CEO], date: `2026-03-0${d}`, accepted: `2026-03-0${d + 1} 17:00:00`, shares: 10_000 }));
  assert.equal(signalsFor(one).signals.length, 0, "5 purchases × $500K by ONE person");
  const two = [tx({ owners: [O.CEO], date: "2026-03-02", accepted: "2026-03-03 17:00:00" }), tx({ owners: [O.CFO], date: "2026-03-04", accepted: "2026-03-05 18:30:00" })];
  const r = signalsFor(two);
  assert.equal(r.signals.length, 1);
  const s = r.signals[0];
  assert.equal(s.uniqueBuyers, 2);
  assert.equal(s.purchases, 2);
  assert.equal(s.valueUsd, 300_000);
  assert.equal(s.valueIls, undefined, "no ILS anywhere");
  assert.deepEqual(s.roles, ["CEO", "CFO", "Director"]);
  assert.equal(s.windowFrom, "2026-03-02");
  assert.equal(s.windowTo, "2026-03-04");
});

test("USD threshold: combined across buyers, strictly greater than $250,000", () => {
  assert.equal(DEFAULTS.minValueUsd, 250_000);
  // 2 buyers × 2,500 shares × $50 = $250,000 exactly → no signal
  const exact = [tx({ owners: [O.CEO], date: "2026-03-02", accepted: "2026-03-03 17:00:00", shares: 2500 }), tx({ owners: [O.CFO], date: "2026-03-04", accepted: "2026-03-05 17:00:00", shares: 2500 })];
  assert.equal(signalsFor(exact).signals.length, 0);
  // Each buyer far below $250,000 alone ($125,050) — combined $250,100 > threshold
  const combined = [tx({ owners: [O.CEO], date: "2026-03-02", accepted: "2026-03-03 17:00:00", shares: 2501 }), tx({ owners: [O.CFO], date: "2026-03-04", accepted: "2026-03-05 17:00:00", shares: 2501 })];
  const r = signalsFor(combined);
  assert.equal(r.signals.length, 1);
  assert.equal(r.signals[0].valueUsd, 250_100);
  assert.equal(signalsFor(combined, { config: { minValueUsd: 300_000 } }).signals.length, 0, "configurable");
  assert.match(normalizeSignalConfig({ minValueIls: 250_000 }).error, /no longer supported/, "the old ILS field is refused, not reinterpreted");
  assert.ok(normalizeSignalConfig({ minValueUsd: -1 }).error);
});

test("rolling 30-calendar-day window by trade date (29 days apart in, 30 days apart out)", () => {
  const inWin = [tx({ owners: [O.CEO], date: "2026-03-02", accepted: "2026-03-03 17:00:00" }), tx({ owners: [O.CFO], date: "2026-03-31", accepted: "2026-04-01 17:00:00" })];
  assert.equal(signalsFor(inWin).signals.length, 1);
  const out = [tx({ owners: [O.CEO], date: "2026-03-02", accepted: "2026-03-03 17:00:00" }), tx({ owners: [O.CFO], date: "2026-04-01", accepted: "2026-04-02 17:00:00" })];
  assert.equal(signalsFor(out).signals.length, 0);
});

test("publication timing: the signal is dated at the SEC acceptance of the filing that completes it", () => {
  const rows = [
    tx({ owners: [O.CEO], date: "2026-03-02", accepted: "2026-03-04 09:12:00" }),
    tx({ owners: [O.CFO], date: "2026-03-03", accepted: "2026-03-05 21:45:10" }), // after-hours filing
  ];
  const s = signalsFor(rows).signals[0];
  assert.equal(s.publishedAt, "2026-03-05 21:45:10 ET");
  assert.equal(s.publishedDate, "2026-03-05");
  assert.equal(s.lagDays, 2);
  assert.equal(s.filings.length, 2);
});

test("late filings: a purchase counts only from its (late) acceptance; stale clusters do not signal", () => {
  const late = [
    tx({ owners: [O.CEO], date: "2026-03-02", accepted: "2026-03-03 17:00:00" }),
    tx({ owners: [O.CFO], date: "2026-03-03", accepted: "2026-03-20 17:00:00" }), // filed 13 business days late
  ];
  const s = signalsFor(late).signals;
  assert.equal(s.length, 1);
  assert.equal(s[0].publishedAt, "2026-03-20 17:00:00 ET", "not on the trade date, not on the first filing");
  assert.equal(s[0].lateFilings, 1);
  assert.equal(signalsFor(late, { config: { maxSignalLagDays: 10 } }).signals.length, 0, "older than 10 days at publication");
});

test("Form 4/A: the original counts until the amendment is public; the retraction never removes an earlier signal", () => {
  const orig = tx({ owners: [O.CFO], date: "2026-03-03", accepted: "2026-03-04 17:00:00" });
  const rows = [tx({ owners: [O.CEO], date: "2026-03-02", accepted: "2026-03-03 17:00:00" }), orig];
  const amend = [{ accessionNo: "0000000000-26-900001", issuerCik: "0000005000", ownerCiks: [O.CFO.cik], originalSubmissionDate: "2026-03-04",
    hasNonDerivativeTable: true, totalNonDerivative: 0, acceptedAtET: "2026-04-10 16:00:00 ET", filingDate: "2026-04-10" }];
  const r = signalsFor(rows, { amendmentFilings: amend });
  assert.equal(r.signals.length, 1, "public on 2026-03-04 — the later amendment is not lookahead");
  assert.equal(r.signals[0].publishedAt, "2026-03-04 17:00:00 ET");

  // Amendment restating a purchase: counts only from the 4/A's acceptance.
  const o2 = tx({ owners: [O.CFO], date: "2026-03-03", accepted: "2026-03-04 17:00:00", shares: 10 }); // $500 — too small
  const fixed = tx({ owners: [O.CFO], date: "2026-03-03", accepted: "2026-03-09 08:00:00", formType: "4/A" }); // $150,000
  const am2 = [{ accessionNo: fixed.accessionNo, issuerCik: "0000005000", ownerCiks: [O.CFO.cik], originalSubmissionDate: "2026-03-04",
    hasNonDerivativeTable: true, totalNonDerivative: 1, acceptedAtET: "2026-03-09 08:00:00 ET", filingDate: "2026-03-09" }];
  const r2 = signalsFor([tx({ owners: [O.CEO], date: "2026-03-02", accepted: "2026-03-03 17:00:00" }), o2, fixed], { amendmentFilings: am2 });
  assert.equal(r2.signals.length, 1);
  assert.equal(r2.signals[0].publishedAt, "2026-03-09 08:00:00 ET");
  assert.equal(r2.signals[0].purchases, 2, "original superseded, not double counted");
  assert.equal(r2.signals[0].valueUsd, 300_000);
});

test("confirmed duplicate reports by related filers are one purchase (value counted once)", () => {
  // $130K reported twice: counted twice it would be $261K > $250K; once = $131K → no signal.
  const a = tx({ owners: [O.FUND, O.FUND_GP], date: "2026-03-02", accepted: "2026-03-03 17:00:00", shares: 2600, ownership: "D", sharesOwnedAfter: 5000 });
  const b = tx({ owners: [O.FUND_GP], date: "2026-03-02", accepted: "2026-03-03 17:05:00", shares: 2600, ownership: "I", nature: "By Big Fund LP", sharesOwnedAfter: 5000 });
  const c = tx({ owners: [O.DIR], date: "2026-03-04", accepted: "2026-03-05 17:00:00", shares: 20 });
  assert.equal(signalsFor([a, b, c]).signals.length, 0);
  const big = tx({ owners: [O.DIR], date: "2026-03-04", accepted: "2026-03-05 17:00:00" });
  const r = signalsFor([a, b, big]);
  assert.equal(r.signals[0].uniqueBuyers, 2, "fund + its GP = one buyer");
  assert.equal(r.signals[0].valueUsd, 280_000);
});

test("joint filers: one buyer; identities use only filings public at the time", () => {
  const joint = [tx({ owners: [O.FUND, O.FUND_GP], date: "2026-03-02", accepted: "2026-03-03 17:00:00" }), tx({ owners: [O.FUND_GP], date: "2026-03-05", accepted: "2026-03-06 17:00:00" })];
  assert.equal(signalsFor(joint).signals.length, 0, "the GP filing alone is the same buyer");
  const rows = [tx({ owners: [O.FUND], date: "2026-03-02", accepted: "2026-03-03 17:00:00" }), tx({ owners: [O.FUND_GP], date: "2026-03-05", accepted: "2026-03-06 17:00:00" }),
    tx({ owners: [O.FUND, O.FUND_GP], date: "2026-06-01", accepted: "2026-06-02 17:00:00", shares: 1 })];
  assert.equal(signalsFor(rows).signals.length, 1);
  const known = [tx({ owners: [O.FUND, O.FUND_GP], date: "2026-02-01", accepted: "2026-02-02 17:00:00", shares: 1 }), ...rows.slice(0, 2)];
  assert.equal(signalsFor(known).signals.length, 0);
});

test("missing and anomalous transaction prices count as buyers but not toward the value", () => {
  const rows = [
    tx({ owners: [O.CEO], date: "2026-03-02", accepted: "2026-03-03 17:00:00", shares: 6000 }), // $300K
    tx({ owners: [O.CFO], date: "2026-03-03", accepted: "2026-03-04 17:00:00", price: null }),  // no price
  ];
  const s = signalsFor(rows).signals[0];
  assert.equal(s.uniqueBuyers, 2);
  assert.equal(s.valueUsd, 300_000);
  assert.equal(s.valuesExcluded, 1);
  // Price echoing the share count (12345 @ $12345) is an intrinsic anomaly → value excluded → below threshold.
  const anom = [tx({ owners: [O.CEO], date: "2026-03-02", accepted: "2026-03-03 17:00:00", shares: 100 }), tx({ owners: [O.CFO], date: "2026-03-03", accepted: "2026-03-04 17:00:00", shares: 12345, price: 12345 })];
  assert.equal(signalsFor(anom).signals.length, 0);
});

test("currency: values must be verifiable U.S. dollars", () => {
  const usdConverted = [{ id: "F1", text: "The reported shares were purchased for Australian dollars at a price of AUD 3.79 per share. The purchase price is reported in U.S. dollars and reflects the conversion from AUD to USD." }];
  const notConverted = [{ id: "F1", text: "Represents a per ordinary share purchase price of MXN$68.1875." }];
  const base = (fn) => [tx({ owners: [O.CEO], date: "2026-03-02", accepted: "2026-03-03 17:00:00", footnotes: fn }), tx({ owners: [O.CFO], date: "2026-03-03", accepted: "2026-03-04 17:00:00" })];
  assert.equal(signalsFor(base(usdConverted)).signals[0].valueUsd, 300_000, "converted to USD on the filing → counts");
  assert.equal(signalsFor(base(notConverted)).signals.length, 0, "unverified currency → value excluded → $150K only");
});

test("peer-price outlier check uses only peers public at the time (no lookahead)", () => {
  const x = tx({ owners: [O.CFO], date: "2026-03-03", accepted: "2026-03-04 17:00:00", shares: 130, price: 2000 }); // $260K vs later peers at $5
  const rows = [tx({ owners: [O.CEO], date: "2026-03-02", accepted: "2026-03-03 17:00:00", shares: 10, price: 5 }), x,
    tx({ owners: [O.DIR], date: "2026-03-04", accepted: "2026-03-20 17:00:00", shares: 10, price: 5 }), tx({ owners: [O.DIR2], date: "2026-03-05", accepted: "2026-03-21 17:00:00", shares: 10, price: 5 })];
  const s = signalsFor(rows).signals;
  assert.equal(s.length, 1, "at 2026-03-04 only ONE peer was public — the outlier rule needs two");
  assert.equal(s[0].publishedAt, "2026-03-04 17:00:00 ET");
});

test("overlapping signals: a continuing cluster is one signal; a later separate cluster is a new one", () => {
  const rows = [
    tx({ owners: [O.CEO], date: "2026-03-02", accepted: "2026-03-03 17:00:00" }), tx({ owners: [O.CFO], date: "2026-03-03", accepted: "2026-03-04 17:00:00" }), // signal 1
    tx({ owners: [O.COO], date: "2026-03-10", accepted: "2026-03-11 17:00:00" }), tx({ owners: [O.VP], date: "2026-03-12", accepted: "2026-03-13 17:00:00" }), // same cluster
    tx({ owners: [O.DIR], date: "2026-04-05", accepted: "2026-04-06 17:00:00" }), tx({ owners: [O.DIR2], date: "2026-04-06", accepted: "2026-04-07 17:00:00" }), // extends (≤ Mar 12 + 29)
    tx({ owners: [O.CEO], date: "2026-06-01", accepted: "2026-06-02 17:00:00" }), tx({ owners: [O.CFO], date: "2026-06-02", accepted: "2026-06-03 17:00:00" }), // new cluster
  ];
  const r = signalsFor(rows);
  assert.deepEqual(r.signals.map((s) => s.publishedAt), ["2026-03-04 17:00:00 ET", "2026-06-03 17:00:00 ET"]);
  assert.equal(r.signals[0].clusterTo, "2026-04-06", "the first cluster kept extending");
  assert.equal(r.signals[1].windowFrom, "2026-06-01");
});

test("role, open-market and per-transaction value filters", () => {
  const rows = [tx({ owners: [O.CEO], date: "2026-03-02", accepted: "2026-03-03 17:00:00" }), tx({ owners: [O.DIR], date: "2026-03-03", accepted: "2026-03-04 17:00:00", context: "offering_or_private" })];
  assert.equal(signalsFor(rows).signals.length, 1);
  assert.equal(signalsFor(rows, { config: { openMarketOnly: true } }).signals.length, 0, "code P alone is not assumed open-market");
  assert.equal(signalsFor(rows, { config: { roles: ["CEO", "CFO"] } }).signals.length, 0);
  assert.equal(signalsFor(rows, { config: { roles: ["CEO", "Director"] } }).signals.length, 1);
  assert.equal(signalsFor(rows, { config: { minTransactionUsd: 200_000 } }).signals.length, 0);
  assert.deepEqual([...ownerBacktestRoles(O.COO)], ["COO"]);
  assert.deepEqual([...ownerBacktestRoles(O.VP)], ["VP"]);
  assert.deepEqual(rowBacktestRoles({ owners: [{ role: "Chief Technology Officer", isOfficer: true }, O.FUND] }), ["CTO", "10% Owner"]);
  assert.deepEqual([...ownerBacktestRoles({ role: "General Counsel", isOfficer: true })], ["Other officer"]);
  assert.ok(normalizeSignalConfig({ roles: ["King"] }).error);
  assert.ok(normalizeSignalConfig({ minBuyers: 0 }).error);
});

test("publication date range filters signals without resetting cluster state", () => {
  const rows = [tx({ owners: [O.CEO], date: "2026-03-02", accepted: "2026-03-03 17:00:00" }), tx({ owners: [O.CFO], date: "2026-03-03", accepted: "2026-03-04 17:00:00" }),
    tx({ owners: [O.COO], date: "2026-03-20", accepted: "2026-03-23 17:00:00" }), tx({ owners: [O.VP], date: "2026-03-21", accepted: "2026-03-24 17:00:00" })];
  assert.equal(signalsFor(rows, { range: { from: "2026-03-10", to: "2026-12-31" } }).signals.length, 0, "the March 20 buys belong to the cluster that signalled on March 4");
});

test("NO LOOKAHEAD: every signal is reproduced exactly from only the filings public at its time", () => {
  const rows = [];
  const owners = [O.CEO, O.CFO, O.COO, O.VP, O.DIR, O.DIR2, O.FUND];
  let k = 0;
  for (const [ci, issuer] of ["0000005000", "0000005001", "0000005002"].entries()) {
    for (let i = 0; i < 14; i++) {
      const day = 1 + ((i * 7 + ci * 3) % 27);
      const date = `2026-0${3 + (i % 4)}-${String(day).padStart(2, "0")}`;
      const lag = (i * 5 + ci) % 9 === 0 ? 25 : 1 + ((i + ci) % 3);
      const acc = new Date(Date.parse(`${date}T00:00:00Z`) + lag * 86_400_000).toISOString().slice(0, 10);
      rows.push(tx({ owners: [owners[(i + ci) % owners.length]], date, accepted: `${acc} ${String(7 + (k++ % 14)).padStart(2, "0")}:15:00`, shares: 1000 + ((i * 1370) % 4000), issuerCik: issuer, ticker: `T${ci}` }));
    }
  }
  const full = signalsFor(rows);
  assert.ok(full.signals.length >= 3, `dataset should produce several signals (got ${full.signals.length})`);
  for (const s of full.signals) {
    const cut = s.publishedAt.replace(/ ET$/, "");
    const truncated = signalsFor(rows, { cutoff: cut });
    const before = (r) => ids({ signals: r.signals.filter((x) => x.publishedAt <= s.publishedAt) });
    assert.deepEqual(before(truncated), before(full), `signals up to ${cut} must not depend on later filings`);
  }
});

// ---------- daily (one-day) precision of the rolling window ----------
test("daily: same-day purchases by two insiders form a one-day cluster", () => {
  const r = signalsFor([tx({ owners: [O.CEO], date: "2026-03-02", accepted: "2026-03-03 17:00:00" }), tx({ owners: [O.CFO], date: "2026-03-02", accepted: "2026-03-04 17:00:00" })]);
  assert.equal(r.signals.length, 1);
  assert.deepEqual([r.signals[0].windowFrom, r.signals[0].windowTo], ["2026-03-02", "2026-03-02"]);
  assert.equal(r.signals[0].publishedAt, "2026-03-04 17:00:00 ET", "trade date and SEC publication stay separate");
});

test("daily: window length in calendar days — 1, 2, 3, 7 and 30 days, exact boundaries", () => {
  const pair = (gapDays) => {
    const d2 = new Date(Date.parse("2026-03-02T00:00:00Z") + gapDays * 86_400_000).toISOString().slice(0, 10);
    return [tx({ owners: [O.CEO], date: "2026-03-02", accepted: "2026-03-02 17:00:00" }), tx({ owners: [O.CFO], date: d2, accepted: `${d2} 18:00:00` })];
  };
  const fires = (gap, windowDays) => signalsFor(pair(gap), { config: { windowDays } }).signals.length === 1;
  assert.equal(fires(0, 1), true, "same day, 1-day window");
  assert.equal(fires(1, 1), false, "consecutive days need a 2-day window");
  assert.equal(fires(1, 2), true);
  assert.equal(fires(2, 2), false);
  assert.equal(fires(2, 3), true);
  assert.equal(fires(6, 7), true);
  assert.equal(fires(7, 7), false);
  assert.equal(fires(29, 30), true);
  assert.equal(fires(30, 30), false);
});

test("daily: weekend and holiday trade dates count as calendar days", () => {
  // Saturday 2026-03-07 and Sunday 2026-04-05 are 29 calendar days apart → inside 30 days.
  const wk = [tx({ owners: [O.CEO], date: "2026-03-07", accepted: "2026-03-09 17:00:00" }), tx({ owners: [O.CFO], date: "2026-04-05", accepted: "2026-04-06 17:00:00" })];
  const r = signalsFor(wk);
  assert.equal(r.signals.length, 1);
  assert.deepEqual([r.signals[0].windowFrom, r.signals[0].windowTo], ["2026-03-07", "2026-04-05"]);
  // Good Friday (market closed) is still the reported trade date.
  const hol = [tx({ owners: [O.CEO], date: "2026-04-03", accepted: "2026-04-06 17:00:00" }), tx({ owners: [O.CFO], date: "2026-04-06", accepted: "2026-04-07 17:00:00" })];
  assert.equal(signalsFor(hol).signals[0].windowFrom, "2026-04-03");
});

// ---------- Joint filers across CONFIRMED duplicate reports (ASPE regression) ----------
// Structure of the REAL ASPE (Aspen Neuroscience) Form 4s of 2026-11-02: two ARCH Venture
// fund families filing jointly; the second filing also reports the first family's
// 1,200,000-share purchase as an INDIRECT holding (footnote F5). Owner names / CIKs /
// share counts are from SEC accessions 0001193125-26-444141 and 0001193125-26-444147.
const ARCH = {
  AVP14: { cik: "0002147717", name: "ARCH Venture Partners XIV, L.P.", role: "10% Owner", isTenPercentOwner: true },
  AVP14LLC: { cik: "0002148927", name: "ARCH Venture Partners XIV, LLC", role: "10% Owner", isTenPercentOwner: true },
  AVF14: { cik: "0002138046", name: "ARCH Venture Fund XIV, L.P.", role: "10% Owner", isTenPercentOwner: true },
  BERNS: { cik: "0001202769", name: "BERNS PAUL L", role: "10% Owner", isTenPercentOwner: true },
  AVF10: { cik: "0001757011", name: "ARCH Venture Fund X, L.P.", role: "10% Owner", isTenPercentOwner: true },
  AVF10O: { cik: "0001757017", name: "ARCH Venture Fund X Overage, L.P.", role: "10% Owner", isTenPercentOwner: true },
  CRANDELL: { cik: "0001219039", name: "CRANDELL KEITH", role: "10% Owner", isTenPercentOwner: true },
};
const XIV = [ARCH.AVP14, ARCH.AVP14LLC, ARCH.AVF14, ARCH.BERNS];
const X = [ARCH.AVF10, ARCH.AVF10O, ARCH.CRANDELL];
const aspeRows = ({ xivAt = "2026-11-02 21:46:27", xAt = "2026-11-02 21:50:27", withIndirect = true } = {}) => {
  const xiv = tx({ owners: XIV, date: "2026-11-02", accepted: xivAt, shares: 1_200_000, price: 15, sharesOwnedAfter: 1_200_000, ticker: "ASPE", issuerCik: "0002124080", context: "unspecified", accessionNo: "0001193125-26-444141" });
  const xRows = [
    tx({ owners: X, date: "2026-11-02", accepted: xAt, shares: 66_666, price: 15, sharesOwnedAfter: 66_666, ticker: "ASPE", issuerCik: "0002124080", context: "unspecified", accessionNo: "0001193125-26-444147" }),
    { ...tx({ owners: X, date: "2026-11-02", accepted: xAt, shares: 66_667, price: 15, sharesOwnedAfter: 66_667, ticker: "ASPE", issuerCik: "0002124080", context: "unspecified", accessionNo: "0001193125-26-444147" }), id: "0001193125-26-444147:6" },
  ];
  if (withIndirect) {
    xRows.push({ ...tx({ owners: X, date: "2026-11-02", accepted: xAt, shares: 1_200_000, price: 15, sharesOwnedAfter: 1_200_000, ownership: "I", nature: "See Footnote", ticker: "ASPE", issuerCik: "0002124080", context: "unspecified", accessionNo: "0001193125-26-444147",
      footnotes: [{ id: "F5", text: "Shares were purchased by ARCH Venture Fund XIV, L.P. (\"ARCH XIV\"). The AVP X Investment Committee Members also are members of the investment committee for ARCH XIV." }] }), id: "0001193125-26-444147:11" });
  }
  return [xiv, ...xRows];
};

test("ASPE: two fund families of one joint filing are ONE buyer — no signal; the duplicate is still counted once", () => {
  assert.equal(signalsFor(aspeRows()).signals.length, 0, "1 distinct buyer < 2");
  // An unrelated insider joins: now 2 buyers; ARCH's $18M counted once, not twice.
  const ceo = tx({ owners: [O.CEO], date: "2026-11-02", accepted: "2026-11-03 08:00:00", ticker: "ASPE", issuerCik: "0002124080" });
  const s = signalsFor([...aspeRows(), ceo]).signals;
  assert.equal(s.length, 1);
  assert.equal(s[0].uniqueBuyers, 2, "ARCH (all joint filers) + the CEO");
  assert.equal(s[0].valueUsd, 18_000_000 + 999_990 + 1_000_005 + 150_000, "duplicate report not double-counted");
  assert.equal(s[0].purchases, 4);
});

test("without the linking report the two families stay separate (no invented links)", () => {
  // No indirect duplicate → nothing ties the CIK groups together → 2 buyers, as filed.
  const s = signalsFor(aspeRows({ withIndirect: false })).signals;
  assert.equal(s.length, 1);
  assert.equal(s[0].uniqueBuyers, 2);
});

test("point-in-time: a link that becomes public LATER never retracts an earlier signal", () => {
  // X family files first (Oct 30), XIV family files (Nov 2 21:46) → signal with 2 buyers then;
  // the linking indirect report only appears on Nov 3.
  const rows = aspeRows({ xivAt: "2026-11-02 21:46:27", xAt: "2026-10-30 18:00:00", withIndirect: false });
  const late = { ...aspeRows({ xAt: "2026-11-03 09:00:00" })[3], accessionNo: "0001193125-26-999999", id: "0001193125-26-999999:0", acceptedAtET: "2026-11-03 09:00:00 ET", filingDate: "2026-11-03" };
  const s = signalsFor([...rows, late]).signals;
  assert.equal(s.length, 1, "signal published before the link was public");
  assert.equal(s[0].publishedAt, "2026-11-02 21:46:27 ET");
  assert.equal(s[0].uniqueBuyers, 2);
});

test("independent buyers are never merged: identical-looking purchases without relationship evidence, or a shared manager", () => {
  // Same issuer, date, shares, price and shares-owned-after — but no filing names the other and
  // both hold directly: transactionGroups keeps them separate ("needs_review"), so 2 buyers.
  const a = tx({ owners: [O.DIR], date: "2026-03-02", accepted: "2026-03-03 17:00:00", sharesOwnedAfter: 9_000 });
  const b = tx({ owners: [O.DIR2], date: "2026-03-02", accepted: "2026-03-03 17:05:00", sharesOwnedAfter: 9_000 });
  const s = signalsFor([a, b]).signals;
  assert.equal(s.length, 1);
  assert.deepEqual([s[0].uniqueBuyers, s[0].valueUsd], [2, 300_000]);
  // Two funds advised by the same investment manager (named in both footnotes) buying different blocks.
  const mgr = [{ id: "F1", text: "Shares held by the fund, which is advised by Example Capital Management LLC." }];
  const f1 = tx({ owners: [{ cik: "0000000301", name: "Example Growth Fund LP", role: "10% Owner", isTenPercentOwner: true }], date: "2026-04-01", accepted: "2026-04-02 17:00:00", footnotes: mgr });
  const f2 = tx({ owners: [{ cik: "0000000302", name: "Example Value Fund LP", role: "10% Owner", isTenPercentOwner: true }], date: "2026-04-01", accepted: "2026-04-02 17:10:00", shares: 3100, footnotes: mgr });
  assert.equal(signalsFor([f1, f2]).signals[0].uniqueBuyers, 2);
});
