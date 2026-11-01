import { Router } from "express";
import protectRoute from "../middelware/protectRoute.js";
import {
  steamLogin,
  steamCallback,
  steamMe,
  resolveVanityUrl,
  steamInventory,
  refreshInventory,
  importInventory,
  getTradeUrl,
  saveTradeUrl,
  getManualItems,
  addManualItem,
  deleteManualItem,
  clearManualItems,
  saveImportedInventory,
  getImportedInventory,
  clearImportedInventory,
  extensionImport,
  getUserImportedInventory,
  steamDebug,
} from "../controllers/steam.controller.js";

const router = Router();

/* ── Auth ── */
router.get("/login",    steamLogin);
router.get("/callback", steamCallback);
router.get("/me",       protectRoute, steamMe);

/* Resolve a vanity profile URL (/id/{vanityName}) to a numeric SteamID64.
 * Used by the extension when the user's Steam profile uses a custom URL. */
router.get("/resolve-vanity/:vanity", protectRoute, resolveVanityUrl);

/* ── Extension import (primary endpoints used by extension + inventory page)
 *
 *  POST /api/steam/import
 *    Called by the Chrome extension after it reads inventory from Steam.
 *    Accepts sanitised items + steamId.  JWT required.
 *
 *  GET  /api/steam/inventory
 *    Returns the logged-in user's persisted (extension-imported) inventory.
 *    MUST be declared before GET /inventory/:steamId to avoid route conflict.
 */
router.post("/import",    protectRoute, extensionImport);
router.get( "/inventory", protectRoute, getUserImportedInventory);

/* ── Live Steam public API (retry + cache) ── */
router.get( "/inventory/:steamId",         protectRoute, steamInventory);
router.post("/inventory/:steamId/refresh", protectRoute, refreshInventory);
router.post("/inventory/import",           protectRoute, importInventory);   // paste-JSON import

/* ── Extension-imported inventory (legacy names kept for compatibility) ── */
router.post(  "/imported-inventory", protectRoute, saveImportedInventory);
router.get(   "/imported-inventory", protectRoute, getImportedInventory);
router.delete("/imported-inventory", protectRoute, clearImportedInventory);

/* ── Trade URL ── */
router.get( "/trade-url", protectRoute, getTradeUrl);
router.post("/trade-url", protectRoute, saveTradeUrl);

/* ── Manual inventory ── */
router.get(   "/manual",         protectRoute, getManualItems);
router.post(  "/manual",         protectRoute, addManualItem);
router.delete("/manual/:itemId", protectRoute, deleteManualItem);
router.delete("/manual",         protectRoute, clearManualItems);

/* ── Diagnostic ── */
router.get("/debug/:steamId", protectRoute, steamDebug);

export default router;
