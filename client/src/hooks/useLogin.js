import { useState } from "react";
import api from "../lib/api";

export default function useLogin() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const login = async ({ identifier, password }) => {
    setLoading(true);
    setError("");

    try {
      // 🔎 בדיקה
      const base = api.defaults.baseURL || "";
      console.log("API BASE:", base);

      // ✅ אם אין /api נוסיף אוטומטית
      const url = base.endsWith("/api")
        ? "/auth/login"
        : "/api/auth/login";

      const res = await api.post(url, { identifier, password });
      return res.data;
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || "Login failed");
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return { login, loading, error };
}