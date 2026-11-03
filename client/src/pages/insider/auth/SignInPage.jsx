// /insider/sign-in — the InsiderTracker sign-in page (Google only).
// Signed-in visitors are sent on to ?next= (an /insider path) or the Overview.
import { useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import useAuth from "../../../hooks/useAuth";
import GoogleSignIn from "./GoogleSignIn";

const safeNext = (n) => (typeof n === "string" && n.startsWith("/insider") && !n.startsWith("//") ? n : "/insider");

export default function SignInPage() {
  const { isAuthed, user } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = safeNext(params.get("next"));
  useEffect(() => { if (isAuthed) navigate(next, { replace: true }); }, [isAuthed, navigate, next]);

  return (
    <div className="flex min-h-[calc(100vh-180px)] items-center justify-center px-1 py-10">
      <section className="it-panel w-full max-w-[420px] px-7 py-8 sm:px-9 sm:py-10" style={{ boxShadow: "var(--it-shadow-lg)" }} aria-labelledby="signin-title">
        <span className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-xl" style={{ background: "var(--it-accent)", color: "var(--it-on-accent)", boxShadow: "var(--it-shadow-md)" }} aria-hidden="true">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l6-6 4 4 8-8" /><path d="M15 7h6v6" /></svg>
        </span>
        <h1 id="signin-title" className="text-center text-[24px] font-semibold tracking-tight" style={{ color: "var(--it-text)" }}>Sign in to InsiderTracker</h1>
        <p className="mx-auto mt-2 max-w-[320px] text-center text-[14px] leading-relaxed it-dim">
          Follow companies and get notified when insiders report purchases or sales to the SEC.
        </p>
        <div className="mt-7">
          {isAuthed ? <p className="text-center text-[14px] it-dim">Signed in as {user?.username} — redirecting…</p> : <GoogleSignIn />}
        </div>
        <ul className="mt-7 flex flex-col gap-2 text-[12.5px] leading-relaxed it-dim2">
          <li className="flex gap-2"><span aria-hidden="true">✓</span>One secure sign-in with your Google account — no new password.</li>
          <li className="flex gap-2"><span aria-hidden="true">✓</span>We receive only your name, email address and profile photo from Google.</li>
          <li className="flex gap-2"><span aria-hidden="true">✓</span>You stay signed in on this device until you sign out.</li>
        </ul>
        <p className="mt-6 text-center text-[12px] it-dim2">
          By continuing you agree to our <Link to="/privacy" className="it-link">privacy policy</Link>. Market and insider data are informational only.
        </p>
      </section>
    </div>
  );
}
