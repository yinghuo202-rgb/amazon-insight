import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { PurchasePlanData } from "@/lib/inventory/contracts";
import { PurchasePlanWorkbench, purchaseDomesticSupplyCells } from "@/components/inventory/purchase-plan-workbench";
import { SeasonalClearanceView } from "@/components/inventory/seasonal-clearance-view";
import { analyzeSeasonalInventoryRow, type SeasonalInventoryPlanResult } from "@/lib/inventory/seasonal-clearance";
import { buildSeasonalPurchaseActions, buildSeasonalShipmentActions } from "@/lib/inventory/seasonal-plan-integration";

function purchase() {
  return { sources: [], cycle: { nextReviewDate: "2026-10-20" }, parameters: { productionLeadDays: 30, oceanLeadDays: 45, reviewCycleDays: 7, safetyStockDays: 21, demandHorizonDays: 100 }, summary: { criticalSkuCount: 0, discrepancySkuCount: 0, varianceQuantity: 0 }, rows: [{
    sku: "MA001", productName: "Product", factory: "Factory", cartonQty: 1, combinedDailySales: 1, usNetworkInventory: 10, caNetworkInventory: 20,
    localInventory: 999, pendingOrderQty: 500, domesticSupplyTotal: 30, domesticSupplyBreakdownVerified: false,
    inventoryPosition: 60, coverageDays: 60, projectedDemand: 100, suggestedPurchaseQty: 40, riskLevel: "critical", orders: [],
  }] } as unknown as PurchasePlanData;
}

it("shows and exports confirmed combined supply rather than historical purchase splits", () => {
  const row = purchase().rows[0];
  expect(purchaseDomesticSupplyCells(row)).toEqual([30, "拆分待核实（历史现货 999 / 历史订单 500）"]);
  const html = renderToStaticMarkup(createElement(PurchasePlanWorkbench, { data: purchase(), seasonalActions: [] }));
  expect(html).toContain("国内组合供应");
  expect(html).toContain("拆分待核实");
  expect(html).toContain("库存合计 60 件");
  expect(html).not.toContain("库存合计 1,529 件");
});

function seasonal(overseas: number) {
  const history = [2024, 2025].flatMap(year => Array.from({ length: 12 }, (_, i) => ({ month: `${year}-${String(i + 1).padStart(2, "0")}`, units: i >= 4 && i <= 7 ? 50 : 10 }))).concat([{ month: "2026-06", units: 50 }]);
  return analyzeSeasonalInventoryRow({ sku: "MA001", productName: "Product", detailMarket: "US", cartonQty: 20,
    usOverseasInventory: overseas, caOverseasInventory: 0, domesticInventory: 100, pendingOrderQty: 40,
    domesticSupplyTotal: 30, domesticSupplyBreakdownVerified: false, usSalesHistoryByMonth: history, caSalesHistoryByMonth: history,
  }, { snapshotDate: "2026-07-14", latestSalesMonth: "2026-06" })!;
}
function plan(candidate: ReturnType<typeof seasonal>, clearance: boolean): SeasonalInventoryPlanResult {
  return { snapshots: { US: "2026-07-14", CA: "2026-07-14" }, snapshotDate: "2026-07-14", latestSalesMonth: "2026-06", seasonEndDate: "2026-08-31",
    clearanceCandidates: clearance ? [candidate] : [], replenishmentCandidates: clearance ? [] : [candidate], summary: {} as SeasonalInventoryPlanResult["summary"] };
}

it("uses combined supply for seasonal purchase demand without executing historical domestic stock", () => {
  const candidate = seasonal(20);
  expect(candidate).toMatchObject({ domesticTransferQty: 0, usDomesticTransferQty: 0, caDomesticTransferQty: 0, pendingCoverageQty: 0, urgentReplenishmentQty: 130 });
  expect(buildSeasonalShipmentActions(plan(candidate, false)).every(action => action.shipmentQty === 0)).toBe(true);
  expect(buildSeasonalPurchaseActions(plan(candidate, false))[0]).toMatchObject({ domesticTransferQty: 0, urgentPurchaseQty: 130, pendingMitigationQty: 0 });
});

it("retains overseas seasonal clearance without stopping orders from an unknown domestic split", () => {
  const candidate = seasonal(300);
  expect(candidate).toMatchObject({ usClearanceQty: 210, domesticClearanceQty: 0, pendingMitigationQty: 0 });
  const shipment = buildSeasonalShipmentActions(plan(candidate, true));
  expect(shipment.find(action => action.market === "US")).toMatchObject({ overseasClearanceQty: 210, shipmentQty: 0 });
  expect(buildSeasonalPurchaseActions(plan(candidate, true))[0].reason).not.toContain("未完工订单");
});

it("labels retained seasonal domestic splits as historical rather than current on-hand stock", () => {
  const html = renderToStaticMarkup(createElement(SeasonalClearanceView, { result: plan(seasonal(20), false) }));
  expect(html).toContain("国内组合供应 30");
  expect(html).toContain("历史现货 100");
  expect(html).toContain("历史订单 40");
  expect(html).toContain("拆分待核实");
  expect(html).not.toContain("国内现货 100");
});
