// deep3/targets/defs.mjs — pattern definitions (fixed BEFORE any outcome was computed; see register.mjs).
// Every flag uses only information available at the entry decision: SEC rows accepted <= the event's acceptance T
// and daily bars strictly before the entry session. Chart flags are evaluated identically on control stock-days, so
// chart-pattern controls are matched WITHIN the same pattern (same month, liquidity tier, period, nearest on
// r5/r20/dd60/vol20/dollar volume/prior gap).
// The one data-derived threshold (TH.tightQ20) is the 20th percentile of `tight` in the DISCOVERY control pool
// (feature distribution only, no outcomes).

export function chartFlags(TH) {
  const near60hi = (r) => r.breakout60 === false && r.hi60r != null && r.hi60r >= -0.05;
  return {
    dd50: (r) => r.dd60 != null && r.dd60 <= -0.5,
    dd30: (r) => r.dd60 != null && r.dd60 > -0.5 && r.dd60 <= -0.3,
    dd15: (r) => r.dd60 != null && r.dd60 > -0.3 && r.dd60 <= -0.15,
    ddle30: (r) => r.dd60 != null && r.dd60 <= -0.3,
    tight: (r) => r.tight != null && r.tight <= TH.tightQ20,
    range15: (r) => r.range20 != null && r.range20 < 0.15,
    bo20: (r) => r.breakout20 === true,
    bo60: (r) => r.breakout60 === true,
    near60hi,
    hiZone: (r) => r.breakout20 === true || near60hi(r),
    volSpike2: (r) => r.volSpike != null && r.volSpike >= 2,
    volDry: (r) => r.volDry != null && r.volDry <= 0.6,
    rsStrong: (r) => r.rs20 != null && r.rs20 >= 0.1,
    rsWeak: (r) => r.rs20 != null && r.rs20 <= -0.2,
    volExp: (r) => r.vr20_60 != null && r.vr20_60 >= 1.5,
    volComp: (r) => r.vr20_60 != null && r.vr20_60 <= 0.7,
    nearLow60: (r) => r.nearLow60 === true,
    pivot: (r) => r.nearPivot === true,
  };
}

// Pattern variants. universe "om" = classification-v2 open-market filings by individuals; "all" = every priced filing.
// chart = name of the chart flag the controls must share (null → primary controls).
export function patternList(TH) {
  const CF = chartFlags(TH);
  const P = [];
  const add = (family, id, label, f, mechanism, { chart = null, universe = "om" } = {}) => P.push({ family, id, label, f, mechanism, chart, universe });
  const ceo = (r) => r.isCeo || r.isCfo;
  const clu = (r) => r.clu7 >= 2;
  const pos25 = (r) => r.firstPosition === true || (r.posIncrease != null && r.posIncrease >= 0.25);

  add("F01 cluster", "clu2_7", ">= 2 distinct people with open-market purchase filings accepted in the 7 days up to T (incl. this one)", clu,
    "Independent insiders agreeing within days is stronger private information than one buyer (cluster-buy literature); a shared catalyst could move the stock more and faster.");
  add("F01 cluster", "clu3_14", ">= 3 distinct people with open-market filings accepted in the 14 days up to T", (r) => r.clu14 >= 3,
    "Broad board/management participation signals a collective view that the price is too low.");
  add("F02 role", "ceocfo", "CEO or CFO purchase", ceo, "CEO/CFO are the best-informed insiders about near-term operations.");
  add("F02 role", "ceocfo100k", "CEO or CFO purchase with filing value >= $100k", (r) => ceo(r) && r.filingValue >= 1e5, "A material personal commitment by the best-informed insiders.");
  add("F03 repeat", "rep1_30", "Same person has >= 1 earlier open-market purchase filing at the issuer accepted in the prior 30 days", (r) => r.rep30 >= 1,
    "Repeated buying = persistent conviction (or price support); tests whether follow-on filings still carry news.");
  add("F03 repeat", "rep3_30", "Same person's >= 4th open-market filing within 30 days", (r) => r.rep30 >= 3, "Long accumulation programmes: either strong conviction or routine support buying that the market has already discounted.");
  add("F04 amount trend", "incAmt", "Filing value >= 1.25x the same person's previous open-market purchase filing (within 90 days)", (r) => r.ratioPrev != null && r.ratioPrev >= 1.25,
    "Escalating size = growing conviction as new information arrives.");
  add("F04 amount trend", "decAmt", "Filing value <= 0.8x the same person's previous open-market purchase filing (within 90 days)", (r) => r.ratioPrev != null && r.ratioPrev <= 0.8,
    "Tapering size = routine or fading conviction.");
  add("F05 holdings", "pos25", "Position increase >= 25% or a first position", pos25, "Buying a large fraction of existing holdings is costly and therefore credible (conviction literature).");
  add("F05 holdings", "pos2", "Position increase < 2% (token add, not a first position)", (r) => r.posIncrease != null && r.posIncrease < 0.02 && r.firstPosition !== true,
    "Token purchases signal little; expected to look like controls.");
  add("F06 own size", "own2x", "Filing value >= 2x the insider's own median earlier purchase filing", (r) => r.ownPriorFilings >= 1 && r.valueVsOwnMedian != null && r.valueVsOwnMedian >= 2,
    "Unusually large relative to the person's own habit = news to them.");
  add("F07 drawdown", "dd50", "Decision close >= 50% below the 60-session closing high", CF.dd50, "Insiders buying into a crash can mark capitulation; large rebounds are possible (and so are further collapses).", { chart: "dd50" });
  add("F07 drawdown", "dd30", "Drawdown 30–50% from the 60-session high", CF.dd30, "Deep but not catastrophic decline with insider support.", { chart: "dd30" });
  add("F07 drawdown", "dd15", "Drawdown 15–30% from the 60-session high", CF.dd15, "Moderate pullback with insider support.", { chart: "dd15" });
  add("F08 consolidation", "tight", "20-session range / (vol60*sqrt20) in the bottom quintile of the discovery control pool", CF.tight,
    "Volatility compression precedes expansion; an insider buying a quiet base may anticipate the catalyst that breaks it.", { chart: "tight" });
  add("F08 consolidation", "range15", "20-session high/low range < 15% (deep-1 consolidation flag)", CF.range15, "Same mechanism, absolute definition.", { chart: "range15" });
  add("F09 breakout", "bo20", "Decision close above the prior 20-session high", CF.bo20, "Insider buying that confirms a breakout: information + momentum.", { chart: "bo20" });
  add("F09 breakout", "bo60", "Decision close above the prior 60-session high", CF.bo60, "Stronger breakout confirmation.", { chart: "bo60" });
  add("F09 breakout", "near60hi", "Within 5% below the prior 60-session high (just before a breakout)", CF.near60hi, "Insiders buying just under resistance may anticipate the breakout.", { chart: "near60hi" });
  add("F10 volume", "volSpike2", "Last-3-session volume >= 2x the prior 20-session baseline", CF.volSpike2, "Unusual volume = news/attention; the filing lands in an already active tape.", { chart: "volSpike2" });
  add("F10 volume", "volDry", "Volume dry-up (sessions -20..-6 average <= 0.6x the 60-session average)", CF.volDry, "Neglected stock: the filing may be the first catalyst.", { chart: "volDry" });
  add("F11 relative strength", "rsStrong", "20-session return minus SPY >= +10%", CF.rsStrong, "Momentum + insider confirmation.", { chart: "rsStrong" });
  add("F11 relative strength", "rsWeak", "20-session return minus SPY <= -20%", CF.rsWeak, "Short-term reversal + insider support.", { chart: "rsWeak" });
  add("F12 volatility change", "volExp", "vol20 / vol60 >= 1.5 (volatility expanding)", CF.volExp, "Regime of large moves already underway.", { chart: "volExp" });
  add("F12 volatility change", "volComp", "vol20 / vol60 <= 0.7 (volatility contracting)", CF.volComp, "Quiet regime: a catalyst could restart large moves.", { chart: "volComp" });
  add("F13 sales context", "othersSold", "Other insiders sold (not 10b5-1) in the prior 90 days (window fully observed, T >= 2026-03-01)", (r) => r.salesCovered === true && r.othersSold90 >= 1,
    "Buying against colleagues' discretionary selling: disagreement; the buyer's information may be specific.");
  add("F13 sales context", "othersPlanOnly", "Only 10b5-1 (planned) sales by other insiders in the prior 90 days", (r) => r.salesCovered === true && r.othersSold90 === 0 && r.othersSoldAny90 >= 1,
    "Planned sales carry little information; the purchase is the only discretionary signal.");
  add("F13 sales context", "noSales", "No insider sales of any kind at the issuer in the prior 90 days", (r) => r.salesCovered === true && r.othersSoldAny90 === 0 && r.selfSoldAny90 !== true,
    "One-sided insider activity.");
  add("F14 issuer history", "histHit", ">= 1 earlier priced purchase filing at the issuer whose 10-session window closed before entry, and >= 1 of them touched +10% within 10 sessions",
    (r) => r.histN >= 1 && r.histHit >= 1, "Stocks that responded strongly to earlier insider buying may respond again (responsive shareholder base / insider timing skill).");
  add("F14 issuer history", "histMiss", ">= 1 earlier resolved purchase filing at the issuer, none touched +10% within 10 sessions", (r) => r.histN >= 1 && r.histHit === 0,
    "Earlier buys did not move the stock: the market discounts this issuer's insider buying.");
  add("F15 gap since last buy", "gap90", "First purchase filing at the issuer after >= 90 days with no insider purchase filing (any class); T >= 2026-03-01 so the 90 days are observed",
    (r) => r.observedDays >= 90 && (r.gapDays == null || r.gapDays >= 90), "A break in a long silence is more likely to be news than another filing in a routine stream.");
  add("F15 gap since last buy", "gap180c", "No insider purchase filing at the issuer in the prior 180 days, observed >= 120 days (LEFT-CENSORED when < 180 days observed)",
    (r) => r.observedDays >= 120 && (r.gapDays == null || r.gapDays >= 180), "Longer silence, same mechanism; history before 2025-12-01 is unobserved.");
  add("F16 support", "nearLow60", "Decision close within 5% of the 60-session low", CF.nearLow60, "Insiders defending support / buying at the bottom of the range.", { chart: "nearLow60" });
  add("F16 support", "pivot", "Decision close 0–5% above the most recent confirmed pivot low (>= 5 sessions old, within 60 sessions)", CF.pivot,
    "Buying at a tested support level; a hold of support can trigger a bounce.", { chart: "pivot" });
  for (const [t, lab] of [[75, "<$1M"], [35, "$1–5M"], [15, "$5–50M"], [5, ">=$50M"]]) {
    add("F17 liquidity tier", `tier${t}`, `All open-market filings, 20-session dollar volume ${lab}`, (r) => r.tier === t, "Size proxy (market cap unavailable): information asymmetry is larger in small, illiquid names.");
  }
  for (const [t, lab] of [[75, "<$1M"], [35, "$1–5M"], [15, "$5–50M"], [5, ">=$50M"]]) {
    add("F18 cluster x liquidity", `cluT${t}`, `Cluster (>= 2 people in 7 days), dollar volume ${lab}`, (r) => clu(r) && r.tier === t, "Collective insider conviction should matter most where analyst coverage is thin.");
  }
  for (const [b, lab] of [["premarket", "04:00–09:30 ET"], ["regular", "09:30–close"], ["afterClose", "close–20:00"], ["overnight", "20:00–04:00, weekends, holidays"]]) {
    add("F19 publication time", `pub_${b}`, `Filing accepted ${lab}`, (r) => r.pubB === b,
      "When the filing becomes public changes how much of the reaction happens before the first executable open (regular-session filings react intraday before our next-open entry).");
  }
  add("F20 purchase class", "clsEntity", "Classification v2: entity / fund-vehicle filer (fund allocations)", (r) => r.cls === "entity", "Fund allocations are portfolio decisions, not insider information.", { universe: "all" });
  add("F20 purchase class", "clsOffer", "Classification v2: offering / placement / plan purchase", (r) => r.cls === "offering", "Issuer-directed purchases at a set price carry no open-market information.", { universe: "all" });
  add("F20 purchase class", "clsUnknown", "Classification v2: unknown", (r) => r.cls === "unknown", "Residual class.", { universe: "all" });
  add("F21 combination", "C1_ceo_dd30", "CEO/CFO purchase AND drawdown >= 30%", (r) => ceo(r) && CF.ddle30(r), "Best-informed insiders buying after a crash: value signal at capitulation.", { chart: "ddle30" });
  add("F21 combination", "C2_clu_dd30", "Cluster (>= 2 people in 7 days) AND drawdown >= 30%", (r) => clu(r) && CF.ddle30(r), "Collective conviction after a crash.", { chart: "ddle30" });
  add("F21 combination", "C3_pos25_tight", "Position increase >= 25% (or first position) AND tight consolidation", (r) => pos25(r) && CF.tight(r), "Heavy accumulation in a quiet base ahead of a catalyst.", { chart: "tight" });
  add("F21 combination", "C4_ceo_hiZone", "CEO/CFO purchase AND (20-session breakout OR within 5% of the 60-session high)", (r) => ceo(r) && CF.hiZone(r), "Management confirming strength: information + momentum.", { chart: "hiZone" });
  add("F21 combination", "C5_clu_low60", "Cluster AND within 5% of the 60-session low", (r) => clu(r) && CF.nearLow60(r), "Collective buying at support.", { chart: "nearLow60" });
  return P;
}

// Per-pattern registered tests (discovery). x = per-event value; "diff" = event minus mean of its matched controls.
export const PATTERN_TESTS = [
  { k: "hit10_5", kind: "diff", desc: "touch +10% (daily high) within 5 sessions of the entry open, event minus matched controls (probability)" },
  { k: "dd10_5", kind: "diff", desc: "MAE <= -10% (daily low) within 5 sessions, event minus matched controls (probability)" },
  { k: "tp10s10n5", kind: "abs", desc: "LIMIT-FILL APPROXIMATION: sell limit +10% (fill needs high >= target*1.005), stop -10% (worst-case ordering), else close of session 5; net of tier cost, minus SPY" },
  { k: "x5", kind: "abs", desc: "EXECUTABLE: entry open -> close of session 5, net of tier cost, minus SPY" },
];
