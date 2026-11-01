export function fmtCoins(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "-";
  return x.toFixed(x >= 10 ? 1 : 2);
}

export function fmtPct(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "-";
  return `${Math.round(x)}%`;
}
