// deep4/behavior/defs.mjs — PRE-DECLARED hypotheses of families A (behaviour-based selection) and C (adaptive track record).
// Registered by 04_register.mjs BEFORE any outcome is computed. Definitions are frozen: never edit after registration.
//
// Point-in-time prior profile of event e (person p, accepted at e.publishedAt):
//   S(e)  = p's open-market (class v2), valued, first-of-dupKey filings accepted strictly before e (styles.priorSet);
//   PE(e) = p's EPISODES built on S(e) ∪ {e} (styles.episodesOf: per issuer, new episode after a > 30-day gap), excluding
//           the episode that contains e; each prior episode is represented by its first purchase;
//   sh_L  = share of label L over PE(e) (defined labels only), n_L = number of PE(e) episodes with L defined.
// Every label of a prior purchase uses that purchase's own decision-time features (style-rules.json thresholds).
import { labelsOf, episodesOf, priorSet } from "./styles.mjs";

export const PRIMARY_OUTCOME = "B_xsNet30"; // public-trader net excess vs SPY, 30 calendar days, tier x1 costs
export const OM = (r) => r.cls === "om" && r.valued === 1; // open-market valued purchase (any priced state)

// prior profile (episode-level) of event e given ALL rows of its person (any class, sorted by publishedAt)
export function profileOf(e, personRows, th) {
  const S = priorSet(e, personRows);
  const copy = [...S, e].map((r) => ({ ...r })).sort((a, b) => (a.publishedAt < b.publishedAt ? -1 : a.publishedAt > b.publishedAt ? 1 : a.key < b.key ? -1 : 1));
  const eps = episodesOf(copy);
  const own = eps.find((ep) => ep.rows.some((r) => r.key === e.key));
  const PE = eps.filter((ep) => ep !== own && ep.start < e.publishedAt);
  const sh = {}, n = {};
  for (const L of ["DIP", "LOW", "DEEP", "RECOV", "MOM", "CONTRA", "FOLLOW"]) {
    const v = PE.map((ep) => labelsOf(ep.rows[0], th)[L]).filter((x) => x === 0 || x === 1);
    n[L] = v.length; sh[L] = v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  }
  const isEpisodeStart = own ? own.rows[0].key === e.key : true;
  return { kS: S.length, kPE: PE.length, issuersSInclE: new Set([...S.map((r) => r.cik), e.cik]).size, priorAtIssuerS: S.filter((r) => r.cik === e.cik).length, sh, n, isEpisodeStart, L: labelsOf(e, th) };
}

// ---------------- family A ----------------
export const FAMILY_A = "behavior.A behaviour-based selection (primary: B_xsNet30 mean vs 0)";
export const FAMILY_A_SEC = "behavior.A.sec secondary outcomes of family A";
export const A_HYPS = [
  { id: "behavior.A01", name: "contrarian-style repeat buyer buying again after a further drop",
    rule: "n_CONTRA >= 1 AND sh_CONTRA >= 0.5 over prior episodes AND pPriorCo >= 1 AND chgSincePrevBuy < 0",
    sel: (e, P) => P.n.CONTRA >= 1 && P.sh.CONTRA >= 0.5 && e.pPriorCo >= 1 && typeof e.chgSincePrevBuy === "number" && e.chgSincePrevBuy < 0,
    rationale: "A person whose earlier episodes were dip/low/drawdown buys returns to a stock that fell further since the last buy: conviction contrarian (deep 3: plain repeat buys lose; this conditions on a persistent contrarian style)." },
  { id: "behavior.A02", name: "buyer whose prior buys were at 60-day lows",
    rule: "n_LOW >= 1 AND sh_LOW >= 0.5 over prior episodes", sel: (e, P) => P.n.LOW >= 1 && P.sh.LOW >= 0.5,
    rationale: "Low-buying is a persistent style (consistency test behavior.P.*.LOW); does it select better next purchases?" },
  { id: "behavior.A03", name: "size escalation by a repeat buyer",
    rule: "ESCAL = 1: usd / max usd of the person's earlier valued purchases >= q80 (1.1034)", sel: (e, P) => P.L.ESCAL === 1,
    rationale: "A repeat buyer raising size above every earlier purchase (deep 3 tested >= 2x in buyer-position context: +0.50 pts, p 0.46; re-tested here at the 30-day horizon, design quantile threshold)." },
  { id: "behavior.A04", name: "multi-company buyer",
    rule: "distinct issuers over S(e) ∪ {e} >= 2 (the person bought another issuer on the open market before)", sel: (e, P) => P.issuersSInclE >= 2,
    rationale: "Insiders buying several companies may be professional allocators (fund directors) — possibly better or worse informed per name." },
  { id: "behavior.A05", name: "first observed buy by an existing holder with a large add",
    rule: "pFirstEver = 1 AND firstPosition = 0 AND pctHold >= q67 (0.159) AND pObsDays >= 60", sel: (e) => e.pFirstEver === 1 && e.firstPosition === 0 && typeof e.pctHold === "number" && e.pctHold >= 0.159 && e.pObsDays >= 60,
    rationale: "A holder (tenure: owns shares already) who has not bought in >= 60 observable days adds >= 15.9% to the stake: first conviction buy. pObsDays >= 60 limits left-censoring." },
  { id: "behavior.A06", name: "contrarian-style person buying a dip again",
    rule: "n_CONTRA >= 1 AND sh_CONTRA >= 0.5 over prior episodes AND CONTRA(e) = 1", sel: (e, P) => P.n.CONTRA >= 1 && P.sh.CONTRA >= 0.5 && P.L.CONTRA === 1,
    rationale: "Style-consistent dip buying (persistent per behavior.P): repeated contrarian conviction." },
  { id: "behavior.A07", name: "momentum-style buyer",
    rule: "n_MOM >= 1 AND sh_MOM >= 0.5 over prior episodes", sel: (e, P) => P.n.MOM >= 1 && P.sh.MOM >= 0.5,
    rationale: "Persons who habitually buy strength/breakouts (deep 3: momentum/breakout buys lose); tests whether the person-level style carries the effect." },
  { id: "behavior.A08", name: "independent-style buyer acting alone again",
    rule: "n_FOLLOW >= 1 AND sh_FOLLOW < 0.5 over prior episodes AND FOLLOW(e) = 0", sel: (e, P) => P.n.FOLLOW >= 1 && P.sh.FOLLOW < 0.5 && P.L.FOLLOW === 0,
    rationale: "A person who usually buys without other insiders (leader, not herding) and again buys alone: individually informed." },
  { id: "behavior.A09", name: "returning buyer starting a new episode in a dip",
    rule: "episode start (no purchase by the person at this issuer in the prior 30 days) AND pPriorCo >= 1 AND CONTRA(e) = 1", sel: (e, P) => P.isEpisodeStart && e.pPriorCo >= 1 && P.L.CONTRA === 1,
    rationale: "A previous buyer comes back after > 30 days when the stock is in a dip/low/drawdown: a fresh decision, not a continuation." },
  { id: "behavior.A10", name: "repeated buy at a similar price level",
    rule: "SIMPRICE = 1: same-issuer repeat with |chgSincePrevBuy| <= q33 (3.25%)", sel: (e, P) => P.L.SIMPRICE === 1,
    rationale: "Defending a price level (deep 2 anecdote: support buying lost)." },
  { id: "behavior.A11", name: "contrarian-style person at a new issuer",
    rule: "n_CONTRA >= 1 AND sh_CONTRA >= 0.5 over prior episodes AND pPriorCo = 0", sel: (e, P) => P.n.CONTRA >= 1 && P.sh.CONTRA >= 0.5 && e.pPriorCo === 0,
    rationale: "The contrarian style carried to a new stock (strictest personal-style case; cross-issuer consistency was significant)." },
];
export const A_SECONDARY = [
  { key: "xsNet5", label: "B_xsNet5 mean vs 0" }, { key: "xsNet10", label: "B_xsNet10 mean vs 0" }, { key: "xsNet20", label: "B_xsNet20 mean vs 0" },
  { key: "ctl30", label: "B_xsNet30 minus matched-control mean (same rule on controls)" }, { key: "hit10ctl", label: "B_hit10_30 minus control hit rate" }, { key: "mae30ctl", label: "B_mae30 minus control mean MAE" },
];

// ---------------- family C ----------------
export const FAMILY_C = "behavior.C adaptive track record (history.mjs, matured outcomes only)";
export const C_FILTER = (r) => r.cls === "om" && r.valued === 1; // track records over open-market valued purchases (history dedupe: isPrimary)
export const C_HYPS = [
  { id: "behavior.C01", name: "person EB track record (B 30d) predicts the next purchase's B_xsNet30", kind: "rank", src: { level: "person", outcome: "B", metric: "xsNet", horizon: 30 }, target: "B_xsNet30", need: 1 },
  { id: "behavior.C02", name: "person EB track record (B 5d) predicts B_xsNet5", kind: "rank", src: { level: "person", outcome: "B", metric: "xsNet", horizon: 5 }, target: "B_xsNet5", need: 1 },
  { id: "behavior.C03", name: "person EB track record (B 5d) predicts B_xsNet30", kind: "rank", src: { level: "person", outcome: "B", metric: "xsNet", horizon: 5 }, target: "B_xsNet30", need: 1 },
  { id: "behavior.C04", name: "person EB own unrealised record (A 30d) predicts B_xsNet30", kind: "rank", src: { level: "person", outcome: "A", metric: "xs", horizon: 30 }, target: "B_xsNet30", need: 1 },
  { id: "behavior.C05", name: "issuer EB track record (B 30d, all buyers) predicts B_xsNet30", kind: "rank", src: { level: "issuer", outcome: "B", metric: "xsNet", horizon: 30 }, target: "B_xsNet30", need: 1 },
  { id: "behavior.C06", name: "issuer EB track record (B 5d) predicts B_xsNet5", kind: "rank", src: { level: "issuer", outcome: "B", metric: "xsNet", horizon: 5 }, target: "B_xsNet5", need: 1 },
  { id: "behavior.C07", name: "role track record (B 30d matured mean) predicts B_xsNet30", kind: "rank", src: { level: "role", outcome: "B", metric: "xsNet", horizon: 30 }, target: "B_xsNet30", need: 1 },
  { id: "behavior.C08", name: "select person EB30 > 0 (>= 1 matured 30d outcome): mean B_xsNet30 > 0", kind: "select", src: { level: "person", outcome: "B", metric: "xsNet", horizon: 30 }, target: "B_xsNet30", need: 1 },
  { id: "behavior.C09", name: "select person EB5 > 0 (>= 1 matured 5d outcome): mean B_xsNet30 > 0", kind: "select", src: { level: "person", outcome: "B", metric: "xsNet", horizon: 5 }, target: "B_xsNet30", need: 1 },
  { id: "behavior.C10", name: "walk-forward (monthly EB prior refit at month start): select person EB30 > 0 with >= 1 matured outcome; mean realised B_xsNet30 > 0", kind: "wf", src: { level: "person", outcome: "B", metric: "xsNet", horizon: 30 }, target: "B_xsNet30", need: 1 },
];
export const C_TEXT = {
  rank: "Spearman rho(track-record estimate, realised target) over design primary purchases whose record has >= 1 matured item; p = one-sided skill-vs-luck permutation: the target outcome values (and the track-record outcome values) are permuted within decision month among primary purchases, history recomputed (history.mjs createHistory on permuted rows), rho recomputed; R = 500 (outcome fields permuted jointly within strata = decision month x availability pattern)",
  select: "mean realised target of selected events (issuer-clustered t vs 0, t df = G-1, two-sided); diagnostic: same permutation null for the selected-minus-unselected difference",
  wf: "walkforward.mjs over design months; fit = history.mjs pool prior at the month start (= the walk-forward training set); predict = history.mjs historyForEvent with that frozen prior; selected events' realised B_xsNet30 pooled across evaluated months, issuer-clustered t vs 0",
};
