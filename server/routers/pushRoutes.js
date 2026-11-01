import { Router } from "express";
import protectRoute from "../middelware/protectRoute.js";
import {
  registerToken,
  unregisterTokens,
  testPush,
  listTokens,
  debugPush,
  tokenHealth,
  deviceReceived,
} from "../controllers/push.controller.js";

const router = Router();

// Public health check — confirms this router is mounted and reachable.
// No auth required. Use GET /api/push/ping to verify deployment.
router.get("/ping", (_req, res) => {
  res.json({ ok: true, route: "push", time: new Date().toISOString() });
});

router.post("/register",   protectRoute, registerToken);
router.delete("/register", protectRoute, unregisterTokens);
router.post("/test",       protectRoute, testPush);
router.get("/tokens",      protectRoute, listTokens);

// Debug endpoint — shows token metadata, last push timestamps, server stats.
// Safe to leave enabled in production; returns no secrets, only token tails.
router.get("/debug",       protectRoute, debugPush);

// Lightweight health check — returns whether this user has ≥1 active token.
// Used by useFcmKeepAlive to detect silent token invalidation.
router.get("/health",      protectRoute, tokenHealth);

// Delivery-receipt diagnostics from firebase-messaging-sw.js. Intentionally
// unauthenticated (a service worker cannot read the JWT from localStorage) —
// see deviceReceived() for the validation / rate-limit / write-scope model.
router.post("/device-received", deviceReceived);

export default router;
