// Small shared building blocks for the Insider Tracker views.
import { useEffect, useRef, useState } from "react";

export function Skeleton({ className = "", style }) {
  return <div className={`it-skel ${className}`} style={style} aria-hidden="true" />;
}

export function Panel({ title, subtitle, right, children, className = "", bodyClass = "" }) {
  return (
    <section className={`it-panel flex min-w-0 flex-col ${className}`}>
      {(title || right) && (
        <header className="it-panel-head">
          <div className="min-w-0">
            {title && <h2 className="it-panel-title truncate">{title}</h2>}
            {subtitle && <div className="truncate text-[12.5px] it-dim2">{subtitle}</div>}
          </div>
          {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
        </header>
      )}
      <div className={`min-w-0 flex-1 ${bodyClass}`}>{children}</div>
    </section>
  );
}

// Page title area: consistent hierarchy on every page (title, one-line description, actions).
export function PageHeader({ title, description, badge, right }) {
  return (
    <div className="it-page-head">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="it-h1">{title}</h1>
          {badge}
        </div>
        {description && <p className="it-lede mt-1 max-w-3xl">{description}</p>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

export function EmptyState({ title, children }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <span className="grid h-10 w-10 place-items-center rounded-full" style={{ background: "var(--it-surface)", color: "var(--it-text-3)" }} aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      </span>
      <div className="text-[14px] font-medium" style={{ color: "var(--it-text)" }}>{title}</div>
      {children && <div className="max-w-md text-[13px] it-dim2">{children}</div>}
    </div>
  );
}

export function ErrorNote({ children, onRetry }) {
  return (
    <div role="alert" className="flex items-center justify-between gap-3 rounded-lg px-4 py-3 text-[13px]"
      style={{ color: "var(--it-sell)", background: "var(--it-sell-soft)", border: "1px solid var(--it-sell-line)" }}>
      <span>{children}</span>
      {onRetry && <button className="it-btn" style={{ height: 30 }} onClick={onRetry}>Retry</button>}
    </div>
  );
}

export function Disclaimer() {
  return (
    <p className="rounded-xl px-4 py-3 text-[12.5px] leading-relaxed" style={{ color: "var(--it-text-2)", background: "var(--it-surface)", border: "1px solid var(--it-line-soft)" }}>
      These are <strong>reported</strong> trades, not real-time trades. Insiders file Form 4 up to two business days after the
      <strong> trade date</strong>; the <strong>filed</strong> date is when the SEC received the report. Reported value = shares × reported
      price per share. Data is informational only and is not investment advice. Always verify against the official SEC filing.
    </p>
  );
}

const reduceMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Animates only when the value actually changes after the first real value.
export function useAnimatedNumber(target, duration = 450) {
  const [shown, setShown] = useState(target);
  const fromRef = useRef(target);
  useEffect(() => {
    const from = fromRef.current;
    fromRef.current = target;
    if (target == null || from == null || from === target || reduceMotion()) { setShown(target); return undefined; }
    let raf, start;
    const step = (ts) => {
      start ??= ts;
      const k = Math.min(1, (ts - start) / duration);
      const e = 1 - (1 - k) ** 3;
      setShown(from + (target - from) * e);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return shown;
}

export function AnimatedNumber({ value, format }) {
  const v = useAnimatedNumber(value);
  return <>{format(v == null ? null : v)}</>;
}
