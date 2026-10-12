import { expect, it } from "vitest";
import type { InventoryDashboardData, PurchasePlanData } from "@/lib/inventory/contracts";
import { applyInventoryOverrides, applyPurchasePlanOverrides, type OperationalDataOverrides } from "@/lib/inventory/operational-data-store";

const empty: OperationalDataOverrides = { products: [], inventories: [], domesticInventories: [] };
function inventory(market: "US" | "CA" = "US", verified: boolean | undefined = false) {
  return {
    market, parameters: { targetCoverDays: 90, fbaTransferTriggerDays: 30, excessCoverDays: 240, leadTimeDays: 75 }, summary: {},
    rows: [
      { sku: "MA001", productName: "Known", cartonQty: 1, dailySales: 1, fbaSellable: 0, awdAvailable: 0,
        awdOutboundToFba: 0, awdInbound: 0, inTransitInventory: 0, localInventory: 999, pendingOrderQty: 500,
        domesticSupplyTotal: 30, wpsDomesticSupplyTotal: 30, domesticSupplyBreakdownVerified: verified, pendingOrders: [] },
      { sku: "MA002", productName: "New", cartonQty: 1, dailySales: 1, fbaSellable: 0, awdAvailable: 0,
        awdOutboundToFba: 0, awdInbound: 0, inTransitInventory: 0, localInventory: 0, pendingOrderQty: 0,
        domesticSupplyTotal: 40, wpsDomesticSupplyTotal: 40, domesticSupplyBreakdownVerified: false, pendingOrders: [] },
    ],
  } as unknown as InventoryDashboardData;
}

it("preserves confirmed combined supply through the real empty override reader", () => {
  const result = applyInventoryOverrides(inventory(), empty);
  expect(result.rows[0]).toMatchObject({ domesticSupplyTotal: 30, wpsDomesticSupplyTotal: 30, readyToShipQty: 0, suggestedProductionQty: 60 });
  expect(result.rows[1]).toMatchObject({ domesticSupplyTotal: 40, readyToShipQty: 0, suggestedProductionQty: 50 });
  expect(result.summary.readyToShipQty).toBe(0);
});

it("retains manual domestic history without promoting an unknown combined breakdown", () => {
  const overrides = { ...empty, domesticInventories: [{ sku: "MA001", localInventory: 777, updatedAt: "2026-07-01" }] };
  expect(applyInventoryOverrides(inventory(), overrides).rows[0]).toMatchObject({ localInventory: 777, domesticSupplyTotal: 30, readyToShipQty: 0 });
  expect(overrides.domesticInventories[0].localInventory).toBe(777);
});

it.each([true, undefined])("retains verified and legacy split override calculations (%s)", verified => {
  const data = inventory("US", verified);
  data.rows[0].domesticSupplyBreakdownVerified = verified;
  data.rows[0].localInventory = 15;
  data.rows[0].pendingOrderQty = 5;
  expect(applyInventoryOverrides(data, empty).rows[0]).toMatchObject({ domesticSupplyTotal: 20, readyToShipQty: 15, suggestedProductionQty: 70 });
});

function plan() {
  return { parameters: { demandHorizonDays: 100 }, summary: {}, rows: [{ sku: "MA001", productName: "Known", cartonQty: 1,
    combinedDailySales: 1, usNetworkInventory: 0, caNetworkInventory: 0, localInventory: 999, pendingOrderQty: 500 }] } as unknown as PurchasePlanData;
}

it("counts the US/CA shared confirmed domestic pool once in purchase demand", () => {
  const us = inventory(), ca = inventory("CA");
  us.rows[0].eligibleInventoryPosition = 10;
  ca.rows[0].eligibleInventoryPosition = 20;
  expect(applyPurchasePlanOverrides(plan(), us, ca, []).rows[0]).toMatchObject({ inventoryPosition: 60, coverageDays: 60, suggestedPurchaseQty: 40 });
});

it.each([true, undefined])("keeps verified and legacy purchase splits (%s)", verified => {
  const us = inventory("US", verified), ca = inventory("CA", verified), purchase = plan();
  us.rows[0].domesticSupplyBreakdownVerified = verified;
  ca.rows[0].domesticSupplyBreakdownVerified = verified;
  us.rows[0].eligibleInventoryPosition = 10;
  ca.rows[0].eligibleInventoryPosition = 20;
  us.rows[0].localInventory = 15;
  purchase.rows[0].pendingOrderQty = 5;
  expect(applyPurchasePlanOverrides(purchase, us, ca, []).rows[0]).toMatchObject({ inventoryPosition: 50, suggestedPurchaseQty: 50 });
});
