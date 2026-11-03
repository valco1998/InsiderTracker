import axios from "axios";
import { getAuthToken, hasTokenProvider } from "./storage";
import { API_BASE } from "./config";

const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
});

// Every request carries the current Google (Firebase) ID token when signed in.
api.interceptors.request.use(async (config) => {
  const t = await getAuthToken();
  if (t) config.headers.Authorization = `Bearer ${t}`;
  return config;
});

// 401: refresh the ID token once and retry (an hour-old token simply expired). If it still
// fails, announce it so AuthContext can end the session cleanly.
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const cfg = error.config;
    if (error.response?.status === 401 && cfg && !cfg.__authRetried && hasTokenProvider()) {
      cfg.__authRetried = true;
      const t = await getAuthToken({ forceRefresh: true });
      if (t) {
        cfg.headers = { ...(cfg.headers || {}), Authorization: `Bearer ${t}` };
        return api(cfg);
      }
    }
    if (error.response?.status === 401 && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("auth:unauthorized", { detail: { code: error.response.data?.code || null } }));
    }
    return Promise.reject(error);
  },
);

export default api;
