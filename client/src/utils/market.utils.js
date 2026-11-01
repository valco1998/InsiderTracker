export function effectiveDiscount(it) {
  const d = Number(it?.discountPct);
  return Number.isFinite(d) && d > 0 ? d : 0;
}

export function safeImage(it) {
  return it?.image || "";
}
