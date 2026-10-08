import { createHash } from "node:crypto";
import path from "node:path";

import { contentWorkflowSchema, inventoryDashboardSchema, newProductResearchSchema, productCatalogSchema, profitabilityDataSchema, purchasePlanSchema, variantCatalogSchema, type InventoryDashboardData } from "@/lib/inventory/contracts";
import { runtimePath } from "@/lib/inventory/paths";
import { loadJsonReport } from "@/lib/inventory/json-report-cache";
import { applyInventoryOverrides, applyProductMasterOverrides, applyPurchasePlanOverrides, listOperationalDataOverrides } from "@/lib/inventory/operational-data-store";
import { listLatestPurchaseOrderReviews, purchaseOrderReviewKey, type PurchaseOrderReview } from "@/lib/inventory/purchase-order-reviews";
import { applyProductCostOverrides, listProductCostOverrides } from "@/lib/inventory/product-cost-store";
import { applyResearchCandidateOverrides } from "@/lib/inventory/new-product-research";
import { listResearchCandidateOverrides } from "@/lib/inventory/new-product-research-store";
import { buildOperatingModel } from "@/lib/inventory/dashboard-view-model";
import { publishedReportPath, withReportVersion } from "@/lib/inventory/report-version";
import { operatingPerformanceSchema } from "@/lib/inventory/operating-performance";
import { listOperatingRuleOverrides } from "@/lib/inventory/operating-rules-store";

export async function loadOperatingModel() {
  return withReportVersion(async () => {
  const [us, ca, profit, variants, performance] = await Promise.allSettled([
    loadInventoryDashboardData("US"), loadInventoryDashboardData("CA"), loadProfitabilityData(), loadVariantCatalogData(), loadOperatingPerformanceData(),
  ]);
  const warnings: string[] = [];
  if (us.status === "rejected") warnings.push("US 库存读取失败，请在业务后台检查报告文件。");
  if (ca.status === "rejected") warnings.push("CA 库存读取失败，请在业务后台检查报告文件。");
  if (profit.status === "rejected") warnings.push("销售和利润报告读取失败，经营指标暂不可用。");
  if (variants.status === "rejected") warnings.push("父子体映射读取失败，暂按 SKU 展示。");
  if (performance.status === "rejected") warnings.push("积加已发布经营报告读取失败；当前回显旧 Excel 来源，不能作为最新数据，请检查发布版本。");
  const model = buildOperatingModel([...(us.status === "fulfilled" ? [us.value] : []), ...(ca.status === "fulfilled" ? [ca.value] : [])], profit.status === "fulfilled" ? profit.value : undefined, variants.status === "fulfilled" ? variants.value : undefined, warnings, new Date(), performance.status === "fulfilled" ? performance.value ?? undefined : undefined);
  const publishedPath = await publishedReportPath(runtimePath("reports", "gerpgo-performance.json"));
  const versionId = path.basename(path.dirname(path.dirname(publishedPath)));
  model.publishedVersion = /^data-/.test(versionId) ? versionId : null;
  try { model.ruleOverrides = listOperatingRuleOverrides(); }
  catch { model.rulesAvailable = false; model.warnings.push("提醒配置读取失败，经营提醒暂停；事实数据仍可查看，请检查运营数据库。"); }
  model.dataVersion = createHash("sha256").update(JSON.stringify([new Date().toISOString().slice(0, 10), model.publishedVersion, model.generatedAt, model.rows, model.snapshots, model.ruleOverrides, model.rulesAvailable])).digest("hex");
  return model;
  });
}

export async function loadOperatingPerformanceData() {
  try {
    const data = await loadJsonReport(runtimePath("reports", "gerpgo-performance.json"), input => operatingPerformanceSchema.parse(input));
    const name = process.env.GERPGO_STORE_NAME?.trim().toLowerCase();
    if (name && data.storeScope?.storeName.trim().toLowerCase() !== name) throw new Error("积加发布报告未限定当前店铺范围。");
    return data;
  }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

export type OperationsMarket = "US" | "CA";

export function normalizeOperationsMarket(value: string | undefined | null): OperationsMarket {
  return value?.toUpperCase() === "CA" ? "CA" : "US";
}

export function inventoryDashboardDataPath(market: OperationsMarket = "US") {
  const environmentPath = market === "CA"
    ? process.env.STORE_OPS_DASHBOARD_DATA_CA?.trim()
    : process.env.STORE_OPS_DASHBOARD_DATA?.trim();
  return environmentPath
    ? path.resolve(environmentPath)
    : runtimePath("reports", market === "CA" ? "inventory_dashboard.ca.json" : "inventory_dashboard.json");
}

export async function loadBaseInventoryDashboardData(market: OperationsMarket = "US") {
  return loadJsonReport(inventoryDashboardDataPath(market), (input) => inventoryDashboardSchema.parse(input));
}

export async function loadRawInventoryDashboardData(market: OperationsMarket = "US") {
  return applyInventoryOverrides(await loadBaseInventoryDashboardData(market), listOperationalDataOverrides());
}

export async function loadInventoryDashboardData(market: OperationsMarket = "US") {
  const data = await loadRawInventoryDashboardData(market);
  const reviews = listLatestPurchaseOrderReviews();
  return applyPurchaseOrderReviews(data, reviews);
}

export function profitabilityDataPath() {
  return process.env.STORE_OPS_PROFITABILITY_DATA?.trim()
    ? path.resolve(process.env.STORE_OPS_PROFITABILITY_DATA)
    : runtimePath("reports", "profitability.json");
}

export async function loadProfitabilityData() {
  return loadJsonReport(profitabilityDataPath(), (input) => profitabilityDataSchema.parse(input));
}

export function applyPurchaseOrderReviews(data: InventoryDashboardData, reviews: PurchaseOrderReview[]) {
  const canceled = new Set(
    reviews.filter((review) => review.action === "cancel").map((review) => purchaseOrderReviewKey(review)),
  );
  if (!canceled.size) return data;

  const rows = data.rows.map((row) => {
    const pendingOrders = row.pendingOrders.filter((order) => !canceled.has(purchaseOrderReviewKey({
      sku: row.sku,
      poNumber: order.poNumber,
      poDate: order.poDate,
    })));
    const pendingOrderQty = pendingOrders.reduce((sum, order) => sum + order.remainingQuantity, 0);
    const domesticSupplyTotal = row.localInventory + pendingOrderQty;
    return {
      ...row,
      pendingOrders,
      pendingOrderQty,
      domesticSupplyTotal,
      suggestedProductionQty: Math.max(0, row.suggestedShipmentQty - domesticSupplyTotal),
    };
  });
  const overdueRows = rows.flatMap((row) => row.pendingOrders
    .filter((order) => order.overdue)
    .map((order) => ({ sku: row.sku, poNumber: order.poNumber })));
  return {
    ...data,
    rows,
    summary: {
      ...data.summary,
      pendingOrderQty: rows.reduce((sum, row) => sum + row.pendingOrderQty, 0),
      overdueOrderCount: overdueRows.length,
      overduePurchaseOrderCount: new Set(overdueRows.map((order) => order.poNumber)).size,
      overdueOrderSkuCount: new Set(overdueRows.map((order) => order.sku)).size,
      suggestedProductionQty: rows.reduce((sum, row) => sum + row.suggestedProductionQty, 0),
    },
  };
}

export function variantCatalogDataPath() {
  return process.env.STORE_OPS_VARIANT_CATALOG?.trim()
    ? path.resolve(process.env.STORE_OPS_VARIANT_CATALOG)
    : runtimePath("reports", "variant_catalog.json");
}

export async function loadVariantCatalogData() {
  return loadJsonReport(variantCatalogDataPath(), (input) => variantCatalogSchema.parse(input));
}

export function productCatalogDataPath() {
  return process.env.STORE_OPS_PRODUCT_CATALOG?.trim()
    ? path.resolve(process.env.STORE_OPS_PRODUCT_CATALOG)
    : runtimePath("reports", "product_catalog.json");
}

export async function loadBaseProductCatalogData() {
  return loadJsonReport(productCatalogDataPath(), (input) => productCatalogSchema.parse(input));
}

export async function loadProductCatalogData() {
  const data = applyProductMasterOverrides(await loadBaseProductCatalogData(), listOperationalDataOverrides().products);
  return applyProductCostOverrides(data, listProductCostOverrides());
}

export function newProductResearchDataPath() {
  return process.env.STORE_OPS_NEW_PRODUCT_RESEARCH?.trim()
    ? path.resolve(process.env.STORE_OPS_NEW_PRODUCT_RESEARCH)
    : runtimePath("reports", "new_product_research.json");
}

export async function loadNewProductResearchData() {
  const data = await loadJsonReport(newProductResearchDataPath(), (input) => newProductResearchSchema.parse(input));
  return applyResearchCandidateOverrides(data, listResearchCandidateOverrides());
}

export function contentWorkflowDataPath() {
  return process.env.STORE_OPS_CONTENT_WORKFLOW?.trim()
    ? path.resolve(process.env.STORE_OPS_CONTENT_WORKFLOW)
    : runtimePath("reports", "content_workflow.json");
}

export async function loadContentWorkflowData() {
  return loadJsonReport(contentWorkflowDataPath(), (input) => contentWorkflowSchema.parse(input));
}

export type ShipmentHistoryItem = {
  market: OperationsMarket;
  batch: number;
  shipmentDate: string;
  sku: string;
  quantity: number;
  cartonCount: number;
  sourcePath: string;
};

export function documentMasterDataPath() {
  return process.env.STORE_OPS_DOCUMENT_MASTER?.trim()
    ? path.resolve(process.env.STORE_OPS_DOCUMENT_MASTER)
    : runtimePath("reports", "document_master.json");
}

export async function loadDocumentMasterData() {
  return loadJsonReport(documentMasterDataPath(), (input) => {
    const payload = input as { shipmentHistory?: unknown };
    const shipmentHistory = Array.isArray(payload.shipmentHistory) ? payload.shipmentHistory.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      const sku = String(row.sku ?? "").trim().toUpperCase();
      const market = String(row.market ?? "").toUpperCase() === "CA" ? "CA" : "US";
      const quantity = Number(row.quantity ?? 0);
      if (!sku || !Number.isFinite(quantity) || quantity <= 0) return [];
      return [{ market, batch: Number(row.batch ?? 0), shipmentDate: String(row.shipmentDate ?? ""), sku, quantity: Math.round(quantity), cartonCount: Math.max(0, Math.round(Number(row.cartonCount ?? 0))), sourcePath: String(row.sourcePath ?? "") }] satisfies ShipmentHistoryItem[];
    }) : [];
    return { shipmentHistory };
  });
}

export function purchasePlanDataPath() {
  return process.env.STORE_OPS_PURCHASE_PLAN?.trim()
    ? path.resolve(process.env.STORE_OPS_PURCHASE_PLAN)
    : runtimePath("reports", "purchase_plan.json");
}

export async function loadBasePurchasePlanData() {
  return loadJsonReport(purchasePlanDataPath(), (input) => purchasePlanSchema.parse(input));
}

export async function loadPurchasePlanData() {
  const [data, us, ca] = await Promise.all([
    loadBasePurchasePlanData(),
    loadInventoryDashboardData("US"),
    loadInventoryDashboardData("CA"),
  ]);
  return applyPurchasePlanOverrides(data, us, ca, listOperationalDataOverrides().products);
}

export function productImageDirectory() {
  return process.env.STORE_OPS_PRODUCT_IMAGES?.trim()
    ? path.resolve(process.env.STORE_OPS_PRODUCT_IMAGES)
    : runtimePath("output", "product-images");
}
