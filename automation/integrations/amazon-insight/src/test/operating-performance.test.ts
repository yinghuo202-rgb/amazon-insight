import { expect, it } from "vitest";
import { buildOperatingModel, operatingFacts } from "@/lib/inventory/dashboard-view-model";
import { queryOperatingModel } from "@/lib/inventory/operating-query";
import { operatingPerformanceSchema } from "@/lib/inventory/operating-performance";
import { profitabilityDataSchema } from "@/lib/inventory/contracts";
const now = new Date("2026-10-08T00:00:00Z");
const input = {
  schemaVersion: 1, sourceTaskId: "d8a4f702-f57b-4aa1-8300-9bfcb005e001", generatedAt: now.toISOString(),
  scopes: [{ market: "US", reportMonth: "2026-09" }],
  rows: [{ market: "US", currency: "USD", reportMonth: "2026-09", sku: "SKU-A", productName: "API product", units: 40, returns: null, productSales: 100,
    actualProfit: null, grossProfit: null, advertisingCost: null, advertisingSales: null, storageCost: null, currentPrice: null, averagePrice: 2.5,
    actualMargin: null, sourceKind: "gerpgo", quality: { profitVerified: false, returnsVerified: false, completePeriod: true } }],
  publication: { version: "data-20261008-000000-test", actor: "shared-account", baseline: "test", previewHash: "test", reviewedAt: now.toISOString() },
};
it("accepts scheduled publication without falling back to stale Excel", () => {
  const data = operatingPerformanceSchema.parse({ ...input, publication: { ...input.publication, actor: "scheduled-worker" } });
  const model = buildOperatingModel([], undefined, undefined, [], now, data);
  expect(queryOperatingModel(model, {}, now).summary.revenue).toBe(100);
  expect(model.publishedVersion).toBe(input.publication.version);
  expect(model.rows[0].history[0].sourceKind).toBe("gerpgo");
});
it("keeps optional API facts null through query summaries and cards", () => {
  const data = operatingPerformanceSchema.parse(input);
  const model = buildOperatingModel([], undefined, undefined, [], now, data);
  const page = queryOperatingModel(model, { brief: true }, now);
  expect(page.summary.revenue).toBe(100);
  expect(page.summary.profit).toBeNull();
  expect(page.summary.returns).toBeNull();
  expect(page.chart[0].profit).toBeNull();
  const facts = operatingFacts(model.rows[0], "2026-09", undefined, now);
  expect(facts.returnRate).toBeNull();
  expect(facts.advertisingSpendShare).toBeNull();
  expect(facts.issues).toEqual([]);
  expect(facts.dataIssues).toContain("仓储费用未提供");
  expect(model.rows[0].productName).toBe("API product");
  expect(model.rows[0].unitHistory).toEqual([{ month: "2026-09", units: 40 }]);
});
it("replaces whole approved scopes and preserves legacy months without resurrecting removed SKUs", () => {
  const base = { market: "US", currency: "USD", sku: "SKU-OLD", units: 100, returns: 2, netUnits: 98, productSales: 500, settlementPayout: 300, landedCost: 10, grossProfit: 200, actualProfit: 100, advertisingCost: 10, storageCost: 10, currentPrice: null, grossMargin: .4, actualMargin: .2, conservativeMargin: .1 };
  const legacy = profitabilityDataSchema.parse({ schemaVersion: 1, generatedAt: now.toISOString(), method: "test", sources: [], rows: [{ ...base, reportMonth: "2026-08" }, { ...base, reportMonth: "2026-09" }] });
  const model = buildOperatingModel([], legacy, undefined, [], now, operatingPerformanceSchema.parse(input));
  expect(model.rows.find(row => row.sku === "SKU-OLD")!.history.map(point => point.reportMonth)).toEqual(["2026-08"]);
  expect(queryOperatingModel(model, { period: "2026-09" }, now).summary.revenue).toBe(100);
});
it("does not report partial fee sums as a whole-market profit", () => {
  const report = operatingPerformanceSchema.parse(input);
  report.rows.push({ ...report.rows[0], sku: "SKU-B", actualProfit: -50 });
  const page = queryOperatingModel(buildOperatingModel([], undefined, undefined, [], now, report), {}, now);
  expect(page.summary.profit).toBeNull();
  expect(page.summary.revenue).toBe(200);
});
it("keeps legacy AU reports readable but excludes their rows and periods from operations", () => {
  const data = operatingPerformanceSchema.parse({ ...input, storeScope: { storeName: "MEASUREMAN", serverId: 1, marketIds: [1, 2, 3, 17] }, scopes: [{ market: "AU", reportMonth: "2026-09" }, { market: "MX", reportMonth: "2026-09" }], rows: [{ ...input.rows[0], market: "AU", currency: "AUD" }] });
  const model = buildOperatingModel([], undefined, undefined, [], now, data);
  expect(model.storeName).toBe("MEASUREMAN");
  expect(model.markets).not.toContain("AU");
  expect(model.markets).toContain("MX");
  expect(model.rows).toEqual([]);
  expect(model.periods).toEqual([]);
  expect(() => queryOperatingModel(model, { market: "AU" }, now)).toThrow("筛选参数");
});
