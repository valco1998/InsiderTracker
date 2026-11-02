// The transaction workspace bound to the main feed: table/cards, sort,
// new-row highlight, cursor Load More (unchanged behaviour).
import { Link } from "react-router-dom";
import { useInsider } from "../InsiderContext";
import { PAGE_SIZE } from "../../../hooks/useInsiderFeed";
import { count } from "../../../utils/insiderFormat";
import { DesktopTable, MobileCards, TableSkeleton, useSortedRows } from "./TransactionTable";
import { EmptyState, ErrorNote } from "./Common";

export default function TransactionsPanel({ limit, title = "Transactions", maxHeight }) {
  const { feed, account, unfiltered } = useInsider();
  const { rows, total, status, loading, error, nextCursor, loadingMore, loadMore, reload, newIds } = feed;
  const visible = limit ? rows.slice(0, limit) : rows;
  const { sorted, sort, toggle, isDefault } = useSortedRows(visible);
  const firstLoad = loading && !status && !error;
  const backlog = status && (status.processing || status.queueLength > 0);

  return (
    <section className="it-panel flex min-w-0 flex-col" aria-label={title}>
      <header className="it-panel-head">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="it-panel-title">{title}</h2>
          <span className="it-num truncate text-[11px] it-dim2">
            {firstLoad ? "loading…" : `${count(visible.length)} of ${count(total)}${unfiltered ? "" : " matching"}`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!isDefault && <button className="it-chip" onClick={() => toggle("filed")} title="Return to newest-filed order">Sorted within loaded rows · reset</button>}
          {loading && status && <span className="text-[11px] it-dim2" aria-live="polite">Refreshing…</span>}
          {limit && <Link to="/insider/transactions" className="it-link text-[12px]">All transactions →</Link>}
        </div>
      </header>

      {error && <div className="p-3"><ErrorNote onRetry={reload}>{error}</ErrorNote></div>}
      {firstLoad && <TableSkeleton />}
      {!firstLoad && !error && rows.length === 0 && (
        <EmptyState title="No matching open-market purchases or sales yet.">
          {backlog ? "Filings are still being downloaded from SEC EDGAR — results appear automatically."
            : "Try clearing filters. Most Form 4 filings report grants, option exercises or tax withholding, which are not shown."}
        </EmptyState>
      )}

      {sorted.length > 0 && (
        <>
          <DesktopTable rows={sorted} account={account} newIds={newIds} sort={sort} toggle={toggle} maxHeight={maxHeight} />
          <MobileCards rows={sorted} account={account} newIds={newIds} />
          {!limit && total > rows.length && (
            <div className="flex flex-col items-center gap-2 px-3 py-4 text-[11.5px] it-dim2" style={{ borderTop: "1px solid var(--it-line-soft)" }}>
              <span>Showing the {count(rows.length)} most recent of {count(total)} transactions.</span>
              {nextCursor && (
                <button onClick={loadMore} disabled={loadingMore} className="it-btn">
                  {loadingMore ? "Loading…" : `Load ${Math.min(PAGE_SIZE, total - rows.length)} more`}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
