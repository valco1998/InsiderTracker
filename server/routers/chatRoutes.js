import { Router } from "express";
import protectRoute from "../middelware/protectRoute.js";
import {
  getHistory,
  createGroup,
  getMyGroups,
  addMember,
  removeMember,
  deleteGroup,
  shareAuction,
} from "../controllers/chat.controller.js";

const router = Router();

// Messages
router.get("/messages",       protectRoute, getHistory);
router.post("/share-auction", protectRoute, shareAuction);

// Groups
router.get("/groups",                         protectRoute, getMyGroups);
router.post("/groups",                        protectRoute, createGroup);
router.post("/groups/:id/members",            protectRoute, addMember);
router.delete("/groups/:id/members/:userId",  protectRoute, removeMember);
router.delete("/groups/:id",                  protectRoute, deleteGroup);

export default router;
