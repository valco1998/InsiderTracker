const KEY = "token";

export function getToken() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setToken(t) {
  try {
    localStorage.setItem(KEY, t);
  } catch {}
}

export function clearToken() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}