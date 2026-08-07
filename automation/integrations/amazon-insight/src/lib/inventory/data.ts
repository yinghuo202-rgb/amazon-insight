import path from "node:path";

import { contentWorkflowSchema, inventoryDashboardSchema, productCatalogSchema, profitabilityDataSchema, purchasePlanSchema, variantCatalogSchema, type InventoryDashboardData } from "@/lib/inventory/contracts";
import { automationRoot } from "@/lib/inventory/paths";
import { loadJsonReport } from "@/lib/inventory/json-report-cache";
import { applyInventoryOverrides, applyProductMasterOverrides, applyPurchasePlanOverrides, listOperationalDataOverrides } from "@/lib/inventory/operational-data-store";
import { listLatestPurchaseOrderReviews, purchaseOrderReviewKey, type PurchaseOrderReview } from "@/lib/inventory/purchase-order-reviews";
import { applyProductCostOverrides, listProductCostOverrides } from "@/lib/inventory/product-cost-store";

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
    : path.join(automationRoot(), "runtime", "reports", market === "CA" ? "inventory_dashboard.ca.json" : "inventory_dashboard.json");
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
    : path.join(automationRoot(), "runtime", "reports", "profitability.json");
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
    : path.join(automationRoot(), "runtime", "reports", "variant_catalog.json");
}

export async function loadVariantCatalogData() {
  return loadJsonReport(variantCatalogDataPath(), (input) => variantCatalogSchema.parse(input));
}

export function productCatalogDataPath() {
  return process.env.STORE_OPS_PRODUCT_CATALOG?.trim()
    ? path.resolve(process.env.STORE_OPS_PRODUCT_CATALOG)
    : path.join(automationRoot(), "runtime", "reports", "product_catalog.json");
}

export async function loadBaseProductCatalogData() {
  return loadJsonReport(productCatalogDataPath(), (input) => productCatalogSchema.parse(input));
}

export async function loadProductCatalogData() {
  const data = applyProductMasterOverrides(await loadBaseProductCatalogData(), listOperationalDataOverrides().products);
  return applyProductCostOverrides(data, listProductCostOverrides());
}

export function contentWorkflowDataPath() {
  return process.env.STORE_OPS_CONTENT_WORKFLOW?.trim()
    ? path.resolve(process.env.STORE_OPS_CONTENT_WORKFLOW)
    : path.join(automationRoot(), "runtime", "reports", "content_workflow.json");
}

export async function loadContentWorkflowData() {
  return loadJsonReport(contentWorkflowDataPath(), (input) => contentWorkflowSchema.parse(input));
}

export function purchasePlanDataPath() {
  return process.env.STORE_OPS_PURCHASE_PLAN?.trim()
    ? path.resolve(process.env.STORE_OPS_PURCHASE_PLAN)
    : path.join(automationRoot(), "runtime", "reports", "purchase_plan.json");
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
    : path.join(automationRoot(), "runtime", "output", "product-images");
}
