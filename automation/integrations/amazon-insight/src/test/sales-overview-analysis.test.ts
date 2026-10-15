import { describe, expect, it } from "vitest";
import { buildOperatingModel, type OperatingModel } from "@/lib/inventory/dashboard-view-model";
import { profitabilityRowSchema, type ProfitabilityData } from "@/lib/inventory/contracts";
import { buildSalesOverviewAnalysis } from "@/lib/inventory/sales-overview-analysis";

const now = new Date("2026-10-15T00:00:00Z");
const end = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).toISOString().slice(0, 10);
function row(month: string, sku = "A", sales = 1000, units = 100, extra: Record<string, unknown> = {}) {
  return profitabilityRowSchema.parse({
    sku, market: "US", currency: "USD", reportMonth: month, units, returns: 0, netUnits: units,
    productSales: sales, settlementPayout: sales * .8, landedCost: 100, grossProfit: sales * .5,
    advertisingCost: 100, storageCost: 5, actualProfit: sales * .2, currentPrice: null, grossMargin: .5, actualMargin: .2, conservativeMargin: null,
    sourceKind: "gerpgo", quality: { profitVerified: true, returnsVerified: true, completePeriod: true, businessAsOf: end(month) }, ...extra,
  });
}
function model(rows: ProfitabilityData["rows"]): OperatingModel {
  return buildOperatingModel([], { schemaVersion: 1, generatedAt: now.toISOString(), method: "test", sources: [], rows }, undefined, [], now);
}
function analyze(rows: ProfitabilityData["rows"], period = "2026-09", market = "US") {
  return buildSalesOverviewAnalysis(model(rows), market, period, now);
}
function scope(month: string, cost: number, sales: number | null): OperatingModel["advertisingScopes"][number] {
  return { market: "US", currency: "USD", reportMonth: month, startDate: `${month}-01`, businessAsOf: end(month), dayCount: Number(end(month).slice(8)), recordCount: 30,
    cost, sales, clicks: null, impressions: null, orders: null, unmatchedRecords: 0 };
}

describe("overall historical sales analysis", () => {
  it("isolates markets and computes symmetric per-SKU quantity/realized-price effects, not an aggregate average-price effect", () => {
    const result = analyze([
      row("2026-08", "A", 1000, 100), row("2026-09", "A", 1440, 120),
      row("2026-08", "B", 1000, 50), row("2026-09", "B", 600, 40),
      row("2026-09", "CA-A", 8000, 400, { market: "CA", currency: "CAD" }),
    ]);
    expect(result.revenue).toBe(2040);
    expect(result.comparisons.month).toMatchObject({ current: 2040, previous: 2000, delta: 40, percent: 2 });
    // A: quantity +220, price +220. B: quantity -175, price -225.
    expect(result.decomposition).toEqual({ volume: 45, price: -5, otherMatched: 0, coverageDifference: 0, total: 40, matchedSkuCount: 2, decomposedSkuCount: 2 });
    expect(result.movers.gainers[0]).toMatchObject({ sku: "A", delta: 440 });
    expect(result.movers.decliners[0]).toMatchObject({ sku: "B", delta: -400 });
    expect(analyze([row("2026-09", "CA-A", 8000, 400, { market: "CA", currency: "CAD" })], "2026-09", "CA")).toMatchObject({ currency: "CAD", revenue: 8000 });
  });

  it("keeps one-sided records as record-range differences and reconciles other matched changes without assuming new or lost SKUs", () => {
    const result = analyze([
      row("2026-08", "A", 1000, 100), row("2026-09", "A", 1440, 120),
      row("2026-08", "ZERO", 100, 0), row("2026-09", "ZERO", 150, 10),
      row("2026-08", "OLD", 500), row("2026-09", "ONLY", 300),
    ]);
    expect(result.decomposition).toMatchObject({ volume: 220, price: 220, otherMatched: 50, coverageDifference: -200, total: 290, matchedSkuCount: 2, decomposedSkuCount: 1 });
    const d = result.decomposition!;
    expect(d.volume + d.price + d.otherMatched + d.coverageDifference).toBe(d.total);
    expect(result.basis).toMatchObject({ currentSkuCount: 3, previousSkuCount: 3, matchedSkuCount: 2, currentOnlySkuCount: 1, previousOnlySkuCount: 1 });
    expect(result.movers.gainers.map(item => item.sku)).toEqual(["A", "ZERO"]);
    expect(JSON.stringify(result.conclusions)).not.toMatch(/新增|流失/);
    expect(result.basis.notes.join(" ")).toContain("记录范围差异");
  });

  it("falls back from a current or future requested period, but never substitutes an explicitly selected incomplete historical month", () => {
    const points = [row("2026-08"), row("2026-09", "A", 1200, 100, { quality: { profitVerified: true, returnsVerified: true, completePeriod: false, businessAsOf: "2026-09-25" } }), row("2026-10")];
    expect(analyze(points, "2026-10")).toMatchObject({ requestedPeriod: "2026-10", period: "2026-08", fallback: true, status: "available" });
    expect(analyze(points, "2026-11")).toMatchObject({ period: "2026-08", fallback: true });
    const historical = analyze(points);
    expect(historical).toMatchObject({ period: "2026-09", fallback: false, status: "incomplete", revenue: 1200, decomposition: null, conclusions: [] });
    expect(historical.comparisons).toEqual({ month: null, quarter: null, year: null });
  });

  it("requires six consecutive complete months for the rolling three-month comparison and a complete same month one year ago", () => {
    const points = [row("2025-09", "A", 400), ...["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"].map((month, i) => row(month, "A", (i + 1) * 100))];
    const result = analyze(points);
    expect(result.comparisons.quarter).toEqual({ currentPeriod: "2026-07–2026-09", previousPeriod: "2026-04–2026-06", current: 1500, previous: 600, delta: 900, percent: 150 });
    expect(result.comparisons.year).toMatchObject({ previousPeriod: "2025-09", current: 600, previous: 400, delta: 200, percent: 50 });
    expect(analyze(points.filter(point => point.reportMonth !== "2026-05")).comparisons.quarter).toBeNull();
    expect(analyze(points.filter(point => point.reportMonth !== "2025-09")).comparisons.year).toBeNull();
    expect(analyze([row("2026-08"), row("2026-09")]).comparisons).toMatchObject({ quarter: null, year: null });
  });

  it("uses historical monthly summaries only where SKU details are absent and does not manufacture detail comparisons", () => {
    const data = model([row("2026-07", "A", 400), row("2026-08", "A", 500), row("2026-09", "A", 600)]);
    data.salesHistory = ["2026-04", "2026-05", "2026-06", "2026-07"].map((reportMonth, i) => ({ market: "US", currency: "USD", reportMonth, productSales: (i + 1) * 100,
      units: 100, businessAsOf: end(reportMonth), sourceKind: "excel-summary" as const }));
    // The current SKU report has precedence over an old aggregate for the same month.
    data.salesHistory[3].productSales = 9999;
    const result = buildSalesOverviewAnalysis(data, "US", "2026-09", now);
    expect(result.comparisons.quarter).toMatchObject({ current: 1500, previous: 600, delta: 900 });
    expect(result.basis.notes.join(" ")).toContain("历史月度销售汇总");
    const july = buildSalesOverviewAnalysis(data, "US", "2026-07", now);
    expect(july.comparisons.month).toMatchObject({ current: 400, previous: 300 });
    expect(july.decomposition).toBeNull();
    expect(july.movers).toEqual({ gainers: [], decliners: [] });
    const june = buildSalesOverviewAnalysis(data, "US", "2026-06", now);
    expect(june).toMatchObject({ revenue: 300, skuCount: 0, topFive: null, profit: null });
    expect(june.conclusions[0]).not.toContain("0 个 SKU");
    data.rows[0].history.push(row("2026-07", "A", 400));
    expect(buildSalesOverviewAnalysis(data, "US", "2026-07", now).revenue).toBeNull();
  });

  it("invalidates comparisons for duplicate SKU months, mixed currency or mismatched SKU identity instead of summing an apparently valid subset", () => {
    const duplicate = analyze([row("2026-08"), row("2026-09"), row("2026-09")]);
    expect(duplicate).toMatchObject({ revenue: null, status: "incomplete", decomposition: null });
    const mixed = analyze([row("2026-08"), row("2026-09"), row("2026-09", "B", 900, 100, { currency: "CAD" })]);
    expect(mixed.revenue).toBeNull();
    expect(mixed.comparisons.month).toBeNull();
    const bad = model([row("2026-08"), row("2026-09")]);
    bad.rows[0].history[1].sku = "UNMAPPED";
    expect(buildSalesOverviewAnalysis(bad, "US", "2026-09", now).revenue).toBeNull();
  });

  it("requires true month-end dates when provided, permits legacy Excel period inference, and records source changes", () => {
    const incomplete = row("2026-09", "A", 1000, 100, { quality: { profitVerified: true, returnsVerified: true, completePeriod: true, businessAsOf: "2026-09-29" } });
    expect(analyze([row("2026-08"), incomplete]).status).toBe("incomplete");
    const legacy = row("2026-08", "A", 1000, 100, { sourceKind: "excel", quality: undefined });
    const result = analyze([legacy, row("2026-09")]);
    expect(result.comparisons.month?.delta).toBe(0);
    expect(result.basis.notes.join(" ")).toMatch(/旧版 Excel.*来源有变化/);
    expect(result.profit?.previous).toBeNull();
    expect(analyze([row("2026-08"), row("2026-09", "A", 1000, 100, { quality: undefined })]).status).toBe("incomplete");
  });

  it("computes same-period advertising spend share and ACOS independently without a universal ACOS judgment", () => {
    const data = model([row("2026-08", "A", 1000), row("2026-09", "A", 2000)]);
    data.advertisingScopes.push(scope("2026-08", 100, 400), scope("2026-09", 300, 500));
    const result = buildSalesOverviewAnalysis(data, "US", "2026-09", now);
    expect(result.advertising).toMatchObject({ currentCost: 300, previousCost: 100, costDelta: 200, spendShare: .15, previousSpendShare: .1, acos: .6, previousAcos: .25 });
    expect(result.advertising?.spendSharePointChange).toBeCloseTo(5);
    expect(result.advertising?.acosPointChange).toBeCloseTo(35);
    expect(result.conclusions.join(" ")).not.toMatch(/广告导致|ACOS.*过高|自然销售/);
  });

  it("does not fill missing advertising values or borrow a different month, and rejects partial daily coverage or duplicate scopes", () => {
    for (const invalid of [
      { ...scope("2026-09", 100, 500), dayCount: 29 },
      { ...scope("2026-09", 100, 500), businessAsOf: "2026-09-29" },
      { ...scope("2026-09", 100, 500), currency: "CAD" as const },
      { ...scope("2026-09", 100, 500), cost: null },
      scope("2026-08", 100, 500),
    ]) {
      const data = model([row("2026-08"), row("2026-09")]);
      data.advertisingScopes.push(invalid);
      expect(buildSalesOverviewAnalysis(data, "US", "2026-09", now).advertising).toBeNull();
    }
    const data = model([row("2026-08"), row("2026-09")]);
    data.advertisingScopes.push(scope("2026-09", 100, 500), scope("2026-09", 100, 500));
    expect(buildSalesOverviewAnalysis(data, "US", "2026-09", now).advertising).toBeNull();
  });

  it("keeps zero baselines and zero ad attribution valid while leaving undefined percentage changes null", () => {
    const data = model([row("2026-08", "A", 0), row("2026-09", "A", 500)]);
    data.advertisingScopes.push(scope("2026-09", 0, 0));
    const result = buildSalesOverviewAnalysis(data, "US", "2026-09", now);
    expect(result.comparisons.month).toMatchObject({ delta: 500, percent: null });
    expect(result.advertising).toMatchObject({ currentCost: 0, spendShare: 0, acos: null, previousCost: null });
    expect(result.conclusions.join(" ")).not.toMatch(/Infinity|NaN/);
  });

  it("aggregates profit only when every reported SKU is verified and calculates margin from summed profit and sales", () => {
    const points = [row("2026-08", "A", 1000, 100, { actualProfit: 100 }), row("2026-09", "A", 2000, 100, { actualProfit: 50 }), row("2026-09", "B", 1000, 100, { actualProfit: -100 })];
    const result = analyze(points);
    expect(result.profit).toMatchObject({ current: -50, previous: 100, delta: -150, margin: -50 / 3000, previousMargin: .1 });
    const unverified = points.map(point => point.sku === "B" ? { ...point, quality: { ...point.quality!, profitVerified: false } } : point);
    expect(analyze(unverified).profit).toBeNull();
  });

  it("computes the five largest reported SKU concentration and limits signed mover lists to three comparable SKUs", () => {
    const points = Array.from({ length: 8 }, (_, i) => [row("2026-08", `SKU${i}`, 100), row("2026-09", `SKU${i}`, (i + 1) * 25)]).flat();
    const result = analyze(points);
    expect(result.topFive).toMatchObject({ revenue: 750, share: 750 / 900, skuCount: 5, previousShare: 5 / 8 });
    expect(result.movers.gainers.map(item => item.sku)).toEqual(["SKU7", "SKU6", "SKU5"]);
    expect(result.movers.decliners.map(item => item.sku)).toEqual(["SKU0", "SKU1", "SKU2"]);
  });

  it("handles missing periods, invalid markets and negative reported revenue without inventing totals or hiding signs", () => {
    expect(analyze([], "2026-10")).toMatchObject({ period: null, fallback: true, revenue: null, status: "unavailable" });
    expect(analyze([row("2026-09")], "2026-09", "MX")).toMatchObject({ revenue: null, status: "unavailable" });
    expect(analyze([row("2026-09")], "not-a-month").revenue).toBeNull();
    const negative = analyze([row("2026-09", "A", -100)]);
    expect(negative.topFive).toBeNull();
    expect(negative.conclusions[0]).toContain("USD -100");
    const invalidAmount = model([row("2026-09")]);
    invalidAmount.rows[0].history[0].productSales = Number.NaN;
    expect(buildSalesOverviewAnalysis(invalidAmount, "US", "2026-09", now).revenue).toBeNull();
  });
});
