// deep4/behavior/03_profiles.mjs — Phase 3: per-insider behavioural profiles + style CONSISTENCY tests (design segment).
// FEATURES ONLY: no outcome field (A_*, B_*, C_*) is read here. Outcome tables per insider are in 06_profilePerf.mjs.
//   node --max-old-space-size=6144 scripts/research/deep4/behavior/03_profiles.mjs
// Consistency (family behavior.P, registered below before computing): for each person, episodes ordered by start; the
// episode label for L = L of the first purchase in the episode where L is defined. Unit = episode j >= 2 with
//   s = share of L over the person's earlier episodes (defined labels), y = L of episode j.
// Statistic: Pearson r(s, y) pooled over units. Null: y permuted within decision-month strata (keeps market-wide timing:
// crashes hit many stocks in the same weeks); R = 2000; one-sided p = (1 + #{r_perm >= r_obs}) / (R + 1).
// Levels: "episode" (all later episodes) and "crossIssuer" (later episodes at an issuer the person never bought before;
// removes the stock's own persistent state — the strictest test of a PERSONAL style).
import { loadDesign, isPrimaryPurchase, writeJson, writeCsv, readJson, checkpoint, group, mean, r4, rng, shuffleInPlace, pearson, spearman, bh, L4, AGENT } from "./common.mjs";
import { labelsOf, episodesOf, ALL_LABELS, MARKET_LABELS, STYLE_RULES_FILE } from "./styles.mjs";

const SR = readJson(STYLE_RULES_FILE), th = SR.thresholds;
const R = 2000;
const EP_LABELS = ALL_LABELS; // 10 labels at the episode level
const X_LABELS = [...MARKET_LABELS, "FOLLOW", "ESCAL"]; // 8 labels defined at a new issuer
// ---------------- registration (before computing) ----------------
const FAMILY = "behavior.P profile consistency", FAMILY_SIZE = EP_LABELS.length + X_LABELS.length;
for (const L of EP_LABELS) L4.registerHypothesis({ agent: AGENT, id: `behavior.P.ep.${L}`, family: FAMILY, familySize: FAMILY_SIZE, preRegistered: true,
  statement: `Episode-level style consistency for label ${L}: a person's share of ${L} over earlier episodes is positively correlated with ${L} at the next episode, beyond the within-month permutation null.`,
  rationale: "Phase 3: is an observable purchase style a persistent personal trait? Label rules from design quantiles (style-rules.json).", test: "Pearson r(s,y); y permuted within decision month; R=2000; one-sided", segment: "design", outcome: "none (features only)" });
for (const L of X_LABELS) L4.registerHypothesis({ agent: AGENT, id: `behavior.P.x.${L}`, family: FAMILY, familySize: FAMILY_SIZE, preRegistered: true,
  statement: `Cross-issuer style consistency for label ${L}: the share of ${L} over a person's earlier episodes predicts ${L} at an episode at a NEW issuer, beyond the within-month permutation null.`,
  rationale: "Strictest personal-style test: the stock's own persistent state cannot carry over to a different issuer.", test: "Pearson r(s,y); y permuted within decision month; R=2000; one-sided", segment: "design", outcome: "none (features only)" });

// ---------------- data (features only) ----------------
const { rows } = loadDesign();
const prim = rows.filter(isPrimaryPurchase).map((r) => ({ ...r }));
for (const r of prim) r.L = labelsOf(r, th);
const byPerson = group(prim, (r) => r.person);
const people = [];
for (const [person, rs] of byPerson) { rs.sort((a, b) => (a.publishedAt < b.publishedAt ? -1 : a.publishedAt > b.publishedAt ? 1 : a.key < b.key ? -1 : 1)); people.push({ person, rs, eps: episodesOf(rs) }); }
// month base rates for expectation (style-rules baseRatesByMonth; null months fall back to the pooled rate)
const baseM = (L, m) => SR.baseRatesByMonth[m]?.[L] ?? SR.baseRates[L].rate;
const epLabel = (ep, L) => { for (const r of ep.rows) { const v = r.L[L]; if (v === 0 || v === 1) return { v, r }; } return null; };

// ---------------- consistency units ----------------
function units(L, level) {
  const us = [];
  for (const p of people) {
    if (p.eps.length < 2) continue;
    const seen = []; const issuersSeen = new Set();
    for (let j = 0; j < p.eps.length; j++) {
      const ep = p.eps[j], lab = epLabel(ep, L);
      if (j >= 1 && lab && seen.length) {
        const ok = level === "episode" || !issuersSeen.has(ep.cik);
        if (ok) us.push({ person: p.person, s: mean(seen), y: lab.v, month: lab.r.month, half: `${lab.r.month}-${lab.r.publishedAt.slice(8, 10) <= "15" ? "a" : "b"}`, cik: ep.cik, nPrior: seen.length });
      }
      if (lab) seen.push(lab.v);
      issuersSeen.add(ep.cik);
    }
  }
  return us;
}
function permTest(us, strataKey, seed) {
  const s = us.map((u) => u.s), y = us.map((u) => u.y);
  const obs = pearson(s, y);
  if (obs == null) return { r: null };
  const strata = group(us.map((u, i) => i), (i) => us[i][strataKey]);
  const rnd = rng(seed); let ge = 0; const perm = new Array(us.length); const null_ = [];
  for (let b = 0; b < R; b++) {
    for (const idx of strata.values()) { const ys = shuffleInPlace(idx.map((i) => y[i]), rnd); idx.forEach((i, k) => { perm[i] = ys[k]; }); }
    const rb = pearson(s, perm); null_.push(rb ?? 0); if (rb != null && rb >= obs) ge++;
  }
  null_.sort((a, b) => a - b);
  return { r: r4(obs), p: r4((1 + ge) / (R + 1)), nullMean: r4(mean(null_)), null95: r4(null_[Math.floor(0.95 * R)]) };
}
const cons = { builtAt: new Date().toISOString(), R, note: "features only; one-sided permutation p; strata = decision month (primary) and half-month (sensitivity)", tests: [] };
for (const [level, labels] of [["episode", EP_LABELS], ["crossIssuer", X_LABELS]]) {
  for (const L of labels) {
    const us = units(L, level);
    const hi = us.filter((u) => u.s >= 0.5), lo = us.filter((u) => u.s < 0.5);
    const t = permTest(us, "month", 11), t2 = permTest(us, "half", 13);
    // expected rate of y given the month mix (what a person with no style would show)
    const expY = mean(us.map((u) => baseM(L, u.month)));
    const res = { id: `behavior.P.${level === "episode" ? "ep" : "x"}.${L}`, level, label: L, units: us.length, persons: new Set(us.map((u) => u.person)).size, rateY: r4(mean(us.map((u) => u.y))), expectedYMonthMix: r4(expY),
      pYgivenHighShare: r4(mean(hi.map((u) => u.y))), nHigh: hi.length, pYgivenLowShare: r4(mean(lo.map((u) => u.y))), nLow: lo.length, lift: hi.length && lo.length ? r4(mean(hi.map((u) => u.y)) - mean(lo.map((u) => u.y))) : null,
      r: t.r, p: t.p, nullMean: t.nullMean, null95: t.null95, pHalfMonth: t2.p };
    cons.tests.push(res);
  }
}
// purchase-level (descriptive only: consecutive purchases incl. same-episode → mechanically autocorrelated)
cons.purchaseLevelDescriptive = {};
for (const L of ALL_LABELS) {
  const pairs = [];
  for (const p of people) for (let i = 1; i < p.rs.length; i++) { const a = p.rs[i - 1].L[L], b = p.rs[i].L[L]; if ((a === 0 || a === 1) && (b === 0 || b === 1)) pairs.push([a, b, p.rs[i].cik === p.rs[i - 1].cik ? 1 : 0]); }
  const same = pairs.filter((x) => x[2] === 1), diff = pairs.filter((x) => x[2] === 0);
  cons.purchaseLevelDescriptive[L] = { pairs: pairs.length, agree: r4(mean(pairs.map((x) => (x[0] === x[1] ? 1 : 0)))), rPrevNext: r4(pearson(pairs.map((x) => x[0]), pairs.map((x) => x[1]))),
    sameIssuerPairs: same.length, rSameIssuer: r4(pearson(same.map((x) => x[0]), same.map((x) => x[1]))), diffIssuerPairs: diff.length, rDiffIssuer: r4(pearson(diff.map((x) => x[0]), diff.map((x) => x[1]))) };
}
const ps = cons.tests.map((t) => t.p);
const q = bh(ps); cons.tests.forEach((t, i) => { t.qFamily = r4(q[i]); });
for (const t of cons.tests) L4.recordResult(t.id, AGENT, { r: t.r, p: t.p, qFamily: t.qFamily, units: t.units, persons: t.persons, lift: t.lift, pHalfMonth: t.pHalfMonth });
writeJson("consistency.json", cons);

// ---------------- per-person profiles ----------------
// Poisson-binomial upper tail P(X >= k) for independent Bernoulli(p_i)
function pbUpper(ps_, k) { let dp = [1]; for (const p of ps_) { const nx = new Array(dp.length + 1).fill(0); for (let j = 0; j < dp.length; j++) { nx[j] += dp[j] * (1 - p); nx[j + 1] += dp[j] * p; } dp = nx; } let s = 0; for (let j = k; j < dp.length; j++) s += dp[j]; return Math.min(1, s); }
const consP = Object.fromEntries(cons.tests.filter((t) => t.level === "episode").map((t) => [t.label, t]));
const profiles = [], csvRows = [];
for (const p of people) {
  const rs = p.rs, eps = p.eps, n = rs.length;
  const issuers = [...new Set(rs.map((r) => r.cik))];
  const roles = [...new Set(rs.map((r) => r.primaryRole))];
  const base = { person: p.person, ownerName: rs[0].ownerName, nPurchases: n, nEpisodes: eps.length, nIssuers: issuers.length, tickers: [...new Set(rs.map((r) => r.sym))], roles,
    first: rs[0].publishedAt, last: rs.at(-1).publishedAt, months: [...new Set(rs.map((r) => r.month))].length, usdTotal: Math.round(rs.reduce((a, r) => a + (r.usd || 0), 0)), usdMedian: Math.round(rs.map((r) => r.usd).sort((a, b) => a - b)[n >> 1] || 0),
    concentration: issuers.length === 1 ? "single-company" : `multi-company (${issuers.length} issuers)`, leftCensored: "history before 2025-12-01 unknown" };
  if (n < 2) { profiles.push({ ...base, profile: "single purchase (summary only)", labels: rs[0].L }); csvRows.push({ ...base, tickers: base.tickers.join("|"), roles: roles.join("|"), styleTags: "", confidence: "single purchase", ...Object.fromEntries(ALL_LABELS.map((L) => [`share_${L}`, rs[0].L[L]])) }); continue; }
  const lab = {};
  const tags = [];
  for (const L of ALL_LABELS) {
    const pv = rs.map((r) => r.L[L]).filter((x) => x === 0 || x === 1);
    const ev = eps.map((ep) => epLabel(ep, L)).filter(Boolean);
    const k = ev.reduce((a, e) => a + e.v, 0), expP = ev.map((e) => baseM(L, e.r.month));
    const pUp = ev.length ? pbUpper(expP, k) : null;
    lab[L] = { purchaseShare: pv.length ? r4(mean(pv)) : null, nPurchases: pv.length, episodeShare: ev.length ? r4(k / ev.length) : null, nEpisodes: ev.length, expectedEpisodeShare: ev.length ? r4(mean(expP)) : null, pUpper: pUp == null ? null : r4(pUp) };
    if (ev.length >= 2 && k / ev.length >= 0.5 && pUp != null && pUp <= 0.10) tags.push(L);
  }
  // size trend across purchases (Spearman of usd vs order)
  const sizeTrend = n >= 3 ? r4(spearman(rs.map((_, i) => i), rs.map((r) => r.usd || 0))) : null;
  if (sizeTrend != null && n >= 4 && sizeTrend >= 0.5) tags.push("SIZE_UP");
  if (issuers.length >= 2) tags.push("MULTI_COMPANY");
  const confidence = eps.length >= 6 ? "higher (>= 6 episodes)" : eps.length >= 4 ? "moderate (4-5 episodes)" : eps.length >= 2 ? "low (2-3 episodes)" : "single episode (one market state; style not separable from the stock's state)";
  const support = rs.map((r) => ({ key: r.key, date: r.publishedAt.slice(0, 10), ticker: r.sym, episode: r.episodeIdx, usd: Math.round(r.usd || 0), role: r.primaryRole, r20: r4(r.r20), dLo60: r4(r.dLo60), dHi60: r4(r.dHi60), bo20: r.bo20,
    oBuyers30Om: r.oBuyers30Om, labels: Object.entries(r.L).filter(([, v]) => v === 1).map(([k]) => k).join("+") }));
  const consistencyNote = tags.filter((t) => consP[t]).map((t) => `${t}: population episode-level r=${consP[t].r} (p=${consP[t].p})`).join("; ");
  profiles.push({ ...base, styleTags: tags, confidence, sizeTrend, labels: lab, populationConsistency: consistencyNote || null, supportingTransactions: support });
  csvRows.push({ ...base, tickers: base.tickers.join("|"), roles: roles.join("|"), styleTags: tags.join("|"), confidence, sizeTrend, ...Object.fromEntries(ALL_LABELS.flatMap((L) => [[`share_${L}`, lab[L].purchaseShare], [`epShare_${L}`, lab[L].episodeShare], [`pUp_${L}`, lab[L].pUpper]])) });
}
profiles.sort((a, b) => b.nPurchases - a.nPurchases || (a.person < b.person ? -1 : 1));
csvRows.sort((a, b) => b.nPurchases - a.nPurchases || (a.person < b.person ? -1 : 1));
const multi = profiles.filter((p) => p.nPurchases >= 2);
const tagCounts = {}; for (const p of multi) for (const t of p.styleTags) tagCounts[t] = (tagCounts[t] || 0) + 1;
const summary = { persons: profiles.length, personsGe2: multi.length, personsGe2MultiEpisode: multi.filter((p) => p.nEpisodes >= 2).length, personsGe4Episodes: multi.filter((p) => p.nEpisodes >= 4).length,
  withAnyTag: multi.filter((p) => p.styleTags.filter((t) => t !== "MULTI_COMPANY").length > 0).length, tagCounts,
  confidence: multi.reduce((m, p) => { m[p.confidence] = (m[p.confidence] || 0) + 1; return m; }, {}),
  singles: { n: profiles.length - multi.length, roles: profiles.filter((p) => p.nPurchases < 2).reduce((m, p) => { m[p.roles[0]] = (m[p.roles[0]] || 0) + 1; return m; }, {}) } };
writeJson("profiles.json", { builtAt: new Date().toISOString(), note: "features only (no outcomes); style tags = episode share >= 0.5 over >= 2 episodes with Poisson-binomial p <= 0.10 vs month base rates; descriptive, not intent", styleRules: STYLE_RULES_FILE, summary, profiles });
writeCsv("profiles.csv", csvRows);
writeCsv("purchase-labels.csv", prim.map((r) => ({ key: r.key, person: r.person, cik: r.cik, sym: r.sym, publishedAt: r.publishedAt, month: r.month, episodeId: r.episodeId, episodeIdx: r.episodeIdx, isEpisodeStart: r.isEpisodeStart, primaryRole: r.primaryRole, usd: r.usd, ...r.L })));
checkpoint("03_profiles", { personsGe2: multi.length, tests: cons.tests.length });
console.log(JSON.stringify(summary, null, 1));
console.log("level        label     units persons rateY  expY   P(y|s>=.5) n   P(y|s<.5) n    lift    r      p      q     pHalf");
for (const t of cons.tests) console.log(`${t.level.padEnd(12)} ${t.label.padEnd(9)} ${String(t.units).padStart(5)} ${String(t.persons).padStart(6)}  ${t.rateY} ${t.expectedYMonthMix}  ${t.pYgivenHighShare} ${t.nHigh}  ${t.pYgivenLowShare} ${t.nLow}  ${t.lift}  ${t.r}  ${t.p}  ${t.qFamily}  ${t.pHalfMonth}`);
console.log(JSON.stringify(cons.purchaseLevelDescriptive));
