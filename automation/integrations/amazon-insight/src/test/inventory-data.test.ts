import { describe, expect, it } from "vitest";

import { applyPurchaseOrderReviews, loadContentWorkflowData, loadInventoryDashboardData, loadProductCatalogData, loadPurchasePlanData, loadRawInventoryDashboardData, normalizeOperationsMarket } from "@/lib/inventory/data";
import { getDocumentExportMeta } from "@/lib/inventory/document-exports";

describe("multi-market inventory data", () => {
  it("normalizes supported market query values", () => {
    expect(normalizeOperationsMarket("ca")).toBe("CA");
    expect(normalizeOperationsMarket("unknown")).toBe("US");
  });

  it("loads the Canadian dashboard as CAD FBA data", async () => {
    const data = await loadInventoryDashboardData("CA");

    expect(data.market).toBe("CA");
    expect(data.currency).toBe("CAD");
    expect(data.snapshots.awdSourceAvailable).toBe(false);
    expect(data.summary.localInventory).toBeGreaterThan(0);
    expect(data.rows.length).toBeGreaterThan(0);
  });

  it("loads local supply, specifications, and listing details for a SKU", async () => {
    const [data, products] = await Promise.all([
      loadInventoryDashboardData("US"),
      loadProductCatalogData(),
    ]);
    const inventory = data.rows.find((row) => row.sku === "MA007");
    const product = products.items.find((item) => item.sku === "MA007");

    expect(inventory).toBeDefined();
    expect((inventory?.localInventory ?? 0) + (inventory?.pendingOrderQty ?? 0)).toBe(inventory?.domesticSupplyTotal);
    expect(inventory?.domesticSupplyTotal).toBeGreaterThanOrEqual(0);
    expect(inventory?.salesHistoryByMonth).toHaveLength(32);
    expect(inventory?.salesHistoryByMonth[0]).toEqual({ month: "2024-01", units: 1238 });
    expect(inventory?.salesHistoryByMonth.at(-1)).toEqual({ month: "2026-08", units: 1512 });
    expect(data.summary.overduePurchaseOrderCount).toBeGreaterThan(0);
    expect(data.rows.some((row) => row.pendingOrders.some((order) => order.overdue && order.poNumber && order.orderedQuantity > 0))).toBe(true);
    expect(product?.fnsku).toBe("X0027UQ1I7");
    expect(product?.cartonDimensionsCm).toEqual({ length: 38, width: 20.5, height: 20 });
    expect(product?.imageFile).toMatch(/^MA007-[a-f0-9]{16}\.(jpeg|png)$/);
    expect(product?.imageMimeType).toMatch(/^image\//);
    expect(product?.imageSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(product?.listing?.title).toContain("0-100 PSI");
    expect(product?.listing?.bullets).toHaveLength(5);
  });

  it("loads all available Canadian SKU sales months", async () => {
    const data = await loadInventoryDashboardData("CA");
    const inventory = data.rows.find((row) => row.sku === "MA007");

    expect(data.sales.historyMonths).toHaveLength(32);
    expect(inventory?.salesHistoryByMonth).toHaveLength(32);
    expect(inventory?.salesHistoryByMonth[0]).toEqual({ month: "2024-01", units: 58 });
    expect(inventory?.salesHistoryByMonth.at(-1)).toEqual({ month: "2026-08", units: 112 });
  });

  it("loads copy, main-image, and A+ draft tasks from product and creative sources", async () => {
    const data = await loadContentWorkflowData();
    const currentMainBrief = data.tasks.find((task) => task.sku === "MC080");
    const combinedBrief = data.tasks.find((task) => task.sku === "MD140");

    expect(data.summary.taskCount).toBeGreaterThan(800);
    expect(currentMainBrief?.mainImageBrief.source).toBe("creative_archive");
    expect(currentMainBrief?.mainImageBrief.sections.length).toBeGreaterThanOrEqual(5);
    expect(combinedBrief?.mainImageBrief.source).toBe("creative_archive");
    expect(combinedBrief?.aPlusBrief.source).toBe("creative_archive");
    expect(combinedBrief?.copy.title).toBeTruthy();
    expect(combinedBrief?.copy.bullets).toHaveLength(5);
  });

  it("reports per-SKU shipment and declaration export readiness", async () => {
    const meta = await getDocumentExportMeta("US");
    expect(meta.readiness.shipmentSkus).toContain("MA007");
    expect(meta.readiness.declarationSkus.length).toBeGreaterThan(0);
    expect(meta.readiness.shipmentSkus.length).toBeGreaterThan(meta.readiness.declarationSkus.length);
  });

  it("uses one shared domestic inventory pool for the US and Canada", async () => {
    const [us, ca] = await Promise.all([loadInventoryDashboardData("US"), loadInventoryDashboardData("CA")]);

    expect(us.domesticPool).toEqual(ca.domesticPool);
    expect(us.domesticPool).toMatchObject({ id: "CN-SHARED", sharedAcrossMarkets: true, markets: ["US", "CA"] });
    expect(ca.summary.localInventory).toBe(us.summary.localInventory);
    expect(ca.summary.pendingOrderQty).toBe(us.summary.pendingOrderQty);
    expect(ca.rows.find((row) => row.sku === "MA007")?.localInventory).toBe(us.rows.find((row) => row.sku === "MA007")?.localInventory);
  });

  it("loads the combined mid-month and month-end purchase plan", async () => {
    const data = await loadPurchasePlanData();
    const ma007 = data.rows.find((row) => row.sku === "MA007");
    const manualPlanQuantity = data.rows.reduce((sum, row) => sum + row.manualPlannedQty, 0);
    const actualOrderQuantity = data.rows.reduce((sum, row) => sum + row.actualOrderedQty, 0);

    expect(data.cycle.latestOrderDate).toBe("2026-07-20");
    expect(data.cycle.nextStage).toBe("month_end");
    expect(data.summary.actualPurchaseOrderCount).toBeGreaterThanOrEqual(0);
    expect(data.summary.actualOrderQuantity).toBe(actualOrderQuantity);
    expect(data.summary.manualPlanQuantity).toBe(manualPlanQuantity);
    expect(data.summary.varianceQuantity).toBe(actualOrderQuantity - manualPlanQuantity);
    expect(data.summary.manualPlanSkuCount).toBe(data.rows.filter((row) => row.manualPlannedQty > 0).length);
    expect(data.summary.actualOrderSkuCount).toBe(data.rows.filter((row) => row.actualOrderedQty > 0).length);
    expect(data.parameters.demandHorizonDays).toBe(90);
    expect(ma007?.caPlannedQty).toBe(0);
    expect(data.sources.filter((source) => source.kind.endsWith("purchase_allocation"))).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "us_purchase_allocation", available: false }),
      expect.objectContaining({ kind: "ca_purchase_allocation", available: false }),
    ]));
    expect(ma007?.pendingOrderQty).toBeGreaterThanOrEqual(ma007?.actualOrderedQty ?? 0);
    expect(ma007?.unreflectedLatestOrderQty).toBeGreaterThanOrEqual(0);
  });

  it("removes a manually canceled purchase task from pending supply and overdue totals", async () => {
    const data = await loadRawInventoryDashboardData("US");
    const row = data.rows.find((item) => item.pendingOrders.some((order) => order.overdue));
    const order = row?.pendingOrders.find((item) => item.overdue);
    expect(row).toBeDefined();
    expect(order).toBeDefined();
    if (!row || !order) return;

    const adjusted = applyPurchaseOrderReviews(data, [{
      id: 1,
      sku: row.sku,
      poNumber: order.poNumber,
      poDate: order.poDate,
      market: "US",
      factory: order.factory,
      remainingQuantity: order.remainingQuantity,
      action: "cancel",
      reason: "人工确认不再生产",
      reviewer: "测试",
      createdAt: "2026-07-13T00:00:00.000Z",
    }]);
    const adjustedRow = adjusted.rows.find((item) => item.sku === row.sku);

    expect(adjustedRow?.pendingOrders).not.toContainEqual(order);
    expect(adjustedRow?.pendingOrderQty).toBe(row.pendingOrderQty - order.remainingQuantity);
    expect(adjustedRow?.domesticSupplyTotal).toBe(row.domesticSupplyTotal - order.remainingQuantity);
    expect(adjusted.summary.pendingOrderQty).toBe(data.summary.pendingOrderQty - order.remainingQuantity);
    expect(adjusted.summary.overdueOrderCount).toBeLessThan(data.summary.overdueOrderCount);
  });
});
