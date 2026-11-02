// Insider Tracker — merging a freshly fetched FIRST PAGE into the rows already
// shown (Phase D3 live updates). Pure functions, no React.
//
// Rows are in server order: newest SEC acceptance first (acceptedAtET, else
// filingDate), ties by row id in natural order — exactly as
// server/services/edgar/insiderSnapshot.js sorts them.
//
// mergeHead(prev, page, pageNext, prevNext) →
//   { rows, nextCursor }  the page replaces the head of the list; every
//                         previously loaded row OLDER than the page's last row
//                         is kept (same objects → memoized rows don't re-render),
//                         so Load More / the cursor keep working.
//   { gap: true }         more new rows arrived than one page holds: the page
//                         does not reach the rows already shown — the caller
//                         must reload everything instead (never show a hole).

const collator = new Intl.Collator(undefined, { numeric: true });
const sortKey = (t) => t.acceptedAtET || t.filingDate || "";

// < 0: a is newer (comes first); > 0: a is older.
export const compareRows = (a, b) => sortKey(b).localeCompare(sortKey(a)) || collator.compare(a.id, b.id);

export function mergeHead(prev, page, pageNext, prevNext) {
  if (!pageNext) return { rows: page, nextCursor: null }; // the page is the whole result
  if (prev.length <= page.length) return { rows: page, nextCursor: pageNext }; // only the first page was loaded
  const last = page[page.length - 1];
  if (!last) return { rows: page, nextCursor: pageNext };
  if (compareRows(last, prev[0]) < 0) return { gap: true };
  const inPage = new Set(page.map((r) => r.id));
  const older = prev.filter((r) => compareRows(r, last) > 0 && !inPage.has(r.id));
  return { rows: [...page, ...older], nextCursor: prevNext };
}

// Ids in `page` that were not shown before (genuinely new to this query).
export function newRowIds(prevRows, page) {
  const seen = new Set(prevRows.map((r) => r.id));
  return page.filter((r) => !seen.has(r.id)).map((r) => r.id);
}
