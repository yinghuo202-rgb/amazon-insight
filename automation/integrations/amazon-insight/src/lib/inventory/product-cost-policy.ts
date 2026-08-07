export const PRODUCT_COST_VAT_RATE = 13;

export function taxExcludedFromIncluded(cost: number | null, fallback: number | null = null) {
  if (cost === null) return fallback;
  return round(cost / (1 + PRODUCT_COST_VAT_RATE / 100), 4);
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
