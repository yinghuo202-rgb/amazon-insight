// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { NewProductProfitCalculator } from "@/components/inventory/new-product-profit-calculator";
import type { ProfitFeeRule } from "@/lib/inventory/profit-scenario";
afterEach(cleanup);
const legacyRule: ProfitFeeRule = { market: "US", category: "已确认测试类目", effectiveDate: "2026-01-01", validUntil: "2099-12-31", referralPercent: 15, freightPerM3: 100,
  fbaTiers: [{ maxWeightG: 500, maxLengthCm: 30, maxWidthCm: 20, maxHeightCm: 10, fee: 3 }] };
const provenanceRule = { ...legacyRule, source: "已确认报价 <b>样本</b>", route: "US 海运体积线", scope: "普通商品，按外箱体积计费" };
function fillMatchedScenario() {
  fireEvent.change(screen.getByLabelText("类目"), { target: { value: legacyRule.category } });
  for (const [label, value] of [["售价（USD）", "20"], ["采购成本 / 件（USD）", "4"], ["长 cm", "50"], ["宽 cm", "40"], ["高 cm", "30"], ["件 / 箱", "10"], ["单件长 cm", "30"], ["单件宽 cm", "20"], ["单件高 cm", "10"], ["单件毛重 g", "500"]]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
}

it("shows the matched rule's full provenance, validity, freight route and applicability as plain text", () => {
  render(createElement(NewProductProfitCalculator, { products: [], rules: [provenanceRule] }));
  fillMatchedScenario();
  const details = screen.getByText("试算范围与费率").closest("details")!;
  fireEvent.click(within(details).getByText("试算范围与费率"));
  expect(within(details).getByText(/2026-01-01.*2099-12-31/)).toBeInTheDocument();
  expect(within(details).getByText(/已确认报价 <b>样本<\/b>/)).toBeInTheDocument();
  expect(within(details).getByText(/US 海运体积线/)).toBeInTheDocument();
  expect(within(details).getByText(/普通商品，按外箱体积计费/)).toBeInTheDocument();
  expect(details.querySelector("b")).toBeNull();
  expect(within(details).getByText(/不含税、仓储、危险品、电池/)).toBeInTheDocument();
  expect(screen.getByText("31.0%")).toBeInTheDocument();
});

it("identifies each manual fee override separately from the matched configuration source and invalidates confirmation", () => {
  render(createElement(NewProductProfitCalculator, { products: [], rules: [provenanceRule] }));
  fillMatchedScenario();
  for (const label of ["佣金率 %", "配送费 / 件（USD）", "头程费率（USD/m³）"]) fireEvent.change(screen.getByLabelText(label), { target: { value: label === "头程费率（USD/m³）" ? "200" : "5" } });
  const details = screen.getByText("试算范围与费率").closest("details")!;
  expect(within(details).getByText(/佣金.*手填覆盖/)).toBeInTheDocument();
  expect(within(details).getByText(/配送.*手填覆盖/)).toBeInTheDocument();
  expect(within(details).getByText(/头程.*手填覆盖/)).toBeInTheDocument();
  expect(within(details).getByText(/配置来源.*已确认报价/)).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("请确认本次费率");
  fireEvent.click(screen.getByLabelText("确认本次市场、类目、包装与费率"));
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("头程费率（USD/m³）"), { target: { value: "300" } });
  expect(screen.getByRole("status")).toHaveTextContent("请确认本次费率");
});

it("calculates with a legacy rule while making missing provenance and the volume-only scope explicit", () => {
  render(createElement(NewProductProfitCalculator, { products: [], rules: [legacyRule] }));
  fillMatchedScenario();
  const details = screen.getByText("试算范围与费率").closest("details")!;
  expect(within(details).getByText(/来源未配置/)).toBeInTheDocument();
  expect(within(details).getByText(/线路未配置/)).toBeInTheDocument();
  expect(details).toHaveTextContent(/仅适用于体积计费/);
  expect(within(details).getByText(/未经过官方费率校验/)).toBeInTheDocument();
  expect(screen.getByText("31.0%")).toBeInTheDocument();
});
it("asks for missing inputs before fee confirmation and calculates a confirmed manual scenario", () => {
  render(createElement(NewProductProfitCalculator, { products: [] }));
  expect(screen.getByRole("status")).toHaveTextContent("填写类目、售价、成本");
  fireEvent.change(screen.getByLabelText("类目"), { target: { value: "OTHER" } });
  for (const [label, value] of [["售价（USD）", "20"], ["采购成本 / 件（USD）", "4"], ["长 cm", "50"], ["宽 cm", "40"], ["高 cm", "30"], ["件 / 箱", "10"], ["头程费率（USD/m³）", "100"], ["佣金率 %", "15"], ["配送费 / 件（USD）", "3"]]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  expect(screen.getByRole("status")).toHaveTextContent("请确认本次费率");
  fireEvent.click(screen.getByLabelText("确认本次市场、类目、包装与费率"));
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.getAllByText("$6.20").length).toBeGreaterThan(0);
  expect(screen.getByText("31.0%")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("站点"), { target: { value: "CA" } });
  expect(screen.queryByText("31.0%")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("填写类目、售价、成本");
});
