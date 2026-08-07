import { describe, expect, it } from "vitest";

import { analyzeSeasonalInventoryRow, type CombinedSeasonalInventoryRowInput, type SeasonalInventoryPlanResult } from "@/lib/inventory/seasonal-clearance";
import { buildSeasonalInventoryCsv } from "@/lib/inventory/seasonal-clearance-export";

function history(summerUnits: number, otherUnits: number) { return [2024, 2025].flatMap((year) => Array.from({ length: 12 }, (_, index) => { const month = index + 1; return { month: `${year}-${String(month).padStart(2, "0")}`, units: month >= 5 && month <= 8 ? summerUnits : otherUnits }; })).concat([{ month: "2026-06", units: summerUnits }]); }
function upcomingHistory(peakUnits: number, otherUnits: number) { return [2024, 2025].flatMap((year) => Array.from({ length: 12 }, (_, index) => { const month = index + 1; return { month: `${year}-${String(month).padStart(2, "0")}`, units: month >= 8 && month <= 10 ? peakUnits : otherUnits }; })).concat([{ month: "2026-06", units: otherUnits }]); }
function row(overrides: Partial<CombinedSeasonalInventoryRowInput> = {}): CombinedSeasonalInventoryRowInput { return { sku: "SUMMER-1", productName: "夏季商品", detailMarket: "US", cartonQty: 20, usOverseasInventory: 300, caOverseasInventory: 100, domesticInventory: 100, pendingOrderQty: 40, usSalesHistoryByMonth: history(50, 10), caSalesHistoryByMonth: history(50, 10), ...overrides }; }
const context = { snapshotDate: "2026-07-14", latestSalesMonth: "2026-06" };

describe("combined seasonal inventory planning", () => {
  it("uses site reserves, clears site excess, and counts domestic stock once", () => {
    const result = analyzeSeasonalInventoryRow(row(), context);
    expect(result?.usReserveUnits).toBe(90);
    expect(result?.caReserveUnits).toBe(90);
    expect(result?.usClearanceQty).toBe(210);
    expect(result?.caClearanceQty).toBe(10);
    expect(result?.domesticClearanceQty).toBe(100);
    expect(result?.pendingMitigationQty).toBe(40);
    expect(result?.atRiskSupplyQty).toBe(360);
    expect(result?.benchmarkAverageMonthlySales).toBe(54.29);
    expect(result?.benchmarkTotalInventory).toBe(500);
    expect(result?.benchmarkMonthsOfSupply).toBe(9.21);
    expect(result?.isTwelveMonthSlowMover).toBe(false);
    expect(result?.upcomingPeak).toBe(false);
  });

  it("fills station gaps from domestic stock, then pending orders, then urgent replenishment", () => {
    const result = analyzeSeasonalInventoryRow(row({ usOverseasInventory: 20, caOverseasInventory: 0, domesticInventory: 100, pendingOrderQty: 40 }), context);
    expect(result?.usReplenishmentGap).toBe(70);
    expect(result?.caReplenishmentGap).toBe(90);
    expect(result?.domesticTransferQty).toBe(100);
    expect(result?.usDomesticTransferQty).toBe(44);
    expect(result?.caDomesticTransferQty).toBe(56);
    expect(result?.pendingCoverageQty).toBe(40);
    expect(result?.usPendingCoverageQty).toBe(17);
    expect(result?.caPendingCoverageQty).toBe(23);
    expect(result?.urgentReplenishmentQty).toBe(20);
    expect(result?.usUrgentReplenishmentQty).toBe(9);
    expect(result?.caUrgentReplenishmentQty).toBe(11);
    expect(result?.domesticClearanceQty).toBe(0);
    expect(result?.pendingMitigationQty).toBe(0);
  });

  it("does not label a steady all-year seller as seasonal", () => { expect(analyzeSeasonalInventoryRow(row({ usSalesHistoryByMonth: history(50, 50), caSalesHistoryByMonth: history(50, 50) }), context)).toBeNull(); });

  it("adds products with a clear upcoming sales lift to replenishment attention", () => {
    const result = analyzeSeasonalInventoryRow(row({ usOverseasInventory: 20, caOverseasInventory: 0, domesticInventory: 0, pendingOrderQty: 0, usSalesHistoryByMonth: upcomingHistory(50, 10), caSalesHistoryByMonth: upcomingHistory(50, 10) }), context);
    expect(result?.isSummerSeasonal).toBe(false);
    expect(result?.upcomingPeak).toBe(true);
    expect(result?.upcomingPeakMonths).toEqual([8, 9, 10]);
    expect(result?.upcomingIndex).toBe(2.5);
    expect(result?.replenishmentHorizonEnd).toBe("2026-10-31");
    expect(result?.usReserveUnits).toBe(173);
    expect(result?.caReserveUnits).toBe(173);
    expect(result?.currentClearanceQty).toBe(0);
  });

  it("uses the median of recent matched months so one sales spike does not overstate seasonal demand", () => {
    const recent = [2024, 2025].flatMap((year) => Array.from({ length: 12 }, (_, index) => { const month = index + 1; return { month: `${year}-${String(month).padStart(2, "0")}`, units: month >= 5 && month <= 8 ? 50 : 10 }; })).concat([
      { month: "2026-04", units: 10 }, { month: "2026-05", units: 50 }, { month: "2026-06", units: 200 },
    ]);
    const result = analyzeSeasonalInventoryRow(row({ usSalesHistoryByMonth: recent, caSalesHistoryByMonth: recent }), context);
    expect(result?.paceEvidenceMonths).toBe(3);
    expect(result?.paceFactor).toBe(1);
    expect(result?.usReserveUnits).toBe(90);
  });

  it("matches the reference workbook stale-stock formula and excludes pending orders", () => {
    const result = analyzeSeasonalInventoryRow(row({ usOverseasInventory: 500, caOverseasInventory: 200, domesticInventory: 100, pendingOrderQty: 900 }), context);
    expect(result?.benchmarkAverageMonthlySales).toBe(54.29);
    expect(result?.benchmarkTotalInventory).toBe(800);
    expect(result?.benchmarkMonthsOfSupply).toBe(14.74);
    expect(result?.isTwelveMonthSlowMover).toBe(true);
    expect(result?.priority).toBe("clear_now");
  });

  it("treats positive inventory with zero recent sales as a twelve-month slow mover", () => {
    const zeroRecentSales = history(50, 10).map((point) => point.month >= "2025-07" ? { ...point, units: 0 } : point);
    const result = analyzeSeasonalInventoryRow(row({ usSalesHistoryByMonth: zeroRecentSales, caSalesHistoryByMonth: zeroRecentSales }), context);
    expect(result?.benchmarkAverageMonthlySales).toBe(0);
    expect(result?.benchmarkMonthsOfSupply).toBeNull();
    expect(result?.isTwelveMonthSlowMover).toBe(true);
  });

  it("recommends a clearance price above the conservative break-even point", () => {
    const result = analyzeSeasonalInventoryRow(row({
      usProfitability: {
        market: "US", currency: "USD", reportMonth: "2026-06", sku: "SUMMER-1", units: 100, returns: 0, netUnits: 100,
        productSales: 1000, settlementPayout: 600, landedCost: 200, grossProfit: 400, advertisingCost: 100, storageCost: 20,
        actualProfit: 300, currentPrice: 10, grossMargin: 0.4, actualMargin: 0.3, conservativeMargin: 0.28,
      },
    }), context);
    expect(result?.priority).toBe("clear_now");
    expect(result?.usPricing?.breakEvenPrice).toBe(6.2);
    expect(result?.usPricing?.suggestedPrice).toBe(8.49);
    expect(result?.usPricing?.adjustmentPercent).toBe(-15.1);
    expect(result?.usPricing?.projectedMargin).toBeCloseTo(0.2697, 4);
    expect(result?.usPricing?.projectedClearanceProfit).toBeCloseTo(480.9, 1);
    expect(result?.usPricing?.pauseAdvertising).toBe(true);
  });

  it("exports Excel-compatible replenishment and clearance CSV files from the same plan rows", () => {
    const candidate = analyzeSeasonalInventoryRow(row({ usOverseasInventory: 20, caOverseasInventory: 0, domesticInventory: 100, pendingOrderQty: 40 }), context);
    expect(candidate).not.toBeNull();
    const plan = {
      snapshots: { US: context.snapshotDate, CA: context.snapshotDate },
      snapshotDate: context.snapshotDate,
      latestSalesMonth: context.latestSalesMonth,
      seasonEndDate: "2026-08-31",
      clearanceCandidates: [candidate!],
      replenishmentCandidates: [candidate!],
      summary: {} as SeasonalInventoryPlanResult["summary"],
    } satisfies SeasonalInventoryPlanResult;
    const replenishment = buildSeasonalInventoryCsv(plan, "replenishment");
    const clearance = buildSeasonalInventoryCsv(plan, "clearance");
    expect(replenishment.content.startsWith("\ufeff\"")).toBe(true);
    expect(replenishment.content.split("\r\n")).toHaveLength(2);
    expect(replenishment.content).toContain('"紧急补货"');
    expect(replenishment.content).toContain('"扣减国内与未完工后需采购"');
    expect(replenishment.content).toContain('"US国内调拨分配"');
    expect(clearance.content.split("\r\n")).toHaveLength(2);
    expect(clearance.content).toContain('"原表合计库存"');
    expect(clearance.content).toContain('"US建议清货价"');
    expect(clearance.content).toContain('"SUMMER-1"');
  });

  it("exports separate US and CA clearance files using each site's action quantity", () => {
    const candidate = analyzeSeasonalInventoryRow(row(), context)!;
    const plan = {
      snapshots: { US: context.snapshotDate, CA: context.snapshotDate }, snapshotDate: context.snapshotDate, latestSalesMonth: context.latestSalesMonth, seasonEndDate: "2026-08-31",
      clearanceCandidates: [candidate], replenishmentCandidates: [candidate], summary: {} as SeasonalInventoryPlanResult["summary"],
    } satisfies SeasonalInventoryPlanResult;
    expect(buildSeasonalInventoryCsv(plan, "clearance", "US").filename).toContain("-US-");
    expect(buildSeasonalInventoryCsv(plan, "clearance", "US").content).toContain('"SUMMER-1"');
    expect(buildSeasonalInventoryCsv(plan, "clearance", "CA").content).toContain('"SUMMER-1"');
  });
});
