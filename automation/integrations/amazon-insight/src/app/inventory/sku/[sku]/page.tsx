import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { OpsPageHeader } from "@/components/inventory/ops-ui";
import { SkuDetailDashboard } from "@/components/inventory/sku-detail-dashboard";
import { SkuOperatingCard } from "@/components/inventory/revenue-overview-dashboard";
import { withReportVersion } from "@/lib/inventory/report-version";
import { resolveOperatingRules } from "@/lib/inventory/operating-rules";
import { loadOperatingModel, loadDocumentMasterData, loadInventoryDashboardData, loadProductCatalogData, loadProfitabilityData, loadVariantCatalogData, normalizeOperationsMarket } from "@/lib/inventory/data";
import { listLatestPurchaseOrderReviews } from "@/lib/inventory/purchase-order-reviews";
import { listSkuPurchaseOrderDetails } from "@/lib/inventory/purchase-orders";
import { buildSkuDetailViewModel } from "@/lib/inventory/sku-detail-view-model";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ sku: string }> }): Promise<Metadata> { const { sku } = await params; return { title: `${decodeURIComponent(sku)} SKU 分析` }; }

export default async function SkuPage({ params, searchParams }: { params: Promise<{ sku: string }>; searchParams: Promise<{ market?: string }> }) {
  const requestedMarket = (await searchParams).market?.toUpperCase();
  const market = requestedMarket === "MX" || requestedMarket === "AU" ? requestedMarket : normalizeOperationsMarket(requestedMarket);
  const { sku: rawSku } = await params;
  const sku = decodeURIComponent(rawSku).toUpperCase();
  const [data, variants, products, purchaseOrders, documentMaster, profitability, operating] = await withReportVersion(() => Promise.all([market === "US" || market === "CA" ? loadInventoryDashboardData(market).catch(() => null) : Promise.resolve(null), loadVariantCatalogData().catch(() => null), loadProductCatalogData().catch(() => null), listSkuPurchaseOrderDetails(sku).catch(() => []), loadDocumentMasterData().catch(() => ({ shipmentHistory: [] })), loadProfitabilityData().catch(() => null), loadOperatingModel()]));
  const row = data?.rows.find((item) => item.sku === sku);
  const operatingRow = operating.rows.find((item) => item.market === market && item.sku === sku);
  if (!row && !operatingRow) notFound();
  const product = products?.items.find((item) => item.sku === sku) ?? null;
  const dashboard = data && row ? buildSkuDetailViewModel(data, variants, product, sku) : null;
  const canceledOrders = listLatestPurchaseOrderReviews({ sku, action: "cancel" });
  // Older NAS snapshots may not contain shipmentHistory yet. Treat that as
  // an empty history instead of crashing the entire SKU detail route.
  const shipmentHistory = Array.isArray(documentMaster?.shipmentHistory)
    ? documentMaster.shipmentHistory.filter((item) => item.sku === sku)
    : [];
  const profitabilityRow = profitability?.rows
    .filter((item) => item.market === market && item.sku === sku)
    .sort((left, right) => right.reportMonth.localeCompare(left.reportMonth))[0] ?? null;
  return <><OpsPageHeader title={`${sku} · ${row?.productName ?? operatingRow?.productName ?? sku}`} description="先看经营摘要与依据；库存、订单、发货和产品资料按需展开。" />{operatingRow && <SkuOperatingCard row={operatingRow} period={operatingRow.history.at(-1)?.reportMonth ?? ""} rules={resolveOperatingRules(market, sku, operating.ruleOverrides)} rulesAvailable={operating.rulesAvailable} />}<details className="mt-5 rounded-xl border border-slate-200 bg-white p-4"><summary className="min-h-11 cursor-pointer text-sm font-medium">业务明细：库存、历史发货、订单、产品资料</summary><p className="mt-3 text-xs text-slate-500">这里的利润明细沿用 Excel 来源；已审核的积加经营事实以上方摘要为准。</p><div className="mt-4">{dashboard ? <SkuDetailDashboard dashboard={dashboard} profitability={profitabilityRow} product={product} sku={sku} canceledOrders={canceledOrders} purchaseOrders={purchaseOrders} shipmentHistory={shipmentHistory} /> : <p className="text-xs text-slate-500">该站点 SKU 暂无已核验库存报告。采购与发货关联尚未提供，不显示其他站点库存。</p>}</div></details></>;
}
