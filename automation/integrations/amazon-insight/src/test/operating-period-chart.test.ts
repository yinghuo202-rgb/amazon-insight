// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  AreaChart: ({ children, data }: { children: ReactNode; data: unknown }) => createElement("svg", { "data-chart-points": JSON.stringify(data) }, children),
  Area: ({ name, strokeDasharray }: { name: string; strokeDasharray?: string }) => createElement("path", { role: "img", "aria-label": name, strokeDasharray }),
  CartesianGrid: () => null, XAxis: () => null, YAxis: () => null, Tooltip: () => null,
}));
import { OperatingHistoryChart } from "@/components/inventory/operating-history-chart";
import { fillOperatingChartMonths } from "@/lib/inventory/operating-chart";
afterEach(cleanup);
it("keeps missing months as null and fills the selected month rather than bridging a gap", () => {
  const chart = fillOperatingChartMonths([
    { month: "2026-07", revenue: 100, profit: 20, complete: true, mtd: false, asOf: "2026-07-31" },
    { month: "2026-09", revenue: 200, profit: 30, complete: true, mtd: false, asOf: "2026-09-30" },
  ], "2026-10");
  expect(chart.map(point => point.month)).toEqual(["2026-07", "2026-08", "2026-09", "2026-10"]);
  expect(chart[1].revenue).toBeNull();
  expect(chart[3].revenue).toBeNull();
  expect(chart[1].complete).toBe(false);
});
it("distinguishes MTD from complete periods using text, cutoff and a dashed series", () => {
  render(createElement(OperatingHistoryChart, { currency: "CAD", metric: "revenue", points: [
    { month: "2026-09", revenue: 120000, profit: 30000, complete: true, mtd: false, asOf: "2026-09-30" },
    { month: "2026-10", revenue: 49000, profit: 10000, complete: false, mtd: true, asOf: "2026-10-12" },
  ] }));
  expect(screen.getByRole("img", { name: "当月累计" })).toHaveAttribute("stroke-dasharray", "5 5");
  expect(screen.getByRole("img", { name: "销售额" })).not.toHaveAttribute("stroke-dasharray");
  expect(screen.getByLabelText("图表口径")).toHaveTextContent("截至 2026-10-12");
  expect(screen.getByLabelText("图表口径")).toHaveTextContent("不与完整月直接比较");
  expect(screen.getByLabelText("销售额趋势数据")).toHaveTextContent("2026-10，期间未完整，CA$49,000");
});
it("does not draw a decline from a complete month to a partial month", () => {
  const { container } = render(createElement(OperatingHistoryChart, { currency: "USD", metric: "revenue", points: [
    { month: "2026-09", revenue: 120000, profit: 30000, complete: true, mtd: false, asOf: "2026-09-30" },
    { month: "2026-10", revenue: 49000, profit: 10000, complete: false, mtd: true, asOf: "2026-10-12" },
  ] }));
  const chart = container.querySelector("svg[data-chart-points]");
  const points = JSON.parse(chart?.getAttribute("data-chart-points") ?? "[]") as Array<{ month: string; fullValue: number | null; partialValue: number | null }>;
  expect(points).toEqual([
    expect.objectContaining({ month: "2026-09", fullValue: 120000, partialValue: null }),
    expect.objectContaining({ month: "2026-10", fullValue: null, partialValue: 49000 }),
  ]);
});
it("does not label incomplete historical evidence as current-month accumulation", () => {
  render(createElement(OperatingHistoryChart, { currency: "USD", metric: "profit", points: [
    { month: "2026-08", revenue: 100, profit: 40, complete: true, mtd: false, asOf: "2026-08-31" },
    { month: "2026-09", revenue: 50, profit: 10, complete: false, mtd: false, asOf: "2026-09-15" },
  ] }));
  expect(screen.getByRole("img", { name: "期间未完整" })).toHaveAttribute("stroke-dasharray", "5 5");
  expect(screen.queryByRole("img", { name: "当月累计" })).not.toBeInTheDocument();
});
