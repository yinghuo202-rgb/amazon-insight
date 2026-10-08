import { expect, test } from "@playwright/test";
const email = "ui-test@measureman.invalid";
const password = process.env.E2E_TEST_PASSWORD!;
test.skip(!process.env.E2E_TEST_DATABASE_URL || !process.env.E2E_TEST_STATE_DB, "Requires explicitly isolated account and audit databases.");
test.beforeAll(async ({ request }) => {
  const response = await request.post("/api/auth/bootstrap", { data: { email, name: "UI test", password } });
  expect([201, 409]).toContain(response.status());
  if (response.status() === 409) expect((await request.post("/api/auth/login", { data: { email, password } })).status()).toBe(200);
});
test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("共用账号邮箱").fill(email);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(page.getByRole("heading", { name: "运营总览", exact: true })).toBeVisible();
});
test("overview stays compact and phone layout has no horizontal overflow", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "销售额变化" })).toBeVisible();
  await expect(page.locator('section[aria-label="经营指标"] > div')).toHaveCount(6);
  await expect(page.locator("article")).toHaveCount(0);
  await expect(page.getByText("优先复核的五条建议")).toHaveCount(0);
  await expect(page.getByLabel("筛选父体")).toHaveCount(0);
  await page.getByLabel("搜索 SKU、产品或 ASIN").fill("MA007");
  await expect(page.locator("article").first()).toBeVisible();
  expect(await page.locator("article").count()).toBeLessThanOrEqual(3);
  await page.getByLabel("搜索 SKU、产品或 ASIN").fill("");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "../../runtime/reports/ui-review-20261007/overview-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("navigation", { name: "快捷导航" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "../../runtime/reports/ui-review-20261007/overview-mobile.png", fullPage: false });
});
test("SKU cards support search, evidence, market switching and phone layout", async ({ page }) => {
  await page.goto("/inventory/brief");
  await expect(page.locator("article").first()).toBeVisible();
  expect(await page.locator("article").count()).toBeGreaterThanOrEqual(20);
  await page.getByLabel("搜索 SKU、产品或 ASIN").fill("MA007");
  await expect(page.locator("article").first()).toBeVisible();
  const count = await page.locator("article").count();
  expect(count).toBeGreaterThan(0);
  expect(count).toBeLessThanOrEqual(20);
  await page.getByText("展开经营依据", { exact: true }).first().click();
  await expect(page.getByText("历史成交均价").first()).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "../../runtime/reports/ui-review-20261007/brief-mobile.png", fullPage: false });
  await page.getByLabel("站点", { exact: true }).selectOption("MX");
  await page.getByLabel("搜索 SKU、产品或 ASIN").fill("");
  await expect(page.getByText("MXN 原币种", { exact: false })).toBeVisible();
});
test("SKU detail reveals shipment records only on request", async ({ page }) => {
  await page.goto("/inventory/sku/MA007");
  await expect(page.getByRole("heading", { name: /MA007/ }).first()).toBeVisible();
  await page.getByText("业务明细：库存、历史发货、订单、产品资料", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "SKU 历史发货记录", exact: true })).toBeVisible();
});
test("online source panel separates configured entry points from actual synchronization", async ({ page }) => {
  await page.goto("/inventory/data");
  await expect(page.getByRole("heading", { name: "在线数据来源", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "WPS 库存规划", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "WPS 新品资料", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "测试积加连接", exact: true })).toBeDisabled();
  await expect(page.getByText("尚未配置积加凭证", { exact: false })).toBeVisible();
  const check = await page.request.post("/api/inventory/data-refresh", { headers: { origin: process.env.E2E_BASE_URL || "http://127.0.0.1:3107" }, data: { action: "test_gerpgo" } });
  expect(check.status()).toBe(422);
  expect((await check.json()).error).toContain("appId");
  await expect(page.getByRole("link", { name: "打开源文档", exact: true })).toHaveAttribute("href", "https://www.kdocs.cn/l/Example123");
  await expect(page.getByText("分享链接已配置；自动同步尚未接入", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
test("profit calculator validates assumptions and clears currency-dependent fees", async ({ page }) => {
  await page.goto("/inventory/calculator");
  await page.getByLabel("类目", { exact: true }).selectOption("OTHER");
  for (const [label, value] of [["售价（USD）", "20"], ["采购成本 / 件（USD）", "4"], ["长 cm", "50"], ["宽 cm", "40"], ["高 cm", "30"], ["件 / 箱", "10"], ["头程费率（USD/m³）", "100"], ["佣金率 %", "15"], ["配送费 / 件（USD）", "3"]]) await page.getByLabel(label, { exact: true }).fill(value);
  await expect(page.getByText("$6.20", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "../../runtime/reports/ui-review-20261007/calculator-mobile.png", fullPage: false });
  await page.getByLabel("配送费 / 件（USD）", { exact: true }).fill("-1");
  await expect(page.getByRole("status")).toContainText("数值无效");
  await page.getByLabel("站点", { exact: true }).selectOption("CA");
  await expect(page.getByLabel("售价（CAD）", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("配送费 / 件（CAD）", { exact: true })).toHaveValue("");
});
test("forged session cannot read or update reports; member creation is closed", async ({ playwright }) => {
  const request = await playwright.request.newContext({ baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:3107", extraHTTPHeaders: { cookie: "measureman_session=forged" } });
  expect((await request.get("/api/inventory/master-data")).status()).toBe(401);
  expect((await request.post("/api/inventory/new-product-research", { data: {} })).status()).toBe(401);
  expect((await request.post("/api/inventory/data-refresh", { data: { action: "test_gerpgo" } })).status()).toBe(401);
  expect((await request.post("/api/inventory/data-refresh", { data: { action: "save_gerpgo_credentials", appId: "fixture", appKey: "fixture" } })).status()).toBe(401);
  expect((await request.post("/api/auth/create-member", { data: {} })).status()).toBe(410);
  await request.dispose();
});

test("review preview requires confirmation and blocked mappings cannot publish", async ({ page }) => {
  // UI fixture only; never fetch tenant data or approve a production report.
  const id = "d8a4f702-f57b-4aa1-8300-9bfcb005e001", hash = "a".repeat(64), now = new Date().toISOString();
  let blocked = false, approved = false;
  await page.route("**/api/inventory/data-refresh*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() === "POST") {
      const input = request.postDataJSON();
      expect(input).toEqual({ action: "publish_gerpgo", sourceTaskId: id, previewHash: hash, confirmed: true });
      approved = true;
      await route.fulfill({ json: { task: { id: "approval", kind: "gerpgo_publish", status: "queued", createdAt: now } } });
    } else if (url.searchParams.has("preview")) {
      await route.fulfill({ json: { preview: { taskId: id, previewHash: hash, baseline: "b".repeat(64), capturedAt: now, recordCount: 1, ignoredParentRows: 0,
        blocked, issueCount: blocked ? 1 : 0, issues: blocked ? [{ source: "performance-2026-09", row: 1, reason: "SKU 未匹配" }] : [],
        withheld: ["FBA 字段未核验"], reviewReasons: ["首次对账"], differences: [{ market: "US", reportMonth: "2026-09", currency: "USD", previousRevenue: 100, candidateRevenue: 150, previousSkuCount: 1, candidateSkuCount: 1, revenueChangePercent: 50, completePeriod: true, protected: true }] },
        records: [{ market: "US", reportMonth: "2026-09", sku: "TEST-SKU", currency: "USD", units: 40, productSales: 150, actualProfit: null }], nextOffset: null } });
    } else if (url.searchParams.get("tasks") === "1") {
      await route.fulfill({ json: { tasks: [{ id, kind: "gerpgo", status: "awaiting_review", createdAt: now, progress: "待对账", error: "" }] } });
    } else await route.continue();
  });
  await page.goto("/inventory/data");
  await page.getByRole("button", { name: "查看差异预览" }).click();
  await expect(page.getByLabel("积加差异预览")).toBeVisible();
  await expect(page.getByRole("button", { name: "确认并交给 worker 发布" })).toBeDisabled();
  await page.getByText("逐 SKU 对账明细", { exact: false }).click();
  await expect(page.getByText("US 2026-09 · TEST-SKU", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("checkbox").last().check();
  await page.getByRole("button", { name: "确认并交给 worker 发布" }).click();
  expect(approved).toBe(true);
  blocked = true;
  await page.getByRole("button", { name: "查看差异预览" }).click();
  await expect(page.getByText("SKU 未匹配", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "确认并交给 worker 发布" })).toHaveCount(0);
});

test("failed imports expose domain coverage on phone without claiming a successful sync", async ({ page }) => {
  const id = "d8a4f702-f57b-4aa1-8300-9bfcb005e001", now = new Date().toISOString();
  await page.route("**/api/inventory/data-refresh*", async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.has("collection")) await route.fulfill({ json: { collection: { taskId: id, capturedAt: now, domains: [
      { name: "ads", completed: 1, failed: 1, skipped: 2, pages: 1, records: 30, errors: ["广告权限尚未开通"] },
    ] } } });
    else if (url.searchParams.get("tasks") === "1") await route.fulfill({ json: { tasks: [{ id, kind: "gerpgo", status: "failed", createdAt: now, progress: "旧报告保留", error: "采集未完成" }] } });
    else await route.continue();
  });
  await page.goto("/inventory/data");
  await page.getByRole("button", { name: "查看采集明细" }).click();
  await expect(page.getByLabel("积加采集覆盖")).toContainText("完成 1 个范围 · 失败 1 · 跳过 2");
  await expect(page.getByText("广告权限尚未开通", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("webpage credentials persist encrypted without being echoed or contacting GERPgo", async ({ page }) => {
  await page.goto("/inventory/data");
  await expect(page.getByRole("button", { name: "保存积加凭证", exact: true })).toBeDisabled();
  await page.getByLabel("积加 appId", { exact: true }).fill("browser-fixture-app-id");
  await page.getByLabel("积加 appKey", { exact: true }).fill("browser-fixture-private-key");
  await expect(page.getByLabel("积加 appKey", { exact: true })).toHaveAttribute("type", "password");
  const pending = page.waitForResponse(response => response.url().endsWith("/api/inventory/data-refresh") && response.request().method() === "POST");
  await page.getByRole("button", { name: "保存积加凭证", exact: true }).click();
  const response = await pending;
  expect(response.status()).toBe(200);
  expect(await response.text()).not.toContain("browser-fixture-private-key");
  await expect(page.getByText("凭证已加密保存", { exact: false })).toBeVisible();
  await expect(page.getByLabel("积加 appKey", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("积加 appId", { exact: true })).toHaveValue("");
  await expect(page.getByRole("button", { name: "测试积加连接", exact: true })).toBeEnabled();
  await page.reload();
  await expect(page.getByText("已在网页保存", { exact: false })).toBeVisible();
  await expect(page.getByLabel("积加 appKey", { exact: true })).toHaveValue("");
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("browser-fixture-private-key");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "../../runtime/reports/ui-review-20261007/gerpgo-settings-mobile.png", fullPage: false });
  // Deliberately do not click connection test with dummy credentials.
});
