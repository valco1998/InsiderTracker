// server/services/edgar/currency.js
//
// Currency of a Form 4 transaction price. The Form 4 XML has no currency field;
// Column 4 is reported in U.S. dollars unless the filing says otherwise. Foreign
// issuers usually say so in a footnote, in one of two ways:
//   • the price WAS CONVERTED to USD ("conversion rate of BRL 5.0380 for each
//     USD 1.00 was used", "converted into U.S. Dollars", "convenience conversion
//     … into U.S. dollars")                                   → USD (converted)
//   • a foreign-currency price with no conversion statement
//     ("SALE PRICE OF MXN$68.1875")                           → unverified
// A foreign currency counts only with a conversion statement or next to a price
// (a currency code inside a fund name — "Apax X EUR LP" — is not a price statement).
// Unverified rows keep their buyer/transaction count but their value is excluded
// from every USD total (via the price-check rule "currency_unverified").

const CURRENCY_RE = /\b(CAD|CDN|C\$|EUR|GBP|NIS|ILS|JPY|CHF|AUD|A\$|HKD|SEK|NOK|DKK|INR|CNY|RMB|BRL|R\$|MXN|KRW|SGD|ZAR|NZD|TWD|ILA)\b|[€£₪¥]|canadian dollars?|euros?\b|pounds? sterling|israeli (new )?shekels?|shekels?|\byen\b|swiss francs?|australian dollars?|south african rand|brazilian reais?|\breais\b|mexican pesos?/i;
const PRICE_RE = /\bprice|per (ordinary )?share|purchased (for|at)|sold (for|at)|conducted in|denominated in|paid|consideration/i;
const CONVERTED_RE = /\bconver(ted|sion)\b|exchange rate|reported in (u\.?s\.?|united states) dollars|into (u\.?s\.?|united states) dollars|to u\.?s\.? dollars|usd equivalent|u\.?s\.? dollar equivalent/i;

// → { code: "USD", basis: "form4" | "converted_to_usd", note? } or
//   { code: null, basis: "unverified", mentioned, note }
export function currencyOf(t = {}) {
  const texts = [...(t.footnotes || []).map((f) => f?.text || ""), t.remarks || ""].filter(Boolean);
  let mention = null;
  for (const text of texts) {
    const m = text.match(CURRENCY_RE);
    if (!m) continue;
    if (CONVERTED_RE.test(text)) return { code: "USD", basis: "converted_to_usd", note: text.slice(0, 200) };
    if (PRICE_RE.test(text)) mention ||= { mentioned: m[0], note: text.slice(0, 200) };
  }
  // A conversion statement anywhere in the row's notes also covers a separate mention.
  if (mention && texts.some((x) => CONVERTED_RE.test(x) && CURRENCY_RE.test(x))) return { code: "USD", basis: "converted_to_usd", note: mention.note };
  if (mention) return { code: null, basis: "unverified", mentioned: mention.mentioned, note: mention.note };
  return { code: "USD", basis: "form4" };
}

export const isUsdVerified = (t) => currencyOf(t).code === "USD";
