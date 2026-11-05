// deep6/testNov.mjs — the single pre-registered evaluation of the locked Nov-2025 test period (prereg6.json N1–N6).
//   node --max-old-space-size=8192 scripts/research/deep6/testNov.mjs → .cache/research/deep6/build/test-nov.json
// Refuses to run twice: if test-nov.json exists it prints it instead of recomputing.
import fs from "node:fs";
import path from "node:path";
import * as L from "../deep5/lib5.mjs";
import * as D6 from "./lib6.mjs";
const { mean, median } = L;

const outFile = path.join(D6.OUT6, "test-nov.json");
if (fs.existsSync(outFile)) { console.log("[TEST_NOV] already evaluated once; printing the saved result"); console.log(fs.readFileSync(outFile, "utf8")); process.exit(0); }
fs.appendFileSync(path.join(D6.D6, "prereg.log"), `${new Date().toISOString()} TEST_NOV evaluation started (build hash ${L.sha256(fs.readFileSync(path.join(D6.OUT6, "clusters.json")))})\n`);

const J = D6.readOut("clusters.json");
const isTest = (u) => u.T < D6.TEST_END;
const base = J.unions[2].filter((u) => isTest(u) && u.entryStatus === "ok");
const usable = base.filter((u) => u.full180 && u.ctrlStatus === "ok").map((u) => ({ ...u, issuer: u.cik }));
const N = (items, f, id, what) => ({ id, what, ...L.clusterBoot(items, f) });

// sensitivity helpers
const byId = new Map(J.clusters.map((c) => [c.id, c]));
const NREQ = { A: 2, B: 3, C: 5 };
function mirrorBreaks(u) { // link identical (date, shares, price) transactions across owners regardless of D/I
  const rep = byId.get(u.repId); const par = new Map(); const f = (x) => { while (par.get(x) !== x) x = par.get(x); return x; };
  const seen = new Map(); let usd = 0;
  for (const p of rep.purchases) { if (!par.has(p.insider)) par.set(p.insider, p.insider); const k = `${p.tradeDate}|${p.shares}|${p.price}`; if (seen.has(k)) par.set(f(p.insider), f(seen.get(k))); else { seen.set(k, p.insider); usd += p.usd; } }
  const owners = new Set(rep.purchases.map((p) => f(p.insider)));
  return owners.size < NREQ[rep.cat] || usd <= L.MIN_USD;
}
const bigPrice = (u) => byId.get(u.repId).purchases.some((p) => p.price > 100000);

function run(items) {
  const tests = [
    N(items, (x) => mean(x.map((c) => c.n180 - c.ctl_n180)), "N1", "180d net minus matched controls"),
    N(items.filter((c) => c.x180 != null), (x) => mean(x.map((c) => c.x180)), "N2", "180d net minus SPY"),
    N(items, (x) => mean(x.map((c) => c.maxGain - c.ctl_maxGain)), "N3", "max 180d gain minus controls"),
    N(items, (x) => mean(x.map((c) => c.hit20 - c.ctl_hit20)), "N4", "+20% touch share minus controls"),
    N(items.filter((c) => c.c1r180 != null), (x) => mean(x.map((c) => c.c1r180 - c.r180)), "N5", "hindsight minus public 180d return, same events"),
    N(items, (x) => mean(x.map((c) => c.n180 - c.ctl_n180)), "N6", "deep5 S1 (every union cluster, 180-day hold) net minus controls — same definition as N1"),
  ];
  const q = L.bh(tests.map((t) => t.p)); tests.forEach((t, i) => (t.q = q[i]));
  const rep = {
    N1: tests[0].lo90 <= 0, N2: tests[1].est < 0, N3: tests[2].est < 0, N4: tests[3].est <= 0, N5: tests[4].est > 0 && tests[4].lo90 > 0, N6: !(tests[5].est > 0 && tests[5].lo90 > 0),
  };
  return { n: items.length, issuers: new Set(items.map((c) => c.cik)).size, tests, replicates: rep, confirmed: rep.N1 && rep.N2 && rep.N5 && rep.N6 };
}
const desc = (cs) => ({ n: cs.length, maxGainMedian: median(cs.map((c) => c.maxGain)), daysToMaxMedian: median(cs.map((c) => c.daysToMax)), hit: Object.fromEntries(L.THRESH.map((t) => [t, mean(cs.map((c) => c[`hit${t}`]))])),
  r180Median: median(cs.map((c) => c.r180)), n180Mean: mean(cs.map((c) => c.n180)), spy180Mean: mean(cs.map((c) => c.spy180)), ctlN180Mean: mean(cs.map((c) => c.ctl_n180)), ctlMaxGainMean: mean(cs.map((c) => c.ctl_maxGain)), ctlHit20: mean(cs.map((c) => c.ctl_hit20)) });

const res = {
  at: new Date().toISOString(), testPeriod: `Clock 2 union events disclosed before ${D6.TEST_END}`,
  counts: { unionEvents: J.unions[2].filter(isTest).length, priced: base.length, usable: usable.length, notFull: base.filter((u) => !u.full180).length, noControls: base.filter((u) => u.full180 && u.ctrlStatus !== "ok").length, leftEdge: usable.filter((u) => u.leftEdge).length, byCat: Object.fromEntries(["A", "B", "C"].map((k) => [k, usable.filter((u) => u.cats.includes(k)).length])) },
  main: run(usable), descriptive: desc(usable),
  sensitivity: {
    excludeLeftEdge: run(usable.filter((u) => !u.leftEdge)),
    mirrorLinked: run(usable.filter((u) => !mirrorBreaks(u))),
    noPriceOver100k: run(usable.filter((u) => !bigPrice(u))),
  },
  events: usable.map((u) => ({ ticker: u.ticker, issuer: u.issuer, cats: u.cats, owners: u.owners, usd: u.usd, T: u.T, entryDate: u.entryDate, maxGain: u.maxGain, daysToMax: u.daysToMax, r180: u.r180, n180: u.n180, ctl: u.ctl_n180, x180: u.x180, c1r180: u.c1r180, leftEdge: u.leftEdge })),
};
fs.writeFileSync(outFile, JSON.stringify(res, null, 1));
const p = (x) => (x == null ? "—" : (x * 100).toFixed(1));
console.log("counts", JSON.stringify(res.counts));
for (const t of res.main.tests) console.log(t.id, t.what, "n", t.n, "est", p(t.est), "90%", p(t.lo90), p(t.hi90), "p", t.p?.toFixed(3), "q", t.q?.toFixed(3));
console.log("replicates", JSON.stringify(res.main.replicates), "CONFIRMED", res.main.confirmed);
for (const [k, v] of Object.entries(res.sensitivity)) console.log("sens", k, "n", v.n, v.tests.map((t) => `${t.id} ${p(t.est)}`).join(" "), "confirmed", v.confirmed);
console.log("desc", JSON.stringify(res.descriptive));
