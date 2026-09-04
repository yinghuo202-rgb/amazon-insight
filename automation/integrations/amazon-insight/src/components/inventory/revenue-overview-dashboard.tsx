"use client";

import { ArrowRight, ArrowUpRight, Search, TrendingDown, TrendingUp } from "lucide-react";
import Link from "next/link";
import { Area, AreaChart, CartesianGrid, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { OpsBadge, OpsCard, OpsCardHeader, OpsKpi } from "@/components/inventory/ops-ui";
import type { CombinedOverviewViewModel } from "@/lib/inventory/dashboard-view-model";
import { compact, days, fullCurrency, integer, marketHref } from "@/lib/inventory/presentation";

export function RevenueOverviewDashboard({ dashboard }: { dashboard: CombinedOverviewViewModel }) {
  const latest = dashboard.revenueKpis.latest;
  const annual = dashboard.revenueKpis.annual;
  const latestRevenuePoint = dashboard.revenueTrend.at(-1);
  const previousRevenuePoint = dashboard.revenueTrend.at(-2);
  const revenueDelta = {
    US: previousRevenuePoint && previousRevenuePoint.美国站销售额 > 0 ? (latestRevenuePoint!.美国站销售额 - previousRevenuePoint.美国站销售额) / previousRevenuePoint.美国站销售额 * 100 : null,
    CA: previousRevenuePoint && previousRevenuePoint.加拿大站销售额 > 0 ? (latestRevenuePoint!.加拿大站销售额 - previousRevenuePoint.加拿大站销售额) / previousRevenuePoint.加拿大站销售额 * 100 : null,
  };
  return <div className="space-y-5">
    <section className="overflow-hidden rounded-2xl border border-slate-800 bg-[#0b1220] text-white shadow-[0_18px_50px_rgba(15,23,42,.16)]">
      <div className="grid gap-5 px-5 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(300px,420px)] lg:items-center">
        <div><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-blue-500/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-blue-300">Revenue Command Center</span><span className="text-[10px] text-emerald-300">{dashboard.revenueKpis.reportMonth ? `销售额基准 ${dashboard.revenueKpis.reportMonth}` : "销售额报告待更新"}</span></div><h2 className="mt-3 text-lg font-semibold tracking-[-0.02em] sm:text-xl">先看销售额变化，再打开需要复核的 SKU</h2><p className="mt-2 max-w-2xl text-xs leading-5 text-slate-400 sm:text-sm sm:leading-6">总览只保留销售额、利润、库存覆盖和重点变化；全量 SKU 通过搜索进入综合工作台。</p></div>
        <SkuSearchBox focusRows={dashboard.revenueFocusRows} />
      </div>
    </section>

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <OpsKpi label="US 最新月销售额" value={fullCurrency(latest.US.productSales, latest.US.currency)} detail={`实际利润 ${fullCurrency(latest.US.actualProfit, latest.US.currency)}`} tone="positive" icon={<TrendingUp className="h-4 w-4" />} />
      <OpsKpi label="CA 最新月销售额" value={fullCurrency(latest.CA.productSales, latest.CA.currency)} detail={`实际利润 ${fullCurrency(latest.CA.actualProfit, latest.CA.currency)}`} tone="positive" icon={<TrendingUp className="h-4 w-4" />} />
      <OpsKpi label="年度销售额 · US" value={fullCurrency(annual.US.productSales, annual.US.currency)} detail="按销售额口径累计" />
      <OpsKpi label="年度销售额 · CA" value={fullCurrency(annual.CA.productSales, annual.CA.currency)} detail="按销售额口径累计" />
      <OpsKpi label="重点变化 SKU" value={integer(dashboard.revenueFocusRows.length)} detail="仅显示需复核的少量对象" tone="warning" icon={<TrendingDown className="h-4 w-4" />} />
    </section>

    <div className="grid gap-5 xl:grid-cols-[1.25fr_.75fr]">
      <OpsCard className="overflow-hidden"><OpsCardHeader title="销售额趋势" description={`最近月环比：US ${formatDelta(revenueDelta.US)} · CA ${formatDelta(revenueDelta.CA)}；两站点保留各自原币种，不做汇率合并。`} action={<OpsBadge tone="blue">原币种</OpsBadge>} /><div className="h-[330px] px-2 pb-4 pt-5 sm:px-5"><ResponsiveContainer width="100%" height="100%"><AreaChart data={dashboard.revenueTrend} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}><defs><linearGradient id="usRevenueGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2563eb" stopOpacity={0.25} /><stop offset="100%" stopColor="#2563eb" stopOpacity={0.02} /></linearGradient></defs><CartesianGrid stroke="#e8edf4" vertical={false} /><XAxis dataKey="month" tickFormatter={(value) => String(value).replace("-", ".")} minTickGap={18} tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} /><YAxis tickFormatter={compact} tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} /><Tooltip contentStyle={tooltipStyle} formatter={(value, name) => [fullCurrency(Number(value), name === "美国站销售额" ? latest.US.currency : latest.CA.currency), name]} /><Legend wrapperStyle={{ fontSize: 11, paddingTop: 12 }} /><Area type="monotone" dataKey="美国站销售额" stroke="#2563eb" strokeWidth={2.6} fill="url(#usRevenueGradient)" dot={false} /><Line type="monotone" dataKey="加拿大站销售额" stroke="#d97706" strokeWidth={2.2} dot={false} /></AreaChart></ResponsiveContainer></div><div className="grid gap-px border-t border-slate-100 bg-slate-100 sm:grid-cols-2"><RevenueFootnote label="美国站" value={fullCurrency(latest.US.productSales, latest.US.currency)} detail={`年度 ${fullCurrency(annual.US.productSales, annual.US.currency)}`} /><RevenueFootnote label="加拿大站" value={fullCurrency(latest.CA.productSales, latest.CA.currency)} detail={`年度 ${fullCurrency(annual.CA.productSales, annual.CA.currency)}`} /></div></OpsCard>
      <OpsCard className="overflow-hidden"><OpsCardHeader title="数据与范围" description="页面默认不加载全量 SKU 表，避免在总览中重复浏览。" /><div className="space-y-3 p-5"><ScopeRow label="US 库存 SKU" value={integer(dashboard.markets.find((market) => market.code === "US")?.skuCount ?? 0)} /><ScopeRow label="CA 库存 SKU" value={integer(dashboard.markets.find((market) => market.code === "CA")?.skuCount ?? 0)} /><ScopeRow label="最新销售额报告" value={dashboard.revenueKpis.reportMonth ?? "待更新"} /><ScopeRow label="库存快照" value={dashboard.snapshots.every((snapshot) => !snapshot.isStale) ? "双站可用" : "存在过期站点"} /><p className="border-t border-slate-100 pt-3 text-xs leading-5 text-slate-500">需要查看全部数据时，进入“库存视图”或“数据更新”；需要判断单个 SKU 时，直接使用上方搜索。</p><Link href="/inventory/data" className="ops-link">检查数据新鲜度 <ArrowUpRight className="h-3.5 w-3.5" /></Link></div></OpsCard>
    </div>

    <RevenueFocusQueue rows={dashboard.revenueFocusRows} />
  </div>;
}

function SkuSearchBox({ focusRows }: { focusRows: CombinedOverviewViewModel["revenueFocusRows"] }) {
  return <form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const sku = String(form.get("sku") ?? "").trim().toUpperCase(); const market = String(form.get("market") ?? "US"); if (sku) window.location.assign(marketHref(`/inventory/sku/${encodeURIComponent(sku)}`, market)); }} className="rounded-2xl border border-white/10 bg-white/[0.06] p-3"><label className="mb-2 block text-[10px] font-medium uppercase tracking-[0.14em] text-slate-400">打开单个 SKU 综合工作台</label><div className="flex gap-2"><div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" /><input name="sku" list="focus-sku-suggestions" placeholder="输入 SKU，例如 MA289" className="w-full rounded-xl border border-white/10 bg-slate-950/40 py-2.5 pl-9 pr-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-blue-400" /><datalist id="focus-sku-suggestions">{focusRows.map((row) => <option key={`${row.market}:${row.sku}`} value={row.sku}>{row.market} · {row.productName}</option>)}</datalist></div><select name="market" defaultValue="US" aria-label="选择站点" className="w-20 rounded-xl border border-white/10 bg-slate-950/40 px-2 text-xs text-white outline-none"><option value="US">US</option><option value="CA">CA</option></select><button type="submit" className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 text-xs font-semibold text-white transition hover:bg-blue-500">打开 <ArrowRight className="h-3.5 w-3.5" /></button></div><p className="mt-2 text-[10px] leading-4 text-slate-500">可输入任意 SKU；下拉提示仅展示当前重点变化对象。</p></form>;
}

function RevenueFocusQueue({ rows }: { rows: CombinedOverviewViewModel["revenueFocusRows"] }) {
  return <OpsCard className="overflow-hidden"><OpsCardHeader title="重点变化队列" description="这里只展示少量需要优先复核的对象，不代表系统替你做出经营判断；点击进入单 SKU 证据页。" action={<Link href="/inventory/brief" className="ops-link">查看完整简报 <ArrowUpRight className="h-3.5 w-3.5" /></Link>} />{rows.length ? <div className="divide-y divide-slate-100">{rows.map((row, index) => <Link key={`${row.market}:${row.sku}`} href={row.href} className="group grid gap-3 px-4 py-4 transition hover:bg-slate-50 sm:grid-cols-[32px_minmax(0,1.4fr)_130px_120px_120px_minmax(220px,1fr)_auto] sm:items-center sm:px-5"><span className="grid h-7 w-7 place-items-center rounded-full bg-slate-100 font-mono text-[11px] text-slate-500">{index + 1}</span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-sm font-semibold text-slate-900">{row.sku}</span><OpsBadge tone={row.market === "US" ? "blue" : "amber"}>{row.market}</OpsBadge></div><p className="mt-1 truncate text-xs text-slate-500">{row.parentSku} · {row.productName}</p></div><RevenueMetric label="最新月销售额" value={fullCurrency(row.productSales, row.currency)} /><RevenueMetric label="实际利润率" value={row.actualMargin === null ? "—" : `${(row.actualMargin * 100).toFixed(1)}%`} /><RevenueMetric label="近3月趋势" value={row.trendPercent === null ? "—" : `${row.trendPercent >= 0 ? "+" : ""}${row.trendPercent.toFixed(1)}%`} tone={row.trendPercent !== null && row.trendPercent < 0 ? "negative" : "positive"} /><div className="flex flex-wrap gap-1">{row.signals.map((signal) => <OpsBadge key={signal} tone={signal.includes("不足") || signal.includes("偏低") || signal.includes("下降") ? "amber" : "slate"}>{signal}</OpsBadge>)}<span className="text-[10px] text-slate-400">覆盖 {days(row.daysCoverNetwork)}</span></div><ArrowUpRight className="h-4 w-4 text-slate-300 transition group-hover:text-blue-600" /></Link>)}</div> : <div className="p-8 text-center text-sm text-slate-500">当前没有可展示的重点变化 SKU。</div>}</OpsCard>;
}

function RevenueMetric({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "positive" | "negative" }) { return <div><p className="text-[10px] text-slate-400">{label}</p><p className={`mt-1 text-xs font-semibold ${tone === "positive" ? "text-emerald-700" : tone === "negative" ? "text-rose-700" : "text-slate-800"}`}>{value}</p></div>; }
function RevenueFootnote({ label, value, detail }: { label: string; value: string; detail: string }) { return <div className="bg-white px-5 py-3"><p className="text-[10px] text-slate-400">{label}</p><p className="mt-1 text-sm font-semibold text-slate-900">{value}</p><p className="mt-0.5 text-[10px] text-slate-500">{detail}</p></div>; }
function ScopeRow({ label, value }: { label: string; value: string }) { return <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3.5 py-3 text-xs"><span className="text-slate-500">{label}</span><span className="font-medium text-slate-900">{value}</span></div>; }
function formatDelta(value: number | null) { return value === null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`; }
const tooltipStyle = { border: "1px solid #e2e8f0", borderRadius: 12, boxShadow: "0 12px 30px rgba(15,23,42,.1)", fontSize: 12 };
