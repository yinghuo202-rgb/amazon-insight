import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { creativeHandoffFilePath, creativeHandoffOutputRoot } from "@/lib/inventory/creative-handoff";
import {
  inventoryDashboardDataPath,
  productCatalogDataPath,
  productImageDirectory,
  purchasePlanDataPath,
} from "@/lib/inventory/data";
import { documentMasterPath, exportFilePath } from "@/lib/inventory/document-exports";
import { advertisingPlanDownloadPath, purchasePlanDownloadPath } from "@/lib/inventory/download-center";
import { dataRoot, operationsDbPath, runtimeRoot } from "@/lib/inventory/paths";

describe("dynamic STORE_OPS_RUNTIME_ROOT and STORE_OPS_DATA_ROOT resolution", () => {
  const originalRuntime = process.env.STORE_OPS_RUNTIME_ROOT;
  const originalData = process.env.STORE_OPS_DATA_ROOT;
  const originalStateDb = process.env.STORE_OPS_STATE_DB;
  let tempDir = "";

  afterEach(() => {
    if (originalRuntime === undefined) delete process.env.STORE_OPS_RUNTIME_ROOT;
    else process.env.STORE_OPS_RUNTIME_ROOT = originalRuntime;
    if (originalData === undefined) delete process.env.STORE_OPS_DATA_ROOT;
    else process.env.STORE_OPS_DATA_ROOT = originalData;
    if (originalStateDb === undefined) delete process.env.STORE_OPS_STATE_DB;
    else process.env.STORE_OPS_STATE_DB = originalStateDb;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  it("routes all report, export, download, and DB paths through STORE_OPS_RUNTIME_ROOT", () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "store-ops-paths-"));
    const customRuntime = path.join(tempDir, "custom-runtime");
    const customSources = path.join(tempDir, "custom-sources");
    process.env.STORE_OPS_RUNTIME_ROOT = customRuntime;
    process.env.STORE_OPS_DATA_ROOT = customSources;
    delete process.env.STORE_OPS_STATE_DB;

    expect(runtimeRoot()).toBe(path.resolve(customRuntime));
    expect(dataRoot()).toBe(path.resolve(customSources));
    expect(operationsDbPath()).toBe(path.join(path.resolve(customRuntime), "db", "operations.sqlite3"));
    expect(inventoryDashboardDataPath("US")).toBe(path.join(path.resolve(customRuntime), "reports", "inventory_dashboard.json"));
    expect(inventoryDashboardDataPath("CA")).toBe(path.join(path.resolve(customRuntime), "reports", "inventory_dashboard.ca.json"));
    expect(productCatalogDataPath()).toBe(path.join(path.resolve(customRuntime), "reports", "product_catalog.json"));
    expect(purchasePlanDataPath()).toBe(path.join(path.resolve(customRuntime), "reports", "purchase_plan.json"));
    expect(documentMasterPath()).toBe(path.join(path.resolve(customRuntime), "reports", "document_master.json"));
    expect(productImageDirectory()).toBe(path.join(path.resolve(customRuntime), "output", "product-images"));
    expect(creativeHandoffOutputRoot()).toBe(path.join(path.resolve(customRuntime), "output", "creative-handoffs"));
    expect(creativeHandoffFilePath("batch-1", "MA007.xlsx")).toBe(
      path.join(path.resolve(customRuntime), "output", "creative-handoffs", "batch-1", "MA007.xlsx"),
    );
    expect(exportFilePath("20260715-120000-abcdef12", "CM320.xlsx")).toBe(
      path.join(path.resolve(customRuntime), "output", "exports", "20260715-120000-abcdef12", "CM320.xlsx"),
    );
    expect(purchasePlanDownloadPath("20260715-120000-abcdef12", "plan.csv")).toBe(
      path.join(path.resolve(customRuntime), "output", "purchase-plans", "20260715-120000-abcdef12", "plan.csv"),
    );
    expect(advertisingPlanDownloadPath("20260715-120000-abcdef12", "ads.csv")).toBe(
      path.join(path.resolve(customRuntime), "output", "advertising-plans", "20260715-120000-abcdef12", "ads.csv"),
    );
  });
});
