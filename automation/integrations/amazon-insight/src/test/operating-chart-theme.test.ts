// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost:3218"}
import { createElement, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
// Render the chart-provider boundary as SVG: assertions inspect the colors
// supplied by our real components, not Recharts sizing/animation internals.
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  AreaChart: ({ children }: { children: ReactNode }) => createElement("svg", null, children),
  LineChart: ({ children }: { children: ReactNode }) => createElement("svg", null, children),
  BarChart: ({ children }: { children: ReactNode }) => createElement("svg", null, children),
  Area: ({ name, stroke, fill }: { name: string; stroke: string; fill: string }) => createElement("path", { role: "img", "aria-label": name, stroke, fill }),
  Line: ({ name, stroke }: { name: string; stroke: string }) => createElement("path", { role: "img", "aria-label": name, stroke }),
  Bar: ({ name, fill }: { name: string; fill: string }) => createElement("rect", { role: "img", "aria-label": name, fill }),
  CartesianGrid: ({ stroke }: { stroke: string }) => createElement("line", { stroke }),
  XAxis: () => null, YAxis: () => null, Tooltip: () => null,
}));
import { RevenueOverviewDashboard, SkuOperatingCard } from "@/components/inventory/revenue-overview-dashboard";
import { SkuOperatingAnalysis } from "@/components/inventory/sku-operating-analysis";
import { SkuDetailDashboard } from "@/components/inventory/sku-detail-dashboard";
import { NewProductProfitCalculator } from "@/components/inventory/new-product-profit-calculator";
import { buildOperatingModel, operatingFacts } from "@/lib/inventory/dashboard-view-model";
import { calculateInventoryRows } from "@/lib/inventory/presentation";
import { inventoryRowSchema, profitabilityRowSchema, type InventoryDashboardData } from "@/lib/inventory/contracts";
import { queryOperatingModel } from "@/lib/inventory/operating-query";

afterEach(cleanup);
const now = new Date("2026-10-12T00:00:00Z");
function operatingModel() {
  const point = profitabilityRowSchema.parse({ sku: "SKU-COLOR", market: "US", currency: "USD", reportMonth: "2026-09", units: 100, returns: 0, netUnits: 100, productSales: 1000, settlementPayout: 800, landedCost: 500, grossProfit: 300, advertisingCost: 0, storageCost: 10, actualProfit: 300, currentPrice: 10, grossMargin: .3, actualMargin: .3, conservativeMargin: .3, quality: { profitVerified: true, returnsVerified: true, completePeriod: true } });
  return buildOperatingModel([], { schemaVersion: 1, generatedAt: now.toISOString(), method: "fixture", sources: [], rows: [{ ...point, reportMonth: "2026-08", productSales: 800 }, point] }, undefined, [], now);
}
it("uses the shared income color for overview and mini trends while profit remains semantic", () => {
  const model = operatingModel();
  render(createElement(RevenueOverviewDashboard, { initial: queryOperatingModel(model, { period: "2026-09" }, now) }));
  expect(screen.getByRole("img", { name: "销售额" })).toHaveAttribute("stroke", "var(--chart-primary)");
  expect(document.querySelector("linearGradient stop")).toHaveAttribute("stop-color", "var(--chart-primary)");
  fireEvent.click(screen.getByRole("button", { name: "利润" }));
  expect(screen.getByRole("img", { name: "报告利润" })).toHaveAttribute("stroke", "var(--positive)");
  cleanup();
  render(createElement(SkuOperatingCard, { row: model.rows[0], period: "2026-09" }));
  expect(screen.getByRole("img", { name: "SKU-COLOR 最近2个完整月销售额趋势" }).querySelector("polyline")).toHaveAttribute("stroke", "var(--chart-primary)");
});
it("keeps the previous overview visible and non-interactive while a new filter loads", () => {
  const model = operatingModel();
  render(createElement(RevenueOverviewDashboard, { initial: queryOperatingModel(model, { period: "2026-09" }, now) }));
  const metrics = screen.getByLabelText("经营指标");
  fireEvent.change(screen.getByLabelText("搜索 SKU、产品或 ASIN"), { target: { value: "NO-MATCH" } });
  expect(metrics).toBeInTheDocument();
  expect(metrics.closest(".ops-stale-content")).toHaveAttribute("aria-busy", "true");
  expect(metrics.closest(".ops-stale-body")).toHaveAttribute("inert");
  expect(screen.getByText("正在加载经营数据…")).toBeInTheDocument();
});
it("does not draw a compact trend across an absent month", () => {
  const row = operatingModel().rows[0];
  row.history[0] = { ...row.history[0], reportMonth: "2026-07" };
  render(createElement(SkuOperatingCard, { row, period: "2026-09" }));
  expect(screen.queryByRole("img", { name: /完整月销售额趋势/ })).not.toBeInTheDocument();
});
it("uses the same income and profit colors in the SKU operating chart", () => {
  const row = operatingModel().rows[0];
  render(createElement(SkuOperatingAnalysis, { row, period: "2026-09", facts: operatingFacts(row, "2026-09", undefined, now) }));
  expect(screen.getByRole("img", { name: "销售额" })).toHaveAttribute("stroke", "var(--chart-primary)");
  fireEvent.click(screen.getByRole("button", { name: "利润" }));
  expect(screen.getByRole("img", { name: "报告利润" })).toHaveAttribute("stroke", "var(--positive)");
});
it("uses the workspace primary for detailed sales and stock bars without changing supply facts", () => {
  const stock = inventoryRowSchema.parse({ sku: "SKU-COLOR", productName: "库存产品", factory: "工厂", cartonQty: 12, fbaSellable: 20, fbaReservedTransfer: 0, fbaReservedProcessing: 0, awdOnHand: 8, awdAvailable: 8, awdPendingShipment: 0, awdOutboundToFba: 0, awdInbound: 0, awdFbaReconciliation: 0, inTransitInventory: 22, dailySales: 1, salesByMonth: [{ month: "2026-09", units: 100 }], dataQuality: [], eligibleInventoryPosition: 50, daysCoverFba: 20, daysCoverNetwork: 50, suggestedShipmentQty: 0, suggestedAwdTransferQty: 0, action: "NO_ACTION", riskLevel: "healthy", reason: "", domesticSupplyTotal: 30, domesticSupplyBreakdownVerified: false });
  const data = { market: "US", snapshots: { fbaDate: "2026-10-12", awdDate: "2026-10-12", inTransitConfirmed: true, awdSourceAvailable: true, awdAvailableConfirmed: true }, sales: { historyMonths: [], windowMonths: [] }, domesticPool: { id: "CN-SHARED" }, summary: { localInventory: 0 }, parameters: { leadTimeDays: 75, reviewCycleDays: 7, targetCoverDays: 90, safetyStockDays: 21, excessCoverDays: 240, fbaTransferTriggerDays: 30, purchaseOrderOverdueDays: 45 }, rows: [stock] } as unknown as InventoryDashboardData;
  render(createElement(SkuDetailDashboard, { dashboard: { market: "US", currency: "USD", domesticPoolId: "CN-SHARED", targetAcosPercent: 30, row: calculateInventoryRows(data)[0], variant: null, engineeringSpecifications: [], campaigns: [] }, sku: stock.sku, profitability: null, product: null, canceledOrders: [], purchaseOrders: [], shipmentHistory: [] }));
  expect(screen.getByRole("img", { name: "销量" })).toHaveAttribute("fill", "var(--chart-primary)");
  expect(screen.getByRole("img", { name: "数量" })).toHaveAttribute("fill", "var(--chart-primary)");
  expect(screen.getAllByText("国内组合供应").length).toBeGreaterThan(0);
  expect(screen.queryByText("系统分析")).not.toBeInTheDocument();
  expect(screen.queryByText("建议发货")).not.toBeInTheDocument();
  expect(screen.queryByText("实际利润")).not.toBeInTheDocument();
  expect(screen.queryByText("所属系列")).not.toBeInTheDocument();
});
it("uses the workspace primary for the calculator cost segment while keeping the calculated result", () => {
  render(createElement(NewProductProfitCalculator, { products: [] }));
  fireEvent.change(screen.getByLabelText("类目", { exact: true }), { target: { value: "OTHER" } });
  for (const [label, value] of [["售价（USD）", "20"], ["采购成本 / 件（USD）", "4"], ["长 cm", "50"], ["宽 cm", "40"], ["高 cm", "30"], ["件 / 箱", "10"], ["头程费率（USD/m³）", "100"], ["佣金率 %", "15"], ["配送费 / 件（USD）", "3"]]) fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } });
  fireEvent.click(screen.getByRole("checkbox", { name: "确认本次市场、类目、包装与费率" }));
  const donut = screen.getByRole("img", { name: "成本与正利润构成，金额见右侧明细" });
  expect(donut.getAttribute("style")).toContain("var(--chart-primary)");
  expect(screen.getByText("$6.20", { selector: ".ops-result-amount" })).toBeInTheDocument();
});
