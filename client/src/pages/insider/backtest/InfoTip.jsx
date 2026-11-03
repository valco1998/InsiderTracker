// Small accessible "i" button (or a custom trigger, e.g. a chip) with an explanation.
// Opens on hover, keyboard focus or tap; closes on Escape or blur; follows its button
// on scroll/resize. Positioned with `fixed` in a portal on the app root (.it-root keeps
// the theme tokens), so the scrollable table (sticky header, edge fades, arrows) never
// clips or covers it. Its real height is measured after render: it opens below the
// trigger, flips above when there is no room, and is clamped inside the viewport.
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const GAP = 8, EDGE = 8;

export default function InfoTip({ label, children, trigger = null, triggerClass = "bt-info" }) {
  const [pos, setPos] = useState(null);
  const btn = useRef(null);
  const tip = useRef(null);
  const id = useId();
  const open = pos != null;

  const show = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(300, window.innerWidth - 24);
    const left = Math.max(12, Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - width - 12));
    setPos({ left, width, anchorTop: r.top, anchorBottom: r.bottom });
  };
  const hide = () => setPos(null);

  // Place using the measured height: below → above → clamped (always fully visible when it fits).
  useLayoutEffect(() => {
    const el = tip.current;
    if (!pos || !el) return;
    const h = el.offsetHeight, vh = window.innerHeight;
    let top = pos.anchorBottom + GAP;
    if (top + h > vh - EDGE) top = pos.anchorTop - GAP - h >= EDGE ? pos.anchorTop - GAP - h : Math.max(EDGE, vh - EDGE - h);
    el.style.top = `${top}px`;
    el.style.visibility = "visible";
  }, [pos]);

  useEffect(() => {
    if (!open) return undefined;
    const key = (e) => { if (e.key === "Escape") hide(); };
    window.addEventListener("scroll", show, true);
    window.addEventListener("resize", show);
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("scroll", show, true); window.removeEventListener("resize", show); window.removeEventListener("keydown", key); };
  }, [open]);

  return (
    <>
      <button
        ref={btn} type="button" className={triggerClass} aria-label={trigger ? `${label} — show evidence` : `What is “${label}”?`} aria-expanded={open} aria-describedby={open ? id : undefined}
        onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}
        onClick={(e) => { e.stopPropagation(); if (open) hide(); else show(); }}
      >
        {trigger || <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M8 7v4.2M8 4.6v.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>}
      </button>
      {open && createPortal(
        <span ref={tip} role="tooltip" id={id} className="bt-tip" style={{ left: pos.left, top: pos.anchorBottom + GAP, width: pos.width, maxHeight: `calc(100vh - ${2 * EDGE}px)`, overflowY: "auto", visibility: "hidden" }}>
          <strong className="bt-tip-title">{label}</strong>
          {children}
        </span>,
        btn.current?.closest(".it-root") || document.body,
      )}
    </>
  );
}
