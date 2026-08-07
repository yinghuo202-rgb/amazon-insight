import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadBaseInventoryDashboardData, loadBaseProductCatalogData, loadInventoryDashboardData, loadProductCatalogData, loadPurchasePlanData } from "@/lib/inventory/data";
import { deleteOperationalDataOverrides, listOperationalDataOverrides, saveInventoryOverrides, saveProductMasterOverrides } from "@/lib/inventory/operational-data-store";

describe("online operational data editor", () => {
  const original = process.env.STORE_OPS_STATE_DB;
  let folder = "";

  beforeEach(() => {
    folder = mkdtempSync(path.join(tmpdir(), "operational-editor-"));
    process.env.STORE_OPS_STATE_DB = path.join(folder, "operations.sqlite3");
  });

  afterEach(() => {
    if (original === undefined) delete process.env.STORE_OPS_STATE_DB;
    else process.env.STORE_OPS_STATE_DB = original;
    rmSync(folder, { recursive: true, force: true });
  });

  it("shares edited domestic inventory across markets and recalculates inventory decisions", async () => {
    const [baseUs, baseCa] = await Promise.all([loadBaseInventoryDashboardData("US"), loadBaseInventoryDashboardData("CA")]);
    const usRow = baseUs.rows.find((row) => row.sku === "MA007")!;
    const caRow = baseCa.rows.find((row) => row.sku === "MA007")!;

    saveInventoryOverrides([{
      market: "US",
      sku: "MA007",
      fbaSellable: usRow.fbaSellable + 100,
      awdAvailable: usRow.awdAvailable + 50,
      awdOutboundToFba: usRow.awdOutboundToFba,
      awdInbound: usRow.awdInbound,
      localInventory: usRow.localInventory + 200,
    }]);

    const [us, ca] = await Promise.all([loadInventoryDashboardData("US"), loadInventoryDashboardData("CA")]);
    const editedUs = us.rows.find((row) => row.sku === "MA007")!;
    const editedCa = ca.rows.find((row) => row.sku === "MA007")!;
    expect(editedUs.fbaSellable).toBe(usRow.fbaSellable + 100);
    expect(editedUs.awdAvailable).toBe(usRow.awdAvailable + 50);
    expect(editedUs.eligibleInventoryPosition).toBe(usRow.eligibleInventoryPosition + 150);
    expect(editedUs.localInventory).toBe(usRow.localInventory + 200);
    expect(editedCa.fbaSellable).toBe(caRow.fbaSellable);
    expect(editedCa.localInventory).toBe(usRow.localInventory + 200);
    expect(us.summary.fbaSellable).toBe(baseUs.summary.fbaSellable + 100);
    expect(us.summary.localInventory).toBe(baseUs.summary.localInventory + 200);
  });

  it("syncs edited product master fields into product, inventory, and purchase data", async () => {
    const product = (await loadBaseProductCatalogData()).items.find((row) => row.sku === "MA007")!;
    saveProductMasterOverrides([{
      sku: "MA007",
      chineseName: "MA007 在线编辑名称",
      englishName: product.englishName,
      category: product.category,
      packaging: "在线编辑包装",
      cartonQty: 25,
      productWeightG: product.productWeightG,
      shippingSizeCm: product.shippingSizeCm,
      cartonGrossWeightKg: product.cartonGrossWeightKg,
      cartonLengthCm: product.cartonDimensionsCm.length,
      cartonWidthCm: product.cartonDimensionsCm.width,
      cartonHeightCm: product.cartonDimensionsCm.height,
    }]);

    const [catalog, inventory, purchase] = await Promise.all([
      loadProductCatalogData(),
      loadInventoryDashboardData("US"),
      loadPurchasePlanData(),
    ]);
    expect(catalog.items.find((row) => row.sku === "MA007")).toMatchObject({ chineseName: "MA007 在线编辑名称", packaging: "在线编辑包装", cartonQty: 25 });
    expect(inventory.rows.find((row) => row.sku === "MA007")).toMatchObject({ productName: "MA007 在线编辑名称", cartonQty: 25 });
    expect(purchase.rows.find((row) => row.sku === "MA007")).toMatchObject({ productName: "MA007 在线编辑名称", cartonQty: 25 });
  });

  it("restores source data by deleting only the selected online version", () => {
    saveInventoryOverrides([{ market: "US", sku: "MA007", fbaSellable: 1, awdAvailable: 2, awdOutboundToFba: 3, awdInbound: 4, localInventory: 5 }]);
    expect(listOperationalDataOverrides().inventories).toHaveLength(1);
    deleteOperationalDataOverrides("inventory", [{ market: "US", sku: "MA007" }]);
    expect(listOperationalDataOverrides()).toMatchObject({ inventories: [], domesticInventories: [] });
  });
});
