import { describe, expect, it } from "vitest";

import { allocateFifoQuantity } from "@/lib/inventory/warehouse-store";

describe("warehouse FIFO allocation", () => {
  it("consumes oldest receipt lots first and splits across purchase orders", () => {
    const lots = [
      { lotCode: "L1", poNumber: "PO-1", remainingQty: 7 },
      { lotCode: "L2", poNumber: "PO-2", remainingQty: 10 },
      { lotCode: "L3", poNumber: "PO-3", remainingQty: 5 },
    ];

    expect(allocateFifoQuantity(lots, 12)).toEqual([
      { lot: lots[0], quantity: 7 },
      { lot: lots[1], quantity: 5 },
    ]);
  });

  it("refuses to create a negative balance", () => {
    expect(() => allocateFifoQuantity([{ remainingQty: 3 }], 4)).toThrow("库存不足：需要 4，可用 3。");
  });

  it("rejects zero, negative and fractional issue quantities", () => {
    const lots = [{ remainingQty: 10 }];
    for (const quantity of [0, -2, 1.5]) expect(() => allocateFifoQuantity(lots, quantity)).toThrow("出库数量必须为正整数。");
  });
});
