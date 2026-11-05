// PROTOTYPE ONLY — fictional companies, people, filings and prices.
// Nothing here is SEC data or market data. Deterministic (seeded) so every reload looks the same.
//
// Internally consistent simulation:
//   • SEC acceptance times fall on EDGAR business days, 06:00–22:00 ET (EDGAR is closed on
//     federal holidays, e.g. Columbus Day — while NYSE is open).
//   • One simulated daily OHLC series per company (+ SPY) on the NYSE 2026 calendar.
//   • Entry, latest close, return, SPY return, R1/R5/R20, peak and the sparkline are ALL derived
//     from that one series with the screener's entry rule — nothing is assigned independently.
//   • Entry rule: acceptance + 60 s ≤ 09:28 ET on a session day → that day's open ("next open");
//     during the session → first regular trade that day; after the close / non-session day →
//     next session's open. A session counts once its close (16:00, early close 13:00) has passed.

const HOUR = 3_600_000, DAY = 86_400_000;
export const ASOF = "2026-11-05"; // last completed NYSE session in the simulation
const DST = (d) => d >= "2026-03-08" && d < "2026-11-01";
export const etMs = (date, time) => Date.parse(`${date}T${time}:00Z`) + (DST(date) ? 4 : 5) * HOUR;
export const NOW = etMs("2026-11-05", "17:45"); // Thu Nov 5 2026, 17:45 ET — after the close

function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const r = rng(20261105);
const pick = (xs) => xs[Math.floor(r() * xs.length)];
const between = (a, b) => a + r() * (b - a);
const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
const gauss = () => { let u = 0; while (!u) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); };

// ---------------------------------------------------------------- calendars (2026)
const NYSE_HOLIDAYS = new Set(["2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25"]);
const NYSE_EARLY = new Set(["2026-11-27", "2026-12-24"]);
const FEDERAL_HOLIDAYS = new Set([...NYSE_HOLIDAYS, "2026-10-12", "2026-11-11"]); // EDGAR closed; NYSE open on Oct 12 / Nov 11
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const weekday = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();
export const isSession = (d) => weekday(d) % 6 !== 0 && !NYSE_HOLIDAYS.has(d);
const isEdgarDay = (d) => weekday(d) % 6 !== 0 && !FEDERAL_HOLIDAYS.has(d);
const closeTime = (d) => (NYSE_EARLY.has(d) ? "13:00" : "16:00");
export const nextSession = (d) => { let x = addDays(d, 1); while (!isSession(x)) x = addDays(x, 1); return x; };
const prevSession = (d) => { let x = addDays(d, -1); while (!isSession(x)) x = addDays(x, -1); return x; };
const SESSIONS = []; for (let d = "2026-04-01"; d <= ASOF; d = addDays(d, 1)) if (isSession(d)) SESSIONS.push(d);
const IDX = new Map(SESSIONS.map((d, i) => [d, i]));
export function msToEt(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
const plusMinute = (t) => { const [h, m] = t.split(":").map(Number); const x = h * 60 + m + 1; return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`; };

// Snap "h hours ago" to a real EDGAR acceptance moment (business day, 06:00–21:59 ET, not in the future).
function edgarMoment(hoursAgo) {
  let { date, time } = msToEt(NOW - hoursAgo * HOUR);
  if (isEdgarDay(date) && time >= "06:00" && time <= "21:59") return etMs(date, time);
  if (isEdgarDay(date) && time < "06:00") date = addDays(date, -1);
  while (!isEdgarDay(date)) date = addDays(date, -1);
  const mins = 6 * 60 + Math.floor(r() * 16 * 60);
  return etMs(date, `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`);
}

// Entry for a publication moment (see header). → { date, type, frac } ; frac = position within the session.
export function entryFor(ms) {
  const { date, time } = msToEt(ms);
  const t = plusMinute(time); // + 60 s execution latency
  if (isSession(date) && t <= "09:28") return { date, type: "next open", frac: 0 };
  if (isSession(date) && t < closeTime(date)) {
    const [h, m] = t.split(":").map(Number), [ch] = closeTime(date).split(":").map(Number);
    return { date, type: "first regular trade", frac: Math.max(0, Math.min(1, (h * 60 + m - 570) / (ch * 60 - 570))) };
  }
  return { date: nextSession(date), type: "next open", frac: 0 };
}

// ---------------------------------------------------------------- price series
function series({ base, sigma, mu, upto = ASOF }) {
  const n = IDX.get(upto) + 1;
  const closes = [base], gaps = [], wick = [];
  for (let i = 1; i < n; i++) closes.push(closes[i - 1] * Math.exp(mu + sigma * gauss()));
  for (let i = 0; i < n; i++) { gaps.push(sigma * 0.35 * gauss()); wick.push([Math.abs(gauss()) * sigma * 0.5, Math.abs(gauss()) * sigma * 0.5]); }
  return { closes, gaps, wick, n };
}
function bars(s) {
  return s.closes.map((c, i) => {
    const o = i ? s.closes[i - 1] * (1 + s.gaps[i]) : c;
    return { d: SESSIONS[i], o, h: Math.max(o, c) * (1 + s.wick[i][0]), l: Math.min(o, c) * (1 - s.wick[i][1]), c };
  });
}
const entryPriceOf = (b, type, frac) => (type === "next open" ? b.o : Math.min(b.h, Math.max(b.l, b.o + (b.c - b.o) * frac)));
// Steer only the closes AFTER the entry session so the path ends at the intended return; entry and
// everything before it are untouched, and every metric is then read from the final bars.
function steer(s, e, entryPrice, target) {
  const last = s.n - 1;
  if (target == null || last <= e) return;
  const k = (entryPrice * (1 + target)) / s.closes[last];
  for (let i = e + 1; i <= last; i++) s.closes[i] *= k ** ((i - e) / (last - e));
}

const SPY = bars(series({ base: 628, sigma: 0.0075, mu: 0.0004 }));
export const SPY_SERIES = SPY;

// Performance for one publication moment, read from one company's bars.
function perfFor(b, pubMs, { status = "ok", marksMs = [] } = {}) {
  if (status === "uncertain_security" || status === "no_data") return { status };
  const ent = entryFor(pubMs);
  if (ent.date > ASOF) return { status: "pending", nextEntry: ent.date, publishedAfterClose: true };
  const e = IDX.get(ent.date);
  const lastBar = b[b.length - 1];
  if (e == null || e > b.length - 1) return { status: "series_ended", endedOn: lastBar.d };
  if (status === "series_ended") return { status, endedOn: lastBar.d };
  const post = b.slice(e);
  const entryPrice = entryPriceOf(b[e], ent.type, ent.frac);
  const spyEntry = entryPriceOf(SPY[e], ent.type, ent.frac);
  const spyLast = SPY[IDX.get(lastBar.d)].c;
  const ret = lastBar.c / entryPrice - 1, spyRet = spyLast / spyEntry - 1;
  const rk = (k) => (post.length >= k ? post[k - 1].c / entryPrice - 1 : null);
  const peakCands = ent.type === "next open" ? post.map((x) => [x.h, x.d]) : [[post[0].c, post[0].d], ...post.slice(1).map((x) => [x.h, x.d])];
  const [peakPx, peakDate] = peakCands.reduce((m, x) => (x[0] > m[0] ? x : m), [-Infinity, null]);
  // sparkline: up to 15 sessions of pre-publication context + every session since entry (≤ 60 points)
  const pre = b.slice(Math.max(0, e - 15), e).map((x) => x.c);
  let postC = [entryPrice, ...post.map((x) => x.c)];
  if (postC.length > 61) { const step = (postC.length - 1) / 60; postC = Array.from({ length: 61 }, (_, i) => postC[Math.round(i * step)]); }
  const marks = marksMs.map((ms) => { const en = entryFor(ms); const j = IDX.get(en.date); return j == null || j > IDX.get(lastBar.d) ? null : Math.min(postC.length - 1, Math.round(((j - e + (en.type === "next open" ? 0 : 1)) / Math.max(1, post.length)) * (postC.length - 1))); }).filter((x) => x != null);
  const staleSessions = IDX.get(ASOF) - IDX.get(lastBar.d);
  return {
    status: staleSessions > 0 ? "stale" : "ok", staleSessions,
    entryDate: ent.date, entryType: ent.type, entryPrice, asOf: lastBar.d, lastClose: lastBar.c,
    ret, spyRet, excess: ret - spyRet, sessions: post.length,
    r1: rk(1), r5: rk(5), r20: rk(20), peak: peakPx / entryPrice - 1, peakDate,
    spark: { pre, post: postC, marks },
  };
}

// ---------------------------------------------------------------- people / names
const FIRST = ["Elena", "Marcus", "Priya", "Daniel", "Sofia", "Jonah", "Miriam", "Victor", "Hannah", "Theo", "Rafael", "Grace", "Omar", "Lena", "Arthur", "Noa", "Simon", "Clara", "Isaac", "Yael"];
const LAST = ["Halvorsen", "Achterberg", "Okafor", "Lindqvist", "Marchetti", "Brandt", "Castellanos", "Weiss", "Nakamura", "Doyle", "Ferreira", "Kowalski", "Ashby", "Rourke", "Tamsin", "Valdez", "Engström", "Hale", "Moreau", "Sato"];
const FUNDS = ["Ridgeline Capital Partners LP", "Ostrander Value Fund", "Bluewater Opportunities LLC", "Kestrel Point Advisors", "Harbor Ash Holdings LP"];
const PARTS_A = ["Northwind", "Calder", "Brightwater", "Ironvale", "Solent", "Arden", "Meridian", "Quarry", "Halcyon", "Corvid", "Lumen", "Pellucid", "Tamarack", "Westmark", "Orrin", "Silverline", "Kepler", "Fenwick", "Aldous", "Cobalt", "Granite Peak", "Juniper", "Vantor", "Redfern", "Stillwater", "Thorne", "Everly", "Marlow", "Ostara", "Penrose"];
const PARTS_B = [["Biosciences", "Healthcare"], ["Freight Systems", "Industrials"], ["Energy Partners", "Energy"], ["Bancorp", "Financials"], ["Semiconductor", "Technology"], ["Therapeutics", "Healthcare"], ["Holdings", "Industrials"], ["Software", "Technology"], ["Minerals", "Materials"], ["Realty Trust", "Real Estate"], ["Foods", "Consumer Staples"], ["Retail Group", "Consumer Discretionary"], ["Networks", "Communication"], ["Financial", "Financials"], ["Robotics", "Technology"]];
function person(seen) {
  let n;
  do { n = `${pick(LAST)} ${pick(FIRST)}`; } while (seen.has(n.split(" ")[0]));
  seen.add(n.split(" ")[0]);
  return n;
}

// ---------------------------------------------------------------- showcase rows (each demonstrates one behaviour)
// sig / lat: SEC acceptance (ET). target: intended return since the SIGNAL entry — realised by the path.
const SHOWCASE = [
  { ticker: "NWBX", name: "Northwind Biosciences", sector: "Healthcare", cluster: "C", econ: 6, legal: 7, roles: ["CEO", "CFO", "Dir"], value: 4_860_000, dOwn: 0.22, sig: ["2026-10-30", "17:30"], lat: ["2026-11-05", "14:12"], later: 3, target: 0.071, momentum: "accelerating", repeat: true, quality: "verified", note: "Cluster C — evolved from 1 to 6 independent buyers in 7 days. Published Friday after the close → entry Monday’s open." },
  { ticker: "CALF", name: "Calder Freight Systems", sector: "Industrials", cluster: "B", econ: 3, legal: 3, roles: ["CEO", "Dir"], value: 1_240_000, dOwn: 0.41, sig: ["2026-11-04", "14:06"], later: 0, target: -0.034, momentum: "accelerating", firstBuy: "CEO's first open-market buy in coverage", quality: "verified", note: "Published during market hours → entry is the first regular-session trade after acceptance + 60 s." },
  { ticker: "IVMN", name: "Ironvale Minerals", sector: "Materials", cluster: "A", econ: 2, legal: 5, roles: ["Dir", "10%"], value: 2_950_000, dOwn: 0.06, sig: ["2026-11-03", "07:45"], lat: ["2026-11-05", "16:58"], later: 1, target: 0.012, momentum: "steady", quality: "warning", flags: ["related_entities"], note: "5 legal filers → 2 independent economic buyers. The latest filing came after today’s close: the LATEST anchor is pending while the SIGNAL anchor is priced." },
  { ticker: "REMF", name: "Redfern Maritime", sector: "Industrials", cluster: null, econ: 1, legal: 1, roles: ["10%"], value: 310_000, dOwn: 0.015, sig: ["2026-11-02", "20:15"], later: 0, target: 0.004, momentum: "single", quality: "warning", flags: ["aggregate_price"], note: "One row reported a total amount in the price field — excluded from value, shown in evidence." },
  { ticker: "HLCY", name: "Halcyon Therapeutics", sector: "Healthcare", cluster: "B", econ: 4, legal: 4, roles: ["CEO", "CFO", "Dir"], value: 3_100_000, dOwn: 0.12, sig: ["2026-10-27", "06:40"], lat: ["2026-11-03", "19:05"], later: 2, target: 0.384, sigma: 0.04, momentum: "slowing", repeat: true, quality: "uncertain", flags: ["offering"], note: "Same-day purchases at one price alongside an 8-K — likely a private placement, not open-market. The stock has already moved a lot since publication." },
  { ticker: "SLNT", name: "Solent Semiconductor", sector: "Technology", cluster: null, econ: 1, legal: 1, roles: ["CEO"], value: 5_200_000, dOwn: 0.09, sig: ["2026-11-05", "16:52"], later: 0, momentum: "single", firstBuy: "First buy by this CEO in 3+ years", quality: "verified", note: "Published after today’s close → entry is tomorrow’s open. No return exists yet — shown as pending, not as missing." },
  { ticker: "ARDN", name: "Arden Bancorp", sector: "Financials", cluster: "A", econ: 3, legal: 3, roles: ["CEO", "Dir"], value: 780_000, dOwn: 0.08, sig: ["2026-10-09", "16:40"], lat: ["2026-10-27", "10:15"], later: 1, target: -0.112, momentum: "steady", repeat: true, quality: "verified", note: "Published Friday after the close; Monday Oct 12 was a market session (EDGAR closed for Columbus Day). Latest close is below the insiders’ average purchase price." },
  { ticker: "QRYX", name: "Quarry Energy Partners", sector: "Energy", cluster: null, econ: 2, legal: 2, roles: ["Dir"], value: 455_000, dOwn: 0.03, sig: ["2026-09-24", "08:10"], later: 0, target: -0.06, momentum: "steady", quality: "verified", price: "series_ended", endAt: "2026-10-21", note: "The price series stops on Oct 21 (delisting / ticker change / vendor gap). Never extrapolated." },
  { ticker: "PNRS.B", name: "Penrose Holdings (Class B)", sector: "Industrials", cluster: null, econ: 2, legal: 2, roles: ["CEO", "10%"], value: 1_900_000, dOwn: 0.05, sig: ["2026-10-29", "12:30"], later: 0, momentum: "steady", quality: "uncertain", flags: ["security_class"], price: "uncertain_security" },
  { ticker: "VNTR", name: "Vantor Retail Group", sector: "Consumer Discretionary", cluster: null, econ: 1, legal: 1, roles: ["Dir"], value: 96_000, dOwn: 0.004, sig: ["2026-10-08", "18:20"], later: 0, target: 0.051, momentum: "single", quality: "warning", flags: ["currency"] },
];

// ---------------------------------------------------------------- generated rows
// Identity attributes (ticker, buyers, value, publication age, quality …) replay the exact random
// sequence of the first prototype version, so rows keep the tickers reviewers already saw.
// Prices are NOT replayed: they come from the simulated series below.
const rid = rng(20261105);
const ipick = (xs) => xs[Math.floor(rid() * xs.length)];
const ibetween = (a, b) => a + rid() * (b - a);
const generated = [];
const usedT = new Set(SHOWCASE.map((s) => s.ticker));
for (let i = 0; i < 54; i++) {
  const a = PARTS_A[i % PARTS_A.length];
  const [b, sector] = PARTS_B[(i * 7) % PARTS_B.length];
  let t;
  do { t = (a.replace(/[^A-Z]/gi, "").slice(0, 2) + ipick(["X", "R", "N", "L", "T", "Q", "V"]) + ipick(["A", "E", "K", "S", ""])).toUpperCase(); } while (usedT.has(t));
  usedT.add(t);
  const econ = rid() < 0.5 ? 1 : rid() < 0.6 ? 2 : rid() < 0.7 ? 3 : Math.round(ibetween(4, 7));
  const cluster = econ >= 5 && rid() < 0.8 ? "C" : econ >= 3 && rid() < 0.6 ? "B" : econ >= 2 && rid() < 0.4 ? "A" : null;
  const roles = econ === 1 ? [ipick(["CEO", "CFO", "Dir", "Dir", "10%"])] : [...new Set([ipick(["CEO", "Dir", "CFO"]), ipick(["Dir", "Dir", "10%", "CFO"]), "Dir"])].slice(0, Math.min(econ, 3));
  const value = Math.round(Math.exp(ibetween(Math.log(40_000), Math.log(econ > 2 ? 6_000_000 : 2_500_000))));
  const hoursAgo = Math.round(Math.exp(ibetween(Math.log(2), Math.log(1900))));
  const target = round(ibetween(-0.18, 0.22) + (rid() < 0.06 ? 0.3 : 0), 4); // intended return since the signal entry
  const q = rid();
  const legal = econ + (rid() < 0.12 ? 1 : 0);
  const dOwn = round(ibetween(0.003, 0.3), 3);
  const signalDaysAgo = hoursAgo / 24 + ibetween(0, 6);
  const later = rid() < 0.25 ? Math.ceil(rid() * 3) : 0;
  ibetween(-0.01, 0.025); // consumed: the first version assigned an SPY return here — now read from the SPY series
  const momentum = econ === 1 ? "single" : ipick(["accelerating", "steady", "steady", "slowing"]);
  const firstBuy = rid() < 0.08 ? "First buy by this insider in coverage" : null;
  const repeat = rid() < 0.22;
  const flags = q >= 0.78 && q < 0.94 ? [ipick(["related_entities", "aggregate_price"])] : q >= 0.94 ? ["offering"] : [];
  const row = {
    ticker: t, name: `${a} ${b}`, sector, cluster, econ, legal, roles, value, dOwn,
    // FIX: the first version gave every row a signal 0–6 days older than its latest filing even with
    // no later filings, and called it "pending" from the LATEST filing's age. Now: no later filings ⇒
    // signal = latest filing; later filings ⇒ the signal is the older publication.
    latestHours: hoursAgo, later, signalExtraDays: later ? Math.max(0.5, signalDaysAgo - hoursAgo / 24) : 0,
    target, scaleTarget: true, sigma: between(0.014, 0.036), momentum, firstBuy, repeat,
    quality: q < 0.78 ? "verified" : q < 0.94 ? "warning" : "uncertain", flags,
  };
  // intentional UI-state sample (everything else is priced)
  if (i === 0) Object.assign(row, { sig: ["2026-11-05", "17:20"], later: 0, note: "Published after today’s close → awaiting tomorrow’s open (pending, not missing)." });
  if (i === 3) Object.assign(row, { sig: ["2026-10-20", "19:10"], later: 0, price: "stale", endAt: "2026-11-02", note: "No bar since Nov 2 (trading halt or vendor gap) — values are shown as of Nov 2 and flagged stale." });
  if (i === 9) Object.assign(row, { price: "no_data", note: "The price provider has no series for this ticker (e.g. OTC / foreign listing). Nothing is estimated." });
  generated.push(row);
}

// ---------------------------------------------------------------- build
function buildCompany(s, idx) {
  const seen = new Set();
  // publication moments
  const latestMs = s.lat ? etMs(...s.lat) : s.sig && !s.later ? etMs(...s.sig) : edgarMoment(s.latestHours);
  let signalMs = s.sig ? etMs(...s.sig) : s.later ? edgarMoment(s.latestHours + s.signalExtraDays * 24) : latestMs;
  if (s.later && signalMs >= latestMs) { // both snapped onto the same EDGAR day → signal = previous EDGAR day, 18:30 ET
    let d = addDays(msToEt(latestMs).date, -1);
    while (!isEdgarDay(d)) d = addDays(d, -1);
    signalMs = etMs(d, "18:30");
  }
  const sigEt = msToEt(signalMs);

  // trade dates of the purchases that formed the signal (sessions on/before the signal date)
  const lastTrade = isSession(sigEt.date) && sigEt.time >= "09:30" ? sigEt.date : prevSession(sigEt.date);
  const spanDays = s.cluster === "C" ? 7 : s.cluster === "B" ? 2 : s.cluster === "A" ? 0 : 9;
  const tradeDays = SESSIONS.filter((d) => d <= lastTrade && d >= addDays(lastTrade, -spanDays));

  // price series (generated through the end date; steered after the signal entry)
  const base = between(4, 140);
  const raw = series({ base, sigma: s.sigma ?? between(0.015, 0.03), mu: between(-0.0006, 0.0008), upto: s.endAt || ASOF });
  const ent = entryFor(signalMs);
  if (ent.date <= (s.endAt || ASOF) && IDX.has(ent.date)) {
    const e = IDX.get(ent.date);
    const pre = bars(raw);
    // generated rows: the intended move grows with √time since entry (a 2-session-old filing does not get a 40-session move)
    const held = raw.n - e;
    const target = s.target == null ? null : s.scaleTarget ? s.target * Math.min(1, Math.sqrt(held / 40)) : s.target;
    steer(raw, e, entryPriceOf(pre[e], ent.type, ent.frac), target);
  }
  const b = s.price === "no_data" ? [] : bars(raw);
  const closeOn = (d) => (b.length ? b[Math.min(IDX.get(d), b.length - 1)].c : base);

  // buyers
  const buyers = [];
  for (let i = 0; i < s.econ; i++) {
    const role = s.roles[i] || (i < 3 ? "Dir" : pick(["Dir", "Officer"]));
    const name = role === "10%" ? pick(FUNDS) : person(seen);
    const legal = [{ name, cik: `000${1_600_000 + idx * 37 + i}`, ownership: r() > 0.5 ? "D" : "I" }];
    if (s.legal > s.econ && i === 0) for (let j = 0; j < s.legal - s.econ; j++) legal.push({ name: `${name.split(" ")[0]} ${pick(["Family Trust", "Holdings LLC", "Partners II LP", "Master Fund", "GP LLC"])}`, cik: `000${1_700_000 + idx * 11 + j}`, ownership: "I" });
    buyers.push({ name, role, legal, ownedAfterIncrease: round(s.dOwn * between(0.6, 1.4), 3) });
  }

  // purchase events: one per buyer before the signal, then later filings
  const n = buyers.length;
  const events = buyers.map((bu, i) => {
    const trade = tradeDays[Math.min(tradeDays.length - 1, Math.floor((i / Math.max(1, n - 1)) * (tradeDays.length - 1)))] || lastTrade;
    // cluster Form 4s are typically accepted minutes apart; never before 06:00 ET of the signal day
    const filed = Math.max(signalMs - (n - 1 - i) * 2 * 60_000, etMs(sigEt.date, "06:00"));
    return { trade, filed, who: bu.name, role: bu.role, w: i === 0 ? 0.45 : 0.55 / Math.max(1, n - 1) };
  });
  const latestEt = msToEt(latestMs);
  for (let k = 0; k < (s.later || 0); k++) {
    const span = SESSIONS.filter((d) => d > sigEt.date && d <= latestEt.date);
    const trade = span[Math.min(span.length - 1, Math.floor(((k + 1) / (s.later + 1)) * span.length))] || latestEt.date;
    const evening = etMs(trade, "18:00");
    const filed = k === s.later - 1 ? latestMs : isEdgarDay(trade) && evening > signalMs && evening < latestMs ? evening : Math.max(signalMs + 60_000, latestMs - (s.later - 1 - k) * 2 * 60_000, etMs(latestEt.date, "06:00"));
    const bu = buyers[k % n];
    events.push({ trade, filed, who: bu.name, role: bu.role, w: 0.08, later: true });
  }
  const wsum = events.reduce((t, e) => t + e.w, 0);
  let acc = 0;
  const counted = events.map((e, i) => {
    const value = i === events.length - 1 ? s.value - acc : Math.round((e.w / wsum) * s.value);
    acc += value;
    const bu = buyers.find((x) => x.name === e.who);
    const price = round(closeOn(e.trade) * (1 + between(-0.006, 0.006)));
    const type = s.flags?.includes("offering") ? "offering" : i % 4 === 3 && s.quality !== "verified" ? "unknown" : i % 3 === 2 ? "likely_om" : "verified_om";
    return {
      tradeDate: e.trade, filedMs: e.filed, owner: bu.legal[0].name, economic: bu.name, role: bu.role, ownership: bu.legal[0].ownership,
      shares: Math.round(value / price), price, value, type, later: !!e.later,
      accession: `0001${String(900000 + idx * 97 + i).padStart(6, "0")}-26-${String(4000 + i * 13).padStart(6, "0")}`,
    };
  });
  for (const bu of buyers) {
    const rows = counted.filter((c) => c.economic === bu.name);
    bu.value = rows.reduce((t, c) => t + c.value, 0);
    bu.shares = rows.reduce((t, c) => t + c.shares, 0);
  }
  const insiderAvgPrice = s.value / counted.reduce((t, c) => t + c.shares, 0);

  const excluded = [];
  if (s.legal > s.econ) excluded.push({ reason: "Same transaction reported by a related filer", detail: `${s.legal - s.econ} related filer(s) (trust / LLC / fund GP) reported the identical purchase. Counted once under the economic buyer; every filing kept as evidence.`, owner: buyers[0].legal[1]?.name || "Related filer", value: buyers[0].value, kind: "duplicate" });
  if (s.flags?.includes("aggregate_price")) excluded.push({ reason: "Total amount entered in the price-per-share field", detail: "Filed price $310,000.00 for 12,400 shares; the footnote states “aggregate purchase price”. Excluded from value totals — the original filing values are preserved.", owner: buyers[0].name, value: null, kind: "price" });
  if (s.flags?.includes("currency")) excluded.push({ reason: "Currency not verified (BRL stated in footnote)", detail: "Price reported in Brazilian reais according to the footnote. Not converted automatically; excluded from USD totals until verified.", owner: buyers[0].name, value: null, kind: "currency" });
  if (idx % 4 === 0) excluded.push({ reason: "Superseded by Form 4/A", detail: "An amendment replaced this row; only the amended values are counted. The original accession stays in the record and the publication anchor stays on the original filing.", owner: buyers[0].name, value: Math.round(s.value * 0.1), kind: "amendment" });

  const flags = [];
  if (s.flags?.includes("related_entities")) flags.push({ code: "related_entities", label: "Related filers merged", detail: "Several legal filers belong to one economic buyer (fund family / trust / manager)." });
  if (s.flags?.includes("aggregate_price")) flags.push({ code: "aggregate_price", label: "Price-field anomaly", detail: "One row reports a total amount as price per share. Excluded from value." });
  if (s.flags?.includes("offering")) flags.push({ code: "offering", label: "Likely private placement", detail: "Purchases at a single price on the same day alongside an issuer financing filing. Not counted as open-market." });
  if (s.flags?.includes("security_class")) flags.push({ code: "security_class", label: "Security class uncertain", detail: "Purchases are Class B shares; the price series found is for Class A. No return is computed." });
  if (s.flags?.includes("currency")) flags.push({ code: "currency", label: "Currency unverified", detail: "A row is reported in a non-USD currency." });

  const laterMs = counted.filter((c) => c.later).map((c) => c.filedMs);
  const status = s.price || "ok";
  const perfSignal = perfFor(b, signalMs, { status, marksMs: laterMs });
  const perfLatest = latestMs === signalMs ? perfSignal : perfFor(b, latestMs, { status });
  for (const p of [perfSignal, perfLatest]) if (p.lastClose != null) p.belowInsider = p.lastClose < insiderAvgPrice;

  const types = counted.reduce((m, c) => { m[c.type] = (m[c.type] || 0) + 1; return m; }, {});
  const days = Array(30).fill(0);
  for (const c of counted) { const d = Math.round((Date.parse(`${ASOF}T00:00:00Z`) - Date.parse(`${c.tradeDate}T00:00:00Z`)) / DAY); if (d >= 0 && d < 30) days[29 - d] += 1; }

  return {
    id: `c${idx}`, ticker: s.ticker, name: s.name, sector: s.sector,
    quality: { status: s.quality, flags },
    buyers: { economic: s.econ, legal: s.legal, roles: [...new Set(s.roles)] },
    purchases: { count: counted.length, verifiedOM: types.verified_om || 0, likelyOM: types.likely_om || 0, offering: types.offering || 0, unknown: types.unknown || 0, verifiedValue: s.value, deltaOwnPct: s.dOwn, insiderAvgPrice },
    cluster: s.cluster,
    publication: { signalAt: signalMs, latestAt: latestMs, laterFilings: s.later || 0 },
    pattern: { momentum: s.momentum, firstBuy: s.firstBuy || null, repeat: !!s.repeat, days },
    evolution: counted.map((c) => ({ at: Date.parse(`${c.tradeDate}T17:00:00Z`), who: c.economic, role: c.role, value: c.value, later: c.later })).reduce((out, e) => { out.push({ ...e, cumulative: e.later ? out.filter((x) => !x.later).length : out.filter((x) => !x.later).length + 1 }); return out; }, []),
    buyersList: buyers, evidence: { counted, excluded },
    note: s.note || null,
    perf: { signal: perfSignal, latest: perfLatest },
  };
}

export const COMPANIES = [...SHOWCASE, ...generated].map(buildCompany);
export const perfOf = (c, anchor) => (anchor === "latest" ? c.perf.latest : c.perf.signal);
export const hasPrice = (p) => p.status === "ok" || p.status === "stale";

export const COVERAGE = { from: "Dec 1, 2025", through: "Nov 5, 2026", missingDays: 14, note: "14 SEC index days between Dec 2025 and Sep 2026 are partially loaded." };
export const PRICE_ASOF_LABEL = "Nov 5 close";
