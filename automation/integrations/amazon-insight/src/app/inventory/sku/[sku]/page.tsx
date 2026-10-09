import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OpsPageHeader } from "@/components/inventory/ops-ui";
import { SkuDetailDashboard } from "@/components/inventory/sku-detail-dashboard";
import { SkuDetailSections } from "@/components/inventory/sku-detail-sections";
import { SkuShipmentHistory } from "@/components/inventory/sku-shipment-history";
import { SkuOperatingCard } from "@/components/inventory/revenue-overview-dashboard";
import { TeamWorkbench } from "@/components/inventory/team-workbench";
import { withReportVersion } from "@/lib/inventory/report-version";
import { resolveOperatingRules } from "@/lib/inventory/operating-rules";
import { operatingFacts } from "@/lib/inventory/dashboard-view-model";
import { operatingFilters, operatingSorts } from "@/lib/inventory/operating-query";
import { skuOperatingHref } from "@/lib/inventory/operating-navigation";
import { loadOperatingModel, loadDocumentMasterData, loadInventoryDashboardData, loadProductCatalogData, loadProfitabilityData, loadVariantCatalogData } from "@/lib/inventory/data";
import { listLatestPurchaseOrderReviews } from "@/lib/inventory/purchase-order-reviews";
import { listSkuPurchaseOrderDetails } from "@/lib/inventory/purchase-orders";
import { buildSkuDetailViewModel } from "@/lib/inventory/sku-detail-view-model";

export const dynamic = "force-dynamic";
export async function generateMetadata({ params }: { params: Promise<{ sku: string }> }): Promise<Metadata> { const { sku } = await params; return { title: `${sku} SKU 分析` }; }
export default async function SkuPage({ params, searchParams }: { params: Promise<{ sku: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const search = await searchParams, requestedMarket = typeof search.market === "string" ? search.market.toUpperCase() : "US";
  if (!["US", "CA", "MX"].includes(requestedMarket)) notFound();
  const market = requestedMarket as "US" | "CA" | "MX";
  const sku = (await params).sku.toUpperCase();
  const [data, variants, products, purchaseOrders, documentMaster, profitability, operating] = await withReportVersion(() => Promise.all([
    market !== "MX" ? loadInventoryDashboardData(market).catch(() => null) : Promise.resolve(null),
    loadVariantCatalogData().catch(() => null), loadProductCatalogData().catch(() => null), listSkuPurchaseOrderDetails(sku).catch(() => []),
    loadDocumentMasterData().catch(() => ({ shipmentHistory: [] })), loadProfitabilityData().catch(() => null), loadOperatingModel(),
  ]));
  const row = data?.rows.find(item => item.sku === sku), operatingRow = operating.rows.find(item => item.market === market && item.sku === sku);
  if (!row && !operatingRow) notFound();
  const period = typeof search.period === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(search.period) ? search.period : operating.periods[0] || "";
  const filter = typeof search.filter === "string" && (operatingFilters as readonly string[]).includes(search.filter) ? search.filter : "focus";
  const sort = typeof search.sort === "string" && (operatingSorts as readonly string[]).includes(search.sort) ? search.sort : "impact";
  const query = typeof search.query === "string" ? search.query.slice(0, 100) : "";
  const origin = search.origin === "overview" ? "overview" : "brief";
  const returnFilter = typeof search.returnFilter === "string" && (operatingFilters as readonly string[]).includes(search.returnFilter) ? search.returnFilter : filter;
  const context = { filter, sort, query, origin, returnFilter };
  const returnHref = (origin === "overview" ? "/inventory?" : "/inventory/brief?") + new URLSearchParams({ market, period, filter: returnFilter, sort, query });
  const product = products?.items.find(item => item.sku === sku) ?? null;
  const dashboard = data && row ? buildSkuDetailViewModel(data, variants, product, sku) : null;
  const canceledOrders = listLatestPurchaseOrderReviews({ sku, action: "cancel" });
  const shipmentHistory = Array.isArray(documentMaster?.shipmentHistory) ? documentMaster.shipmentHistory.filter(item => item.sku === sku && item.market === market) : [];
  const profitabilityRow = profitability?.rows.find(item => item.market === market && item.sku === sku && item.reportMonth === period) ?? null;
  const rules = resolveOperatingRules(market, sku, operating.ruleOverrides);
  const facts = operatingRow ? operatingFacts(operatingRow, period, rules, new Date(), operating.rulesAvailable) : null;
  const detailHref = skuOperatingHref(sku, market, period, context);
  const backendHref = (path: string) => path + "?" + new URLSearchParams({ market, period, query: sku, returnTo: detailHref });
  const initialTab = typeof search.tab === "string" ? search.tab : filter === "stock" ? "supply" : "analysis";
  return <>
    <Link href={returnHref} className="mb-4 inline-flex min-h-11 items-center text-sm text-[#0071e3]">返回{origin === "overview" ? "运营总览" : "SKU 简报"} · 保留筛选</Link>
    <OpsPageHeader title={`${sku} · ${row?.productName ?? operatingRow?.productName ?? sku}`} description="经营事实、供应情况与人工记录分开查看；提醒只是核查线索，不是经营结论。" />
    <p className="mb-4 text-xs leading-6 text-slate-500">{market} · {period || "无经营期间"} · Seller SKU {facts?.current?.msku || "未核验映射"} · ASIN {facts?.current?.asin || "未核验映射"} · 发布版本 {operating.publishedVersion || operating.dataVersion.slice(0, 12)}</p>
    {operatingRow && <SkuOperatingCard row={operatingRow} period={period} rules={rules} rulesAvailable={operating.rulesAvailable} initialEvidenceOpen={["loss", "advertising", "returns", "decline", "missing"].includes(filter)} context={context} />}
    <SkuDetailSections initialTab={initialTab}
      analysis={<section className="rounded-xl border border-black/5 bg-white p-5 text-sm leading-7"><h2 className="font-semibold">依据与解释</h2><p className="mt-2">本期经营事实以上方六项指标和“展开经营依据”为准。库存使用当前快照，不表示历史月末库存。</p><p className="text-slate-500">价格、流量、广告、退货与季节性可能影响经营结果；未完成费用和归因核验时，不据此确认原因或动作成效。</p><Link href={backendHref("/inventory/costs")} className="mt-3 inline-flex min-h-11 items-center text-[#0071e3]">查看同 SKU 产品成本资料</Link><Link href={backendHref("/inventory/advertising")} className="ml-4 mt-3 inline-flex min-h-11 items-center text-[#0071e3]">查看同 SKU 广告活动</Link></section>}
      supply={<><nav aria-label="SKU 供应后台入口" className="mb-4 flex flex-wrap gap-3">{[["/inventory/stock", "库存视图"], ["/inventory/replenishment", "发货计划"], ["/inventory/purchasing", "采购计划"], ["/inventory/supply-chain", "订单与批次追溯"]].map(([path, label]) => <Link key={path} href={backendHref(path)} className="inline-flex min-h-11 items-center rounded-lg border bg-white px-3 text-sm text-[#0071e3]">{label}</Link>)}</nav><details className="rounded-xl border border-slate-200 bg-white p-4"><summary className="min-h-11 cursor-pointer text-sm font-medium">业务明细：库存、历史发货、订单、产品资料</summary><p className="mt-3 text-xs leading-6 text-slate-500">库存为当前快照；国内采购为共享供应池，不按站点重复分配。利润明细仅显示所选月份的 Excel 来源；积加事实以上方摘要为准。发货记录仅展示 {market}。</p><div className="mt-4">{dashboard ? <SkuDetailDashboard dashboard={dashboard} profitability={profitabilityRow} product={product} sku={sku} canceledOrders={canceledOrders} purchaseOrders={purchaseOrders} shipmentHistory={shipmentHistory} /> : <><p className="mb-4 text-xs text-slate-500">该站点暂无已核验库存报告，不显示其他站点库存，缺失不当作零。</p><SkuShipmentHistory sku={sku} history={shipmentHistory} /></>}</div></details></>}
      records={<TeamWorkbench review={{ sku, market, period, version: operating.dataVersion, issues: facts ? [...facts.issues, ...facts.dataIssues] : [] }} />}
    />
  </>;
}
