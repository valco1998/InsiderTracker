// Insider Tracker — account area: sign in, push toggle, follows, alerts.
// Reuses the existing auth hooks/context and usePushNotifications unchanged.
import { useState } from "react";
import useAuth from "../../hooks/useAuth";
import useLogin from "../../hooks/useLogin";
import useSignup from "../../hooks/useSignup";
import usePushNotifications from "../../hooks/usePushNotifications";

const panel = { background: "var(--bg-panel)", border: "1px solid var(--border)" };
const input = "h-9 w-full rounded-lg px-3 text-sm text-white/90 outline-none focus:ring-1 focus:ring-cyan-400/50";
const inputStyle = { background: "var(--bg-surface)", border: "1px solid var(--border)" };
const btn = "h-9 rounded-lg px-3 text-sm font-medium transition-colors disabled:opacity-50";
const primary = { background: "rgba(34,211,238,0.15)", color: "var(--cyan)", border: "1px solid rgba(34,211,238,0.35)" };
const TYPE_LABEL = { both: "Purchases & sales", purchase: "Purchases only", sale: "Sales only" };

const day = (iso) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" }) : "—");

function SignIn() {
  const { loginWithToken } = useAuth();
  const { login, loading: loggingIn, error: loginError } = useLogin();
  const { signup, loading: signingUp, error: signupError } = useSignup();
  const [mode, setMode] = useState("login");
  const [f, setF] = useState({ identifier: "", username: "", email: "", password: "", confirmPassword: "" });
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (mode === "login") {
      try {
        const data = await login({ identifier: f.identifier, password: f.password });
        if (data?.token) loginWithToken(data.token, data.user);
      } catch { /* error shown by hook */ }
    } else {
      const data = await signup({ username: f.username, email: f.email, password: f.password, confirmPassword: f.confirmPassword });
      if (data?.token) loginWithToken(data.token, data.user);
    }
  };
  const busy = loggingIn || signingUp;
  const error = mode === "login" ? loginError : signupError;

  return (
    <form onSubmit={submit} className="flex flex-col gap-2.5 rounded-xl p-4" style={panel}>
      <div className="text-sm font-semibold text-white">{mode === "login" ? "Sign in to follow companies" : "Create an account"}</div>
      <div className="text-xs text-white/50">Get a push notification when insiders at companies you follow report a purchase or sale on Form 4.</div>
      {mode === "login" ? (
        <input className={input} style={inputStyle} placeholder="Email or username" autoComplete="username" value={f.identifier} onChange={set("identifier")} />
      ) : (
        <>
          <input className={input} style={inputStyle} placeholder="Username" autoComplete="username" value={f.username} onChange={set("username")} />
          <input className={input} style={inputStyle} placeholder="Email" type="email" autoComplete="email" value={f.email} onChange={set("email")} />
        </>
      )}
      <input className={input} style={inputStyle} placeholder="Password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={f.password} onChange={set("password")} />
      {mode === "signup" && <input className={input} style={inputStyle} placeholder="Confirm password" type="password" autoComplete="new-password" value={f.confirmPassword} onChange={set("confirmPassword")} />}
      {error && <div className="text-xs text-rose-300">{error}</div>}
      <div className="flex items-center justify-between gap-2">
        <button type="submit" disabled={busy} className={btn} style={primary}>{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</button>
        <button type="button" onClick={() => setMode(mode === "login" ? "signup" : "login")} className="text-xs text-white/55 hover:text-white">
          {mode === "login" ? "New here? Create an account" : "Have an account? Sign in"}
        </button>
      </div>
    </form>
  );
}

function PushToggle({ serverPush }) {
  const { status, loading, error, request, disable } = usePushNotifications();
  const msg = {
    checking: "Checking notification support…",
    "no-config": "Push notifications are not configured for this app yet.",
    "browser-unsupported": "This browser does not support push notifications. On iPhone, add the app to your Home Screen first.",
    "not-logged-in": "Sign in to enable notifications.",
    denied: "Notifications are blocked in your browser settings.",
    ready: "Get a push notification when a followed company files a Form 4 purchase or sale.",
    enabled: "Push notifications are on for this device.",
  }[status] || "";
  return (
    <div className="flex flex-col gap-2 rounded-lg p-3" style={{ background: "var(--bg-surface)" }}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-white/85">Push notifications</span>
        {status === "ready" && <button onClick={request} disabled={loading} className={btn} style={primary}>{loading ? "Enabling…" : "Enable"}</button>}
        {status === "enabled" && <button onClick={disable} disabled={loading} className={`${btn} text-white/60`} style={{ border: "1px solid var(--border)" }}>Turn off</button>}
      </div>
      <div className="text-xs text-white/50">{msg}</div>
      {!serverPush && status !== "no-config" && <div className="text-xs text-amber-300/80">Server-side delivery is not configured yet — alerts are recorded but not pushed.</div>}
      {error && <div className="text-xs text-rose-300">{String(error)}</div>}
    </div>
  );
}

function Following({ account }) {
  const [ticker, setTicker] = useState("");
  const [types, setTypes] = useState("both");
  const [msg, setMsg] = useState(null);
  const add = async (e) => {
    e.preventDefault();
    if (!ticker) return;
    const r = await account.follow(ticker, types);
    setMsg(r.ok ? null : r.error);
    if (r.ok) setTicker("");
  };
  return (
    <div className="flex flex-col gap-2.5">
      <form onSubmit={add} className="flex flex-wrap gap-2">
        <input value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 10))}
          placeholder="Ticker, e.g. AAPL" className={`${input} min-w-0 flex-1`} style={inputStyle} />
        <select value={types} onChange={(e) => setTypes(e.target.value)} className={`${input} w-auto`} style={{ ...inputStyle, colorScheme: "dark" }}>
          {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button type="submit" className={btn} style={primary}>Follow</button>
      </form>
      {msg && <div className="text-xs text-rose-300">{msg}</div>}
      {account.watches.length === 0 ? (
        <div className="text-xs text-white/40">Not following any companies yet. Use “+ Follow” on any transaction or add a ticker above.</div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {account.watches.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center gap-2 rounded-lg px-3 py-2" style={{ background: "var(--bg-surface)" }}>
              <span className="font-semibold text-white">{w.ticker}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-white/50" title={w.companyName}>{w.companyName}</span>
              <select value={w.types} onChange={(e) => account.updateWatch(w.id, { types: e.target.value })}
                className="h-8 rounded-md px-2 text-xs text-white/80" style={{ ...inputStyle, colorScheme: "dark" }} aria-label={`Alert types for ${w.ticker}`}>
                {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <label className="flex items-center gap-1 text-xs text-white/60" title="Paused follows never back-fill alerts when resumed">
                <input type="checkbox" checked={w.enabled} onChange={(e) => account.updateWatch(w.id, { enabled: e.target.checked })} className="accent-cyan-400" />
                On
              </label>
              <button onClick={() => account.unfollow(w.id)} className="text-xs text-white/40 hover:text-rose-300" aria-label={`Unfollow ${w.ticker}`}>Remove</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Alerts({ account }) {
  if (!account.alerts.length) {
    return <div className="text-xs text-white/40">No alerts yet. Alerts are sent only for Form 4 filings accepted by the SEC after you follow a company.</div>;
  }
  return (
    <div className="flex flex-col gap-1.5">
      {account.unread > 0 && <button onClick={() => account.markRead(null)} className="self-end text-xs text-white/50 hover:text-white">Mark all read</button>}
      <ul className="flex max-h-80 flex-col gap-1.5 overflow-y-auto">
        {account.alerts.map((a) => (
          <li key={a.id} className="rounded-lg px-3 py-2" style={{ background: "var(--bg-surface)", borderLeft: `2px solid ${a.isRead ? "transparent" : "var(--cyan)"}` }}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-white">{a.title}</span>
              {!a.isRead && <button onClick={() => account.markRead(a.id)} className="text-[11px] text-white/40 hover:text-white">Mark read</button>}
            </div>
            <div className="text-xs text-white/55">{a.insiderName} · traded {day(a.transactionDate)} · filed {day(a.filingDate)}</div>
            <div className="mt-1 flex flex-wrap gap-x-3">
              {(a.filings?.length ? a.filings : [{ accessionNo: "", filingUrl: a.filingUrl }]).map((f, i, all) => (
                <a key={f.accessionNo || i} href={f.filingUrl} target="_blank" rel="noopener noreferrer" className="text-xs hover:underline" style={{ color: "var(--cyan)" }}>
                  {all.length > 1 ? `SEC filing ${i + 1} ↗` : "SEC filing ↗"}
                </a>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// `stacked`: single column (used inside the account drawer).
export default function InsiderAccountPanel({ account, stacked = false }) {
  const { isAuthed, logout } = useAuth();
  if (!account.health) return null;
  if (!account.accountsAvailable) {
    return (
      <div className="rounded-xl px-4 py-3 text-xs text-white/50" style={panel}>
        Following companies and push alerts will be available once this server&apos;s account database is configured.
      </div>
    );
  }
  if (!isAuthed) return <SignIn />;
  return (
    <div className={`grid gap-3 ${stacked ? "" : "lg:grid-cols-2"}`}>
      <section className="flex flex-col gap-3 rounded-xl p-4" style={panel}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Following</h2>
          <button onClick={logout} className="text-xs text-white/45 hover:text-white">Sign out{account.user?.username ? ` (${account.user.username})` : ""}</button>
        </div>
        <PushToggle serverPush={!!account.health?.push} />
        <Following account={account} />
      </section>
      <section className="flex flex-col gap-3 rounded-xl p-4" style={panel}>
        <h2 className="text-sm font-semibold text-white">Your alerts{account.unread ? ` · ${account.unread} new` : ""}</h2>
        {account.error && <div className="text-xs text-rose-300">{account.error}</div>}
        <Alerts account={account} />
      </section>
    </div>
  );
}

export function FollowButton({ t, account }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  if (!account.ready || !t.ticker) return null;
  if (account.isFollowing(t.issuerCik)) {
    return <span className="text-[10px] font-medium text-cyan-300/80" title="You follow this company">Following ✓</span>;
  }
  const onClick = async () => {
    setBusy(true);
    setError(null);
    // Follow by the filing's issuer CIK so the alert matches this exact company.
    const r = await account.follow(t.ticker, "both", t.issuerCik);
    if (!r.ok) setError(r.error);
    setBusy(false);
  };
  return (
    <span className="inline-flex items-center gap-1.5">
      <button disabled={busy} onClick={onClick}
        className="rounded px-1.5 py-px text-[10px] font-medium text-white/60 hover:text-white disabled:opacity-50"
        style={{ border: "1px solid var(--border)" }} title={`Get alerts for new ${t.ticker} Form 4 filings`}>
        + Follow
      </button>
      {error && <span className="text-[10px] text-rose-300" role="alert" title={error}>Couldn&apos;t follow</span>}
    </span>
  );
}
