import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { OpsPageHeader } from "@/components/inventory/ops-ui";
import { SkuDetailDashboard } from "@/components/inventory/sku-detail-dashboard";
import { loadInventoryDashboardData, loadProductCatalogData, loadVariantCatalogData, normalizeOperationsMarket } from "@/lib/inventory/data";
import { listLatestPurchaseOrderReviews } from "@/lib/inventory/purchase-order-reviews";
import { listSkuPurchaseOrderDetails } from "@/lib/inventory/purchase-orders";
import { buildSkuDetailViewModel } from "@/lib/inventory/sku-detail-view-model";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ sku: string }> }): Promise<Metadata> { const { sku } = await params; return { title: `${decodeURIComponent(sku)} SKU 分析` }; }

export default async function SkuPage({ params, searchParams }: { params: Promise<{ sku: string }>; searchParams: Promise<{ market?: string }> }) {
  const market = normalizeOperationsMarket((await searchParams).market);
  const { sku: rawSku } = await params;
  const sku = decodeURIComponent(rawSku).toUpperCase();
  const [data, variants, products, purchaseOrders] = await Promise.all([loadInventoryDashboardData(market), loadVariantCatalogData().catch(() => null), loadProductCatalogData().catch(() => null), listSkuPurchaseOrderDetails(sku).catch(() => [])]);
  const row = data.rows.find((item) => item.sku === sku);
  if (!row) notFound();
  const product = products?.items.find((item) => item.sku === sku) ?? null;
  const dashboard = buildSkuDetailViewModel(data, variants, product, sku);
  if (!dashboard) notFound();
  const canceledOrders = listLatestPurchaseOrderReviews({ sku, action: "cancel" });
  return <><OpsPageHeader eyebrow="SKU Analysis" title={`${sku} · ${row.productName}`} description="独立查看该 SKU 的销量、库存、产品规格、Listing、全部历史采购订单、补货和广告表现。" /><SkuDetailDashboard dashboard={dashboard} product={product} sku={sku} canceledOrders={canceledOrders} purchaseOrders={purchaseOrders} /></>;
}
