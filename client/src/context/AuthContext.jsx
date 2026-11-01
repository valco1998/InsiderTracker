import { createContext, useEffect, useMemo, useState } from "react";
import { clearToken, getToken, setToken } from "../lib/storage";
import api from "../lib/api";

export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setTokenState] = useState(() => getToken());
  const [user, setUser] = useState(() => {
    // אם תרצה לשמור גם user בלוקאל (אופציונלי)
    try {
      const raw = localStorage.getItem("user");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(true);

  const isAuthed = !!token;

  // טוען את המשתמש מהשרת כשיש token
  useEffect(() => {
    let ignore = false;

    async function loadMe() {
      try {
        setLoading(true);

        const t = getToken();
        console.log("[AUTH] origin:", window.location.origin, "| token in localStorage:", !!t);
        if (!t) {
          console.log("[AUTH] no token at this origin — treating as logged out");
          if (!ignore) setUser(null);
          return;
        }

        const res = await api.get("/auth/me")
        const u = res.data?.user ?? null;
        console.log("[AUTH] /auth/me ok — user:", u?.username, "| steamId:", u?.steamId || "(none)");

        if (!ignore) {
          setUser(u);
          // אופציונלי: לשמור user בלוקאל כדי למנוע “ריק” בהתחלה
          localStorage.setItem("user", JSON.stringify(u));
        }
      } catch (e) {
        // אם token לא תקין/פג תוקף -> מתנתקים נקי
        console.log("[AUTH] /auth/me failed — clearing token. origin:", window.location.origin, "| error:", e?.message);
        if (!ignore) {
          clearToken();
          localStorage.removeItem("user");
          setTokenState(null);
          setUser(null);
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    loadMe();
    return () => {
      ignore = true;
    };
  }, [token]);

  // ✅ חשוב: להכניס גם user כדי שה-UI יתעדכן מיד אחרי login
  const loginWithToken = (t, userData = null) => {
    setToken(t);
    setTokenState(t);

    if (userData) {
      setUser(userData);
      localStorage.setItem("user", JSON.stringify(userData));
    }
  };

  const logout = async () => {
    // אופציונלי (אם יש לך endpoint של logout)
    try {
      await api.post("/auth/logout");
    } catch {}

    clearToken();
    localStorage.removeItem("user");
    setTokenState(null);
    setUser(null);
  };

  const updateUserSetting = async (key, value) => {
    const res = await api.patch("/auth/settings", { [key]: value });
    if (res.data.ok) {
      setUser(res.data.user);
      localStorage.setItem("user", JSON.stringify(res.data.user));
    }
  };

  const value = useMemo(
    () => ({
      token,
      user,
      isAuthed,
      loading,
      loginWithToken,
      logout,
      setUser,
      updateUserSetting,
    }),
    [token, user, isAuthed, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}