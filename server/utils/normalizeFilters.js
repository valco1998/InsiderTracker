// utils/normalizeFilters.js
function toNumberOrUndef(v) {
  if (v === null || typeof v === "undefined" || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function toBoolOrUndef(v) {
  if (v === null || typeof v === "undefined" || v === "") return undefined;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  if (s === "1" || s === "true" || s === "yes" || s === "on") return true;
  if (s === "0" || s === "false" || s === "no" || s === "off") return false;
  return undefined;
}

function normalizeNameIncludes(v) {
  if (v === null || typeof v === "undefined" || v === "") return undefined;

  if (Array.isArray(v)) {
    const arr = v.map((x) => String(x).trim()).filter(Boolean);
    return arr.length ? arr : undefined;
  }

  const s = String(v).trim();
  if (!s) return undefined;

  const arr = s.split(",").map((x) => x.trim()).filter(Boolean);
  return arr.length ? arr : undefined;
}

export function normalizeFiltersInput(filters = {}) {
  const out = { ...(filters || {}) };

  if (typeof out.min_price !== "undefined" && typeof out.minPrice === "undefined") out.minPrice = out.min_price;
  if (typeof out.max_price !== "undefined" && typeof out.maxPrice === "undefined") out.maxPrice = out.max_price;

  if (typeof out.priceMin !== "undefined" && typeof out.minPrice === "undefined") out.minPrice = out.priceMin;
  if (typeof out.priceMax !== "undefined" && typeof out.maxPrice === "undefined") out.maxPrice = out.priceMax;

  out.minPrice = toNumberOrUndef(out.minPrice);
  out.maxPrice = toNumberOrUndef(out.maxPrice);
  out.minDiscountPct = toNumberOrUndef(out.minDiscountPct);
  out.perPage = toNumberOrUndef(out.perPage);
  out.throttle = toNumberOrUndef(out.throttle);

  out.onlyKnives = toBoolOrUndef(out.onlyKnives);
  out.nameIncludes = normalizeNameIncludes(out.nameIncludes);

  if (typeof out.channels !== "undefined") {
    const isObj = out.channels && typeof out.channels === "object" && !Array.isArray(out.channels);
    if (!isObj) delete out.channels;
  }

  for (const k of Object.keys(out)) {
    if (typeof out[k] === "undefined") delete out[k];
  }

  const allowed = ["minPrice","maxPrice","minDiscountPct","perPage","throttle","onlyKnives","nameIncludes","channels"];
  return Object.fromEntries(Object.entries(out).filter(([k]) => allowed.includes(k)));
}