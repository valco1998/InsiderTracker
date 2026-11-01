import { useEffect } from "react";
import { setToken } from "../../lib/storage";

/*
 * Handles the redirect from the server after Steam OpenID completes.
 * URL: /steam/callback?token=<JWT>  or  /steam/callback?error=<code>
 *
 * We clear the stale "user" from localStorage before navigating so that
 * AuthContext re-fetches /auth/me with the new Steam user, which includes
 * the correct steamId.  Without this, the old email-login user object
 * (missing steamId) persists in localStorage and SteamInventory never
 * receives the right steamId via context.
 *
 * We use window.location.replace instead of React Router navigate() so
 * AuthContext re-initializes from localStorage (where the token is already
 * saved), avoiding the race condition where ProtectedLayout sees token=null.
 */
export default function SteamCallback() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token  = params.get("token");
    const error  = params.get("error");

    console.log("[SteamCallback] page loaded at origin:", window.location.origin);
    console.log("[SteamCallback] token received:", token ? token.slice(0, 30) + "..." : null);
    console.log("[SteamCallback] error param:   ", error ?? null);

    if (error) {
      console.warn("[SteamCallback] server error, redirecting to /login:", error);
      window.location.replace(`/login?error=${encodeURIComponent(error)}`);
      return;
    }

    if (!token) {
      console.warn("[SteamCallback] no token in URL, redirecting to /login");
      window.location.replace("/login");
      return;
    }

    // 1. Clear stale user so AuthContext re-fetches /auth/me fresh on next load
    localStorage.removeItem("user");
    console.log("[SteamCallback] cleared stale 'user' from localStorage");

    // 2. Save JWT under the same key the rest of the app uses: "token"
    setToken(token);
    console.log("[SteamCallback] token saved to localStorage key 'token' at origin:", window.location.origin);

    // 3. Full-page replace so AuthContext re-initializes from localStorage.
    //    Honour the page the user originally tried to visit (saved by Login.jsx).
    const redirectTo = sessionStorage.getItem("redirectAfterLogin") || "/inventory";
    sessionStorage.removeItem("redirectAfterLogin");
    console.log("[SteamCallback] redirecting to", redirectTo, "(full reload), final authenticated origin:", window.location.origin);
    window.location.replace(redirectTo);
  }, []);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        background: "#0d1117",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <svg
        width={36}
        height={36}
        viewBox="0 0 32 32"
        fill="none"
        style={{ animation: "spin 1.2s linear infinite" }}
      >
        <circle cx="16" cy="16" r="12" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
        <path
          d="M16 4 A12 12 0 0 1 28 16"
          stroke="rgba(255,255,255,0.55)"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
      <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", letterSpacing: "0.04em" }}>
        Completing Steam login…
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
