// deep4/panel/schema.mjs — writes .cache/research/deep4/panel/schema.json (field dictionary) and checks that every field of
// panel.json and controls.json is documented.   node scripts/research/deep4/panel/schema.mjs
import fs from "node:fs";
import path from "node:path";
import * as PL from "./panelLib.mjs";

const T = "t = SEC acceptance (ET) + 60 s";
const D = {
  // ---- ids / timing ----
  key: "event key = SEC accession number (unique)", acc: "SEC accession number", cik: "issuer CIK (number)", ticker: "issuer ticker (p-filings, else any P row of the filing)",
  sym: "bar symbol (ticker normalised; tickerless filings mapped through other rows of the same CIK)", issuer: "issuer name", form: "4 or 4/A",
  person: "buyer identity, app rule (p-filings.json person: union-find over reporting-owner CIKs/names incl. confirmed duplicate reports; store-wide links)",
  ownerName: "first reporting owner of the largest row", ownerCik: "its CIK", segment: "lib4.segmentOf(publishedAt): design / confirm / exposed", month: "decision month (YYYY-MM of publishedAt)",
  publishedAt: "SEC acceptance time, ET wall clock", decisionAt: `decision time ${T} (ET)`, decisionDate: "date of decisionAt",
  window: "publication window: premarket_04_0930 / regular_session / after_close_to_20 / evening_20_24 / overnight_00_04 / non_session_day",
  entryDate: "public-trader entry session: first session whose 09:28 ET MOO cut-off is >= t (execLib.entryOf mooCutoff)", entryMonth: "YYYY-MM of entryDate",
  tradeDate: "trade date of the largest valued P row", tradeDateMin: "earliest trade date among the filing's P rows", tradeDateMax: "latest trade date among the filing's P rows",
  dupKey: "person|cik|entryDate: filings of one person at one issuer entering at the same open", dupSize: "filings in the dupKey group (may include filings accepted after t but before the entry open — NOT a feature)",
  dupRank: "rank by acceptance inside the dupKey group", isPrimary: "1 = first-accepted filing of its dupKey group (use for one-row-per-economic-event)",
  amend: "store amendment status (superseded = a LATER 4/A exists: hindsight, NOT a feature)", dedupe: "store dedupe status (NOT a feature)",
  priceStatus: "ok | no_ticker | no_bars | entry_before_first_bar | entry_after_last_bar | entry_embargo (entry on/after the price cutoff) | entry_censored",
  priced: "1 = an official open exists on the entry session", primary: "1 = class v2 open-market AND valued AND priced (primary universe)",
  // ---- purchase ----
  cls: "classification v2 (deep2 filing-class.json): om / entity / offering / unknown", venueStated: "Form-4 stated purchase context of the largest row",
  security: "security title (largest row)", commonLike: "1 common / ordinary / class A–C shares; 0 preferred, warrant, unit, note, ADS…", plan10b5: "1 if any row is flagged 10b5-1",
  rowsN: "code-P rows in the filing (after the amendment rule)", role: "role text of the largest row", isCEO: "role flag", isCFO: "role flag", isDirector: "role flag", isTenPct: "role flag (10% owner)",
  isOfficer: "role flag: CEO, CFO or other officer title (incl. chairman; deep2 rolesOfText)", primaryRole: "CEO > CFO > Officer > Director > TenPct > Other",
  ownership: "D, I or D+I over the filing's rows", ownD: "any direct row", ownI: "any indirect row", valued: "1 = at least one row with value > 0 and no price anomaly",
  usd: "sum of valued rows' USD value", shares: "sum of shares over P rows", sharesValued: "sum of shares over valued rows", priceVwap: "usd / sharesValued (as traded)",
  priceReported: "as-traded price of the largest valued row (null on price anomaly)", sharesAfter: "sum over ownership lines of max sharesOwnedAfter (deep3 holdingsOf)",
  pctHold: "shares bought / holdings before the purchase (null when prior holdings ~ 0)", firstPosition: "1 = prior holdings ~ 0 (new position), null if holdings invalid",
  holdValid: "1 = holdings arithmetic consistent", lagDays: "decisionDate − tradeDate (calendar days)", lagDaysFirst: "decisionDate − tradeDateMin", tdAfterDecision: "data error flag: trade date after the decision date",
  // ---- person history (filings of the same person accepted strictly before this filing; visible segments; left-censored at 2025-12-01) ----
  pPrior: "the person's earlier purchase filings (any issuer, any class)", pPriorCo: "… at this issuer", pPriorOm: "… open-market class", pCompanies: "distinct issuers bought so far incl. this one",
  pFirstEver: "1 = no earlier purchase since 2025-12-01", pConcurrent: "other filings of the person accepted in the same second", pObsDays: "days of observable history (date(t) − 2025-12-01)",
  pDaysSincePrev: "days since the person's previous purchase filing (acceptance dates, any issuer)", pDaysSincePrevCo: "… at this issuer", pTdDaysSincePrev: "trade-date gap to the latest earlier purchase",
  pUsdRatioMax: "usd / max usd of the person's earlier valued purchases (any issuer)", pUsdRatioMed: "usd / median of those", pUsdRatioMaxCo: "usd / max earlier usd at this issuer",
  avgDown: "1 = split-adjusted insider price below the person's previous purchase price at this issuer", avgDownPct: "split-adjusted price / previous price − 1",
  chgSincePrevBuy: "decision close / close on the trade date of the person's previous purchase at this issuer − 1 (adjusted bars)", repeatIntoFalling: "1 = earlier purchase at this issuer and chgSincePrevBuy < 0",
  // ---- cluster context (accepted before t) ----
  oBuyers30: "distinct OTHER persons with purchase filings at the issuer in [t−30d, t)", oBuyers30Om: "… open-market class only", oBuyUsd30: "their USD", selfBuys30: "the person's own filings at the issuer in the window",
  oBuyersPrior: "distinct other buyers at the issuer since 2025-12-01", oBuysPrior: "their filings", iBuysPrior: "all earlier purchase filings at the issuer", iDaysSincePrevBuy: "days since the previous purchase filing at the issuer",
  sellers30: "distinct sellers (code S) at the issuer in [t−30d, t)", sellUsd30: "their USD", sellers30np: "… excluding 10b5-1 sales", sellUsd30np: "… USD excluding 10b5-1", selfSold30: "the buyer sold in the window",
  selfSoldPrior: "the buyer sold at the issuer since 2025-12-01", ctxTrunc30: "1 = window starts before 2025-12-01 (truncated)",
  // ---- market (decision bar = last bar before entryDate; session windows) ----
  histBars: "bars available up to the decision session", histSessions: "sessions since the symbol's first cached bar (bars start 2025-10-01)", decDate: "date of the decision bar",
  decStale: "sessions between the decision bar and the last session before entry (0 = traded)", featOk: "1 = >= 26 bars (deep-2 chart features / matching)",
  r1: "1-session return to the decision close", r5: "5-session return", r10: "10-session return", r20: "20-session return", r60: "60-session return (null if history shorter)",
  dHi30: "decision close / max close over 30 sessions − 1", dLo30: "decision close / min close over 30 sessions − 1", win30: "sessions actually covered by the 30-session window",
  dHi60: "close / 60-session closing high − 1 (= deep-2 dd60)", dLo60: "close / 60-session closing low − 1 (= recovery from the low)", win60: "sessions covered",
  dHi252: "close / max close over up to 252 sessions − 1 (never complete: bars start 2025-10-01)", dLo252: "close / min close over up to 252 sessions − 1", win252: "sessions covered",
  vol20: "sd of daily log returns, 20-session window", vol60: "sd, 60-session window", dv20: "20-session mean dollar volume (missing bar = 0)", costBps: "per-side cost tier from dv20: 5/15/35/75/100 bps",
  tier: "liquidity tier (100 merged into 75; matching)", mdd60: "maximum drawdown of closes inside the 60-session window", bo20: "1 = decision close is the 20-session closing high",
  gapPrev: "prior-day gap of the decision bar (open / previous close − 1)", volSurge: "mean volume of the last 3 bars / mean of bars −22..−3", volSurge1: "decision-bar volume / mean of the 20 bars before it",
  sma50r: "close / 50-bar mean − 1", decCloseAdj: "split-adjusted decision close LEVEL (NOT a feature: encodes later splits)", decCloseAsTraded: "decision close in as-traded terms = decCloseAdj / fut_adjFactor (events only; inherits reported-price errors)",
  spyR5: "SPY 5-session return to the decision session", spyR20: "SPY 20-session return", spyVol20: "SPY 20-session volatility", spyDd60: "SPY close / 60-session high − 1", spyAbove50: "SPY above its 50-session mean",
  breadth50: "share of cached symbols with a bar on the decision session whose close > 50-bar mean (null before 2025-12-10)", breadth20: "same with a 20-bar mean",
  regime: "up / mixed / down: breadth50 terciles over design sessions (b33, b67 in meta) × sign of spyR20",
  gapEntry: "entry open / decision close − 1 (AT ENTRY: known only at the entry open)", gapEntryX: "gapEntry − SPY gap over the same dates (AT ENTRY)",
  retTdToDec: "decision close / close on the trade date − 1 (both public at t)",
  // ---- future-derived ----
  insPriceAdj: "split-adjusted insider price = priceReported × adjFactor (future-derived: NOT a feature)", fut_adjFactor: "execLib.adjFactor: adjusted trade-date close / reported price if outside [0.55, 1.8], else 1",
  fut_adjInferred: "1 = split / other-class ratio inferred (FUTURE information: NOT a feature)", fut_adjRatio: "raw ratio adjusted close / reported price",
  // ---- controls file ----
  ctlKey: "control key SYM|entryDate", exclTrunc: "1 = control day within 20 sessions of the visibility boundary: exclusion window incomplete",
};
const pat = [
  [/^td_(.+)$/, (m) => `trade-date view: ${D[m[1]] ? D[m[1]] : m[1]} computed with bars strictly before the trade date`],
  [/^B_status$/, () => "outcome B status: ok | embargo | censored | no_entry_bar | unpriced reasons"], [/^B_entryDate$/, () => "entry session"], [/^B_entryPrice$/, () => "official open, split-adjusted"],
  [/^B_spyEntry$/, () => "SPY official open on the entry session"], [/^B_entryVolume$/, () => "entry-session volume"], [/^B_costBps$/, () => "per-side cost used (tier)"],
  [/^B_end(\d+)$/, (m) => `exit session for ${m[1]} calendar days = last session <= entry + ${m[1]} days (use with lib4.maturedBy)`], [/^B_st(\d+)$/, (m) => `status of the ${m[1]}-day outcome: ok | embargo | censored | no_exit_bar`],
  [/^B_exit(\d+)$/, () => "official close of the exit session (adjusted)"], [/^B_gross(\d+)$/, () => "exit / entry − 1"], [/^B_spy(\d+)$/, () => "SPY open(entry) → close(exit)"],
  [/^B_xs(\d+)$/, () => "gross − SPY"], [/^B_net(\d+)$/, () => "exit(1−c)/(entry(1+c)) − 1, c = tier cost ×1"], [/^B_xsNet(\d+)$/, () => "net − SPY (tier ×1)"], [/^B_xsNet2x(\d+)$/, () => "net − SPY at tier ×2"],
  [/^B_mfe(\d+)$/, () => "max daily high over the window / entry − 1"], [/^B_mae(\d+)$/, () => "min daily low over the window / entry − 1"],
  [/^B_hit(\d+)_(\d+)$/, (m) => `1 = a daily high >= entry × (1+${m[1]}%) within ${m[2]} days (touch, not a profit)`],
  [/^B_lim10_(\d+)$/, (m) => `limit +10% approximation (fill max(open, target) when high >= target×1.005, else close at ${m[1]}d), net ×1 − SPY`], [/^B_lim10fill(\d+)$/, () => "1 = limit filled"], [/^B_lim10sess(\d+)$/, () => "fill session (0 = entry session)"],
  [/^B_tt(\d+)s$/, (m) => `sessions to the first +${m[1]}% touch within 30 days (0 = entry session)`], [/^B_tt(\d+)d$/, (m) => `calendar days to the first +${m[1]}% touch`], [/^B_tt(\d+)obs$/, () => "1 touched within 30d, 0 not touched (complete window), null unknown"],
  [/^B_ttMaxHi30s$/, () => "session of the maximum high within 30 days"], [/^B_sEnd(\d+)$/, (m) => `exit session = ${m[1]}-th session after entry`], [/^B_sSt(\d+)$/, () => "status"], [/^B_sGross(\d+)$/, () => "gross"],
  [/^B_sSpy(\d+)$/, () => "SPY"], [/^B_sXsNet(\d+)$/, () => "net − SPY (×1)"], [/^B_sXsNet2x(\d+)$/, () => "net − SPY (×2)"],
  [/^A_status$/, () => "outcome A status: ok | no_price | no_bars | td_before_bars | td_after_decision | embargo"], [/^A_spyBase$/, () => "SPY close of the trade-date session"],
  [/^A_end(\d+)$/, (m) => `last session <= tradeDate + ${m[1]} days`], [/^A_st(\d+)$/, () => "status"], [/^A_ret(\d+)$/, () => "close(exit) / insPriceAdj − 1 (hypothetical, unrealised)"],
  [/^A_spy(\d+)$/, () => "SPY over the same dates"], [/^A_xs(\d+)$/, () => "A_ret − A_spy"], [/^A_mfe30$/, () => "max high after the trade date within 30 days / insider price − 1"], [/^A_mae30$/, () => "min low / insider price − 1"],
  [/^A_hit(\d+)_30$/, (m) => `1 = high >= insider price × (1+${m[1]}%) within 30 days`], [/^A_tt(\d+)s$/, () => "sessions after the trade date to the first touch"],
  [/^C_n$/, () => "matched controls"], [/^C_distMean$/, () => "mean matching distance"], [/^C_exclTrunc$/, () => "share of controls with an incomplete exclusion window"],
  [/^C_(.+)_n$/, () => "controls with a value"], [/^C_(.+)$/, (m) => `mean of the controls' B_${m[1]}`],
];
const def = (k) => D[k] ?? (pat.find(([re]) => re.test(k)) ? (() => { const [re, f] = pat.find(([r]) => r.test(k)); return f(k.match(re)); })() : null);
const P = PL.readOut("panel.json"), C = PL.readOut("controls.json");
const panelFields = Object.keys(P.rows[0]), ctlFields = C.fields;
const missing = [...new Set([...panelFields, ...ctlFields])].filter((k) => !def(k));
const schema = {
  builtAt: new Date().toISOString(), conventions: { decision: T, entry: "official open of the first session whose 09:28 ET MOO cut-off is >= t", features: "bars with date < entryDate; filings accepted before t; outcomes of other events only if lib4.maturedBy(end, t)",
    priceCutoff: "design build: no bar on/after 2026-06-15 is read (outcomes needing one = status embargo)", costs: "tier 5/15/35/75/100 bps per side by dv20; ×2 sensitivity",
    rounding: "6 decimals for |x| >= 1, 7 significant digits below 1" },
  featureFields: P.meta.featureFields, notFeatures: P.meta.notFeatures, fieldGroups: P.meta.fieldGroups,
  panel: Object.fromEntries(panelFields.map((k) => [k, def(k)])), controls: Object.fromEntries(ctlFields.map((k) => [k, def(k)])), undocumented: missing,
};
PL.writePretty("schema.json", schema);
console.log(`schema.json: ${panelFields.length} panel fields, ${ctlFields.length} control fields, undocumented: ${missing.length ? missing.join(",") : "none"}`);
