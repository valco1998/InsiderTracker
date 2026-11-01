import { Router } from "express";
import protectRoute from "../middelware/protectRoute.js";
import {
  getMyDMs,
  openOrCreateDM,
  getDMHistory,
  sendDMMessage,
  markDMRead,
  hideConversation,
  clearConversation,
} from "../controllers/dm.controller.js";

const router = Router();

router.use(protectRoute);

/* List all DM conversations (excludes hidden ones) */
router.get("/", getMyDMs);

/* Open or create a DM (friendship not required, blocks enforced) */
router.post("/:userId", openOrCreateDM);

/* Message history for one conversation */
router.get("/:convId/messages", getDMHistory);

/* Send a message via HTTP (socket is primary; this is the fallback) */
router.post("/:convId/messages", sendDMMessage);

/* Mark conversation as read */
router.post("/:convId/read", markDMRead);

/* Hide / delete conversation for current user only */
router.delete("/:convId", hideConversation);

/* Clear message history for current user only */
router.delete("/:convId/messages", clearConversation);

export default router;
