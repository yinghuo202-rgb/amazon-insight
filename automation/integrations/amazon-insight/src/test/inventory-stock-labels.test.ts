import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { InventoryStockVisual } from "@/components/inventory/inventory-stock-visual";

const base = { title: "库存与计划", description: "当前数据", actionLabel: "计划量", referenceLabel: "需求量", rows: [{ sku: "MA001", usOverseas: 10, caOverseas: 5, fba: 10, awd: 5, domestic: 30, pending: 0, action: 12, reference: 18 }] };
it.each(["combined", "market"] as const)("labels combined supply explicitly in %s mode without changing totals", mode => {
  const html = renderToStaticMarkup(createElement(InventoryStockVisual, { ...base, mode, domesticLabel: "共享国内供应（含组合）", pendingLabel: "已核实未完工订单" }));
  expect(html).toContain("共享国内供应（含组合）");
  expect(html).toContain("已核实未完工订单");
  expect(html).not.toContain("共享国内现货");
  expect(html).toContain("库存合计 45 件");
});
it("keeps existing verified-stock labels for callers without overrides", () => {
  const html = renderToStaticMarkup(createElement(InventoryStockVisual, { ...base, mode: "combined" }));
  expect(html).toContain("共享国内现货");
  expect(html).toContain("未完工订单");
  expect(html).toContain("库存合计 45 件");
});
