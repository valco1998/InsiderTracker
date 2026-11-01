export function getWearFromFloat(float) {
  const f = Number(float);
  if (isNaN(f)) return "Unknown";

  if (f <= 0.07) return "Factory New";
  if (f <= 0.15) return "Minimal Wear";
  if (f <= 0.38) return "Field-Tested";
  if (f <= 0.45) return "Well-Worn";
  return "Battle-Scarred";
}