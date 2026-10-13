"use client";

import { ArrowUpRight, PackageOpen } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { OpsBadge, OpsCard, OpsCardHeader, OpsKpi } from "@/components/inventory/ops-ui";
import { CanceledPurchaseOrders, OrderLine } from "@/components/inventory/pending-orders";
import { SkuOrderHistory } from "@/components/inventory/sku-order-history";
import { SkuShipmentHistory } from "@/components/inventory/sku-shipment-history";
import type { ProductCatalogItem, ProfitabilityData } from "@/lib/inventory/contracts";
import type { ShipmentHistoryItem } from "@/lib/inventory/data";
import type { PurchaseOrderReview } from "@/lib/inventory/purchase-order-reviews";
import type { SkuPurchaseOrderDetail } from "@/lib/inventory/purchase-orders";
import {
  days,
  fullCurrency as formatCurrency,
  integer,
  marketHref,
} from "@/lib/inventory/presentation";
import type { SkuDetailViewModel } from "@/lib/inventory/sku-detail-view-model";

export function SkuDetailDashboard({ dashboard, product, sku, canceledOrders, purchaseOrders, shipmentHistory }: { dashboard: SkuDetailViewModel; profitability: ProfitabilityData["rows"][number] | null; product: ProductCatalogItem | null; sku: string; canceledOrders: PurchaseOrderReview[]; purchaseOrders: SkuPurchaseOrderDetail[]; shipmentHistory: ShipmentHistoryItem[] }) {
  const { row, variant, engineeringSpecifications, campaigns } = dashboard;
  const fullCurrency = (value: number) => formatCurrency(value, dashboard.currency);
  const adSpend = campaigns.reduce((sum, item) => sum + item.spend, 0);
  const adSales = campaigns.reduce((sum, item) => sum + item.advertisingSales, 0);
  const adOrders = campaigns.reduce((sum, item) => sum + item.orders, 0);
  const salesHistory = row.salesHistoryByMonth.length ? row.salesHistoryByMonth : row.salesByMonth;
  const inventoryChart = [
    { label: "FBA 可售", value: row.fbaSellable, fill: "var(--chart-primary)" },
    { label: "AWD 可用", value: row.awdAvailable, fill: "#64748b" },
    { label: "AWD→FBA", value: row.awdOutboundToFba, fill: "#d97706" },
    { label: "在途库存", value: row.inTransitInventory, fill: "#06b6d4" },
    ...(row.domesticSupplyBreakdownVerified === false ? [{ label: "国内组合供应（拆分待核实）", value: row.domesticSupplyTotal, fill: "var(--chart-primary)" }] : [
      { label: "共享国内现货", value: row.localInventory, fill: "var(--chart-primary)" },
      { label: "共享未完工订单", value: row.pendingOrderQty, fill: "#d97706" },
    ]),
  ];
  const totalSupply = inventoryChart.reduce((sum, item) => sum + item.value, 0);
  const lowConfidenceSpecifications = engineeringSpecifications.filter((item) => item.confidence === "low").length;
  const productSpecificationCoverage = product ? [
    product.fnsku, product.chineseName || row.productName, product.englishName, product.packaging, product.hsCode,
    product.cartonQty, product.productWeightG, product.shippingSizeCm, product.cartonDimensionsCm.length, product.cartonGrossWeightKg,
  ].filter((value) => value !== null && value !== undefined && value !== "").length : 0;

  return <div className="space-y-4">
    {variant ? <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500"><span>{variant.categoryL1} / {variant.categoryL2}</span><OpsBadge>{variant.variantValue || "默认款"}</OpsBadge></div> : null}
    <p className="ops-subtext">当前库存 · 国内供应为美加共享池 {dashboard.domesticPoolId}</p>
    <div className="ops-kpi-grid grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <OpsKpi label="FBA 可售" value={integer(row.fbaSellable)} detail={`预留 ${integer(row.fbaReservedTransfer + row.fbaReservedProcessing)}`} />
      <OpsKpi label="AWD 可用" value={integer(row.awdAvailable)} detail={`在库 ${integer(row.awdOnHand)}`} />
      <OpsKpi label={row.domesticSupplyBreakdownVerified === false ? "国内组合供应" : "国内现货"} value={integer(row.domesticSupplyBreakdownVerified === false ? row.domesticSupplyTotal : row.localInventory)} detail={row.domesticSupplyBreakdownVerified === false ? "含现货及订单 · 拆分待核实" : "共享供应池"} />
      <OpsKpi label="海外库存与在途" value={integer(row.eligibleInventoryPosition)} detail={`覆盖 ${days(row.daysCoverNetwork)}`} />
    </div>

    {row.pendingOrders.length ? <details id="pending-orders" className={`rounded-2xl border bg-white ${row.pendingOrders.some((order) => order.overdue) ? "border-rose-200" : "border-slate-200"}`}><summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4"><div><p className="text-sm font-semibold text-slate-900">{row.domesticSupplyBreakdownVerified === false ? "历史采购订单（当前拆分待核实）" : "进行中采购订单"}</p><p className="mt-1 text-xs text-slate-500">点击查看下单日期、订单数量、未完工数量和订单号；逾期任务可人工核查后取消</p></div><OpsBadge tone={row.pendingOrders.some((order) => order.overdue) ? "rose" : "blue"}>{integer(row.pendingOrderQty)} 件 · {row.pendingOrders.length} 单</OpsBadge></summary><div className="grid gap-x-5 border-t border-slate-100 px-5 py-1 md:grid-cols-2 xl:grid-cols-3">{row.pendingOrders.map((order) => <OrderLine key={`${order.poNumber}-${order.poDate}`} order={order} sku={sku} market={dashboard.market} />)}</div></details> : null}

    <CanceledPurchaseOrders reviews={canceledOrders} />

    <SkuShipmentHistory history={shipmentHistory} sku={sku} />

    <SkuOrderHistory orders={purchaseOrders} sku={sku} />

    <div className="grid gap-4 xl:grid-cols-2">
      <OpsCard><OpsCardHeader title="库存表历史销量" description={salesHistory.length ? `保留至 ${salesHistory.at(-1)?.month} 的原始库存规划记录；最新经营趋势见经营分析。` : "没有历史销量记录。"} /><div className="h-[260px] p-4"><ResponsiveContainer width="100%" height="100%"><BarChart data={salesHistory} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}><CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="month" tickFormatter={(value) => String(value).replace("-", ".")} minTickGap={22} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} /><YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} /><Tooltip labelFormatter={(value) => `${value} 原始销量记录`} /><Bar dataKey="units" name="销量" fill="var(--chart-primary)" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div></OpsCard>
      <OpsCard><OpsCardHeader title="库存结构" description={`当前各库存来源合计 ${integer(totalSupply)} 件，其中海外网络库存覆盖 ${days(row.daysCoverNetwork)}。`} /><div className="h-[260px] p-4"><ResponsiveContainer width="100%" height="100%"><BarChart data={inventoryChart} layout="vertical" margin={{ top: 8, right: 12, left: 20, bottom: 0 }}><CartesianGrid stroke="var(--border)" horizontal={false} /><XAxis type="number" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} /><YAxis type="category" dataKey="label" width={72} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} /><Tooltip /><Bar dataKey="value" name="数量" fill="var(--chart-primary)" radius={[0, 3, 3, 0]} /></BarChart></ResponsiveContainer></div></OpsCard>
    </div>

    {engineeringSpecifications.length ? <OpsCard id="engineering-specifications"><OpsCardHeader title="工程参数提取" description={`已提取 ${engineeringSpecifications.length} 项工程参数，${lowConfidenceSpecifications ? `其中 ${lowConfidenceSpecifications} 项低置信度需人工复核` : "当前没有低置信度参数"}。`} /><div className="grid gap-px border-t border-slate-100 bg-slate-200 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{engineeringSpecifications.map((fact) => <div key={`${fact.key}-${fact.value}`} className="bg-white p-4"><div className="flex items-start justify-between gap-3"><p className="text-[10px] font-semibold text-slate-400">{fact.label}</p><OpsBadge tone={fact.confidence === "high" ? "emerald" : fact.confidence === "medium" ? "blue" : "amber"}>{fact.confidence === "high" ? "高置信" : fact.confidence === "medium" ? "中置信" : "待复核"}</OpsBadge></div><p className="mt-2 break-words text-sm font-semibold leading-5 text-slate-900">{fact.value}</p><p className="mt-2 text-[10px] text-slate-500">来源：{fact.sourceLabel}</p></div>)}</div></OpsCard> : null}

    {product ? <div className="grid gap-4 xl:grid-cols-[.85fr_1.15fr]">
      <OpsCard id="product-specifications"><OpsCardHeader title="产品规格" description={`关键发货与报关字段已覆盖 ${productSpecificationCoverage}/10 项，${productSpecificationCoverage < 10 ? `仍有 ${10 - productSpecificationCoverage} 项待补` : "资料已齐全"}。`} /><div className="grid gap-5 p-5 sm:grid-cols-[150px_1fr]"><div className="flex aspect-square items-center justify-center overflow-hidden border border-slate-200 bg-slate-50">{product.imageFile ? <Image unoptimized width={150} height={150} src={`/api/inventory/products/${encodeURIComponent(sku)}/image`} alt={`${sku} 产品图`} className="h-full w-full object-contain p-2" /> : <div className="px-4 text-center text-xs leading-5 text-slate-400">源表暂无<br />产品图片</div>}</div><div className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-3"><Spec label="FNSKU" value={product.fnsku || "—"} mono /><Spec label="中文品名" value={product.chineseName || row.productName} /><Spec label="英文品名" value={product.englishName || "—"} /><Spec label="包装方式" value={product.packaging || "—"} /><Spec label="HS 编码" value={product.hsCode || "—"} mono /><Spec label="装箱量" value={product.cartonQty ? `${integer(product.cartonQty)} 件/箱` : "—"} /><Spec label="单品重量" value={product.productWeightG === null ? "—" : `${product.productWeightG} g`} /><Spec label="产品 Shipping 尺寸" value={product.shippingSizeCm || "—"} /><Spec label="外箱尺寸" value={formatDimensions(product)} /><Spec label="箱净重" value={product.cartonNetWeightKg === null ? "—" : `${product.cartonNetWeightKg} kg`} /><Spec label="箱毛重" value={product.cartonGrossWeightKg === null ? "—" : `${product.cartonGrossWeightKg} kg`} /><Spec label="单箱体积" value={product.cartonVolumeM3 === null ? "—" : `${product.cartonVolumeM3} m³`} /></div></div>{product.productDescription ? <details className="border-t border-slate-100 px-5 py-4"><summary className="cursor-pointer text-xs font-medium text-emerald-700">展开产品具体描述</summary><p className="mt-3 whitespace-pre-line text-xs leading-6 text-slate-600">{product.productDescription}</p></details> : null}</OpsCard>
      <OpsCard id="listing-information"><OpsCardHeader title="Listing 信息" description={product.listing ? `${product.listing.brand || "MEASUREMAN"} · ${product.listing.sourceSheet} 系列` : "当前 Listing 表未匹配"} />{product.listing ? <div className="space-y-5 p-5"><div><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Title</p><p className="mt-2 text-sm font-medium leading-6 text-slate-900">{product.listing.title || "标题待补充"}</p></div>{product.listing.bullets.length ? <div><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Bullet Points</p><ol className="mt-2 space-y-2">{product.listing.bullets.map((bullet, index) => <li key={`${index}-${bullet.slice(0, 24)}`} className="flex gap-3 text-xs leading-5 text-slate-600"><span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center bg-emerald-50 font-mono text-[10px] font-semibold text-emerald-700">{index + 1}</span><span>{bullet}</span></li>)}</ol></div> : null}{Object.keys(product.listing.attributes).length ? <div className="grid grid-cols-2 gap-x-5 gap-y-3 border-t border-slate-100 pt-4">{Object.entries(product.listing.attributes).map(([key, value]) => <Spec key={key} label={listingAttributeLabels[key] ?? key} value={value} />)}</div> : null}</div> : <div className="p-8 text-sm text-slate-500">该 SKU 在当前 Listing 文件中没有可识别内容。</div>}</OpsCard>
    </div> : <OpsCard className="p-6 text-sm text-slate-500">当前 SKU 尚未匹配到产品规格或 Listing 数据。</OpsCard>}

    <details className="ops-surface p-4">
      <summary className="min-h-11 cursor-pointer text-sm font-medium">历史广告活动资料 · {campaigns.length} 个活动</summary>
      <OpsCard><OpsCardHeader title="历史活动记录" description={`原始资料累计花费 ${fullCurrency(adSpend)} · 归因销售 ${fullCurrency(adSales)} · ${adOrders} 单；不代表所选经营月份。`} action={<Link href={marketHref("/inventory/advertising", dashboard.market)} className="ops-link">广告资料 <ArrowUpRight className="inline h-3.5 w-3.5" /></Link>} />
        {campaigns.length > 0 ? <div className="divide-y divide-slate-100">{campaigns.map((campaign) => <div key={campaign.campaign} className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(80px,.5fr))] md:items-center"><div><p className="text-sm font-medium text-slate-900">{campaign.campaign}</p><p className="mt-1 text-xs text-slate-500">{campaign.status}</p></div><Mini label="花费" value={fullCurrency(campaign.spend)} /><Mini label="归因销售" value={fullCurrency(campaign.advertisingSales)} /><Mini label="ACOS" value={campaign.acos === null ? "—" : `${campaign.acos.toFixed(1)}%`} /></div>)}</div> : <div className="grid place-items-center gap-2 p-10 text-center"><PackageOpen className="h-7 w-7 text-slate-300" /><p className="text-sm text-slate-500">没有历史广告活动资料。</p></div>}
      </OpsCard>
    </details>
  </div>;
}

function Mini({ label, value }: { label: string; value: string }) { return <div><p className="text-[10px] text-slate-400">{label}</p><p className="mt-1 text-xs font-medium text-slate-800">{value}</p></div>; }

function Spec({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) { return <div className="min-w-0"><p className="text-[10px] text-slate-400">{label}</p><p className={`mt-1 break-words text-xs font-medium leading-5 text-slate-800 ${mono ? "font-mono" : ""}`}>{value}</p></div>; }

function formatDimensions(product: ProductCatalogItem) { const { length, width, height } = product.cartonDimensionsCm; return [length, width, height].every((value) => value !== null) ? `${length} × ${width} × ${height} cm` : "—"; }

const listingAttributeLabels: Record<string, string> = { workingPressure: "工作压力", usageFeatures: "使用特点", mainMaterial: "主体材质", materialFeatures: "材质特点", inflationHeadType: "充气头类型", threadSpecification: "螺纹规格", applicableTo: "适用范围", sellingPointSummary: "卖点总结" };
