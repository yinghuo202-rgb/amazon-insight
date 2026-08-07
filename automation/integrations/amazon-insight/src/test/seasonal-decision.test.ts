import { describe, expect, it } from "vitest";

import { analyzeSeasonalInventoryRow, type CombinedSeasonalInventoryRowInput, type SeasonalInventoryPlanResult } from "@/lib/inventory/seasonal-clearance";
import { buildSeasonalDecisionRows, buildSeasonalDecisionSummary } from "@/lib/inventory/seasonal-decision";

function history() { return [2024, 2025].flatMap((year) => Array.from({ length: 12 }, (_, index) => { const month = index + 1; return { month: `${year}-${String(month).padStart(2, "0")}`, units: month >= 5 && month <= 8 ? 50 : 10 }; })).concat([{ month: "2026-06", units: 50 }]); }
function input(): CombinedSeasonalInventoryRowInput { return { sku: "CROSS-1", productName: "跨站错配商品", detailMarket: "US", cartonQty: 20, usOverseasInventory: 20, caOverseasInventory: 200, domesticInventory: 0, pendingOrderQty: 0, usSalesHistoryByMonth: history(), caSalesHistoryByMonth: history() }; }

describe("seasonal decision consolidation", () => {
  it("merges a clearance and replenishment overlap into one cross-market decision", () => {
    const candidate = analyzeSeasonalInventoryRow(input(), { snapshotDate: "2026-07-14", latestSalesMonth: "2026-06" })!;
    const plan = { snapshots: { US: "2026-07-14", CA: "2026-07-14" }, snapshotDate: "2026-07-14", latestSalesMonth: "2026-06", seasonEndDate: "2026-08-31", clearanceCandidates: [candidate], replenishmentCandidates: [candidate], summary: {} as SeasonalInventoryPlanResult["summary"] } satisfies SeasonalInventoryPlanResult;
    const rows = buildSeasonalDecisionRows(plan);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("cross_market");
    expect(rows[0].clearance).toBe(true);
    expect(rows[0].replenishment).toBe(true);
    const summary = buildSeasonalDecisionSummary(plan);
    expect(summary.actionSkuCount).toBe(1);
    expect(summary.overlapCount).toBe(1);
    expect(summary.crossMarketMismatchCount).toBe(1);
    expect(summary.markets.US.replenishmentGapQty).toBe(70);
    expect(summary.markets.CA.clearanceQty).toBe(110);
  });
});
