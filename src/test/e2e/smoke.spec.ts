import { expect, test } from "@playwright/test";

test("home page renders search CTA", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("开始发现候选商品")).toBeVisible();
});
