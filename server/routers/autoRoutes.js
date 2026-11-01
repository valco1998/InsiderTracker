import { Router } from "express";
import { autoRun } from "../controllers/auto.controllers.js";
import protectRoute from "../middelware/protectRoute.js";

const router = Router();

/**
 * כל הרצה אוטומטית חייבת משתמש מחובר
 */

router.get("/run", autoRun);
router.post("/run", autoRun);

export default router;
