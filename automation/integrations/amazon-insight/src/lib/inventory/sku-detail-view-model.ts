import type { InventoryDashboardData, ProductCatalogItem, VariantCatalogData } from "@/lib/inventory/contracts";
import { calculateCampaignRows, calculateInventoryRows } from "@/lib/inventory/presentation";
import { extractProductSpecifications } from "@/lib/inventory/product-specification-extractor";

export type SkuDetailViewModel = NonNullable<ReturnType<typeof buildSkuDetailViewModel>>;

export function buildSkuDetailViewModel(
  data: InventoryDashboardData,
  variants: VariantCatalogData | null,
  product: ProductCatalogItem | null,
  sku: string,
) {
  const rows = calculateInventoryRows(data);
  const row = rows.find((item) => item.sku === sku);
  if (!row) return null;
  const variant = variants?.items.find((item) => item.market === data.market && item.sku === sku && item.role === "Child") ?? null;
  const campaigns = calculateCampaignRows(data, rows).filter((campaign) => campaign.sku === sku);

  return {
    market: data.market === "CA" ? "CA" as const : "US" as const,
    currency: data.currency,
    domesticPoolId: data.domesticPool.id,
    targetAcosPercent: data.advertising.parameters.targetAcosPercent,
    row,
    variant,
    engineeringSpecifications: extractProductSpecifications(product, variant),
    campaigns,
  };
}
