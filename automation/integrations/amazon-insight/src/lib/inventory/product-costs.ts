import type { ProductCatalogData, VariantCatalogData } from "@/lib/inventory/contracts";
import { PRODUCT_COST_VAT_RATE, taxExcludedFromIncluded } from "@/lib/inventory/product-cost-policy";
import type { ProductCostOverride, ProductCostValues } from "@/lib/inventory/product-cost-store";

export type ProductCostSeries = {
  id: string;
  name: string;
  category: string;
  kind: "variant" | "category";
  skuCount: number;
};

export type ProductCostRow = ProductCostValues & {
  sku: string;
  productName: string;
  category: string;
  seriesId: string;
  seriesName: string;
  seriesKind: ProductCostSeries["kind"];
  parentSku: string;
  variantValue: string;
  source: ProductCostValues;
  updatedAt: string | null;
};

export function buildProductCostView(
  products: ProductCatalogData,
  variants: VariantCatalogData,
  overrides: ProductCostOverride[],
) {
  const variantBySku = new Map<string, VariantCatalogData["items"][number]>();
  for (const item of variants.items) {
    if (!variantBySku.has(item.sku) || item.market === "US") variantBySku.set(item.sku, item);
  }
  const overrideBySku = new Map(overrides.map((item) => [item.sku, item] as const));
  const rows = products.items.map((product): ProductCostRow => {
    const variant = variantBySku.get(product.sku);
    const category = product.category || variant?.categoryL2 || "未分类";
    const seriesId = variant?.familyId || `CATEGORY:${category}`;
    const seriesName = variant?.familyName || `${category}（待归父子系列）`;
    const override = overrideBySku.get(product.sku);
    const sourceIncluded = product.purchaseCostRmbTaxIncluded;
    const source = {
      purchaseCostRmbTaxIncluded: product.purchaseCostRmbTaxIncluded,
      purchaseCostRmbTaxExcluded: taxExcludedFromIncluded(sourceIncluded, product.purchaseCostRmbTaxExcluded),
      purchaseCostUsd: product.purchaseCostUsd,
    };
    const purchaseCostRmbTaxIncluded = override ? override.purchaseCostRmbTaxIncluded : source.purchaseCostRmbTaxIncluded;
    return {
      sku: product.sku,
      productName: product.chineseName || product.productDescription || product.englishName || product.sku,
      category,
      seriesId,
      seriesName,
      seriesKind: variant ? "variant" : "category",
      parentSku: variant?.parentSku ?? "",
      variantValue: variant?.variantValue ?? "",
      source,
      purchaseCostRmbTaxIncluded,
      purchaseCostRmbTaxExcluded: taxExcludedFromIncluded(
        purchaseCostRmbTaxIncluded,
        override ? override.purchaseCostRmbTaxExcluded : source.purchaseCostRmbTaxExcluded,
      ),
      purchaseCostUsd: override ? override.purchaseCostUsd : source.purchaseCostUsd,
      updatedAt: override?.updatedAt ?? null,
    };
  }).sort((left, right) => left.seriesName.localeCompare(right.seriesName, "zh-CN") || left.sku.localeCompare(right.sku));

  const seriesMap = new Map<string, ProductCostSeries>();
  for (const row of rows) {
    const current = seriesMap.get(row.seriesId);
    if (current) current.skuCount += 1;
    else seriesMap.set(row.seriesId, {
      id: row.seriesId,
      name: row.seriesName,
      category: row.category,
      kind: row.seriesKind,
      skuCount: 1,
    });
  }
  const series = [...seriesMap.values()].sort((left, right) =>
    Number(right.kind === "variant") - Number(left.kind === "variant")
    || left.name.localeCompare(right.name, "zh-CN"),
  );
  return { rows, series, parameters: inferCostParameters(rows) };
}

export function inferCostParameters(rows: ProductCostRow[]) {
  const exchangeRates = rows.flatMap((row) => {
    const rmb = taxExcludedFromIncluded(row.purchaseCostRmbTaxIncluded);
    const usd = row.purchaseCostUsd;
    return rmb && usd ? [rmb / usd] : [];
  }).filter((value) => Number.isFinite(value) && value > 1 && value < 20).sort((left, right) => left - right);
  const middle = Math.floor(exchangeRates.length / 2);
  const exchangeRate = exchangeRates.length
    ? exchangeRates.length % 2 ? exchangeRates[middle] : (exchangeRates[middle - 1] + exchangeRates[middle]) / 2
    : 7.2;
  return { vatRate: PRODUCT_COST_VAT_RATE, exchangeRate: round(exchangeRate, 4) };
}

export function calculateCostsFromTaxIncluded(cost: number | null, exchangeRate: number): ProductCostValues {
  if (cost === null) return {
    purchaseCostRmbTaxIncluded: null,
    purchaseCostRmbTaxExcluded: null,
    purchaseCostUsd: null,
  };
  const purchaseCostRmbTaxExcluded = taxExcludedFromIncluded(cost);
  return {
    purchaseCostRmbTaxIncluded: round(cost, 4),
    purchaseCostRmbTaxExcluded,
    purchaseCostUsd: exchangeRate > 0 && purchaseCostRmbTaxExcluded !== null ? round(purchaseCostRmbTaxExcluded / exchangeRate, 4) : null,
  };
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
