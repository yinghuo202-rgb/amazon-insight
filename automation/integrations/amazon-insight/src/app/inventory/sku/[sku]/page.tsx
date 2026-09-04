import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { OpsPageHeader } from "@/components/inventory/ops-ui";
import { SkuDetailDashboard } from "@/components/inventory/sku-detail-dashboard";
import { loadDocumentMasterData, loadInventoryDashboardData, loadProductCatalogData, loadProfitabilityData, loadVariantCatalogData, normalizeOperationsMarket } from "@/lib/inventory/data";
import { listLatestPurchaseOrderReviews } from "@/lib/inventory/purchase-order-reviews";
import { listSkuPurchaseOrderDetails } from "@/lib/inventory/purchase-orders";
import { buildSkuDetailViewModel } from "@/lib/inventory/sku-detail-view-model";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ sku: string }> }): Promise<Metadata> { const { sku } = await params; return { title: `${decodeURIComponent(sku)} SKU 分析` }; }

export default async function SkuPage({ params, searchParams }: { params: Promise<{ sku: string }>; searchParams: Promise<{ market?: string }> }) {
  const market = normalizeOperationsMarket((await searchParams).market);
  const { sku: rawSku } = await params;
  const sku = decodeURIComponent(rawSku).toUpperCase();
  const [data, variants, products, purchaseOrders, documentMaster, profitability] = await Promise.all([loadInventoryDashboardData(market), loadVariantCatalogData().catch(() => null), loadProductCatalogData().catch(() => null), listSkuPurchaseOrderDetails(sku).catch(() => []), loadDocumentMasterData().catch(() => ({ shipmentHistory: [] })), loadProfitabilityData().catch(() => null)]);
  const row = data.rows.find((item) => item.sku === sku);
  if (!row) notFound();
  const product = products?.items.find((item) => item.sku === sku) ?? null;
  const dashboard = buildSkuDetailViewModel(data, variants, product, sku);
  if (!dashboard) notFound();
  const canceledOrders = listLatestPurchaseOrderReviews({ sku, action: "cancel" });
  // Older NAS snapshots may not contain shipmentHistory yet. Treat that as
  // an empty history instead of crashing the entire SKU detail route.
  const shipmentHistory = Array.isArray(documentMaster?.shipmentHistory)
    ? documentMaster.shipmentHistory.filter((item) => item.sku === sku)
    : [];
  const profitabilityRow = profitability?.rows
    .filter((item) => item.market === market && item.sku === sku)
    .sort((left, right) => right.reportMonth.localeCompare(left.reportMonth))[0] ?? null;
  return <><OpsPageHeader eyebrow="SKU Analysis" title={`${sku} · ${row.productName}`} description="独立查看该 SKU 的销售额、利润、库存、历史发货、产品规格、Listing、采购订单和广告表现。" /><SkuDetailDashboard dashboard={dashboard} profitability={profitabilityRow} product={product} sku={sku} canceledOrders={canceledOrders} purchaseOrders={purchaseOrders} shipmentHistory={shipmentHistory} /></>;
}
