import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getAdvertisingPlan, saveAdvertisingPlan, transitionAdvertisingPlan } from "@/lib/inventory/advertising-plan-store";
import type { InventoryDashboardData } from "@/lib/inventory/contracts";
import { backtestPurchaseDemand } from "@/lib/inventory/purchase-backtest";
import { getPurchasePlanCycle, replacePurchasePlanDraft, transitionPurchasePlanCycle } from "@/lib/inventory/purchase-plan-store";

describe("persisted planning workflows", () => {
  const original = process.env.STORE_OPS_STATE_DB; let folder = "";
  beforeEach(() => { folder = mkdtempSync(path.join(tmpdir(), "planning-workflows-")); process.env.STORE_OPS_STATE_DB = path.join(folder, "operations.sqlite3"); });
  afterEach(() => { if (original === undefined) delete process.env.STORE_OPS_STATE_DB; else process.env.STORE_OPS_STATE_DB = original; rmSync(folder, { recursive: true, force: true }); });

  it("versions and locks a purchase plan through explicit transitions", () => {
    replacePurchasePlanDraft("2026-07-31", [{ sku: "MA007", quantity: 800, suggestedQuantity: 800, note: "test" }]);
    expect(getPurchasePlanCycle("2026-07-31")).toMatchObject({ status: "DRAFT", version: 1 });
    expect(transitionPurchasePlanCycle("2026-07-31", "review").status).toBe("REVIEWED");
    expect(transitionPurchasePlanCycle("2026-07-31", "lock").status).toBe("LOCKED");
    expect(() => replacePurchasePlanDraft("2026-07-31", [])).toThrow(/不是草稿状态/);
    expect(transitionPurchasePlanCycle("2026-07-31", "ordered").status).toBe("ORDERED");
  });

  it("requires reopening a confirmed advertising plan before editing", () => {
    const item = { campaign: "MA007 keyword", sku: "MA007", recommendedAction: "INCREASE_BID" as const, currentBudget: 20, proposedBudget: 20, bidChangePercent: 8, note: "test" };
    expect(saveAdvertisingPlan("US", "2026-06", [item]).version).toBe(1);
    expect(transitionAdvertisingPlan("US", "2026-06", "confirm").status).toBe("CONFIRMED");
    expect(() => saveAdvertisingPlan("US", "2026-06", [item])).toThrow(/已确认/);
    expect(transitionAdvertisingPlan("US", "2026-06", "reopen").status).toBe("DRAFT");
    expect(getAdvertisingPlan("US", "2026-06").items).toHaveLength(1);
  });
});

describe("purchase demand backtest", () => {
  it("keeps algorithm comparison read-only and identifies seasonal demand", () => {
    const months = Array.from({ length: 24 }, (_, index) => `202${4 + Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, "0")}`);
    const seasonal = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120];
    const dashboard = (units: number[]): InventoryDashboardData => ({ sales: { historyMonths: months }, rows: [{ sku: "MA007", productName: "Gauge", salesHistoryByMonth: months.map((month, index) => ({ month, units: units[index] })) }] } as unknown as InventoryDashboardData);
    const result = backtestPurchaseDemand(dashboard([...seasonal, ...seasonal]), dashboard(Array(24).fill(0)));
    expect(result.skuCount).toBe(1);
    expect(result.methods.find((item) => item.method === "seasonal")!.weightedErrorPercent).toBeLessThan(result.methods.find((item) => item.method === "recent3")!.weightedErrorPercent);
    expect(result.recommendedMethod).toBe("seasonal");
  });
});
