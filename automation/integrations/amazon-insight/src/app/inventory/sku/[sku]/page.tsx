import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OpsPageHeader, OpsKpi } from "@/components/inventory/ops-ui";
import { ProductArtwork } from "@/components/inventory/product-artwork";
import { fullCurrency } from "@/lib/inventory/presentation";
import { SkuOperatingAnalysis } from "@/components/inventory/sku-operating-analysis";
import { SkuDetailDashboard } from "@/components/inventory/sku-detail-dashboard";
import { SkuDetailSections } from "@/components/inventory/sku-detail-sections";
import { SkuShipmentHistory } from "@/components/inventory/sku-shipment-history";
import { TeamWorkbench } from "@/components/inventory/team-workbench";
import { withReportVersion } from "@/lib/inventory/report-version";
import { resolveOperatingRules } from "@/lib/inventory/operating-rules";
import { operatingFacts } from "@/lib/inventory/dashboard-view-model";
import { operatingFilters, operatingSorts } from "@/lib/inventory/operating-query";
import { operatingMarkets } from "@/lib/inventory/operating-performance";
import { skuOperatingHref } from "@/lib/inventory/operating-navigation";
import { loadOperatingModel, loadDocumentMasterData, loadInventoryDashboardData, loadProductCatalogData, loadVariantCatalogData } from "@/lib/inventory/data";
import { listLatestPurchaseOrderReviews } from "@/lib/inventory/purchase-order-reviews";
import { listSkuPurchaseOrderDetails } from "@/lib/inventory/purchase-orders";
import { buildSkuDetailViewModel } from "@/lib/inventory/sku-detail-view-model";

export const dynamic = "force-dynamic";
export async function generateMetadata({ params }: { params: Promise<{ sku: string }> }): Promise<Metadata> { const { sku } = await params; return { title: `${sku} SKU 分析` }; }
export default async function SkuPage({ params, searchParams }: { params: Promise<{ sku: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const search = await searchParams, requestedMarket = typeof search.market === "string" ? search.market.toUpperCase() : "US";
  if (!(operatingMarkets as readonly string[]).includes(requestedMarket)) notFound();
  const market = requestedMarket as typeof operatingMarkets[number];
  const sku = (await params).sku.toUpperCase();
  return withReportVersion(async () => {
  const [data, variants, products, initialPurchaseOrders, documentMaster, operating] = await Promise.all([
    loadInventoryDashboardData(market).catch(() => null),
    loadVariantCatalogData().catch(() => null), loadProductCatalogData().catch(() => null), listSkuPurchaseOrderDetails(sku).catch(() => []),
    loadDocumentMasterData().catch(() => ({ shipmentHistory: [] })), loadOperatingModel(),
  ]);
  const operatingRow = operating.rows.find(item => item.market === market && item.sku === sku)
    ?? operating.rows.find(item => item.market === market && item.sourceSkus.includes(sku));
  const row = data?.rows.find(item => item.sku === sku || item.sku === operatingRow?.sku);
  if (!row && !operatingRow) notFound();
  const period = typeof search.period === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(search.period) ? search.period : operating.periods[0] || "";
  const filter = typeof search.filter === "string" && (operatingFilters as readonly string[]).includes(search.filter) ? search.filter : "focus";
  const sort = typeof search.sort === "string" && (operatingSorts as readonly string[]).includes(search.sort) ? search.sort : "impact";
  const query = typeof search.query === "string" ? search.query.slice(0, 100) : "";
  const origin = search.origin === "overview" ? "overview" : "brief";
  const returnFilter = typeof search.returnFilter === "string" && (operatingFilters as readonly string[]).includes(search.returnFilter) ? search.returnFilter : filter;
  const returnPeriod = typeof search.returnPeriod === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(search.returnPeriod) ? search.returnPeriod : period;
  const context = { filter, sort, query, origin, returnFilter, returnPeriod };
  const returnHref = (origin === "overview" ? "/inventory?" : "/inventory/brief?") + new URLSearchParams({ market, period: returnPeriod, filter: returnFilter, sort, query });
  const resolvedSku = operatingRow?.sku ?? row?.sku ?? sku;
  const product = products?.items.find(item => item.sku === resolvedSku) ?? null;
  const purchaseOrders = resolvedSku === sku ? initialPurchaseOrders : await listSkuPurchaseOrderDetails(resolvedSku).catch(() => []);
  const dashboard = data && row ? buildSkuDetailViewModel(data, variants, product, row.sku) : null;
  const canceledOrders = listLatestPurchaseOrderReviews({ sku: resolvedSku, action: "cancel" });
  const shipmentHistory = Array.isArray(documentMaster?.shipmentHistory) ? documentMaster.shipmentHistory.filter(item => item.sku === resolvedSku && item.market === market) : [];
  const rules = resolveOperatingRules(market, resolvedSku, operating.ruleOverrides);
  const facts = operatingRow ? operatingFacts(operatingRow, period, rules, new Date(), operating.rulesAvailable) : null;
  const detailHref = skuOperatingHref(resolvedSku, market, period, context);
  const backendHref = (path: string) => path + "?" + new URLSearchParams({ market, period, query: resolvedSku, returnTo: detailHref });
  const initialTab = typeof search.tab === "string" ? search.tab : filter === "stock" ? "supply" : filter === "advertising" ? "advertising" : "analysis";
  const current = facts?.current;
  const currency = current?.currency || operatingRow?.currency || (market === "CA" ? "CAD" : "USD");
  const amount = (value: number | null | undefined) => value == null ? "—" : fullCurrency(value, currency);
  const percentage = (value: number | null | undefined) => value == null ? "—" : `${(value * 100).toFixed(1)}%`;
  return <>
    <Link href={returnHref} className="mb-4 inline-flex min-h-11 items-center text-sm text-[#0071e3]">返回{origin === "overview" ? "运营总览" : "SKU 简报"} · 保留筛选</Link>
    <div className="ops-detail-heading ops-surface mb-4 flex items-center gap-4 p-5"><ProductArtwork sku={resolvedSku} available={!!product?.imageFile} /><div className="min-w-0"><OpsPageHeader eyebrow={`${market} · ${period || "无经营期间"}`} title={resolvedSku} description={row?.productName ?? operatingRow?.productName ?? resolvedSku} />{current?.asin || current?.msku ? <p className="ops-subtext mt-2">{current?.asin ? `ASIN ${current.asin}` : ""}{current?.msku ? ` · Seller SKU ${current.msku}` : ""}</p> : null}</div></div>
    {facts && <section aria-label="SKU 经营指标" className="ops-detail-kpis mb-5 grid grid-cols-3 gap-3"><OpsKpi label="销售额" value={amount(current?.productSales)} detail={period} /><OpsKpi label={current?.quality?.profitVerified ? "实际利润" : "报告利润"} value={amount(current?.actualProfit)} detail={period} tone={current?.quality?.profitVerified && current.actualProfit !== null && current.actualProfit < 0 ? "danger" : "default"} /><OpsKpi label={current?.quality?.profitVerified ? "利润率" : "报告利润率"} value={percentage(current && current.productSales > 0 && current.actualProfit !== null ? current.actualProfit / current.productSales : null)} detail={period} /><OpsKpi label="平均成交价" value={amount(facts.averagePrice)} detail={period} /><OpsKpi label="广告花费" value={amount(facts.advertisingCost)} detail={facts.advertisingPeriod || "—"} /><OpsKpi label="退货率" value={percentage(facts.returnRate)} detail={period} /></section>}
    <SkuDetailSections initialTab={initialTab}
      analysis={<>{operatingRow && facts && <SkuOperatingAnalysis row={operatingRow} period={period} facts={facts} />}<nav aria-label="SKU 分析资料" className="mt-4 flex flex-wrap gap-3"><Link href={backendHref("/inventory/costs")} className="ops-text-link">产品成本</Link><Link href={backendHref("/inventory/advertising")} className="ops-text-link">广告活动</Link></nav></>}
      advertising={facts ? <section className="ops-surface p-5"><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><h2 className="ops-section-title">广告投入与销售表现</h2><span className="ops-subtext">{facts.advertisingPeriod || "暂无数据"}{facts.advertisingPeriod && facts.advertisingPeriod !== period ? " · 最近有数据月份" : ""}{facts.advertisingAsOf ? ` · 截至 ${facts.advertisingAsOf}` : ""}</span></div><div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><OpsKpi label="广告花费" value={amount(facts.advertisingCost)} detail={currency} /><OpsKpi label="广告归因销售" value={amount(facts.advertisingSales)} detail={currency} /><OpsKpi label="ACOS" value={percentage(facts.acos)} detail="花费 / 广告销售额" /><OpsKpi label="广告归因比" value={percentage(facts.advertisingShare)} detail={facts.advertisingPeriod !== period ? "跨月不计算占比" : "归因销售 / 同期商品销售"} /></div><p className="ops-subtext mt-4">归因销售可跨期或跨商品，归因比可超过 100%，不用于拆分自然销售。</p><Link href={backendHref("/inventory/advertising")} className="ops-text-link mt-4">查看广告明细</Link></section> : undefined}
      supply={<><nav aria-label="SKU 供应后台入口" className="mb-4 flex flex-wrap gap-3">{[["/inventory/stock", "库存视图"], ["/inventory/replenishment", "发货计划"], ["/inventory/purchasing", "采购计划"], ["/inventory/supply-chain", "订单与批次追溯"]].map(([path, label]) => <Link key={path} href={backendHref(path)} className="inline-flex min-h-11 items-center rounded-lg border bg-white px-3 text-sm text-[#0071e3]">{label}</Link>)}</nav><details open className="rounded-xl border border-slate-200 bg-white p-4"><summary className="min-h-11 cursor-pointer text-sm font-medium">业务明细：库存、历史发货、订单、产品资料</summary><p className="mt-3 text-xs leading-6 text-slate-500">库存与原始业务资料 · 国内供应为共享池 · 历史发货仅展示 {market}。</p><div className="mt-4">{dashboard ? <SkuDetailDashboard dashboard={dashboard} profitability={null} product={product} sku={resolvedSku} canceledOrders={canceledOrders} purchaseOrders={purchaseOrders} shipmentHistory={shipmentHistory} /> : <><p className="mb-4 text-xs text-slate-500">该站点暂无已核验库存报告，不显示其他站点库存，缺失不当作零。</p><SkuShipmentHistory sku={resolvedSku} history={shipmentHistory} /></>}</div></details></>}
      records={<TeamWorkbench review={{ sku: resolvedSku, market, period, version: operating.dataVersion, issues: facts ? [...facts.issues, ...facts.dataIssues] : [] }} />}
    />
  </>;
  });
}
