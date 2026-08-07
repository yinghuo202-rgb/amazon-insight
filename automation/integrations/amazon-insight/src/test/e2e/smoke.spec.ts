import { expect, test } from "@playwright/test";

test("home page renders search CTA", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("开始发现候选商品")).toBeVisible();
});

test("operations overview links to focused workspaces", async ({ page }) => {
  await page.goto("/inventory");
  await expect(page.getByRole("heading", { name: "运营总览" })).toBeVisible();
  await expect(page.getByText("优先处理 SKU")).toBeVisible();
  await expect(page.getByRole("link", { name: "补货计划" })).toBeVisible();
});

test("sku analysis page combines sales inventory and advertising", async ({ page }) => {
  await page.goto("/inventory/sku/MA007");
  await expect(page.getByRole("heading", { name: /MA007/ })).toBeVisible();
  await expect(page.getByText("销量走势")).toBeVisible();
  await expect(page.getByText("库存结构")).toBeVisible();
  await expect(page.getByText("系统分析")).toBeVisible();
});
