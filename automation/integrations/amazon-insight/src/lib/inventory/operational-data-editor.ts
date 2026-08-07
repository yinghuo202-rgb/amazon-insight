import type { InventoryDashboardData, ProductCatalogData, VariantCatalogData } from "@/lib/inventory/contracts";
import type { InventoryValues, OperationalDataOverrides, ProductMasterValues } from "@/lib/inventory/operational-data-store";
import type { ProductCostSeries } from "@/lib/inventory/product-costs";

export type EditableProductRow = ProductMasterValues & {
  sku: string;
  seriesId: string;
  seriesName: string;
  source: ProductMasterValues;
  updatedAt: string | null;
};

export type EditableInventoryRow = InventoryValues & {
  market: "US" | "CA";
  sku: string;
  productName: string;
  seriesId: string;
  seriesName: string;
  source: InventoryValues;
  updatedAt: string | null;
};

export function buildOperationalDataEditorView(
  products: ProductCatalogData,
  variants: VariantCatalogData,
  us: InventoryDashboardData,
  ca: InventoryDashboardData,
  overrides: OperationalDataOverrides,
) {
  const variantBySku = new Map<string, VariantCatalogData["items"][number]>();
  for (const item of variants.items) if (!variantBySku.has(item.sku) || item.market === "US") variantBySku.set(item.sku, item);
  const productOverrideBySku = new Map(overrides.products.map((item) => [item.sku, item] as const));
  const inventoryOverrideByKey = new Map(overrides.inventories.map((item) => [`${item.market}:${item.sku}`, item] as const));
  const domesticBySku = new Map(overrides.domesticInventories.map((item) => [item.sku, item] as const));
  const productBySku = new Map(products.items.map((item) => [item.sku, item] as const));

  const productRows = products.items.map((product): EditableProductRow => {
    const variant = variantBySku.get(product.sku);
    const seriesId = variant?.familyId || `CATEGORY:${product.category || "未分类"}`;
    const seriesName = variant?.familyName || `${product.category || "未分类"}（待归父子系列）`;
    const source = productValues(product);
    const override = productOverrideBySku.get(product.sku);
    return { sku: product.sku, seriesId, seriesName, source, ...(override ? productValues(override) : source), updatedAt: override?.updatedAt ?? null };
  }).sort((left, right) => left.seriesName.localeCompare(right.seriesName, "zh-CN") || left.sku.localeCompare(right.sku));

  const productNameBySku = new Map(productRows.map((item) => [item.sku, item.chineseName] as const));
  const inventoryRows = ([
    ["US", us],
    ["CA", ca],
  ] as const).flatMap(([market, data]) => data.rows.map((row): EditableInventoryRow => {
    const variant = variantBySku.get(row.sku);
    const product = productBySku.get(row.sku);
    const category = product?.category || "未分类";
    const seriesId = variant?.familyId || `CATEGORY:${category}`;
    const seriesName = variant?.familyName || `${category}（待归父子系列）`;
    const source = inventoryValues(row);
    const override = inventoryOverrideByKey.get(`${market}:${row.sku}`);
    const domestic = domesticBySku.get(row.sku);
    return {
      market,
      sku: row.sku,
      productName: productNameBySku.get(row.sku) || row.productName,
      seriesId,
      seriesName,
      source,
      fbaSellable: override?.fbaSellable ?? source.fbaSellable,
      awdAvailable: override?.awdAvailable ?? source.awdAvailable,
      awdOutboundToFba: override?.awdOutboundToFba ?? source.awdOutboundToFba,
      awdInbound: override?.awdInbound ?? source.awdInbound,
      localInventory: domestic?.localInventory ?? source.localInventory,
      updatedAt: latest(override?.updatedAt, domestic?.updatedAt),
    };
  })).sort((left, right) => left.market.localeCompare(right.market) || left.seriesName.localeCompare(right.seriesName, "zh-CN") || left.sku.localeCompare(right.sku));

  return {
    products: productRows,
    inventories: inventoryRows,
    series: buildSeries(productRows),
    summary: {
      productOverrideCount: overrides.products.length,
      inventoryOverrideCount: overrides.inventories.length,
      domesticOverrideCount: overrides.domesticInventories.length,
    },
  };
}

function productValues(product: {
  chineseName: string; englishName: string; category: string; packaging: string; cartonQty: number | null;
  productWeightG: number | null; shippingSizeCm: string; cartonGrossWeightKg: number | null;
  cartonDimensionsCm?: { length: number | null; width: number | null; height: number | null };
  cartonLengthCm?: number | null; cartonWidthCm?: number | null; cartonHeightCm?: number | null;
}): ProductMasterValues {
  return {
    chineseName: product.chineseName,
    englishName: product.englishName,
    category: product.category,
    packaging: product.packaging,
    cartonQty: product.cartonQty,
    productWeightG: product.productWeightG,
    shippingSizeCm: product.shippingSizeCm,
    cartonGrossWeightKg: product.cartonGrossWeightKg,
    cartonLengthCm: product.cartonDimensionsCm?.length ?? product.cartonLengthCm ?? null,
    cartonWidthCm: product.cartonDimensionsCm?.width ?? product.cartonWidthCm ?? null,
    cartonHeightCm: product.cartonDimensionsCm?.height ?? product.cartonHeightCm ?? null,
  };
}

function inventoryValues(row: InventoryDashboardData["rows"][number]): InventoryValues {
  return {
    fbaSellable: row.fbaSellable,
    awdAvailable: row.awdAvailable,
    awdOutboundToFba: row.awdOutboundToFba,
    awdInbound: row.awdInbound,
    localInventory: row.localInventory,
  };
}

function buildSeries(rows: EditableProductRow[]): ProductCostSeries[] {
  const map = new Map<string, ProductCostSeries>();
  for (const row of rows) {
    const current = map.get(row.seriesId);
    if (current) current.skuCount += 1;
    else map.set(row.seriesId, { id: row.seriesId, name: row.seriesName, category: row.category, kind: row.seriesId.startsWith("CATEGORY:") ? "category" : "variant", skuCount: 1 });
  }
  return [...map.values()].sort((left, right) => Number(right.kind === "variant") - Number(left.kind === "variant") || left.name.localeCompare(right.name, "zh-CN"));
}

function latest(...values: Array<string | undefined>) {
  return values.filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
}
