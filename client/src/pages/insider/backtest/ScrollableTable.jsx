// Horizontal navigation for a wide results table: column-group jump bar, edge fades
// and floating arrows that appear only when there is more content in that direction.
// Native wheel / trackpad / touch / keyboard scrolling is untouched — the scroll area is
// a focusable region (arrow keys scroll it). Nothing renders when the table fits.
//
// Column groups are marked in the table with <th data-group-start="<id>">; a sticky
// first column is marked with className "bt-sticky" (fades/arrows start after it).
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

const prefersReducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const SAME = (a, b) => Object.keys(a).every((k) => a[k] === b[k]);

export default function ScrollableTable({ groups, label, children }) {
  const ref = useRef(null);
  const frame = useRef(0);
  const id = useId();
  const [s, setS] = useState({ overflow: false, left: false, right: false, active: groups[0]?.id, sbW: 0, sbH: 0, headH: 40, stickyW: 0 });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const x = el.scrollLeft;
    const stickyW = el.querySelector("thead th.bt-sticky")?.offsetWidth || 0;
    let active = groups[0]?.id;
    for (const g of groups) {
      const th = el.querySelector(`th[data-group-start="${g.id}"]`);
      if (th && th.offsetLeft - stickyW <= x + 24) active = g.id;
    }
    if (max > 1 && x >= max - 2) active = groups[groups.length - 1]?.id; // the last group is fully visible at the end
    const next = {
      overflow: max > 1, left: x > 2, right: x < max - 2, active,
      sbW: el.offsetWidth - el.clientWidth, sbH: el.offsetHeight - el.clientHeight,
      headH: el.querySelector("thead")?.offsetHeight || 40, stickyW,
    };
    setS((p) => (SAME(p, next) ? p : next));
  }, [groups]);

  useLayoutEffect(() => { measure(); }, [measure, children]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const onScroll = () => { cancelAnimationFrame(frame.current); frame.current = requestAnimationFrame(measure); };
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onScroll) : null;
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    window.addEventListener("resize", onScroll);
    return () => { el.removeEventListener("scroll", onScroll); ro?.disconnect(); window.removeEventListener("resize", onScroll); cancelAnimationFrame(frame.current); };
  }, [measure]);

  const behavior = () => (prefersReducedMotion() ? "auto" : "smooth");
  const page = (dir) => {
    const el = ref.current;
    if (!el) return;
    // ~65% of the visible table width, keeping at least 48px of the previous view beside the sticky column.
    const step = Math.max(160, Math.min(el.clientWidth * 0.65, el.clientWidth - s.stickyW - 48));
    el.scrollBy({ left: dir * step, behavior: behavior() });
  };
  const goTo = (gid) => {
    const el = ref.current;
    if (!el) return;
    const th = gid === groups[0]?.id ? null : el.querySelector(`th[data-group-start="${gid}"]`);
    el.scrollTo({ left: th ? Math.max(0, th.offsetLeft - s.stickyW) : 0, behavior: behavior() });
  };

  const arrowTop = `calc(50% + ${(s.headH - s.sbH) / 2}px)`; // centred in the body area, below the header
  return (
    <div className="bt-scroller">
      {s.overflow && (
        <div className="bt-scroll-nav">
          <span className="text-[12px] it-dim2" id={`${id}-nav`}>Jump to</span>
          <div className="it-seg" role="group" aria-labelledby={`${id}-nav`}>
            {groups.map((g) => (
              <button key={g.id} type="button" aria-pressed={s.active === g.id} aria-controls={id} onClick={() => goTo(g.id)}>{g.label}</button>
            ))}
          </div>
          <span className="bt-scroll-hint text-[11.5px] it-dim2">Scroll sideways, use the arrows, or focus the table and press ← →</span>
        </div>
      )}
      <div className="bt-scroll-frame">
        <div
          ref={ref} id={id} className={`it-table-wrap bt-scroll-area${s.left ? " is-scrolled" : ""}`}
          role="region" aria-label={label} tabIndex={s.overflow ? 0 : undefined}
        >
          {children}
        </div>
        {s.overflow && (
          <>
            <div className="bt-fade bt-fade-l" data-on={s.left} style={{ left: s.stickyW, top: s.headH, bottom: s.sbH }} aria-hidden="true" />
            <div className="bt-fade bt-fade-r" data-on={s.right} style={{ right: s.sbW, top: s.headH, bottom: s.sbH }} aria-hidden="true" />
            <button type="button" className="bt-arrow" data-on={s.left} style={{ left: s.stickyW + 8, top: arrowTop }}
              aria-label="Show previous columns" aria-controls={id} aria-hidden={!s.left} tabIndex={s.left ? 0 : -1} onClick={() => page(-1)}>
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <button type="button" className="bt-arrow" data-on={s.right} style={{ right: s.sbW + 8, top: arrowTop }}
              aria-label="Show more columns" aria-controls={id} aria-hidden={!s.right} tabIndex={s.right ? 0 : -1} onClick={() => page(1)}>
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
