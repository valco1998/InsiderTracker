import { Router } from "express";
import { passwordAuthRetired, session, me, logout, updateSettings } from "../controllers/auth.controllers.js";
import protectRoute from "../middelware/protectRoute.js";

// Authentication — Google sign-in only (Firebase Authentication).
const router = Router();

// Email/password registration and login are retired.
router.post("/signup", passwordAuthRetired);
router.post("/login", passwordAuthRetired);

// Google sign-in: the Firebase ID token is verified, the profile created or linked.
router.post("/session", protectRoute, session);

router.get("/me", protectRoute, me);
router.patch("/settings", protectRoute, updateSettings);
router.post("/logout", logout);

export default router;
