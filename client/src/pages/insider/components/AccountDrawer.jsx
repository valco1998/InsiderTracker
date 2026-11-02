// Right-side drawer hosting the unchanged InsiderAccountPanel (sign-in,
// push toggle, follows, alerts). The dashboard never requires sign-in.
import { useEffect, useRef } from "react";
import InsiderAccountPanel from "../InsiderAccountPanel";
import { useInsider } from "../InsiderContext";

export default function AccountDrawer() {
  const { account, accountOpen, setAccountOpen } = useInsider();
  const ref = useRef(null);
  const close = () => setAccountOpen(false);

  useEffect(() => {
    if (!accountOpen) return undefined;
    const prevFocus = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.querySelector("input, button, select, a[href]")?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") setAccountOpen(false);
      if (e.key === "Tab" && ref.current) { // keep focus inside the dialog
        const f = [...ref.current.querySelectorAll("a[href], button:not([disabled]), input, select, [tabindex]:not([tabindex='-1'])")];
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prevOverflow; prevFocus?.focus?.(); };
  }, [accountOpen, setAccountOpen]);

  if (!accountOpen) return null;
  return (
    <>
      <div className="it-backdrop" onClick={close} />
      <aside ref={ref} className="it-drawer" role="dialog" aria-modal="true" aria-label="Account, follows and alerts">
        <header className="flex items-center justify-between px-4" style={{ height: 52, borderBottom: "1px solid var(--it-line)" }}>
          <span className="it-panel-title">Account &amp; alerts</span>
          <button onClick={close} className="it-btn" style={{ width: 32, padding: 0 }} aria-label="Close account panel">✕</button>
        </header>
        <div className="flex-1 overflow-y-auto p-4">
          {account.health ? <InsiderAccountPanel account={account} stacked /> : <div className="text-xs it-dim2">Checking account service…</div>}
          <p className="mt-4 text-[11px] leading-relaxed it-dim2">
            The dashboard is public. An account is only needed to follow companies and receive alerts for new Form 4 filings.
          </p>
        </div>
      </aside>
    </>
  );
}
