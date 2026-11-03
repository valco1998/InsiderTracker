// The transaction workspace bound to the main feed: table/cards, sort,
// new-row highlight, cursor Load More (unchanged behaviour).
// Phase D3: reports to the feed whether the reader is in older rows (desktop:
// the table's own scroll box; mobile: the page), so live refreshes never move
// the list under them — a "New filings available" bar appears instead.
import { useCallback, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useInsider } from "../InsiderContext";
import { PAGE_SIZE } from "../../../hooks/useInsiderFeed";
import { count } from "../../../utils/insiderFormat";
import { DesktopTable, MobileCards, TableSkeleton, useSortedRows } from "./TransactionTable";
import { EmptyState, ErrorNote } from "./Common";

export default function TransactionsPanel({ limit, title = "Transactions", maxHeight }) {
  const { feed, account, unfiltered } = useInsider();
  const { rows, total, status, loading, error, nextCursor, loadingMore, loadMore, reload, newIds, pending, applyPending, setReading } = feed;
  const visible = limit ? rows.slice(0, limit) : rows;
  const { sorted, sort, toggle, isDefault } = useSortedRows(visible);
  const firstLoad = loading && !status && !error;
  const backlog = status && (status.processing || status.queueLength > 0);
  const panelRef = useRef(null);
  const wrapRef = useRef(null);
  const readingRef = useRef(false);

  // Reading older rows = the table box is scrolled down, or the page is scrolled
  // past the first rows of this panel. Reported only when it flips (no re-render).
  const measure = useCallback(() => {
    const wrap = wrapRef.current, panel = panelRef.current;
    const boxScrolled = !!wrap && wrap.offsetParent !== null && wrap.scrollTop > 120;
    const pageScrolled = !!panel && panel.getBoundingClientRect().top < -160;
    const reading = boxScrolled || pageScrolled;
    if (reading !== readingRef.current) { readingRef.current = reading; setReading(reading); }
  }, [setReading]);

  useEffect(() => {
    const wrap = wrapRef.current;
    window.addEventListener("scroll", measure, { passive: true });
    wrap?.addEventListener("scroll", measure, { passive: true });
    measure();
    return () => {
      window.removeEventListener("scroll", measure);
      wrap?.removeEventListener("scroll", measure);
      if (readingRef.current) { readingRef.current = false; setReading(false); }
    };
  }, [measure, setReading, sorted.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps -- re-bind once the table mounts

  const showNew = () => {
    applyPending();
    wrapRef.current?.scrollTo({ top: 0 });
    const top = panelRef.current?.getBoundingClientRect().top ?? 0;
    if (top < 0) panelRef.current.scrollIntoView({ block: "start" });
  };

  return (
    <section ref={panelRef} className="it-panel relative flex min-w-0 flex-col" aria-label={title}>
      <header className="it-panel-head flex-wrap">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
          <h2 className="it-panel-title">{title}</h2>
          <span className="it-chip it-num">
            {firstLoad ? "loading…" : `${count(visible.length)} of ${count(total)}${unfiltered ? "" : " matching"}`}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!isDefault && <button className="it-chip it-chip-x" onClick={() => toggle("filed")} title="Return to newest-filed order">Sorted within loaded rows · reset</button>}
          {loading && status && <span className="text-[12px] it-dim2" aria-live="polite">Refreshing…</span>}
          {limit && <Link to="/insider/transactions" className="it-link whitespace-nowrap text-[13px]">All transactions →</Link>}
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

      {pending && (
        <div className="sticky top-[88px] z-10 flex justify-center px-3 pt-2 md:top-[52px]" role="status" aria-live="polite">
          <button onClick={showNew} className="it-btn it-btn-primary shadow-lg" style={{ height: 30 }}>
            New filings available · {pending.capped ? `${pending.count}+` : pending.count} new — show
          </button>
        </div>
      )}

      {sorted.length > 0 && (
        <>
          <DesktopTable rows={sorted} account={account} newIds={newIds} sort={sort} toggle={toggle} maxHeight={maxHeight} wrapRef={wrapRef} />
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
