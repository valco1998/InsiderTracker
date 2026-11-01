import { Router } from "express";
import { signup, login, me, logout, updateSettings } from "../controllers/auth.controllers.js";
import protectRoute from "../middelware/protectRoute.js";

const router = Router();

router.post("/signup", signup);
router.post("/login", login);

// ✅ חובה בשביל avatar/user בפרונט
router.get("/me", protectRoute, me);

router.patch("/settings", protectRoute, updateSettings);
router.post("/logout", logout);

export default router;