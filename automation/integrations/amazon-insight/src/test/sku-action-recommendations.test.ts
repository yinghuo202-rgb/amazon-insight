import { describe, expect, it } from "vitest";
import { buildOperatingModel, operatingFacts } from "@/lib/inventory/dashboard-view-model";
import { profitabilityRowSchema, type ProfitabilityData } from "@/lib/inventory/contracts";
import { defaultOperatingRules } from "@/lib/inventory/operating-rules";
import { buildSkuActionRecommendations } from "@/lib/inventory/sku-action-recommendations";

const now = new Date("2026-10-15T00:00:00Z");
const period = "2026-09";

function profitRow(month: string, overrides: Record<string, unknown> = {}) {
  return profitabilityRowSchema.parse({
    market: "US", currency: "USD", reportMonth: month, sku: "SKU-1", units: 100, returns: 2, netUnits: 98,
    productSales: month === period ? 900 : 1000, settlementPayout: 700, landedCost: 300, grossProfit: 400,
    advertisingCost: 0, storageCost: 10, actualProfit: month === period ? 45 : 200,
    currentPrice: null, averagePrice: null, sourceKind: "gerpgo",
    quality: { profitVerified: true, returnsVerified: true, completePeriod: true, businessAsOf: month === period ? "2026-09-30" : "2026-08-31" },
    grossMargin: .4, actualMargin: month === period ? .05 : .2, conservativeMargin: null,
    ...overrides,
  });
}

function fixture(currentOverrides: Record<string, unknown> = {}) {
  const report: ProfitabilityData = { schemaVersion: 1, generatedAt: now.toISOString(), method: "fixture", sources: [],
    rows: [profitRow("2026-08"), profitRow(period, currentOverrides)] };
  const row = buildOperatingModel([], report, undefined, [], now).rows[0];
  return row;
}

function adRow(overrides: Record<string, unknown> = {}) {
  return {
    market: "US" as const, currency: "USD" as const, reportMonth: period, startDate: "2026-09-01", businessAsOf: "2026-09-30",
    recordCount: 30, sku: "SKU-1", productName: "Product", cost: 250, sales: 400, clicks: 100, impressions: 1000, orders: 5,
    asins: [], mskus: [], ...overrides,
  };
}

function recommendations(row: ReturnType<typeof fixture>) {
  return buildSkuActionRecommendations(row, period, operatingFacts(row, period, defaultOperatingRules, now), defaultOperatingRules);
}

describe("SKU price and advertising recommendations", () => {
  it("suggests a price test from verified comparable realized-price, unit and margin evidence without inventing a listing price", () => {
    const result = recommendations(fixture());
    expect(result.availability.price).toEqual({ available: true, reason: null });
    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0]).toMatchObject({ kind: "price", action: "test_price_increase", evidence: [
      { label: "历史成交均价变化", unit: "percent", period: "2026-08→2026-09" },
      { label: "销量变化", value: 0, unit: "percent", period: "2026-08→2026-09" },
      { label: "已核验实际利润率", value: 5, unit: "percent", period: "2026-09" },
    ] });
    expect(result.recommendations[0].evidence[0].value).toBeCloseTo(-10);
    expect(result.recommendations[0].suggestion).toContain("不将历史成交均价当作挂牌价");
    expect(result.recommendations[0]).not.toHaveProperty("scenario");
  });

  it("requires complete, verified, same-currency data and enough units for price advice", () => {
    const cases = [
      fixture({ quality: { profitVerified: false, returnsVerified: true, completePeriod: true, businessAsOf: "2026-09-30" } }),
      fixture({ quality: { profitVerified: true, returnsVerified: true, completePeriod: false, businessAsOf: "2026-09-30" } }),
      fixture({ currency: "CAD" }),
      fixture({ units: 20, productSales: 180 }),
    ];
    for (const row of cases) {
      const result = recommendations(row);
      expect(result.availability.price.available).toBe(false);
      expect(result.recommendations.find(item => item.kind === "price")).toBeUndefined();
    }
    const missingPrevious = fixture();
    missingPrevious.history.shift();
    expect(recommendations(missingPrevious).recommendations[0]).toMatchObject({ kind: "price", action: "review_price_and_cost" });
    const otherSku = fixture();
    otherSku.history[1].sku = "SKU-OTHER";
    expect(recommendations(otherSku).availability.price.available).toBe(false);
  });

  it("uses only the same complete SKU advertising month and verified profit to suggest an ad-spend review", () => {
    const row = fixture();
    row.advertisingHistory.push(adRow());
    const result = recommendations(row);
    expect(result.availability.advertising).toEqual({ available: true, reason: null });
    expect(result.recommendations.map(item => item.kind)).toEqual(["price", "advertising"]);
    expect(result.recommendations[1]).toMatchObject({ action: "review_ad_spend", evidence: [
      { label: "SKU 广告花费", value: 250, unit: "currency", currency: "USD", period, source: "积加 SKU 广告汇总" },
      { label: "广告花费 / 商品销售额", unit: "percent", period },
      { label: "已核验实际利润率", value: 5, unit: "percent", period },
    ] });
    expect(result.recommendations[1].evidence[1].value).toBeCloseTo(250 / 900 * 100);
    expect(result.recommendations[1].suggestion).toContain("不给出竞价改幅");
  });

  it("does not reuse stale, partial, mixed-currency or missing advertising values", () => {
    const invalid = [
      adRow({ reportMonth: "2026-08", startDate: "2026-08-01", businessAsOf: "2026-08-31" }),
      adRow({ businessAsOf: "2026-09-15" }),
      adRow({ currency: "CAD" }),
      adRow({ cost: null }),
      adRow({ sales: null }),
    ];
    for (const ad of invalid) {
      const row = fixture();
      row.advertisingHistory.push(ad);
      const result = recommendations(row);
      expect(result.availability.advertising.available).toBe(false);
      expect(result.recommendations.find(item => item.kind === "advertising")).toBeUndefined();
    }
  });

  it("keeps valid zero advertising spend as data, not as a missing value or an alert", () => {
    const row = fixture();
    row.advertisingHistory.push(adRow({ cost: 0, sales: 0 }));
    const result = recommendations(row);
    expect(result.availability.advertising.available).toBe(true);
    expect(result.recommendations.find(item => item.kind === "advertising")).toBeUndefined();
  });

  it("falls back to a verified price/cost review without claiming a price drop caused weak profit", () => {
    const increasedUnits = fixture({ units: 120, productSales: 1080, actualProfit: 54 });
    const result = recommendations(increasedUnits);
    expect(result.recommendations[0]).toMatchObject({ kind: "price", action: "review_price_and_cost", evidence: [
      { label: "已核验实际利润率", value: 5 },
      { label: "本期成交均价", value: 9 },
      { label: "单件实际利润", value: .45 },
    ] });
    expect(result.recommendations[0].suggestion).toContain("仅凭成交均价不能确定");
    const healthy = fixture({ actualProfit: 180, actualMargin: .2 });
    expect(recommendations(healthy).recommendations.find(item => item.kind === "price")).toBeUndefined();
  });
});
