import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  autoSplitShipmentBatches,
  createShipmentBatch,
  listShipmentBatchItems,
  listShipmentBatches,
  listShipmentPlanItems,
  removeShipmentPlanItem,
  replaceShipmentPlan,
  setShipmentBatchStatus,
  upsertShipmentPlanItem,
} from "@/lib/inventory/shipment-plan";

describe("persistent shipment plan", () => {
  const originalStateDb = process.env.STORE_OPS_STATE_DB;
  let databasePath = "";

  beforeEach(() => {
    databasePath = path.join(os.tmpdir(), `store-ops-shipment-plan-${randomUUID()}.sqlite3`);
    process.env.STORE_OPS_STATE_DB = databasePath;
  });

  afterEach(async () => {
    if (originalStateDb === undefined) delete process.env.STORE_OPS_STATE_DB;
    else process.env.STORE_OPS_STATE_DB = originalStateDb;
    await Promise.all([databasePath, `${databasePath}-wal`, `${databasePath}-shm`].map((file) => rm(file, { force: true })));
  });

  it("keeps US and Canada plans separate while supporting updates and removal", () => {
    const base = { suggestedQuantity: 120, note: "", reason: "库存覆盖不足", snapshotDate: "2026-07-14" };
    upsertShipmentPlanItem({ market: "US", sku: "MA007", quantity: 120, ...base });
    upsertShipmentPlanItem({ market: "CA", sku: "MA007", quantity: 40, ...base });
    upsertShipmentPlanItem({ market: "US", sku: "MA007", quantity: 150, ...base, note: "优先出库" });

    expect(listShipmentPlanItems("US")).toMatchObject([{ market: "US", sku: "MA007", quantity: 150, note: "优先出库" }]);
    expect(listShipmentPlanItems("CA")).toMatchObject([{ market: "CA", sku: "MA007", quantity: 40 }]);
    expect(listShipmentPlanItems()).toHaveLength(2);
    expect(removeShipmentPlanItem("US", "MA007")).toBe(true);
    expect(listShipmentPlanItems("US")).toHaveLength(0);
  });

  it("replaces one market plan without changing the other market", () => {
    const base = { suggestedQuantity: 80, note: "", reason: "需要补货", snapshotDate: "2026-07-14" };
    upsertShipmentPlanItem({ market: "CA", sku: "MA007", quantity: 40, ...base });
    replaceShipmentPlan("US", [
      { market: "US", sku: "MA008", quantity: 80, ...base },
      { market: "US", sku: "MA009", quantity: 60, ...base },
    ]);

    expect(listShipmentPlanItems("US").map((item) => item.sku).sort()).toEqual(["MA008", "MA009"]);
    expect(listShipmentPlanItems("CA").map((item) => item.sku)).toEqual(["MA007"]);
  });

  it("keeps an unlimited number of SKUs in one business batch and keeps history", () => {
    const items = Array.from({ length: 87 }, (_, index) => ({
      market: "US" as const,
      sku: `MA${String(index + 1).padStart(3, "0")}`,
      quantity: index + 1,
      suggestedQuantity: index + 1,
      note: "",
      reason: "需要补货",
      snapshotDate: "2026-07-14",
    }));

    const batches = autoSplitShipmentBatches("US", items, "CM500", "2026-07-20");
    expect(batches.map((batch) => batch.batchNumber)).toEqual(["CM500"]);
    expect(batches.map((batch) => batch.itemCount)).toEqual([87]);
    expect(listShipmentBatchItems(batches[0].id)).toHaveLength(87);

    setShipmentBatchStatus(batches[0].id, "EXPORTED");
    setShipmentBatchStatus(batches[0].id, "ARCHIVED");
    expect(listShipmentBatches("US").find((batch) => batch.id === batches[0].id)?.status).toBe("ARCHIVED");
    expect(listShipmentPlanItems("US")).toHaveLength(0);
  });

  it("creates independent empty draft batches", () => {
    const first = createShipmentBatch("CA", { batchNumber: "CM610" });
    const second = createShipmentBatch("CA", { batchNumber: "CM611" });
    expect(first.id).not.toBe(second.id);
    expect(listShipmentBatches("CA").map((batch) => batch.batchNumber).sort()).toEqual(["CM610", "CM611"]);
  });
});
