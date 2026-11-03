// Google sign-in (Firebase Authentication) — the only sign-in method.
// Reuses the default Firebase app (same config as FCM in lib/firebase.js, which is untouched).
// Session persistence: browserLocalPersistence — the user stays signed in across page
// refreshes and browser restarts until they sign out (Firebase refreshes ID tokens itself).
import { initializeApp, getApps } from "firebase/app";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  onAuthStateChanged, signOut, setPersistence, browserLocalPersistence,
} from "firebase/auth";
import { firebaseConfig, isFirebaseConfigured } from "./firebase";

let _auth = null;

export function getFirebaseAuth() {
  if (!isFirebaseConfigured()) return null;
  if (!_auth) {
    const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
    _auth = getAuth(app);
    setPersistence(_auth, browserLocalPersistence).catch(() => { /* default persistence is already local */ });
  }
  return _auth;
}

// Popup first (desktop and most mobile browsers); redirect when popups are blocked or
// unsupported (some in-app / mobile browsers). Returns the user, or null when redirecting.
export async function signInWithGoogle() {
  const auth = getFirebaseAuth();
  if (!auth) throw Object.assign(new Error("not configured"), { code: "auth/not-configured" });
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    const r = await signInWithPopup(auth, provider);
    return r.user;
  } catch (e) {
    if (e?.code === "auth/popup-blocked" || e?.code === "auth/operation-not-supported-in-this-environment") {
      await signInWithRedirect(auth, provider);
      return null;
    }
    throw e;
  }
}

// Completes a redirect sign-in after the page reloads (no-op otherwise).
export async function completeGoogleRedirect() {
  const auth = getFirebaseAuth();
  if (!auth) return null;
  const r = await getRedirectResult(auth);
  return r?.user || null;
}

export function onGoogleAuthChange(cb) {
  const auth = getFirebaseAuth();
  if (!auth) { cb(null); return () => {}; }
  return onAuthStateChanged(auth, cb);
}

export function signOutGoogle() {
  const auth = getFirebaseAuth();
  return auth ? signOut(auth) : Promise.resolve();
}

// Friendly messages for the sign-in screen (never raw SDK text).
const MESSAGES = {
  "auth/not-configured": "Google sign-in is not configured for this site yet.",
  "auth/popup-closed-by-user": "The Google window was closed before signing in.",
  "auth/cancelled-popup-request": "Sign-in was cancelled.",
  "auth/network-request-failed": "Network error — check your connection and try again.",
  "auth/unauthorized-domain": "This website's domain is not authorised for Google sign-in.",
  "auth/operation-not-allowed": "Google sign-in is not enabled for this project.",
  "auth/user-disabled": "This account has been disabled.",
  "auth/too-many-requests": "Too many attempts — please wait a moment and try again.",
  "auth/account-conflict": "This email is already linked to a different Google account.",
  "auth/provider-not-allowed": "Only Google sign-in is supported.",
  "auth/session-failed": "Signed in with Google, but the server could not start your session. Please try again.",
};
export function authErrorMessage(e) {
  return MESSAGES[e?.code] || "Sign-in failed. Please try again.";
}
export const isQuietAuthError = (e) => e?.code === "auth/popup-closed-by-user" || e?.code === "auth/cancelled-popup-request";
