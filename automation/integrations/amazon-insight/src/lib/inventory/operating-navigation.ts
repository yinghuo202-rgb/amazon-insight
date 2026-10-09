export function skuOperatingHref(sku: string, market: string, period: string, context: { filter?: string; query?: string; sort?: string; origin?: string; returnFilter?: string } = {}) {
  const params = new URLSearchParams({ market, period, filter: context.filter || "focus", query: context.query || "", sort: context.sort || "impact", origin: context.origin === "overview" ? "overview" : "brief" });
  if (context.returnFilter) params.set("returnFilter", context.returnFilter);
  return `/inventory/sku/${encodeURIComponent(sku)}?` + params;
}

export function safeSkuReturnHref(value: string | undefined) {
  if (!value || value.length > 2000 || !value.startsWith("/inventory/sku/")) return null;
  try { const url = new URL(value, "https://measureman.invalid"); return url.origin === "https://measureman.invalid" && url.pathname.startsWith("/inventory/sku/") ? url.pathname + url.search : null; } catch { return null; }
}

export function skuBackendContext(input: Record<string, unknown>) {
  const market = typeof input.market === "string" ? input.market.toUpperCase() : undefined;
  return { market, query: typeof input.query === "string" ? input.query.slice(0, 100) : undefined,
    returnTo: typeof input.returnTo === "string" ? input.returnTo : undefined,
    invalidMarket: input.market !== undefined && (!market || !["US", "CA", "MX"].includes(market)) };
}
