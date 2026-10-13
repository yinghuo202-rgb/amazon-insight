// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { NewProductProfitCalculator } from "@/components/inventory/new-product-profit-calculator";
afterEach(cleanup);
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
