import { describe, expect, it } from "vitest";

import { buildCombinedOverviewViewModel } from "@/lib/inventory/dashboard-view-model";
import { loadInventoryDashboardData, loadProductCatalogData, loadVariantCatalogData } from "@/lib/inventory/data";
import { buildSkuDetailViewModel } from "@/lib/inventory/sku-detail-view-model";
import { marketHref } from "@/lib/inventory/presentation";

describe("inventory client view models", () => {
  it("places the market query before URL fragments", () => {
    expect(marketHref("/inventory/sku/MA007#pending-orders", "CA")).toBe("/inventory/sku/MA007?market=CA#pending-orders");
    expect(marketHref("/inventory/categories?parent=MA007", "CA")).toBe("/inventory/categories?parent=MA007&market=CA");
  });

  it("keeps the combined dashboard compact while retaining chart and execution data", async () => {
    const [us, ca] = await Promise.all([loadInventoryDashboardData("US"), loadInventoryDashboardData("CA")]);
    const dashboard = buildCombinedOverviewViewModel(us, ca);

    expect(dashboard.salesTrend.length).toBeGreaterThan(12);
    expect(dashboard.salesTrend.at(-1)?.month).toBe("2026-07");
    expect(dashboard.salesTrend.at(-1)?.总销量).toBe(30_497);
    expect(dashboard.annualPerformance).toHaveLength(12);
    expect(dashboard.markets).toHaveLength(2);
    expect(dashboard.priorityRows.length).toBeLessThanOrEqual(10);
    expect(dashboard.markets.every((market) => !("rows" in market))).toBe(true);
    expect(JSON.stringify(dashboard).length).toBeLessThan(100_000);
  });

  it("serializes only the selected SKU instead of the full market report", async () => {
    const [data, variants, products] = await Promise.all([
      loadInventoryDashboardData("US"),
      loadVariantCatalogData(),
      loadProductCatalogData(),
    ]);
    const sku = data.rows.find((row) => products.items.some((product) => product.sku === row.sku))?.sku ?? data.rows[0].sku;
    const product = products.items.find((item) => item.sku === sku) ?? null;
    const dashboard = buildSkuDetailViewModel(data, variants, product, sku);

    expect(dashboard?.row.sku).toBe(sku);
    expect(dashboard?.campaigns.every((campaign) => campaign.sku === sku)).toBe(true);
    expect(JSON.stringify(dashboard).length).toBeLessThan(JSON.stringify(data).length / 4);
  });
});
