// server/services/edgar/edgarSources.js
//
// Pure parsers for EDGAR discovery sources. Strictly Form 4 / 4/A only:
//   • The latest-filings Atom feed's `type=4` filter is a PREFIX match and
//     also returns 424B2, 497, 497K, 485BXT, 425, … — entries are filtered by
//     their <category term="…"> form type, never by the query parameter.
//   • The official daily form index lists each filing once per related filer
//     (issuer + reporting owners); entries are de-duplicated by accession.

import { FORM4_TYPES } from "./form4Parser.js";

export const feedUrl = (start, count = 100) =>
  `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&company=&dateb=&owner=include&start=${start}&count=${count}&output=atom`;

export function dailyIndexUrl(yyyymmdd) {
  const qtr = Math.floor((Number(yyyymmdd.slice(4, 6)) - 1) / 3) + 1;
  return `https://www.sec.gov/Archives/edgar/daily-index/${yyyymmdd.slice(0, 4)}/QTR${qtr}/form.${yyyymmdd}.idx`;
}

const ENTRY_RE = /<entry>([\s\S]*?)<\/entry>/g;
const TERM_RE = /<category\b[^>]*\bterm="([^"]+)"/;
const LINK_RE = /\/Archives\/edgar\/data\/(\d+)\/\d{18}\/(\d{10}-\d{2}-\d{6})-index\.htm/;

// → { entries, form4: [{ accessionNo, cikDir, formType }] } (form4 de-duplicated)
export function parseFeedForm4(atom) {
  const form4 = new Map();
  let entries = 0;
  for (const m of String(atom).matchAll(ENTRY_RE)) {
    entries++;
    const term = (m[1].match(TERM_RE) || [])[1];
    if (!FORM4_TYPES.has(term)) continue;
    const link = m[1].match(LINK_RE);
    if (link && !form4.has(link[2])) form4.set(link[2], { accessionNo: link[2], cikDir: link[1], formType: term });
  }
  return { entries, form4: [...form4.values()] };
}

const IDX_LINE_RE = /^(4|4\/A)\s+.*\s(\d{8})\s+edgar\/data\/(\d+)\/(\d{10}-\d{2}-\d{6})\.txt\s*$/;

// → [{ accessionNo, cikDir, formType, dateFiled }] de-duplicated, newest accession first
export function parseDailyFormIndex(idx) {
  const out = new Map();
  for (const line of String(idx).split(/\r?\n/)) {
    const m = line.match(IDX_LINE_RE);
    if (!m || out.has(m[4])) continue;
    out.set(m[4], { accessionNo: m[4], cikDir: m[3], formType: m[1], dateFiled: m[2] });
  }
  return [...out.values()].sort((a, b) => b.accessionNo.localeCompare(a.accessionNo));
}
