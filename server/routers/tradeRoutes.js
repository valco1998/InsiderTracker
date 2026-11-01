import { Router } from "express";
import protectRoute from "../middelware/protectRoute.js";
import {
  createTradePost, listTradePosts, myTradePosts, getTradePost,
  closeTradePost, bumpTradePost, deleteTradePost,
  getNotifications, getUnreadCount, markNotificationRead, markAllRead, deleteNotification,
  getComments, postComment, markCommentsRead,
  createTestNotification, rescanActivePosts, searchMatchingPosts, searchByWant,
} from "../controllers/trade.controller.js";

const router = Router();

/*
 * ROUTE ORDER MATTERS.
 * All static/named routes MUST be registered before the dynamic /:id route.
 * Express matches routes in registration order — /:id would swallow any path
 * that hasn't already been matched by a static route above it.
 */

/* ── Notification routes (all static) ──────────────── */
router.get(   "/notifications",              protectRoute, getNotifications);
router.get(   "/notifications/unread-count", protectRoute, getUnreadCount);
router.patch( "/notifications/:id/read",     protectRoute, markNotificationRead);
router.post(  "/notifications/read-all",     protectRoute, markAllRead);
router.delete("/notifications/:id",          protectRoute, deleteNotification);

/* ── Static trade-post routes ───────────────────────── */
router.get(  "/mine",             protectRoute, myTradePosts);
router.get(  "/search-matches",  protectRoute, searchMatchingPosts);
router.get(  "/search-by-want",  protectRoute, searchByWant);
router.post( "/test-notification", protectRoute, createTestNotification);
router.post( "/rescan-active",     protectRoute, rescanActivePosts);

/* ── Collection routes ──────────────────────────────── */
router.post("/", protectRoute, createTradePost);
router.get( "/", listTradePosts);

/* ── Dynamic /:id routes — must come last ───────────── */
router.get(   "/:id",              getTradePost);
router.patch( "/:id/close",        protectRoute, closeTradePost);
router.patch( "/:id/bump",         protectRoute, bumpTradePost);
router.delete("/:id",              protectRoute, deleteTradePost);

/* ── Comment routes on a specific post ─────────────── */
router.get(  "/:id/comments",      getComments);
router.post( "/:id/comments",      protectRoute, postComment);
router.patch("/:id/comments/read", protectRoute, markCommentsRead);

export default router;
