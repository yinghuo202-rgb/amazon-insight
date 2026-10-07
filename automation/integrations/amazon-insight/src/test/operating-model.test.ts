import { describe, expect, it } from "vitest";
import { buildOperatingModel, operatingFacts, snapshotAgeDays } from "@/lib/inventory/dashboard-view-model";
import { profitabilityRowSchema, type ProfitabilityData } from "@/lib/inventory/contracts";

function row(sku = "MA1", reportMonth = "2026-08", market: "US" | "CA" | "MX" = "US") {
  return profitabilityRowSchema.parse({ sku, reportMonth, market, currency: market === "CA" ? "CAD" : market === "MX" ? "MXN" : "USD", units: 10, returns: 1, netUnits: 9, productSales: 200, settlementPayout: 150, landedCost: 40, grossProfit: 110, advertisingCost: 30, storageCost: 5, actualProfit: 75, currentPrice: 22, grossMargin: .55, actualMargin: .375, conservativeMargin: .3 });
}
function report(rows: ProfitabilityData["rows"]): ProfitabilityData { return { schemaVersion: 1, generatedAt: "2026-09-01", method: "Excel", sources: [], rows }; }
describe("period-aligned operating cards", () => {
  it("keeps markets separate and exposes Mexico without inventing its inventory", () => {
    const model = buildOperatingModel([], report([row(), row("MA1", "2026-08", "MX")]));
    expect(model.markets).toEqual(["US", "MX"]);
    expect(model.rows).toHaveLength(2);
    expect(model.rows[1].currency).toBe("MXN");
    expect(model.rows[1].stock).toBeNull();
  });
  it("does not treat absent reports or ads attribution as zero", () => {
    const sku = buildOperatingModel([], report([row()])).rows[0];
    expect(operatingFacts(sku, "2026-07").current).toBeNull();
    const facts = operatingFacts(sku, "2026-08");
    expect(facts.advertisingShare).toBeNull();
    expect(facts.advertisingSpendShare).toBe(.15);
    expect(facts.averagePrice).toBe(20);
    expect(facts.returnRate).toBe(.1);
  });
  it("only compares adjacent months and preserves normalized GERPgo fields", () => {
    const current = { ...row(), advertisingSales: 100, averagePrice: 19, sourceKind: "gerpgo" as const };
    const sku = buildOperatingModel([], report([row("MA1", "2026-06"), current])).rows[0];
    expect(operatingFacts(sku, "2026-08").revenueChange).toBeNull();
    expect(operatingFacts(sku, "2026-08").advertisingShare).toBe(.5);
    expect(operatingFacts(sku, "2026-08").averagePrice).toBe(19);
    expect(buildOperatingModel([], report([current])).periods).toEqual(["2026-08"]);
  });
  it("recalculates snapshot age rather than trusting imported freshness", () => {
    expect(snapshotAgeDays("2026-08-29", new Date("2026-10-07T00:00:00Z"))).toBe(39);
    expect(snapshotAgeDays("invalid")).toBeNull();
  });
});
