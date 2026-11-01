import { initializeApp, getApps } from "firebase/app";
import { getMessaging, isSupported } from "firebase/messaging";

// Public Firebase client config — these are NOT secrets.
// Set VITE_FIREBASE_* in Vercel dashboard → Project → Settings → Env Vars.
export const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

if (import.meta.env.DEV) {
  console.log("[Firebase] isFirebaseConfigured:", Boolean(import.meta.env.VITE_FIREBASE_API_KEY && import.meta.env.VITE_FIREBASE_API_KEY !== "undefined"));
}

export const isFirebaseConfigured = () =>
  Boolean(firebaseConfig.apiKey && firebaseConfig.apiKey !== "undefined");

let _app       = null;
let _messaging = null;

export async function getFirebaseMessaging() {
  if (!isFirebaseConfigured()) {
    console.warn("[Firebase] getFirebaseMessaging() — not configured, skipping");
    return null;
  }

  try {
    console.log("[Firebase] calling isSupported()…");
    const supported = await isSupported();
    console.log("[Firebase] isSupported() →", supported);
    if (!supported) {
      console.warn("[Firebase] isSupported() returned false — FCM not available in this browser/context");
      return null;
    }

    if (!_app) {
      _app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
      console.log("[Firebase] app initialized ✓");
    }
    if (!_messaging) {
      _messaging = getMessaging(_app);
      console.log("[Firebase] getMessaging() ✓");
    }
    return _messaging;
  } catch (err) {
    console.error("[Firebase] getFirebaseMessaging() threw:", err?.message ?? err);
    return null;
  }
}
