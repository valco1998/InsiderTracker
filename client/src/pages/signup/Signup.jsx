import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import useSignup from "../../hooks/useSignup.js";
import ErrorBanner from "../../pages/components/ErrorBanner.jsx";
import Spinner from "../../pages/components/Spinner.jsx";
import steamLogoImg from "../../assets/Steam_icon_logo.png";
import { STEAM_LOGIN_URL } from "../../lib/config";

function SteamIcon({ size = 17 }) {
  return (
    <img
      src={steamLogoImg}
      alt="Steam"
      style={{ width: size, height: size, objectFit: "contain", flexShrink: 0 }}
    />
  );
}

export default function Signup() {
  const nav = useNavigate();
  const { signup, loading, error } = useSignup();

  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [form, setForm] = useState({
    username: "",
    fullName: "",
    email: "",
    password: "",
    confirmPassword: "",
    gender: "unspecified",
  });

  const isValid = useMemo(() => {
    const u = form.username.trim();
    const e = form.email.trim();
    const p = form.password;
    const cp = form.confirmPassword;

    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
    const passOk = p.length >= 6;
    const confirmOk = cp.length >= 6 && cp === p;

    return u.length >= 3 && emailOk && passOk && confirmOk;
  }, [form]);

  const submit = async (e) => {
    e.preventDefault();
    if (!isValid || loading) return;

    const data = await signup({
      username: form.username.trim(),
      fullName: form.fullName.trim(),
      email: form.email.trim(),
      password: form.password,
      confirmPassword: form.confirmPassword,
      gender: form.gender,
    });

    if (!data?.ok) return;
    nav("/login");
  };

  return (
    <div className="min-h-screen text-white" style={{ background: "var(--bg-app)" }}>
      <div className="mx-auto max-w-md px-4 py-10">
        <div className="mb-6">
          <div className="text-3xl font-extrabold tracking-tight">Create account</div>
          <div className="mt-1 text-sm text-white/60">
            Start tracking deals, watchlists, and market signals.
          </div>
        </div>

        <div className="rounded-2xl p-5 shadow-xl" style={{ background: "var(--bg-surface)", border: "1px solid rgba(255,255,255,0.09)" }}>
          <ErrorBanner message={error} />

          {/* ── Steam shortcut (top of card) ── */}
          <div className="mb-4">
            <a
              href={STEAM_LOGIN_URL}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 9,
                width: "100%",
                padding: "9px 0",
                borderRadius: 9,
                background: "rgba(23,26,33,0.7)",
                border: "1px solid rgba(102,192,244,0.18)",
                color: "rgba(255,255,255,0.75)",
                fontSize: 13,
                fontWeight: 600,
                textDecoration: "none",
                transition: "all 0.18s ease",
                cursor: "pointer",
                boxShadow: "0 0 0 0 transparent",
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = "rgba(23,26,33,0.95)";
                e.currentTarget.style.borderColor = "rgba(102,192,244,0.38)";
                e.currentTarget.style.color = "#fff";
                e.currentTarget.style.boxShadow = "0 0 16px rgba(102,192,244,0.18), 0 2px 8px rgba(0,0,0,0.4)";
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = "rgba(23,26,33,0.7)";
                e.currentTarget.style.borderColor = "rgba(102,192,244,0.18)";
                e.currentTarget.style.color = "rgba(255,255,255,0.75)";
                e.currentTarget.style.boxShadow = "0 0 0 0 transparent";
              }}
            >
              <SteamIcon size={18} />
              Sign in with Steam
            </a>

            {/* Separator */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginTop: 14,
              }}
            >
              <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.08)" }} />
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", whiteSpace: "nowrap", letterSpacing: "0.04em" }}>
                or continue with email
              </span>
              <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.08)" }} />
            </div>
          </div>

          <form onSubmit={submit} className="space-y-3">
            {/* Username */}
            <div className="space-y-1">
              <label className="text-sm text-white/70">Username</label>
              <input
                className="w-full rounded-xl border border-white/[0.10] bg-white/[0.05] px-3 py-2 text-white/90 outline-none focus:border-cyan-400/35 placeholder:text-white/25"
                placeholder="e.g. idanakiva"
                autoComplete="username"
                value={form.username}
                onChange={(e) => setForm((p) => ({ ...p, username: e.target.value }))}
              />
              <div className="text-xs text-white/45">Min 3 characters</div>
            </div>

            {/* Full name */}
            <div className="space-y-1">
              <label className="text-sm text-white/70">Full name (optional)</label>
              <input
                className="w-full rounded-xl border border-white/[0.10] bg-white/[0.05] px-3 py-2 text-white/90 outline-none focus:border-cyan-400/35 placeholder:text-white/25"
                placeholder="e.g. Idan Akiva"
                autoComplete="name"
                value={form.fullName}
                onChange={(e) => setForm((p) => ({ ...p, fullName: e.target.value }))}
              />
            </div>

            {/* Gender */}
            <div className="space-y-1">
              <label className="text-sm text-white/70">Gender</label>
              <div className="flex flex-wrap gap-2">
                <label className="flex items-center gap-2 rounded-xl border border-white/[0.09] bg-white/[0.04] px-3 py-2 text-sm">
                  <input
                    type="radio"
                    name="gender"
                    value="male"
                    checked={form.gender === "male"}
                    onChange={(e) => setForm((p) => ({ ...p, gender: e.target.value }))}
                  />
                  Male
                </label>

                <label className="flex items-center gap-2 rounded-xl border border-white/[0.09] bg-white/[0.04] px-3 py-2 text-sm">
                  <input
                    type="radio"
                    name="gender"
                    value="female"
                    checked={form.gender === "female"}
                    onChange={(e) => setForm((p) => ({ ...p, gender: e.target.value }))}
                  />
                  Female
                </label>

                <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/80">
                  <input
                    type="radio"
                    name="gender"
                    value="unspecified"
                    checked={form.gender === "unspecified"}
                    onChange={(e) => setForm((p) => ({ ...p, gender: e.target.value }))}
                  />
                  Prefer not to say
                </label>
              </div>
            </div>

            {/* Email */}
            <div className="space-y-1">
              <label className="text-sm text-white/70">Email</label>
              <input
                className="w-full rounded-xl border border-white/[0.10] bg-white/[0.05] px-3 py-2 text-white/90 outline-none focus:border-cyan-400/35 placeholder:text-white/25"
                placeholder="name@example.com"
                autoComplete="email"
                value={form.email}
                onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
              />
            </div>

            {/* Password */}
            <div className="space-y-1">
              <label className="text-sm text-white/70">Password</label>
              <div className="flex items-center gap-2">
                <input
                  type={showPass ? "text" : "password"}
                  className="w-full rounded-xl border border-white/[0.10] bg-white/[0.05] px-3 py-2 text-white/90 outline-none focus:border-cyan-400/35 placeholder:text-white/25"
                  placeholder="At least 6 characters"
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
                />
                <button
                  type="button"
                  onClick={() => setShowPass((s) => !s)}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 hover:bg-white/10"
                >
                  {showPass ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            {/* Confirm password */}
            <div className="space-y-1">
              <label className="text-sm text-white/70">Confirm password</label>
              <div className="flex items-center gap-2">
                <input
                  type={showConfirm ? "text" : "password"}
                  className="w-full rounded-xl border border-white/[0.10] bg-white/[0.05] px-3 py-2 text-white/90 outline-none focus:border-cyan-400/35 placeholder:text-white/25"
                  placeholder="Repeat password"
                  autoComplete="new-password"
                  value={form.confirmPassword}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, confirmPassword: e.target.value }))
                  }
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm((s) => !s)}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 hover:bg-white/10"
                >
                  {showConfirm ? "Hide" : "Show"}
                </button>
              </div>

              {form.confirmPassword.length > 0 && form.confirmPassword !== form.password ? (
                <div className="text-xs text-red-300">Passwords do not match</div>
              ) : null}
            </div>

            <button
              disabled={!isValid || loading}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-3 py-2 font-semibold text-black hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Spinner className="h-4 w-4" />
                  Creating...
                </>
              ) : (
                "Create account"
              )}
            </button>

            <div className="pt-1 text-sm text-white/60">
              Already have an account?{" "}
              <Link className="text-sky-300 hover:underline" to="/login">
                Login
              </Link>
            </div>
          </form>
        </div>

        <div className="mt-6 text-center text-xs text-white/35">
          AppCSNT • Local dev
        </div>
      </div>
    </div>
  );
}
