import { expect, it } from "vitest";
import { buildOperatingModel } from "@/lib/inventory/dashboard-view-model";
import { profitabilityRowSchema } from "@/lib/inventory/contracts";
import { queryOperatingModel } from "@/lib/inventory/operating-query";

const now = new Date("2026-10-12T00:00:00Z");
function focusModel(count = 1) {
  const rows = Array.from({ length: count }, (_, index) => profitabilityRowSchema.parse({ sku: `SKU-${index}`, market: "US", currency: "USD", reportMonth: "2026-09", units: 100, returns: 0, netUnits: 100, productSales: 1000, settlementPayout: 400, landedCost: 500, grossProfit: -100, advertisingCost: 0, storageCost: 10, actualProfit: -100, currentPrice: 10, grossMargin: -.1, actualMargin: -.1, conservativeMargin: -.1, quality: { profitVerified: true, returnsVerified: true, completePeriod: true } }));
  return buildOperatingModel([], { schemaVersion: 1, generatedAt: now.toISOString(), method: "fixture", sources: [], rows: [...rows, { ...rows[0], reportMonth: "2026-10", productSales: 250, actualProfit: 100, actualMargin: .4, quality: { profitVerified: false, returnsVerified: false, completePeriod: false } }] }, undefined, [], now);
}

it("keeps October MTD metrics while September alerts carry their actual evidence month", () => {
  const page = queryOperatingModel(focusModel(), { period: "2026-10" }, now);
  expect(page.period).toBe("2026-10");
  expect(page.summary.revenue).toBe(250);
  expect(page.summary.complete).toBe(false);
  expect(page.focusPeriod).toBe("2026-09");
  expect(page.priorities).toHaveLength(1);
  expect(page.priorities[0]).toMatchObject({ sku: "SKU-0", period: "2026-09", operatingPeriod: "2026-09", title: "利润为负" });
});

it("loads latest complete-month focus cards in stable twenty-card batches without changing the selected month", () => {
  const data = focusModel(45);
  const first = queryOperatingModel(data, { period: "2026-10", brief: true }, now);
  const second = queryOperatingModel(data, { period: "2026-10", brief: true, offset: 20 }, now);
  expect(first.model.rows).toHaveLength(20);
  expect(first.model.rows[0].analysisPeriod).toBe("2026-09");
  expect(first.model.rows[0].analysis.current?.reportMonth).toBe("2026-09");
  expect(first.nextOffset).toBe(20);
  expect(first.total).toBe(45);
  expect(new Set([...first.model.rows, ...second.model.rows].map(row => row.sku)).size).toBe(40);
  expect(first.priorities).toHaveLength(3);
});

it("keeps search and selected historical reports independent from the focus fallback", () => {
  const data = focusModel();
  const searched = queryOperatingModel(data, { period: "2026-10", query: "SKU-0" }, now);
  expect(searched.model.rows[0].analysis.current?.reportMonth).toBe("2026-10");
  const history = queryOperatingModel(data, { period: "2026-08", brief: true, filter: "all" }, now);
  expect(history.summary.revenue).toBeNull();
  expect(history.priorities).toEqual([]);
});

it("does not promote unverified, incomplete or foreign-currency facts into operating alerts", () => {
  const data = focusModel(3);
  data.rows[0].history[0].quality!.profitVerified = false;
  data.rows[1].history[0].units = 1;
  data.rows[2].history[0].currency = "CAD";
  expect(queryOperatingModel(data, { period: "2026-10" }, now).priorities).toEqual([]);
  data.rows.forEach(row => { row.history[0].quality!.completePeriod = false; });
  expect(queryOperatingModel(data, { period: "2026-10" }, now).focusPeriod).toBeNull();
});

it("retains fresh stock alerts when no complete operating report exists and labels their snapshot", () => {
  const data = focusModel();
  data.rows[0].history = [];
  data.rows[0].inventoryDate = "2026-10-12";
  data.rows[0].stock = { fba: 2, awd: 0, awdTransfer: 0, transit: 0, domestic: 0, orders: 0, dailySales: 1, cover: 2, target: 90, supplyConfirmed: true };
  const page = queryOperatingModel(data, { period: "2026-10", brief: true }, now);
  expect(page.focusPeriod).toBeNull();
  expect(page.priorities[0]).toMatchObject({ title: "当前供货风险", operatingPeriod: null, inventoryDate: "2026-10-12", impact: null });
  expect(page.total).toBe(1);
});

it("distinguishes the old operating month from current inventory on a merged attention card", () => {
  const data = focusModel();
  data.rows[0].inventoryDate = "2026-10-11";
  data.rows[0].stock = { fba: 2, awd: 0, awdTransfer: 0, transit: 0, domestic: 0, orders: 0, dailySales: 1, cover: 2, target: 90, supplyConfirmed: true };
  expect(queryOperatingModel(data, { period: "2026-10" }, now).priorities[0]).toMatchObject({ operatingPeriod: "2026-09", inventoryDate: "2026-10-11", stockFresh: true, fact: "利润为负 · 当前供货风险 · 供应覆盖不足" });
});

it("limits visible site choices to US and CA without removing Mexico history", () => {
  const data = focusModel();
  data.markets.push("MX");
  data.rows.push({ ...data.rows[0], market: "MX", currency: "MXN", listingId: "MX-SKU", history: [{ ...data.rows[0].history[0], market: "MX", currency: "MXN" }] });
  const page = queryOperatingModel(data, {}, now);
  expect(page.model.markets).toEqual(["US"]);
  expect(data.rows.find(row => row.market === "MX")?.history).toHaveLength(1);
});

it("marks complete-month and MTD chart points with the source cutoff without expanding the chart payload", () => {
  const data = focusModel();
  data.rows[0].history[0].quality!.businessAsOf = "2026-09-30";
  data.rows[0].history[1].quality!.businessAsOf = "2026-10-12";
  const chart = queryOperatingModel(data, { period: "2026-10" }, now).chart;
  expect(chart[0]).toMatchObject({ month: "2026-09", complete: true, mtd: false, asOf: "2026-09-30" });
  expect(chart[1]).toMatchObject({ month: "2026-10", complete: false, mtd: true, asOf: "2026-10-12" });
  expect(Object.keys(chart[1]).sort()).toEqual(["asOf", "complete", "month", "mtd", "profit", "revenue"]);
});

it("honors selected margin and impact sorting inside the revenue-contribution filter", () => {
  const data = focusModel(3);
  [[1000, 200], [500, 25], [1500, 900]].forEach(([sales, profit], index) => {
    Object.assign(data.rows[index].history[0], { productSales: sales, actualProfit: profit, actualMargin: profit / sales });
  });
  const query = (sort: string) => queryOperatingModel(data, { period: "2026-09", brief: true, filter: "revenue", sort }, now).model.rows.map(row => row.sku);
  expect(query("revenue")).toEqual(["SKU-2", "SKU-0", "SKU-1"]);
  expect(query("margin")).toEqual(["SKU-1", "SKU-0", "SKU-2"]);
  expect(query("impact")[0]).toBe("SKU-1");
});

it("keeps only same-period positive same-currency sales in contribution while all retains missing, zero and negative records", () => {
  const data = focusModel(6);
  data.rows[0].history = data.rows[0].history.filter(point => point.reportMonth !== "2026-09");
  data.rows[1].history[0].productSales = 0;
  data.rows[2].history[0].productSales = -20;
  data.rows[3].history[0].currency = "CAD";
  data.rows[5].history[0].productSales = 2000;
  const contribution = queryOperatingModel(data, { period: "2026-09", brief: true, filter: "revenue", sort: "revenue" }, now);
  expect(contribution.model.rows.map(row => row.sku)).toEqual(["SKU-5", "SKU-4"]);
  expect(contribution.total).toBe(2);
  expect(contribution.counts.revenue).toBe(2);
  expect(queryOperatingModel(data, { period: "2026-09", brief: true, filter: "all" }, now).total).toBe(6);
  expect(queryOperatingModel(data, { period: "2026-09", brief: true, filter: "revenue", query: "SKU-0" }, now).total).toBe(0);
  expect(queryOperatingModel(data, { period: "2026-09", brief: true, filter: "all", query: "SKU-0" }, now).total).toBe(1);
});
