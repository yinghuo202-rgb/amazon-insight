// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { buildOperatingModel } from "@/lib/inventory/dashboard-view-model";
import { profitabilityRowSchema, type InventoryDashboardData } from "@/lib/inventory/contracts";
import { queryOperatingModel } from "@/lib/inventory/operating-query";
import { SalesOverviewAnalysisPanel } from "@/components/inventory/sales-overview-analysis-panel";

const now = new Date("2026-10-15T00:00:00Z");
afterEach(cleanup);
function fixture() {
  const inventory = {
    market: "US", currency: "USD", rows: [], parameters: {},
    snapshots: { fbaDate: "2026-10-14", awdDate: "", awdSourceAvailable: false, staleAfterDays: 7 },
    businessPerformance: { actualYear: 2026, series: [
      { month: "01", actualUnits: 10, actualRevenue: 100 },
      { month: "08", actualUnits: 20, actualRevenue: 8000 },
      { month: "09", actualUnits: 0, actualRevenue: 0 },
      { month: "10", actualUnits: 10, actualRevenue: 500 },
      { month: "12", actualUnits: 0, actualRevenue: 0 },
    ] },
  } as unknown as InventoryDashboardData;
  const point = profitabilityRowSchema.parse({ sku: "A", market: "US", currency: "USD", reportMonth: "2026-08", units: 100, returns: 0, netUnits: 100,
    productSales: 1000, settlementPayout: 700, landedCost: 400, grossProfit: 300, advertisingCost: 50, storageCost: 5,
    actualProfit: 200, currentPrice: 10, grossMargin: .3, actualMargin: .2, conservativeMargin: .15,
    quality: { profitVerified: true, returnsVerified: true, completePeriod: true } });
  return buildOperatingModel([inventory], { schemaVersion: 1, generatedAt: now.toISOString(), method: "fixture", sources: [], rows: [point, { ...point, reportMonth: "2026-09", productSales: 1200 }] }, undefined, [], now);
}
it("includes real closed-month sales totals, omits workbook placeholders, and keeps SKU data authoritative", () => {
  const model = fixture();
  expect(model.salesHistory.map(point => point.reportMonth)).toEqual(["2026-01", "2026-08"]);
  expect(model.periods).toEqual(["2026-09", "2026-08"]);
  const page = queryOperatingModel(model, { period: "2026-09" }, now);
  expect(page.chart.find(point => point.month === "2026-01")).toMatchObject({ revenue: 100, profit: null, complete: true, asOf: "2026-01-31" });
  expect(page.chart.find(point => point.month === "2026-02")?.revenue).toBeNull();
  expect(page.chart.find(point => point.month === "2026-08")?.revenue).toBe(1000);
  expect(page.salesAnalysis?.comparisons.month).toMatchObject({ current: 1200, previous: 1000, delta: 200 });
  expect(queryOperatingModel(model, { period: "2026-09", brief: true }, now).salesAnalysis).toBeNull();
});
it("does not hide mixed-currency SKU records behind a historical site total", () => {
  const model = fixture();
  model.rows[0].history[0].currency = "CAD";
  const page = queryOperatingModel(model, { period: "2026-09" }, now);
  expect(page.chart.find(point => point.month === "2026-08")?.revenue).toBeNull();
  expect(page.salesAnalysis?.comparisons.month).toBeNull();
});
it("shows complete-month evidence without replacing MTD selection and links contributors to their actual period", () => {
  const analysis = queryOperatingModel(fixture(), { period: "2026-10" }, now).salesAnalysis!;
  const onNavigate = vi.fn();
  render(createElement(SalesOverviewAnalysisPanel, { analysis, onNavigate, context: { filter: "decline", sort: "impact", query: "pump" } }));
  expect(screen.getByText("当前选择 2026-10；以下使用最近完整月 2026-09 分析。")).toBeInTheDocument();
  const details = screen.getByText("查看历史分析依据").closest("details")!;
  expect(details).not.toHaveAttribute("open");
  fireEvent.click(screen.getByText("查看历史分析依据"));
  expect(details).toHaveAttribute("open");
  const link = within(details).getByRole("link", { name: /A/ });
  const url = new URL(link.getAttribute("href")!, "http://localhost");
  expect(url.searchParams.get("period")).toBe("2026-09");
  expect(url.searchParams.get("returnPeriod")).toBe("2026-10");
  expect(url.searchParams.get("filter")).toBe("decline");
  expect(url.searchParams.get("sort")).toBe("impact");
  expect(url.searchParams.get("query")).toBe("pump");
  fireEvent.click(link);
  expect(onNavigate).toHaveBeenCalledOnce();
  expect(screen.queryByText("较去年同月")).not.toBeInTheDocument();
});
