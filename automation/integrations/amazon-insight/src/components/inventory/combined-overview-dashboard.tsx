"use client";

import { ArrowRight, ArrowUpRight, Boxes, CircleAlert, ClockAlert, Megaphone, PackageCheck, Store, TrendingDown, TrendingUp, Warehouse } from "lucide-react";
import Link from "next/link";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { OpsBadge, OpsCard, OpsCardHeader, OpsKpi } from "@/components/inventory/ops-ui";
import type { CombinedOverviewViewModel } from "@/lib/inventory/dashboard-view-model";
import { compact, currency, days, integer, inventoryActionLabels, marketHref } from "@/lib/inventory/presentation";

export function CombinedOverviewDashboard({ dashboard }: { dashboard: CombinedOverviewViewModel }) {
  const { kpis } = dashboard;
  const salesChange = kpis.salesChangePercent;
  const latestSales = dashboard.salesTrend.at(-1);
  const actualMonths = dashboard.annualPerformance.filter((point) => point.美国站 + point.加拿大站 > 0);
  const actualYtd = actualMonths.reduce((sum, point) => sum + point.美国站 + point.加拿大站, 0);
  const planYtd = actualMonths.reduce((sum, point) => sum + point.计划销量, 0);
  const planVariance = planYtd ? (actualYtd - planYtd) / planYtd * 100 : null;
  const riskLeader = [...dashboard.riskDistribution].sort((left, right) => right.紧急 + right.关注 - left.紧急 - left.关注)[0];
  const inventoryLeader = [...dashboard.inventoryComposition].sort((left, right) => right.FBA + right.AWD + right.调拨中 - left.FBA - left.AWD - left.调拨中)[0];
  const advertisingGap = dashboard.advertisingEfficiency
    .filter((item) => item.ACOS !== null)
    .map((item) => ({ ...item, gap: Number(item.ACOS) - item.目标ACOS }))
    .sort((left, right) => right.gap - left.gap)[0];
  const prioritySku = dashboard.priorityRows[0];
  const staleMarketCount = dashboard.snapshots.filter((snapshot) => snapshot.isStale).length;

  return <div className="space-y-5">
    <section className="overflow-hidden rounded-2xl border border-slate-800 bg-[#0b1220] text-white shadow-[0_18px_50px_rgba(15,23,42,.16)]">
      <div className="grid gap-5 px-5 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-blue-500/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-blue-300">今日经营简报</span><span className={`inline-flex items-center gap-1.5 text-[10px] ${staleMarketCount ? "text-amber-300" : "text-emerald-300"}`}><span className={`h-1.5 w-1.5 rounded-full ${staleMarketCount ? "bg-amber-400" : "bg-emerald-400"}`} />{staleMarketCount ? `${staleMarketCount} 个站点库存快照需更新` : "双站库存快照可用"}</span></div>
          <h2 className="mt-3 text-lg font-semibold tracking-[-0.02em] sm:text-xl">先处理库存缺口与采购交期，再承接增长机会</h2>
          <p className="mt-2 max-w-3xl text-xs leading-5 text-slate-400 sm:text-sm sm:leading-6">系统已把今天最值得关注的异常收敛为三个执行入口，点击即可进入对应工作台，无需从图表中重复查找。</p>
        </div>
        <Link href="/inventory/data" className="inline-flex w-fit items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3.5 py-2.5 text-xs font-medium text-slate-200 transition hover:border-blue-400/40 hover:bg-blue-500/10 hover:text-white">检查数据新鲜度 <ArrowRight className="h-3.5 w-3.5" /></Link>
      </div>
      <div className="grid gap-px border-t border-white/[0.08] bg-white/[0.08] sm:grid-cols-3">
        <PriorityAction href="/inventory/replenishment" icon={<CircleAlert className="h-4 w-4" />} label="库存优先级" value={`${integer(kpis.criticalSkuCount)} 个紧急 SKU`} detail={`建议发货 ${integer(kpis.suggestedShipmentQty)} 件`} tone="rose" />
        <PriorityAction href="/inventory/purchasing/orders" icon={<ClockAlert className="h-4 w-4" />} label="采购交期" value={`${integer(dashboard.overdueOrders.length)} 条超期任务`} detail="进入订单队列逐项复核" tone="amber" />
        <PriorityAction href="/inventory/advertising" icon={<Megaphone className="h-4 w-4" />} label="广告动作" value={`${integer(kpis.advertisingAdjustments)} 项待处理`} detail="按库存约束控量或扩量" tone="blue" />
      </div>
    </section>

    <section className="ops-kpi-grid grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <OpsKpi label="双站海外库存" value={integer(kpis.networkInventory)} detail="FBA、AWD 与调拨中库存" icon={<Warehouse className="h-4 w-4" />} />
      <OpsKpi label="最新月总销量" value={integer(kpis.latestSalesUnits)} detail={salesChange === null ? "缺少环比基期" : `环比 ${salesChange >= 0 ? "+" : ""}${salesChange.toFixed(1)}%`} tone={salesChange !== null && salesChange < 0 ? "warning" : "positive"} icon={salesChange !== null && salesChange < 0 ? <TrendingDown className="h-4 w-4" /> : <TrendingUp className="h-4 w-4" />} />
      <OpsKpi label="紧急库存 SKU" value={integer(kpis.criticalSkuCount)} detail={`建议发货 ${integer(kpis.suggestedShipmentQty)} 件`} tone={kpis.criticalSkuCount ? "danger" : "positive"} icon={<CircleAlert className="h-4 w-4" />} />
      <OpsKpi label="共享国内供应" value={integer(dashboard.sharedSupply.localInventory + dashboard.sharedSupply.pendingOrderQty)} detail={`现货 ${integer(dashboard.sharedSupply.localInventory)} · 未完工 ${integer(dashboard.sharedSupply.pendingOrderQty)}`} tone={dashboard.sharedSupply.overdueOrderCount ? "warning" : "default"} icon={<Boxes className="h-4 w-4" />} />
      <OpsKpi label={`${dashboard.actualYear} 双站销量`} value={compact(kpis.annualUnits)} detail={`${kpis.advertisingAdjustments} 项广告动作待处理`} icon={<PackageCheck className="h-4 w-4" />} />
    </section>

    <OpsCard className="overflow-hidden">
      <OpsCardHeader title="双站销量脉冲" description={latestSales ? `${latestSales.month} 双站销量 ${integer(latestSales.总销量)} 件${salesChange === null ? "" : `，环比${salesChange >= 0 ? "增长" : "下降"} ${Math.abs(salesChange).toFixed(1)}%`}。` : "当前没有可用的双站月度销量。"} action={<div className="flex items-center gap-2"><OpsBadge tone="blue">24M</OpsBadge><span className="font-mono text-[11px] text-slate-400">更新 {formatGeneratedAt(dashboard.generatedAt)}</span></div>} />
      <div className="h-[320px] px-2 pb-4 pt-5 sm:h-[430px] sm:px-5" role="img" aria-label="美国站、加拿大站与双站总销量趋势">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={dashboard.salesTrend} margin={{ top: 12, right: 16, left: 0, bottom: 0 }}>
            <defs><linearGradient id="totalSalesGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2563eb" stopOpacity={0.26} /><stop offset="100%" stopColor="#2563eb" stopOpacity={0.015} /></linearGradient></defs>
            <CartesianGrid stroke="#e8edf4" vertical={false} />
            <XAxis dataKey="month" tickFormatter={(value) => String(value).replace("-", ".")} minTickGap={18} tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={compact} width={46} tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={(value) => `${value} 实际销量`} formatter={(value) => [`${integer(Number(value))} 件`]} />
            <Legend wrapperStyle={{ fontSize: 11, paddingTop: 12 }} />
            <Area type="monotone" dataKey="总销量" stroke="#2563eb" strokeWidth={2.8} fill="url(#totalSalesGradient)" dot={false} activeDot={{ r: 4 }} />
            <Line type="monotone" dataKey="美国站" stroke="#0f766e" strokeWidth={1.8} dot={false} />
            <Line type="monotone" dataKey="加拿大站" stroke="#d97706" strokeWidth={1.8} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="grid gap-px border-t border-slate-100 bg-slate-100 sm:grid-cols-2">
        {dashboard.snapshots.map((snapshot) => <div key={snapshot.code} className="flex items-center justify-between gap-3 bg-white px-5 py-3 text-xs"><div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${snapshot.isStale ? "bg-rose-500" : "bg-emerald-500"}`} /><strong className="text-slate-800">{snapshot.label}</strong><span className="text-slate-400">库存 {snapshot.date}</span></div><span className="text-slate-500">销量至 {snapshot.latestSalesMonth || "—"}{snapshot.awdAvailable ? "" : " · 仅FBA"}</span></div>)}
      </div>
    </OpsCard>

    <div className="grid gap-5 xl:grid-cols-[1.35fr_.8fr]">
      <OpsCard className="overflow-hidden">
        <OpsCardHeader title="年度销量：实际 vs 计划" description={planVariance === null ? `${dashboard.actualYear} 已实现 ${integer(actualYtd)} 件，当前缺少同期计划基准。` : `${dashboard.actualYear} 截至 ${actualMonths.at(-1)?.month ?? "当前月"} 月累计 ${integer(actualYtd)} 件，较同期计划${planVariance >= 0 ? "高" : "低"} ${Math.abs(planVariance).toFixed(1)}%。`} />
        <div className="h-[360px] px-3 pb-4 pt-5" role="img" aria-label="年度实际销量和计划销量对比">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={dashboard.annualPerformance} margin={{ top: 8, right: 12, left: -4, bottom: 0 }}>
              <CartesianGrid stroke="#e8edf4" vertical={false} />
              <XAxis dataKey="month" tickFormatter={(value) => `${Number(value)}月`} tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={compact} tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} formatter={(value) => [`${integer(Number(value))} 件`]} />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 12 }} />
              <Bar dataKey="美国站" stackId="actual" fill="#2563eb" radius={[0, 0, 0, 0]} />
              <Bar dataKey="加拿大站" stackId="actual" fill="#60a5fa" radius={[5, 5, 0, 0]} />
              <Line type="monotone" dataKey="计划销量" stroke="#d97706" strokeWidth={2.2} strokeDasharray="6 5" dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </OpsCard>

      <OpsCard className="overflow-hidden">
        <OpsCardHeader title="库存风险结构" description={riskLeader ? `${riskLeader.market}站紧急及关注 SKU 共 ${riskLeader.紧急 + riskLeader.关注} 个，为当前风险较集中的站点。` : "当前没有可用的库存风险数据。"} />
        <div className="h-[360px] px-4 pb-4 pt-5" role="img" aria-label="美加库存风险结构">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dashboard.riskDistribution} layout="vertical" margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
              <CartesianGrid stroke="#e8edf4" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="market" width={52} tick={{ fontSize: 11, fill: "#334155" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} formatter={(value) => [`${integer(Number(value))} SKU`]} />
              <Legend wrapperStyle={{ fontSize: 10, paddingTop: 12 }} />
              <Bar dataKey="紧急" stackId="risk" fill="#e11d48" />
              <Bar dataKey="关注" stackId="risk" fill="#f59e0b" />
              <Bar dataKey="健康" stackId="risk" fill="#10b981" />
              <Bar dataKey="过量" stackId="risk" fill="#64748b" />
              <Bar dataKey="待补数据" stackId="risk" fill="#cbd5e1" radius={[0, 5, 5, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </OpsCard>
    </div>

    <div className="grid gap-5 xl:grid-cols-2">
      <OpsCard className="overflow-hidden"><OpsCardHeader title="海外库存构成" description={inventoryLeader ? `${inventoryLeader.market}站海外库存 ${integer(inventoryLeader.FBA + inventoryLeader.AWD + inventoryLeader.调拨中)} 件，为两站中库存规模较高的一站。` : "当前没有可用的海外库存数据。"} /><div className="h-[300px] px-4 py-5"><ResponsiveContainer width="100%" height="100%"><BarChart data={dashboard.inventoryComposition} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}><CartesianGrid stroke="#e8edf4" vertical={false} /><XAxis dataKey="market" tick={{ fontSize: 11, fill: "#475569" }} axisLine={false} tickLine={false} /><YAxis tickFormatter={compact} tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} /><Tooltip contentStyle={tooltipStyle} formatter={(value) => [`${integer(Number(value))} 件`]} /><Legend wrapperStyle={{ fontSize: 11 }} /><Bar dataKey="FBA" stackId="stock" fill="#2563eb" /><Bar dataKey="AWD" stackId="stock" fill="#0f766e" /><Bar dataKey="调拨中" stackId="stock" fill="#93c5fd" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer></div></OpsCard>
      <OpsCard className="overflow-hidden"><OpsCardHeader title="广告效率与动作" description={advertisingGap ? `${advertisingGap.market}站 ACOS ${Number(advertisingGap.ACOS).toFixed(1)}%，${advertisingGap.gap > 0 ? `高于目标 ${advertisingGap.gap.toFixed(1)} 个百分点` : `低于目标 ${Math.abs(advertisingGap.gap).toFixed(1)} 个百分点`}。` : "当前没有可比较的广告效率数据。"} action={<Link href="/inventory/advertising" className="ops-link">广告管理 <ArrowUpRight className="h-3.5 w-3.5" /></Link>} /><div className="h-[300px] px-4 py-5"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={dashboard.advertisingEfficiency} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}><CartesianGrid stroke="#e8edf4" vertical={false} /><XAxis dataKey="market" tick={{ fontSize: 11, fill: "#475569" }} axisLine={false} tickLine={false} /><YAxis unit="%" tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} /><Tooltip contentStyle={tooltipStyle} /><Legend wrapperStyle={{ fontSize: 11 }} /><Bar dataKey="ACOS" fill="#7c3aed" radius={[5, 5, 0, 0]} /><Line type="monotone" dataKey="目标ACOS" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 4" /></ComposedChart></ResponsiveContainer></div></OpsCard>
    </div>

    <div className="grid gap-5 xl:grid-cols-2">
      {dashboard.markets.map((market) => <MarketPanel key={market.code} market={market} />)}
    </div>

    <div className="grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
      <OpsCard className="overflow-hidden"><OpsCardHeader title="优先执行 SKU" description={prioritySku ? `${prioritySku.sku}（${prioritySku.market}）建议优先发货 ${integer(prioritySku.suggestedShipmentQty)} 件，当前海外覆盖 ${days(prioritySku.daysCover)}。` : "当前没有需要优先发货的 SKU。"} action={<Link href="/inventory/replenishment" className="ops-link">进入发货计划 <ArrowUpRight className="h-3.5 w-3.5" /></Link>} /><div className="divide-y divide-slate-100">{dashboard.priorityRows.slice(0, 8).map((row, index) => <Link key={`${row.market}-${row.sku}`} href={marketHref(`/inventory/sku/${encodeURIComponent(row.sku)}`, row.market)} className="grid gap-3 px-5 py-3.5 transition hover:bg-slate-50/80 sm:grid-cols-[28px_minmax(0,1.4fr)_90px_90px_110px] sm:items-center"><span className="font-mono text-[11px] text-slate-400">{String(index + 1).padStart(2, "0")}</span><div className="min-w-0"><div className="flex items-center gap-2"><span className="font-mono text-xs font-semibold text-slate-900">{row.sku}</span><OpsBadge tone={row.market === "US" ? "blue" : "amber"}>{row.market}</OpsBadge><OpsBadge tone="rose">{inventoryActionLabels[row.action]}</OpsBadge></div><p className="mt-1 truncate text-xs text-slate-500">{row.productName}</p></div><SmallMetric label="日销" value={row.dailySales.toFixed(1)} /><SmallMetric label="海外覆盖" value={days(row.daysCover)} /><SmallMetric label="建议发货" value={integer(row.suggestedShipmentQty)} strong /></Link>)}</div></OpsCard>
      <OpsCard className={`overflow-hidden ${dashboard.overdueOrders.length ? "border-rose-200" : ""}`}><OpsCardHeader title="采购交期队列" description={dashboard.overdueOrders.length ? `${dashboard.overdueOrders.length} 条去重任务超过交期` : "当前没有超期采购任务"} action={<ClockAlert className={`h-4 w-4 ${dashboard.overdueOrders.length ? "text-rose-600" : "text-emerald-600"}`} />} />{dashboard.overdueOrders.length ? <div className="divide-y divide-slate-100">{dashboard.overdueOrders.slice(0, 8).map((order) => <Link key={order.key} href={marketHref(`/inventory/sku/${encodeURIComponent(order.sku)}#pending-orders`, order.markets.includes("US") ? "US" : "CA")} className="block px-5 py-3.5 hover:bg-rose-50/60"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><span className="font-mono text-xs font-semibold">{order.sku}</span><OpsBadge>{order.markets.join(" / ")}</OpsBadge></div><OpsBadge tone="rose">逾期 {order.overdueDays} 天</OpsBadge></div><p className="mt-1.5 text-[11px] text-slate-500">{order.poNumber} · 待完成 {integer(order.remainingQuantity)} 件 · {order.poDate}</p></Link>)}</div> : <div className="grid min-h-52 place-items-center p-8 text-center"><div><PackageCheck className="mx-auto h-8 w-8 text-emerald-500" /><p className="mt-3 text-sm font-semibold text-slate-800">采购交期正常</p><p className="mt-1 text-xs text-slate-500">共享国内供应池没有已识别的超期任务。</p></div></div>}</OpsCard>
    </div>
  </div>;
}

function MarketPanel({ market }: { market: CombinedOverviewViewModel["markets"][number] }) {
  return <OpsCard className="overflow-hidden"><div className="flex items-start justify-between gap-4 p-5"><div className="flex items-center gap-3"><span className={`grid h-10 w-10 place-items-center rounded-xl text-white shadow-sm ${market.code === "US" ? "bg-blue-600" : "bg-amber-500"}`}><Store className="h-4 w-4" /></span><div><div className="flex items-center gap-2"><h2 className="text-base font-semibold text-slate-950">{market.label}</h2><OpsBadge tone={market.isStale ? "rose" : "emerald"}>{market.isStale ? "库存过期" : "数据可用"}</OpsBadge></div><p className="mt-1 text-[11px] text-slate-500">{market.currency} · 库存 {market.snapshotDate} · 销量 {market.latestSalesMonth || "—"}</p></div></div><Link href={marketHref("/inventory/stock", market.code)} className="ops-icon-button" aria-label={`打开${market.label}库存`}><ArrowUpRight className="h-4 w-4" /></Link></div><div className="grid grid-cols-2 gap-px border-t border-slate-100 bg-slate-100 sm:grid-cols-3"><MarketMetric label="海外库存" value={integer(market.networkInventory)} detail={`FBA ${integer(market.fbaSellable)} · AWD ${integer(market.awdAvailable)}`} /><MarketMetric label="最近月销量" value={integer(market.latestMonthSales)} detail={`日均 ${market.dailySales.toFixed(1)} 件`} /><MarketMetric label="建议发货" value={integer(market.shipment)} detail={`${market.risk.critical} 个紧急 SKU`} danger={market.risk.critical > 0} /><MarketMetric label="年度销售额" value={currency(market.annualRevenue, market.currency)} detail={`${integer(market.annualUnits)} 件`} /><MarketMetric label="广告 ACOS" value={market.acos === null ? "—" : `${market.acos.toFixed(1)}%`} detail={`目标 ${market.targetAcos}%`} danger={market.acos !== null && market.acos > market.targetAcos} /><MarketMetric label="广告动作" value={`${market.adAdjustments} 项`} detail="需调整或扩量" /></div></OpsCard>;
}

function MarketMetric({ label, value, detail, danger = false }: { label: string; value: string; detail: string; danger?: boolean }) { return <div className="bg-white px-4 py-4"><p className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-400">{label}</p><p className={`mt-2 text-lg font-semibold tracking-[-0.02em] ${danger ? "text-rose-700" : "text-slate-950"}`}>{value}</p><p className="mt-1 text-[11px] text-slate-500">{detail}</p></div>; }
function SmallMetric({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) { return <div><p className="text-[10px] text-slate-400">{label}</p><p className={`mt-0.5 text-xs ${strong ? "font-semibold text-blue-700" : "font-medium text-slate-700"}`}>{value}</p></div>; }
function PriorityAction({ href, icon, label, value, detail, tone }: { href: string; icon: React.ReactNode; label: string; value: string; detail: string; tone: "rose" | "amber" | "blue" }) {
  const tones = { rose: "bg-rose-500/15 text-rose-300", amber: "bg-amber-500/15 text-amber-300", blue: "bg-blue-500/15 text-blue-300" };
  return <Link href={href} className="group flex items-center gap-3 bg-[#0b1220] px-5 py-4 transition hover:bg-slate-900"><span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${tones[tone]}`}>{icon}</span><div className="min-w-0"><p className="text-[10px] font-medium uppercase tracking-[0.12em] text-slate-500">{label}</p><p className="mt-1 truncate text-sm font-semibold text-white">{value}</p><p className="mt-0.5 truncate text-[10px] text-slate-400">{detail}</p></div><ArrowUpRight className="ml-auto h-4 w-4 shrink-0 text-slate-600 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-white" /></Link>;
}
function formatGeneratedAt(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date); }
const tooltipStyle = { border: "1px solid #e2e8f0", borderRadius: 12, boxShadow: "0 12px 30px rgba(15,23,42,.1)", fontSize: 12 };
