import { useState } from "react";
import api from "../lib/api";

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

export default function useSignup() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const signup = async ({ username, fullName, email, password, confirmPassword, gender }) => {
    setLoading(true);
    setError("");

    const clean = {
      username: String(username || "").trim(),
      fullName: String(fullName || "").trim(),
      email: String(email || "").trim(),
      password: String(password || ""),
      confirmPassword: String(confirmPassword || ""),
      gender: gender || "unspecified",
    };

    if (!clean.username || !clean.email || !clean.password) {
      setError("Missing fields");
      setLoading(false);
      return null;
    }
    if (clean.username.length < 3) {
      setError("Username must be at least 3 characters");
      setLoading(false);
      return null;
    }
    if (!isValidEmail(clean.email)) {
      setError("Invalid email");
      setLoading(false);
      return null;
    }
    if (clean.password.length < 6) {
      setError("Password must be at least 6 characters");
      setLoading(false);
      return null;
    }
    if (clean.password !== clean.confirmPassword) {
      setError("Passwords do not match");
      setLoading(false);
      return null;
    }

    try {
      const res = await api.post("/auth/signup", clean);
      return res.data;
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || "Signup failed";
      setError(msg);
      return null;
    } finally {
      setLoading(false);
    }
  };

  return { signup, loading, error };
}