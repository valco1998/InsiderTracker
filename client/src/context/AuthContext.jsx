// Authentication — Google sign-in only (Firebase Authentication).
//  • Firebase keeps the session (local persistence): signed in across refreshes and browser
//    restarts until sign-out. ID tokens refresh automatically.
//  • On every sign-in / page load with a Firebase user, POST /auth/session verifies the ID
//    token on the server and creates or links the MongoDB profile (Firebase UID).
//  • API calls carry the ID token via lib/storage.js → lib/api.js; a 401 triggers one forced
//    refresh, then a clean sign-out with a "session ended" message.
// The context keeps the fields existing components use: token, user, isAuthed, loading,
// logout, setUser, updateUserSetting (+ loginWithToken, now a no-op).
import { createContext, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clearToken, setTokenProvider, getCachedUser, setCachedUser } from "../lib/storage";
import { isFirebaseConfigured } from "../lib/firebase";
import { onGoogleAuthChange, signInWithGoogle as googleSignIn, completeGoogleRedirect, signOutGoogle, authErrorMessage, isQuietAuthError } from "../lib/firebaseAuth";
import api from "../lib/api";

export const AuthContext = createContext(null);

const errorOf = (code) => ({ code, message: authErrorMessage({ code }) });

export function AuthProvider({ children }) {
  const configured = isFirebaseConfigured();
  const [user, setUser] = useState(() => (configured ? getCachedUser() : null));
  const [token, setTok] = useState(null);
  const [loading, setLoading] = useState(configured);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState(null);
  const fbUserRef = useRef(null);

  const endSession = useCallback(async (err = null) => {
    setTokenProvider(null);
    fbUserRef.current = null;
    setTok(null);
    setUser(null);
    setCachedUser(null);
    if (err) setAuthError(err);
    try { await signOutGoogle(); } catch { /* already signed out */ }
  }, []);

  useEffect(() => {
    clearToken(); // retire the legacy email/password session token
    if (!configured) { setCachedUser(null); setLoading(false); return undefined; }
    completeGoogleRedirect().catch((e) => { if (!isQuietAuthError(e)) setAuthError({ code: e?.code, message: authErrorMessage(e) }); });
    const unsubscribe = onGoogleAuthChange(async (fbUser) => {
      fbUserRef.current = fbUser;
      if (!fbUser) {
        setTokenProvider(null);
        setTok(null);
        setUser(null);
        setCachedUser(null);
        setLoading(false);
        return;
      }
      setTokenProvider((force) => fbUser.getIdToken(force));
      setLoading(true);
      try {
        setTok(await fbUser.getIdToken());
        const res = await api.post("/auth/session");
        if (fbUserRef.current !== fbUser) return; // signed out meanwhile
        setUser(res.data?.user || null);
        setCachedUser(res.data?.user || null);
        setAuthError(null);
      } catch (e) {
        await endSession(errorOf(e?.response?.data?.code === "auth/account-conflict" ? "auth/account-conflict" : "auth/session-failed"));
      } finally {
        setLoading(false);
      }
    });
    return unsubscribe;
  }, [configured, endSession]);

  // A protected call still returned 401 after a token refresh → the session is over.
  useEffect(() => {
    const onUnauthorized = () => {
      if (!fbUserRef.current) return;
      endSession({ code: "auth/session-ended", message: "Your session has ended. Please continue with Google to sign in again." });
    };
    window.addEventListener("auth:unauthorized", onUnauthorized);
    return () => window.removeEventListener("auth:unauthorized", onUnauthorized);
  }, [endSession]);

  const signInWithGoogle = useCallback(async () => {
    setAuthError(null);
    setSigningIn(true);
    try {
      await googleSignIn(); // onGoogleAuthChange completes the session
    } catch (e) {
      if (!isQuietAuthError(e)) setAuthError({ code: e?.code, message: authErrorMessage(e) });
    } finally {
      setSigningIn(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try { await api.post("/auth/logout"); } catch { /* best effort */ }
    await endSession(null);
  }, [endSession]);

  const updateUserSetting = useCallback(async (key, value) => {
    const res = await api.patch("/auth/settings", { [key]: value });
    if (res.data.ok) { setUser(res.data.user); setCachedUser(res.data.user); }
  }, []);

  // Email/password login is retired; kept so older imports keep compiling.
  const loginWithToken = useCallback(() => {
    if (import.meta.env.DEV) console.warn("[AUTH] loginWithToken() is retired — use signInWithGoogle()");
  }, []);

  const value = useMemo(() => ({
    token, user, isAuthed: !!(token && user), loading, signingIn, authError, configured,
    signInWithGoogle, clearAuthError: () => setAuthError(null),
    loginWithToken, logout, setUser, updateUserSetting,
  }), [token, user, loading, signingIn, authError, configured, signInWithGoogle, loginWithToken, logout, updateUserSetting]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
