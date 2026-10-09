import { describe, expect, it } from "vitest";
import { buildOperatingModel, operatingFacts } from "@/lib/inventory/dashboard-view-model";
import { profitabilityRowSchema, type ProfitabilityData } from "@/lib/inventory/contracts";
import { defaultOperatingRules, resolveOperatingRules } from "@/lib/inventory/operating-rules";
import { queryOperatingModel } from "@/lib/inventory/operating-query";

const now = new Date("2026-10-08T00:00:00Z");
function model(count = 1) {
  const rows = Array.from({ length: count }, (_, index) => profitabilityRowSchema.parse({ market: "US", currency: "USD", sku: `MA${index}`, reportMonth: "2026-09", units: 100, returns: 4, netUnits: 96, productSales: 1000, settlementPayout: 700, landedCost: 200, grossProfit: 500, advertisingCost: 210, storageCost: 10, actualProfit: 90, currentPrice: null, grossMargin: .5, actualMargin: .09, conservativeMargin: .08, quality: { profitVerified: true, returnsVerified: true, completePeriod: true } }));
  return buildOperatingModel([], { schemaVersion: 1, generatedAt: now.toISOString(), method: "test", sources: [], rows } as ProfitabilityData, undefined, [], now);
}
describe("operating thresholds", () => {
  it("uses explicit defaults and field-level SKU overrides", () => {
    const rules = resolveOperatingRules("US", "MA1", [{ market: "US", sku: "", values: { adSpendMaxPercent: 25, returnRateMaxPercent: 4 } }, { market: "US", sku: "MA1", values: { adSpendMaxPercent: 30 } }]);
    expect(rules.adSpendMaxPercent).toBe(30);
    expect(rules.returnRateMaxPercent).toBe(4);
    expect(rules.supplyCoverDays).toBe(90);
  });
  it("requires verified facts and samples; does not use calculator defaults", () => {
    const row = model().rows[0];
    expect(operatingFacts(row, "2026-09", defaultOperatingRules, now).issues).toEqual(["利润待核查", "广告待核查", "退货待核查"]);
    row.history[0].units = 10;
    expect(operatingFacts(row, "2026-09", defaultOperatingRules, now).issues).toEqual([]);
    row.history[0].units = 100;
    row.history[0].quality!.profitVerified = false;
    row.history[0].quality!.returnsVerified = false;
    const facts = operatingFacts(row, "2026-09", defaultOperatingRules, now);
    expect(facts.issues).not.toContain("利润待核查");
    expect(facts.issues).not.toContain("退货待核查");
    expect(facts.dataIssues).toContain("利润费用待对账");
  });
  it("does not count domestic stock, orders or unverified transit as overseas supply", () => {
    const row = model().rows[0];
    row.inventoryDate = "2026-10-08"; row.awdDate = "2026-10-08";
    row.stock = { fba: 10, awd: 5, awdTransfer: 20, transit: 40, domestic: 10000, orders: 10000, dailySales: 1, cover: null, target: 90, supplyConfirmed: false };
    const unknown = operatingFacts(row, "2026-09", defaultOperatingRules, now);
    expect(unknown.supplyFresh).toBe(false);
    expect(unknown.issues).not.toContain("供应覆盖不足");
    expect(unknown.issues).toContain("当前供货风险");
    row.stock.supplyConfirmed = true; row.stock.cover = 55;
    expect(operatingFacts(row, "2026-09", defaultOperatingRules, now).issues).toContain("供应覆盖不足");
    row.inventoryDate = "2026-10-09";
    expect(operatingFacts(row, "2026-09", defaultOperatingRules, now).stockFresh).toBe(false);
  });
  it("does not alert on current months or exact threshold boundaries", () => {
    const row = model().rows[0];
    row.history[0].actualMargin = .1;
    row.history[0].advertisingCost = 200;
    row.history[0].returns = 3;
    expect(operatingFacts(row, "2026-09", defaultOperatingRules, now).issues).toEqual([]);
    expect(operatingFacts(row, "2026-09", defaultOperatingRules, new Date("2026-09-20")).issues).toEqual([]);
  });
  it("does not compare different SKU populations or connect missing months", () => {
    const data = model(2);
    data.rows[0].history.unshift({ ...data.rows[0].history[0], reportMonth: "2026-07" });
    data.periods = ["2026-09", "2026-07"];
    const result = queryOperatingModel(data, {}, now);
    expect(result.chart.map(point => point.month)).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(result.chart[1].revenue).toBeNull();
    expect(result.summary.delta).toBeNull();
    data.rows[0].history.unshift({ ...data.rows[0].history[0], reportMonth: "2026-08" });
    expect(queryOperatingModel(data, {}, now).summary.delta).toBeNull();
  });
  it("pauses alerts rather than silently using defaults when settings are unavailable", () => {
    const data = model();
    data.rulesAvailable = false;
    expect(operatingFacts(data.rows[0], "2026-09", defaultOperatingRules, now, false).issues).toEqual([]);
    expect(queryOperatingModel(data, { brief: true, filter: "advertising" }, now).total).toBe(0);
  });
  it("filters actual issues and serves only a stable twenty-row batch", () => {
    const data = model(45);
    expect(queryOperatingModel(data, {}, now).model.rows).toHaveLength(0);
    const first = queryOperatingModel(data, { brief: true }, now);
    expect(first.model.rows).toHaveLength(20);
    expect(first.nextOffset).toBe(20);
    const second = queryOperatingModel(data, { brief: true, offset: 20 }, now);
    expect(new Set([...first.model.rows, ...second.model.rows].map(row => row.sku)).size).toBe(40);
    expect(queryOperatingModel(data, { brief: true, filter: "loss" }, now).total).toBe(45);
    expect(queryOperatingModel(data, { query: "MA1" }, now).model.rows.length).toBeLessThanOrEqual(3);
  });
});
