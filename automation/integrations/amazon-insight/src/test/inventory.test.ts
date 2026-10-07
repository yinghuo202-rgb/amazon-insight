import { describe, expect, it } from "vitest";

import { calculateInventoryDecision, roundUpToPack } from "@/lib/inventory/calculator";
import type { InventoryParameters } from "@/lib/inventory/contracts";

const parameters: InventoryParameters = {
  leadTimeDays: 75,
  reviewCycleDays: 7,
  targetCoverDays: 45,
  safetyStockDays: 21,
  excessCoverDays: 240,
  fbaTransferTriggerDays: 30,
  purchaseOrderOverdueDays: 45,
};

describe("inventory replenishment calculator", () => {
  it("rounds shipment quantities to a full carton", () => {
    expect(roundUpToPack(101, 50)).toBe(150);
  });

  it("flags inventory that runs out before the sea ETA", () => {
    const result = calculateInventoryDecision(
      { dailySales: 10, fbaSellable: 200, awdAvailable: 100, awdOutboundToFba: 0, inTransitInventory: 0, cartonQty: 50 },
      parameters,
    );

    expect(result.action).toBe("URGENT_AIR_OR_TRANSFER");
    expect(result.daysCoverNetwork).toBe(30);
  });

  it("uses AWD transfer when network cover is sufficient but FBA is low", () => {
    const result = calculateInventoryDecision(
      { dailySales: 10, fbaSellable: 100, awdAvailable: 700, awdOutboundToFba: 0, inTransitInventory: 0, cartonQty: 50 },
      parameters,
    );

    expect(result.action).toBe("AWD_TRANSFER");
    expect(result.suggestedAwdTransferQty).toBe(200);
  });

  it("targets three months and deducts in-transit inventory", () => {
    const result = calculateInventoryDecision(
      { dailySales: 10, fbaSellable: 200, awdAvailable: 100, awdOutboundToFba: 0, inTransitInventory: 300, cartonQty: 50 },
      { ...parameters, targetCoverDays: 90 },
    );

    expect(result.eligibleInventoryPosition).toBe(600);
    expect(result.suggestedShipmentQty).toBe(300);
    expect(result.daysCoverNetwork).toBe(60);
  });
});
