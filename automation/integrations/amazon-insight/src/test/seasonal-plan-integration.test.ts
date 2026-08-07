import { describe, expect, it } from "vitest";

import { analyzeSeasonalInventoryRow, type CombinedSeasonalInventoryRowInput, type SeasonalInventoryPlanResult } from "@/lib/inventory/seasonal-clearance";
import { adjustedSeasonalPurchaseQuantity, buildSeasonalPurchaseActions, buildSeasonalShipmentActions } from "@/lib/inventory/seasonal-plan-integration";

function history(summerUnits: number, otherUnits: number) {
  return [2024, 2025].flatMap((year) => Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    return { month: `${year}-${String(month).padStart(2, "0")}`, units: month >= 5 && month <= 8 ? summerUnits : otherUnits };
  })).concat([{ month: "2026-06", units: summerUnits }]);
}

function input(overrides: Partial<CombinedSeasonalInventoryRowInput> = {}): CombinedSeasonalInventoryRowInput {
  return {
    sku: "MA999",
    productName: "季节测试商品",
    detailMarket: "US",
    cartonQty: 20,
    usOverseasInventory: 300,
    caOverseasInventory: 100,
    domesticInventory: 100,
    pendingOrderQty: 40,
    usSalesHistoryByMonth: history(50, 10),
    caSalesHistoryByMonth: history(50, 10),
    ...overrides,
  };
}

function plan(candidate: NonNullable<ReturnType<typeof analyzeSeasonalInventoryRow>>, clearance: boolean, replenishment: boolean): SeasonalInventoryPlanResult {
  return {
    snapshots: { US: "2026-07-14", CA: "2026-07-14" },
    snapshotDate: "2026-07-14",
    latestSalesMonth: "2026-06",
    seasonEndDate: "2026-08-31",
    clearanceCandidates: clearance ? [candidate] : [],
    replenishmentCandidates: replenishment ? [candidate] : [],
    summary: {} as SeasonalInventoryPlanResult["summary"],
  };
}

describe("seasonal plan integration", () => {
  it("turns domestic peak-season coverage into market shipment actions and a purchase floor", () => {
    const candidate = analyzeSeasonalInventoryRow(input({ usOverseasInventory: 20, caOverseasInventory: 0, domesticInventory: 100, pendingOrderQty: 40 }), { snapshotDate: "2026-07-14", latestSalesMonth: "2026-06" })!;
    const result = plan(candidate, false, true);
    const shipment = buildSeasonalShipmentActions(result);
    expect(shipment.find((action) => action.market === "US")?.transferQty).toBe(44);
    expect(shipment.find((action) => action.market === "CA")?.transferQty).toBe(56);
    expect(shipment[0].shipByDate).toBe("2026-07-31");
    const purchase = buildSeasonalPurchaseActions(result)[0];
    expect(purchase.kind).toBe("urgent_purchase");
    expect(purchase.urgentPurchaseQty).toBe(20);
    expect(purchase.pendingMitigationQty).toBe(0);
    expect(adjustedSeasonalPurchaseQuantity(0, 20, purchase)).toBe(20);
  });

  it("routes domestic clearance to shipment, sets a sellout deadline, and blocks new purchasing", () => {
    const candidate = analyzeSeasonalInventoryRow(input(), { snapshotDate: "2026-07-14", latestSalesMonth: "2026-06" })!;
    const result = plan(candidate, true, false);
    const shipment = buildSeasonalShipmentActions(result);
    expect(shipment.find((action) => action.market === "US")?.clearanceQty).toBe(50);
    expect(shipment.find((action) => action.market === "CA")?.clearanceQty).toBe(50);
    expect(shipment[0].sellByDate).toBe("2026-08-31");
    const purchase = buildSeasonalPurchaseActions(result)[0];
    expect(purchase.kind).toBe("stop_purchase");
    expect(purchase.blockPurchase).toBe(true);
    expect(adjustedSeasonalPurchaseQuantity(200, 20, purchase)).toBe(0);
  });

  it("rounds an urgent seasonal purchase floor up to full cartons", () => {
    expect(adjustedSeasonalPurchaseQuantity(0, 24, {
      sku: "MA999", productName: "测试", kind: "urgent_purchase", blockPurchase: false,
      urgentPurchaseQty: 25, domesticTransferQty: 0, pendingMitigationQty: 0, deadline: "2026-10-31", reason: "",
    })).toBe(48);
  });
});
