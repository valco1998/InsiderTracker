// server/services/firebaseAuth.js
//
// Verifies Firebase Authentication ID tokens (Google sign-in only).
// • Uses the existing firebase-admin package on a NAMED app ("insider-auth") so it never
//   collides with the FCM default app in services/fcm.js.
// • ID-token verification needs only the Firebase project ID (Google's public signing keys
//   are fetched by firebase-admin); no service-account secret is required for this.
//   Config: FIREBASE_AUTH_PROJECT_ID, else FIREBASE_PROJECT_ID (server/.env).
// • Only tokens whose sign-in provider is google.com are accepted.
// Tokens are never logged.
import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const APP_NAME = "insider-auth";
let testVerifier = null;

export function firebaseAuthProjectId(env = process.env) {
  return String(env.FIREBASE_AUTH_PROJECT_ID || env.FIREBASE_PROJECT_ID || "").trim() || null;
}

export function isFirebaseAuthConfigured(env = process.env) {
  return !!testVerifier || !!firebaseAuthProjectId(env);
}

// Tests only: replace the verifier (token → decoded claims).
export function setFirebaseVerifierForTests(fn) { testVerifier = fn; }

function verifier() {
  if (testVerifier) return testVerifier;
  const projectId = firebaseAuthProjectId();
  if (!projectId) return null;
  const app = getApps().find((a) => a.name === APP_NAME) || initializeApp({ projectId }, APP_NAME);
  const auth = getAuth(app);
  return (token) => auth.verifyIdToken(token);
}

const authError = (code, message) => Object.assign(new Error(message), { code });

// → decoded claims { uid, email, email_verified, name, picture, firebase: { sign_in_provider } }
export async function verifyGoogleIdToken(token) {
  const v = verifier();
  if (!v) throw authError("auth/not-configured", "Firebase Authentication is not configured on the server");
  const decoded = await v(token);
  if (decoded?.firebase?.sign_in_provider !== "google.com") throw authError("auth/provider-not-allowed", "Only Google sign-in is accepted");
  if (!decoded.uid) throw authError("auth/invalid-token", "Token has no user id");
  return decoded;
}

// Firebase ID tokens are JWTs issued by https://securetoken.google.com/<project>.
export function looksLikeFirebaseIdToken(token) {
  try {
    const part = String(token || "").split(".")[1];
    if (!part) return false;
    const p = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return typeof p.iss === "string" && p.iss.startsWith("https://securetoken.google.com/");
  } catch {
    return false;
  }
}
