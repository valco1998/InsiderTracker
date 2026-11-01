import { fetchMarket, getClient } from "./empire.controllers.js";

export async function marketLive(req, res) {
  try {
    const appId = Number(req.query.appId ?? 730) || 730;

    const perPage = Math.min(
      Math.max(Number(req.query.perPage ?? req.query.per_page ?? 100) || 100, 1),
      2500
    );

    const minDiscountPct =
      req.query.minDiscountPct !== undefined
        ? Number(req.query.minDiscountPct)
        : req.query.min_discount !== undefined
        ? Number(req.query.min_discount)
        : undefined;

    const minPrice =
      req.query.minPrice !== undefined ? Number(req.query.minPrice) : undefined;

    const maxPrice =
      req.query.maxPrice !== undefined ? Number(req.query.maxPrice) : undefined;

    const search = String(req.query.search || "").trim();

    const r = await fetchMarket({
      appId,
      perPage,
      minPrice,
      maxPrice,
      search,
    });

    let items = Array.isArray(r?.items) ? r.items : [];

    if (Number.isFinite(minDiscountPct)) {
      items = items.filter(
        (it) => Number(it?.discountPct ?? it?.discount ?? 0) >= minDiscountPct
      );
    }

    res.json({ ok: true, items });
  } catch (error) {
    console.error("marketLive error:", error.response?.data || error.message);

    res.status(500).json({
      ok: false,
      message: "Failed to load market items",
    });
  }
}

export async function getItemDetails(req, res) {
  try {
    console.log("DETAILS ID:", req.params.id);
    console.log("DETAILS URL:", `/trading/item/${req.params.id}`);

    const { id } = req.params;
    const empireApi = getClient();

    const response = await empireApi.get(`/trading/item/${id}`);

    const payload =
      response?.data?.item ||
      response?.data?.data?.item ||
      response?.data?.data ||
      response?.data;

    console.log("DETAIL ITEM RESPONSE:", payload);

    if (!payload) {
      return res.status(404).json({
        ok: false,
        message: "Item details not found",
      });
    }

    res.json(payload);
  } catch (error) {
    console.error(
      "getItemDetails error:",
      error.response?.status,
      error.response?.data || error.message
    );

    res.status(error.response?.status || 500).json({
      ok: false,
      message: "Failed to load item details",
    });
  }
}