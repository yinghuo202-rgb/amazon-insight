import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { RevenueOverviewDashboard } from "@/components/inventory/revenue-overview-dashboard";
import { buildOperatingModel } from "@/lib/inventory/dashboard-view-model";
import { profitabilityRowSchema } from "@/lib/inventory/contracts";
import { queryOperatingModel } from "@/lib/inventory/operating-query";

it("labels historical focus evidence and opens that month while preserving the current-month return context", () => {
  const now = new Date("2026-10-12T00:00:00Z");
  const row = profitabilityRowSchema.parse({ sku: "SKU-LOSS", market: "US", currency: "USD", reportMonth: "2026-09", units: 100, returns: 0, netUnits: 100, productSales: 1000, settlementPayout: 400, landedCost: 500, grossProfit: -100, advertisingCost: 0, storageCost: 10, actualProfit: -100, currentPrice: 10, grossMargin: -.1, actualMargin: -.1, conservativeMargin: -.1, quality: { profitVerified: true, returnsVerified: true, completePeriod: true } });
  const model = buildOperatingModel([], { schemaVersion: 1, generatedAt: now.toISOString(), method: "fixture", sources: [], rows: [row, { ...row, reportMonth: "2026-10", quality: { profitVerified: false, returnsVerified: false, completePeriod: false } }] }, undefined, [], now);
  model.rows[0].inventoryDate = "2026-10-11";
  model.rows[0].stock = { fba: 2, awd: 0, awdTransfer: 0, transit: 0, domestic: 0, orders: 0, dailySales: 1, cover: 2, target: 90, supplyConfirmed: true };
  const html = renderToStaticMarkup(createElement(RevenueOverviewDashboard, { initial: queryOperatingModel(model, { period: "2026-10" }, now) }));
  const panel = html.match(/<aside\b[^>]*aria-label="重点关注"[^>]*>([\s\S]*?)<\/aside>/)![1];
  expect(panel).not.toContain("本月重点关注");
  expect(panel).toContain("经营 2026-09");
  const links = [...panel.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
  const detail = new URL(links.find(link => link[2].includes("SKU-LOSS"))![1].replaceAll("&amp;", "&"), "https://test.invalid");
  expect(detail.searchParams.get("period")).toBe("2026-09");
  expect(detail.searchParams.get("returnPeriod")).toBe("2026-10");
  const brief = new URL(links.find(link => link[2].includes("查看简报"))![1].replaceAll("&amp;", "&"), "https://test.invalid");
  expect(brief.searchParams.get("period")).toBe("2026-09");
  expect(brief.searchParams.get("filter")).toBe("focus");

  const briefHtml = renderToStaticMarkup(createElement(RevenueOverviewDashboard, { initial: queryOperatingModel(model, { period: "2026-10", brief: true }, now), brief: true }));
  const header = briefHtml.match(/<article\b[^>]*>[\s\S]*?<header\b[^>]*>([\s\S]*?)<\/header>/)![1];
  expect(header).toContain("经营 2026-09");
  expect(header).toContain("库存 2026-10-11");
  expect(header).toContain("period=2026-09");
  expect(header).toContain("returnPeriod=2026-10");
});
