import { Router } from "express";
import protectRoute from "../middelware/protectRoute.js";
import {
  getFriends,
  getRequests,
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  cancelFriendRequest,
  removeFriend,
  searchUsers,
  getBlocked,
  blockUser,
  unblockUser,
} from "../controllers/social.controller.js";

const router = Router();

router.use(protectRoute);

/* Friends */
router.get("/friends",                    getFriends);
router.get("/friends/requests",           getRequests);
router.post("/friends/request/:userId",   sendFriendRequest);
router.post("/friends/accept/:userId",    acceptFriendRequest);
router.delete("/friends/decline/:userId", declineFriendRequest); // must come before /:userId
router.delete("/friends/cancel/:userId",  cancelFriendRequest);  // must come before /:userId
router.delete("/friends/:userId",         removeFriend);

/* Search */
router.get("/search", searchUsers);

/* Block */
router.get("/blocked",            getBlocked);
router.post("/block/:userId",     blockUser);
router.delete("/block/:userId",   unblockUser);

export default router;
