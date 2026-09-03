import { describe, expect, it } from "vitest";

import { buildCombinedOverviewViewModel } from "@/lib/inventory/dashboard-view-model";
import { loadInventoryDashboardData, loadProductCatalogData, loadProfitabilityData, loadVariantCatalogData } from "@/lib/inventory/data";
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
    expect(dashboard.salesTrend.at(-1)?.month).toBe(`${us.businessPerformance.actualYear}-08`);
    expect(dashboard.salesTrend.at(-1)?.总销量).toBe(us.businessPerformance.summary.latestMonthUnits + ca.businessPerformance.summary.latestMonthUnits);
    expect(dashboard.annualPerformance).toHaveLength(12);
    expect(dashboard.markets).toHaveLength(2);
    expect(dashboard.priorityRows.length).toBeLessThanOrEqual(10);
    expect(dashboard.markets.every((market) => !("rows" in market))).toBe(true);
    expect(JSON.stringify(dashboard).length).toBeLessThan(700_000);
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

  it("builds a complete parent and child SKU operations brief", async () => {
    const [us, ca, profitability, variants] = await Promise.all([
      loadInventoryDashboardData("US"),
      loadInventoryDashboardData("CA"),
      loadProfitabilityData(),
      loadVariantCatalogData(),
    ]);
    const dashboard = buildCombinedOverviewViewModel(us, ca, profitability, variants);

    expect(dashboard.operationsBrief.reportMonth).toBe("2026-08");
    expect(dashboard.operationsBrief.childCount).toBeGreaterThanOrEqual(845);
    expect(dashboard.operationsBrief.parents.length).toBeGreaterThan(3);
    expect(dashboard.operationsBrief.parents.some((parent) => parent.parentSku === "未识别父体")).toBe(true);
    expect(dashboard.operationsBrief.parents.flatMap((parent) => parent.children).some((child) => child.issues.includes("实际利润为负"))).toBe(true);
    expect(dashboard.operationsBrief.growthCandidates.every((candidate) => candidate.trendPercent >= 8 && candidate.actualMargin >= 0.1)).toBe(true);
  });
});
