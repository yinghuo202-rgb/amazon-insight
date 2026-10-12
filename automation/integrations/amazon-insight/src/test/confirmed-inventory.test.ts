import { expect, it } from "vitest";
import { inventoryRowSchema, type InventoryDashboardData } from "@/lib/inventory/contracts";
import { buildOperatingModel } from "@/lib/inventory/dashboard-view-model";
import { calculateInventoryRows } from "@/lib/inventory/presentation";
import { buildInventoryPlanningViewModel, calculatePlanningRows } from "@/lib/inventory/client-view-models";
import { StockBrowser } from "@/components/inventory/stock-browser";
import { SkuDetailDashboard } from "@/components/inventory/sku-detail-dashboard";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { applyPurchaseOrderReviews } from "@/lib/inventory/data";
import type { PurchaseOrderReview } from "@/lib/inventory/purchase-order-reviews";

it("retains each SKU's own confirmed inventory date and unverified domestic breakdown", () => {
  const stock = inventoryRowSchema.parse({
    sku: "MA001", productName: "库存产品", factory: "工厂", cartonQty: 12,
    fbaSellable: 20, fbaReservedTransfer: 0, fbaReservedProcessing: 0,
    awdOnHand: 8, awdAvailable: 8, awdPendingShipment: 0, awdOutboundToFba: 0, awdInbound: 0, awdFbaReconciliation: 0,
    inTransitInventory: 22, dailySales: 1, salesByMonth: [], dataQuality: [],
    eligibleInventoryPosition: 50, daysCoverFba: 20, daysCoverNetwork: 50,
    suggestedShipmentQty: 0, suggestedAwdTransferQty: 0, action: "NO_ACTION", riskLevel: "healthy", reason: "",
    inventorySnapshotDate: "2026-07-14", awdSnapshotDate: "2026-06-26",
    domesticSupplyTotal: 30, wpsDomesticSupplyTotal: 30, domesticSupplyBreakdownVerified: false,
  });
  expect(stock.inventorySnapshotDate).toBe("2026-07-14");
  expect(stock.domesticSupplyBreakdownVerified).toBe(false);
  const data = { market: "US", currency: "USD", rows: [stock],
    parameters: { targetCoverDays: 90 }, snapshots: { fbaDate: "2026-10-12", awdDate: "2026-10-12", awdSourceAvailable: true, staleAfterDays: 14, inTransitConfirmed: true, awdAvailableConfirmed: true },
  } as InventoryDashboardData;
  const row = buildOperatingModel([data]).rows[0];
  expect(row.inventoryDate).toBe("2026-07-14");
  expect(row.awdDate).toBe("2026-06-26");
  expect(row.stock?.domesticSupplyTotal).toBe(30);
  expect(row.stock?.domesticSupplyBreakdownVerified).toBe(false);
});

it.each(["UNRELATED", "MA001"])("keeps confirmed combined supply when canceling historical orders for %s", (canceledSku) => {
  const order = { poNumber: "PO-OLD", poDate: "2026-07-14", remainingQuantity: 2, overdue: false };
  const data = { rows: [
    { sku: "MA001", localInventory: 10, pendingOrders: [order], pendingOrderQty: 2,
      domesticSupplyTotal: 30, wpsDomesticSupplyTotal: 30, domesticSupplyBreakdownVerified: false, suggestedShipmentQty: 90 },
    { sku: "MA002", localInventory: 0, pendingOrders: [], pendingOrderQty: 0,
      domesticSupplyTotal: 40, wpsDomesticSupplyTotal: 40, domesticSupplyBreakdownVerified: false, suggestedShipmentQty: 90 },
    { sku: "LEGACY", localInventory: 7, pendingOrders: [{ ...order, remainingQuantity: 4 }], pendingOrderQty: 4,
      domesticSupplyTotal: 11, suggestedShipmentQty: 90 },
  ], summary: {} } as unknown as InventoryDashboardData;
  const canceled = { id: 1, sku: canceledSku, poNumber: "PO-OLD", poDate: "2026-07-14", market: "US", factory: "", remainingQuantity: 2,
    action: "cancel", reason: "历史订单人工取消", reviewer: "user", createdAt: "2026-10-12" } as PurchaseOrderReview;
  const adjusted = applyPurchaseOrderReviews(data, [canceled]);
  expect(adjusted.rows[0].domesticSupplyTotal).toBe(30);
  expect(adjusted.rows[0].wpsDomesticSupplyTotal).toBe(30);
  expect(adjusted.rows[0].suggestedProductionQty).toBe(60);
  expect(adjusted.rows[0].pendingOrderQty).toBe(canceledSku === "MA001" ? 0 : 2);
  expect(adjusted.rows[0].pendingOrders).toHaveLength(canceledSku === "MA001" ? 0 : 1);
  expect(adjusted.rows[1].domesticSupplyTotal).toBe(40);
  expect(adjusted.rows[1].suggestedProductionQty).toBe(50);
  expect(adjusted.rows[2].domesticSupplyTotal).toBe(11);
  expect(data.rows[0].pendingOrders).toHaveLength(1);
  for (const verified of [true, undefined]) {
    const splitData = { ...data, rows: [{ ...data.rows[0], domesticSupplyBreakdownVerified: verified, domesticSupplyTotal: 12 }] };
    expect(applyPurchaseOrderReviews(splitData, [canceled]).rows[0].domesticSupplyTotal).toBe(canceledSku === "MA001" ? 10 : 12);
  }
});

it("uses confirmed domestic combined supply without enabling shipment from an old breakdown", () => {
  const data = {
    market: "US", generatedAt: "2026-10-12", sales: { historyMonths: [], windowMonths: [] },
    domesticPool: { id: "CN-SHARED" }, summary: { localInventory: 999 }, snapshots: { fbaDate: "2026-10-12" },
    parameters: { leadTimeDays: 75, reviewCycleDays: 7, targetCoverDays: 90, safetyStockDays: 21, excessCoverDays: 240, fbaTransferTriggerDays: 30, purchaseOrderOverdueDays: 45 },
    rows: [{ sku: "MA001", productName: "库存产品", cartonQty: 12, dailySales: 10,
      fbaSellable: 20, awdAvailable: 8, awdOutboundToFba: 0, inTransitInventory: 22,
      localInventory: 999, pendingOrderQty: 500, domesticSupplyTotal: 30, domesticSupplyBreakdownVerified: false,
      pendingOrders: [], fbaReservedTransfer: 0, fbaReservedProcessing: 0, awdOnHand: 8,
      salesByMonth: [], salesHistoryByMonth: [] }],
  } as unknown as InventoryDashboardData;
  expect(calculateInventoryRows(data)[0].readyToShipQty).toBe(0);
  const planning = buildInventoryPlanningViewModel(data);
  const row = calculatePlanningRows(planning)[0];
  expect(row.readyToShipQty).toBe(0);
  expect(row.suggestedProductionQty).toBe(Math.max(0, row.suggestedShipmentQty - 30));
  const html = renderToStaticMarkup(createElement(StockBrowser, { data: planning, purchasePlan: { cycle: { nextReviewDate: "2026-10-20" }, rows: [] } }));
  expect(html).toContain("国内组合供应");
  expect(html).toContain("拆分待核实");
  expect(html).toContain("80");
  expect(html).not.toContain("1,549");
  expect(html).not.toMatch(/加入 [0-9,]+ 件/);
  const detail = renderToStaticMarkup(createElement(SkuDetailDashboard, {
    dashboard: { market: "US", currency: "USD", domesticPoolId: "CN-SHARED", targetAcosPercent: 30,
      row: calculateInventoryRows(data)[0], variant: null, engineeringSpecifications: [], campaigns: [] },
    sku: "MA001", profitability: null, product: null, canceledOrders: [], purchaseOrders: [], shipmentHistory: [],
  }));
  expect(detail).toContain("国内组合供应");
  expect(detail).toContain("拆分待核实");
  expect(detail).not.toContain("可直接发");
  expect(detail).not.toContain("1,549");
});
