// server/services/backtest/ipoContext.js
//
// INFORMATIONAL classification of Form 4 code-P purchases that may be IPO allocations
// (shares bought in the company's initial public offering at the offering price,
// not on the open market). It never excludes anything from the backtest and never
// changes the code-P / openMarketOnly rules — it only labels, with its evidence.
//
// Evidence (all public SEC data):
//   • the issuer's final IPO prospectus (Form 424B4 / 424B1) from the EDGAR
//     submissions index — it must state an "initial public offering" with "no
//     public market" before it, and its offering price is parsed from the text;
//   • the purchase date relative to the prospectus (pricing → closing window);
//   • the purchase price vs the offering price (exact, to the cent);
//   • an explicit statement: a Form 4 footnote/remark saying the shares were bought
//     in the IPO, or the prospectus naming the buyer as purchasing in the offering.
//
// Levels — never decided by the price alone:
//   verified  prospectus + window + offering price + an explicit statement
//   possible  prospectus + window + offering price, but no explicit statement
//             (or a Form 4 statement without a matching prospectus)
//   none      no IPO prospectus around the purchase, or a different price
//   unknown   the SEC lookup failed (retried later)
//
// SEC access: its own throttled EDGAR client (2 req/s, SEC_USER_AGENT) so it never
// shares the live ingestion's rate limiter or circuit breaker; results cached on disk.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createEdgarClient } from "../edgar/edgarClient.js";

export const WINDOW_BEFORE_DAYS = 3;  // a purchase dated at pricing can precede the 424B4 filing
export const WINDOW_AFTER_DAYS = 10;  // IPO closing is normally T+1/T+2 after pricing
const LOOKBACK_DAYS = 45;             // prospectuses considered before a purchase
const SUBMISSIONS_TTL_MS = 24 * 3_600_000;
const UNKNOWN_RETRY_MS = 15 * 60_000;
const PROSPECTUS_FORMS = new Set(["424B4", "424B1"]);
const DEFAULT_CACHE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".cache", "ipo-context.v1.json");

const DAY = 86_400_000;
const dayNum = (iso) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY);
const normalize = (s) => String(s || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();

export function htmlToText(html) {
  return String(html || "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, "\"").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ");
}

// Prospectus text → { isIpo, offeringPrice, participation: [snippets] }
export function parseOffering(text) {
  const t = String(text || "");
  const isIpo = /initial public offering/i.test(t) && /(no|not been an?) (established )?public (trading )?market for (our|the)/i.test(t);
  const m = /initial public offering price (?:is|of|will be)\s*(?:US)?\$\s?([\d,]+\.\d{2})\s*per (?:share|ADS|American Depositary Share)/i.exec(t)
    || /public offering price (?:is|of)\s*(?:US)?\$\s?([\d,]+\.\d{2})\s*per (?:share|ADS)/i.exec(t);
  const offeringPrice = m ? Number(m[1].replace(/,/g, "")) : null;
  const participation = [];
  const re = /(indicated an interest in purchasing|have agreed to purchase|has agreed to purchase|agreed to purchase|intends? to purchase|will purchase)/gi;
  let x;
  while ((x = re.exec(t)) && participation.length < 6) {
    const s = t.slice(Math.max(0, x.index - 320), x.index + 320);
    if (/offering/i.test(s)) participation.push(s.trim());
  }
  return { isIpo, offeringPrice: Number.isFinite(offeringPrice) && offeringPrice > 0 ? offeringPrice : null, participation };
}

// Name keys an owner can be referred to by in prose ("ARCH Venture Fund XIV, L.P." → "arch venture").
const SUFFIX = new Set(["l", "p", "lp", "llc", "inc", "ltd", "co", "corp", "fund", "funds", "partners", "overage", "holdings", "the",
  "i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii", "xiii", "xiv", "xv", "xvi", "xvii", "xviii", "xix", "xx"]);
export function ownerNameKeys(name) {
  const n = normalize(name);
  if (!n) return [];
  const toks = n.split(" ");
  const meaningful = toks.filter((t) => !SUFFIX.has(t));
  if (meaningful.length < 2) return []; // "ABC LP" is too generic to find in prose
  const keys = new Set([n]);
  // Person names ("CRANDELL KEITH") are also written "Keith Crandell"; entity names are not swapped.
  if (meaningful.length === toks.length && toks.length <= 4) keys.add([...toks.slice(1), toks[0]].join(" "));
  const core = [...toks];
  while (core.length > 2 && SUFFIX.has(core[core.length - 1])) core.pop();
  if (core.length >= 2) keys.add(core.join(" "));
  return [...keys].filter((k) => k.length >= 6 && k.split(" ").length >= 2);
}

const STATEMENT_RE = /initial public offering|\bIPO\b|in the offering|in this offering|from the underwriters/i;

// One purchase row vs an offering → { level, evidence[], missing[] }
export function classifyPurchase(row, offering) {
  const evidence = [], missing = [];
  const texts = [...(row.footnotes || []).map((f) => f.text), row.remarks, row.purchaseContextEvidence].filter(Boolean);
  const stmt = texts.find((s) => STATEMENT_RE.test(s));
  if (!offering) {
    if (stmt) return { level: "possible", evidence: [`Form 4 text: “${stmt.slice(0, 220)}”`], missing: ["no IPO prospectus found around the purchase date"] };
    return { level: "none", evidence: [], missing: [] };
  }
  const d = dayNum(row.transactionDate) - dayNum(offering.filingDate);
  const inWindow = d >= -WINDOW_BEFORE_DAYS && d <= WINDOW_AFTER_DAYS;
  const priceMatch = offering.offeringPrice != null && Number.isFinite(row.price) && Math.abs(row.price - offering.offeringPrice) < 0.005;
  if (!inWindow || !priceMatch) {
    if (stmt) return { level: "possible", evidence: [`Form 4 text: “${stmt.slice(0, 220)}”`], missing: [!inWindow ? "purchase date outside the IPO closing window" : "price differs from the IPO offering price"] };
    return { level: "none", evidence: [], missing: [] };
  }
  evidence.push(`IPO prospectus (${offering.form}, filed ${offering.filingDate}): initial public offering at $${offering.offeringPrice.toFixed(2)} per share`);
  evidence.push(`Purchase dated ${row.transactionDate} at $${row.price.toFixed(2)} — exactly the offering price, ${d >= 0 ? `${d} day${d === 1 ? "" : "s"} after` : `${-d} day${d === -1 ? "" : "s"} before`} the prospectus`);
  if (stmt) evidence.push(`Form 4 text: “${stmt.slice(0, 220)}”`);
  const keys = (row.identityOwners || row.owners || []).flatMap((o) => ownerNameKeys(o.name));
  const named = offering.participation.find((p) => { const n = ` ${normalize(p)} `; return keys.some((k) => n.includes(` ${k} `)); });
  if (named) evidence.push(`Prospectus names the buyer as purchasing in the offering: “…${named.slice(0, 260)}…”`);
  if (stmt || named) return { level: "verified", evidence, missing };
  missing.push("neither the Form 4 nor the prospectus states that this buyer purchased in the offering");
  return { level: "possible", evidence, missing };
}

const LEVEL_RANK = { verified: 3, possible: 2, none: 1, unknown: 0 };

export function createIpoContextService({
  getText = null, // (url) → text; default: own throttled EDGAR client
  cacheFile = DEFAULT_CACHE,
  now = () => Date.now(),
  log = console,
} = {}) {
  let client = null;
  const fetchText = (url) => (getText ? getText(url) : (client ||= createEdgarClient({ maxRps: 2, log })).getText(url));
  let cache = null;
  const load = () => { if (!cache) { try { cache = JSON.parse(fs.readFileSync(cacheFile, "utf8")); } catch { cache = { issuers: {}, prospectuses: {} }; } } return cache; };
  const save = () => {
    try { fs.mkdirSync(path.dirname(cacheFile), { recursive: true }); fs.writeFileSync(`${cacheFile}.tmp`, JSON.stringify(cache)); fs.renameSync(`${cacheFile}.tmp`, cacheFile); }
    catch (err) { log.warn(`[IPO_CONTEXT_CACHE] write failed: ${String(err?.message || err).slice(0, 120)}`); }
  };

  async function prospectusesFor(cik) {
    const c = load();
    const key = String(Number(cik));
    const hit = c.issuers[key];
    if (hit && now() - Date.parse(hit.checkedAt) < SUBMISSIONS_TTL_MS) return hit.prospectuses;
    const j = JSON.parse(await fetchText(`https://data.sec.gov/submissions/CIK${key.padStart(10, "0")}.json`));
    const f = j?.filings?.recent || {};
    const list = [];
    for (let i = 0; i < (f.form || []).length; i++) {
      if (!PROSPECTUS_FORMS.has(f.form[i])) continue;
      list.push({ form: f.form[i], accessionNo: f.accessionNumber[i], filingDate: f.filingDate[i], primaryDocument: f.primaryDocument[i] });
    }
    c.issuers[key] = { checkedAt: new Date(now()).toISOString(), prospectuses: list };
    save();
    return list;
  }

  async function parsedProspectus(cik, p) {
    const c = load();
    if (c.prospectuses[p.accessionNo]) return c.prospectuses[p.accessionNo];
    const url = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${p.accessionNo.replace(/-/g, "")}/${p.primaryDocument}`;
    const parsed = parseOffering(htmlToText(await fetchText(url)));
    const rec = { ...p, url, ...parsed, participation: parsed.participation.map((s) => s.slice(0, 700)) };
    c.prospectuses[p.accessionNo] = rec; // a filed prospectus never changes
    save();
    return rec;
  }

  // The IPO prospectus relevant to purchases dated [from, to], or null.
  async function ipoOffering(cik, from, to) {
    const list = await prospectusesFor(cik);
    const near = list.filter((p) => dayNum(p.filingDate) >= dayNum(from) - LOOKBACK_DAYS && dayNum(p.filingDate) <= dayNum(to) + WINDOW_BEFORE_DAYS)
      .sort((a, b) => b.filingDate.localeCompare(a.filingDate)).slice(0, 3);
    for (const p of near) {
      const rec = await parsedProspectus(cik, p);
      if (rec.isIpo && rec.offeringPrice != null) return rec;
    }
    return null;
  }

  // items: [{ id, issuerCik, rows: [economic purchase rows] }] → { [id]: classification }
  async function classify(items) {
    const out = {};
    for (const it of items) {
      const rows = it.rows || [];
      if (!rows.length) { out[it.id] = { status: "none", purchases: [] }; continue; }
      const dates = rows.map((r) => r.transactionDate).sort();
      let offering;
      try { offering = await ipoOffering(it.issuerCik, dates[0], dates[dates.length - 1]); }
      catch (err) {
        log.warn(`[IPO_CONTEXT] issuer=${it.issuerCik} error=${String(err?.message || err).slice(0, 160)}`);
        out[it.id] = { status: "unknown", reason: "SEC lookup failed — retried later", purchases: [], retryAfterMs: UNKNOWN_RETRY_MS };
        continue;
      }
      const purchases = rows.map((r) => ({ rowId: r.id, insider: r.owners?.[0]?.name || r.insiderName || null, transactionDate: r.transactionDate, price: r.price, valueUsd: r.value ?? null, ...classifyPurchase(r, offering) }));
      const status = purchases.reduce((best, p) => (LEVEL_RANK[p.level] > LEVEL_RANK[best] ? p.level : best), "none");
      const flagged = purchases.filter((p) => p.level === "verified" || p.level === "possible");
      out[it.id] = {
        status,
        offering: offering ? { form: offering.form, accessionNo: offering.accessionNo, filingDate: offering.filingDate, offeringPrice: offering.offeringPrice, url: offering.url } : null,
        flaggedValueUsd: flagged.reduce((s, p) => s + (p.valueUsd || 0), 0),
        flaggedPurchases: flagged.length,
        purchases,
      };
    }
    return out;
  }

  return { classify, ipoOffering };
}
