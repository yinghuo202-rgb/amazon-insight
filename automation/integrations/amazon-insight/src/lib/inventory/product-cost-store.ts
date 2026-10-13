import type { ProductCatalogData } from "@/lib/inventory/contracts";
import { taxExcludedFromIncluded } from "@/lib/inventory/product-cost-policy";

export type ProductCostValues = {
  purchaseCostRmbTaxIncluded: number | null;
  purchaseCostRmbTaxExcluded: number | null;
  purchaseCostUsd: number | null;
};
export type ProductCostOverride = ProductCostValues & { sku: string; updatedAt: string };
export { listProductCostOverrides, saveProductCostOverrides, deleteProductCostOverrides, listProductCostEditStates, listProductCostHistory, readProductCostSnapshot, validateProductCostDate, ProductCostError } from "@/lib/inventory/product-cost-history";
export type { ProductCostWriteMetadata, ProductCostVersion, ProductCostEditState } from "@/lib/inventory/product-cost-history";

export function applyProductCostOverrides(data: ProductCatalogData, overrides: ProductCostOverride[]): ProductCatalogData {
  if (!overrides.length) return data;
  const bySku = new Map(overrides.map((item) => [item.sku, item] as const));
  return {
    ...data,
    items: data.items.map((item) => {
      const override = bySku.get(item.sku);
      if (!override) return item;
      return {
        ...item,
        purchaseCostRmbTaxIncluded: override.purchaseCostRmbTaxIncluded,
        purchaseCostRmbTaxExcluded: taxExcludedFromIncluded(override.purchaseCostRmbTaxIncluded, override.purchaseCostRmbTaxExcluded),
        purchaseCostUsd: override.purchaseCostUsd,
      };
    }),
  };
}
