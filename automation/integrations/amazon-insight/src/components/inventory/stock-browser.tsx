"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, FileSpreadsheet, Plus, Search, ShoppingCart, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { OpsBadge, OpsCard, OpsCardHeader, OpsKpi } from "@/components/inventory/ops-ui";
import type { InventoryRisk } from "@/lib/inventory/contracts";
import { calculatePlanningRows, type InventoryPlanningViewModel, type StockPurchasePlanViewModel } from "@/lib/inventory/client-view-models";
import { days, integer, marketHref } from "@/lib/inventory/presentation";
import {
  aggregateCalendarSeasonality,
  buildSeasonalityProfile,
  latestMonthlyUnits,
  salesTrendPercent,
  trailingAverage,
  type SeasonalityBand,
} from "@/lib/inventory/seasonality";

type SortKey = "risk" | "sku" | "monthlySales" | "inventory" | "cover" | "shipment" | "purchase" | "seasonality";
type SortDirection = "asc" | "desc";
type StockSource = "all" | "fba" | "awd" | "domestic" | "pending";
type SeasonFilter = "all" | SeasonalityBand | "upcoming";
type PurchaseFilter = "all" | "recommended" | "none";

const pageSize = 40;
const riskLabels: Record<InventoryRisk, string> = { critical: "紧急", watch: "关注", healthy: "健康", excess: "过量", data: "数据待补" };
const riskTones: Record<InventoryRisk, "rose" | "amber" | "emerald" | "slate"> = { critical: "rose", watch: "amber", healthy: "emerald", excess: "slate", data: "amber" };
const riskRank: Record<InventoryRisk, number> = { critical: 0, watch: 1, data: 2, healthy: 3, excess: 4 };
const seasonLabels: Record<SeasonalityBand, string> = { peak: "旺季中", steady: "相对平稳", low: "淡季", insufficient: "样本不足" };

export function StockBrowser({ data, purchasePlan }: { data: InventoryPlanningViewModel; purchasePlan: StockPurchasePlanViewModel }) {
  const currentMonth = new Date(data.generatedAt).getUTCMonth() + 1;
  const latestSalesMonth = data.sales.historyMonths.at(-1) ?? data.sales.windowMonths.at(-1) ?? "最近月";
  const purchaseBySku = useMemo(() => new Map(purchasePlan.rows.map((row) => [row.sku, row])), [purchasePlan.rows]);
  const calculated = useMemo(() => calculatePlanningRows(data).map((row) => {
    const history = row.salesHistoryByMonth.length ? row.salesHistoryByMonth : row.salesByMonth;
    const seasonality = buildSeasonalityProfile(history, currentMonth);
    const upcomingPeak = seasonality.band !== "peak" && (seasonality.nextQuarterFactor ?? 0) >= 1.15;
    return {
      ...row,
      history,
      seasonality,
      upcomingPeak,
      prefix: row.sku.slice(0, 2),
      latestMonthlySales: latestMonthlyUnits(history, latestSalesMonth),
      averageThreeMonths: trailingAverage(history, 3),
      trendPercent: salesTrendPercent(history, 3),
      networkInventory: row.fbaSellable + row.awdAvailable + row.awdOutboundToFba,
      availableInventory: row.fbaSellable + row.awdAvailable + row.awdOutboundToFba + row.localInventory,
      supplyTotal: row.fbaSellable + row.awdAvailable + row.awdOutboundToFba + row.localInventory + row.pendingOrderQty,
      suggestedPurchaseQty: purchaseBySku.get(row.sku)?.suggestedPurchaseQty ?? 0,
      wholeCartonReadyQty: Math.floor(row.readyToShipQty / Math.max(1, row.cartonQty ?? 1)) * Math.max(1, row.cartonQty ?? 1),
    };
  }), [currentMonth, data, latestSalesMonth, purchaseBySku]);

  const [query, setQuery] = useState("");
  const [risk, setRisk] = useState<"all" | InventoryRisk>("all");
  const [prefix, setPrefix] = useState("all");
  const [stockSource, setStockSource] = useState<StockSource>("all");
  const [season, setSeason] = useState<SeasonFilter>("all");
  const [purchaseFilter, setPurchaseFilter] = useState<PurchaseFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("risk");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [page, setPage] = useState(1);
  const [planSkus, setPlanSkus] = useState<Set<string>>(new Set());
  const [planBusySku, setPlanBusySku] = useState("");
  const [purchaseBusy, setPurchaseBusy] = useState<"filtered" | "automatic" | "">("");
  const [purchaseMessage, setPurchaseMessage] = useState("");

  useEffect(() => {
    fetch(`/api/inventory/shipment-plan?market=${data.market}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => setPlanSkus(new Set((payload?.items ?? []).map((item: { sku: string }) => item.sku))))
      .catch(() => undefined);
  }, [data.market]);

  const prefixes = useMemo(() => [...new Set(calculated.map((row) => row.prefix))].sort(), [calculated]);
  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toUpperCase();
    const matches = calculated.filter((row) => {
      if (normalizedQuery && !`${row.sku} ${row.productName}`.toUpperCase().includes(normalizedQuery)) return false;
      if (risk !== "all" && row.riskLevel !== risk) return false;
      if (prefix !== "all" && row.prefix !== prefix) return false;
      if (season !== "all" && (season === "upcoming" ? !row.upcomingPeak : row.seasonality.band !== season)) return false;
      if (purchaseFilter === "recommended" && row.suggestedPurchaseQty <= 0) return false;
      if (purchaseFilter === "none" && row.suggestedPurchaseQty > 0) return false;
      if (stockSource === "fba" && row.fbaSellable <= 0) return false;
      if (stockSource === "awd" && row.awdAvailable + row.awdOutboundToFba <= 0) return false;
      if (stockSource === "domestic" && row.localInventory <= 0) return false;
      if (stockSource === "pending" && row.pendingOrderQty <= 0) return false;
      return true;
    });
    const direction = sortDirection === "asc" ? 1 : -1;
    return matches.sort((left, right) => {
      let comparison = 0;
      if (sortKey === "sku") comparison = left.sku.localeCompare(right.sku);
      if (sortKey === "risk") comparison = riskRank[left.riskLevel] - riskRank[right.riskLevel] || right.suggestedShipmentQty - left.suggestedShipmentQty;
      if (sortKey === "monthlySales") comparison = left.latestMonthlySales - right.latestMonthlySales;
      if (sortKey === "inventory") comparison = left.supplyTotal - right.supplyTotal;
      if (sortKey === "cover") comparison = (left.daysCoverNetwork ?? Number.MAX_SAFE_INTEGER) - (right.daysCoverNetwork ?? Number.MAX_SAFE_INTEGER);
      if (sortKey === "shipment") comparison = left.suggestedShipmentQty - right.suggestedShipmentQty;
      if (sortKey === "purchase") comparison = left.suggestedPurchaseQty - right.suggestedPurchaseQty;
      if (sortKey === "seasonality") comparison = (left.seasonality.currentFactor ?? -1) - (right.seasonality.currentFactor ?? -1);
      return comparison * direction || left.sku.localeCompare(right.sku);
    });
  }, [calculated, prefix, purchaseFilter, query, risk, season, sortDirection, sortKey, stockSource]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const chartRows = [...filtered].sort((a, b) => b.supplyTotal - a.supplyTotal).slice(0, 10).map((row) => ({
    sku: row.sku,
    FBA: row.fbaSellable,
    AWD: row.awdAvailable + row.awdOutboundToFba,
    国内现货: row.localInventory,
    未完工: row.pendingOrderQty,
    月销量: row.latestMonthlySales,
  }));
  const aggregateHistory = aggregateCalendarSeasonality(filtered.map((row) => row.history));
  const aggregateSeasonality = buildSeasonalityProfile(aggregateHistory, currentMonth);
  const seasonChart = aggregateSeasonality.calendarMonths.map((point) => ({
    month: `${point.month}月`,
    monthNumber: point.month,
    index: point.factor === null ? 0 : Math.round(point.factor * 100),
    averageUnits: point.averageUnits,
  }));
  const monthlySales = filtered.reduce((sum, row) => sum + row.latestMonthlySales, 0);
  const networkInventory = filtered.reduce((sum, row) => sum + row.networkInventory, 0);
  const localInventory = filtered.reduce((sum, row) => sum + row.localInventory, 0);
  const pendingOrders = filtered.reduce((sum, row) => sum + row.pendingOrderQty, 0);
  const dailySales = filtered.reduce((sum, row) => sum + row.dailySales, 0);
  const weightedCover = dailySales > 0 ? networkInventory / dailySales : null;
  const critical = filtered.filter((row) => row.riskLevel === "critical").length;
  const topSupplyRow = [...filtered].sort((left, right) => right.supplyTotal - left.supplyTotal)[0];
  const peakMonths = aggregateSeasonality.peakMonths.map((month) => `${month}月`).join("、");
  const filteredPurchaseRows = filtered.filter((row) => row.suggestedPurchaseQty > 0);
  const filteredPurchaseUnits = filteredPurchaseRows.reduce((sum, row) => sum + row.suggestedPurchaseQty, 0);
  const automaticPurchaseRows = purchasePlan.rows.filter((row) => row.suggestedPurchaseQty > 0);

  function changeFilter(update: () => void) { update(); setPage(1); }
  function changeSort(next: SortKey) {
    if (sortKey === next) setSortDirection((current) => current === "asc" ? "desc" : "asc");
    else { setSortKey(next); setSortDirection(next === "sku" || next === "risk" || next === "cover" ? "asc" : "desc"); }
    setPage(1);
  }
  function resetFilters() {
    setQuery(""); setRisk("all"); setPrefix("all"); setStockSource("all"); setSeason("all"); setPurchaseFilter("all"); setSortKey("risk"); setSortDirection("asc"); setPage(1);
  }

  async function generatePurchaseTable(rows: Array<{ sku: string; suggestedPurchaseQty: number }>, mode: "merge" | "replace", source: "filtered" | "automatic") {
    setPurchaseBusy(source); setPurchaseMessage("");
    try {
      const response = await fetch("/api/inventory/purchase-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cycleDate: purchasePlan.cycle.nextReviewDate,
          mode,
          items: rows.map((row) => ({
            sku: row.sku,
            quantity: row.suggestedPurchaseQty,
            suggestedQuantity: row.suggestedPurchaseQty,
            note: source === "filtered" ? `${data.market} 库存筛选加入` : "系统自动推荐",
          })),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "生成采购表失败");
      setPurchaseMessage(`已生成 ${payload.items.length} 个 SKU 的采购草稿，正在打开采购计划。`);
      window.location.assign("/inventory/purchasing?source=stock");
    } catch (error) {
      setPurchaseMessage(error instanceof Error ? error.message : "生成采购表失败");
      setPurchaseBusy("");
    }
  }

  async function addToShipmentPlan(row: (typeof calculated)[number]) {
    setPlanBusySku(row.sku);
    try {
      const response = await fetch("/api/inventory/shipment-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ market: data.market, action: "upsert", item: { sku: row.sku, quantity: row.wholeCartonReadyQty, suggestedQuantity: row.wholeCartonReadyQty, note: "", reason: row.reason, snapshotDate: data.snapshots.fbaDate } }),
      });
      if (!response.ok) return;
      setPlanSkus((current) => new Set([...current, row.sku]));
    } finally {
      setPlanBusySku("");
    }
  }

  return <div className="space-y-5">
    <div className="ops-kpi-grid grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      <OpsKpi label="筛选 SKU" value={integer(filtered.length)} detail={`全部 ${integer(calculated.length)} 个 SKU`} />
      <OpsKpi label="海外可用库存" value={integer(networkInventory)} detail={`综合覆盖 ${days(weightedCover)}`} />
      <OpsKpi label="共享国内库存池" value={integer(localInventory)} detail={`共享未完工 ${integer(pendingOrders)} 件 · 美加共用`} />
      <OpsKpi label={`${latestSalesMonth} 月销量`} value={integer(monthlySales)} detail="当前可识别的最新实际月份" tone="positive" />
      <OpsKpi label="紧急 SKU" value={integer(critical)} detail="库存覆盖短于海运船期" tone={critical ? "danger" : "positive"} />
      <OpsKpi label="季节位置" value={seasonLabel(aggregateSeasonality.band, (aggregateSeasonality.nextQuarterFactor ?? 0) >= 1.15)} detail={`当前 ${currentMonth} 月 · 指数 ${formatFactor(aggregateSeasonality.currentFactor)}`} tone={aggregateSeasonality.band === "peak" ? "warning" : "default"} />
    </div>

    <div className="border border-blue-200 bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-900">“国内现货”和“未完工订单”均来自美加共享库存池 {data.domesticPool.id}，切换站点时显示的是同一批国内供应，不可跨站重复相加。</div>

    <OpsCard className="border-emerald-200 bg-emerald-50/30">
      <div className="grid gap-4 p-5 lg:grid-cols-[1fr_auto] lg:items-center">
        <div className="flex min-w-0 items-start gap-3">
          <ShoppingCart className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
          <div><h2 className="text-sm font-semibold text-slate-950">从库存筛选生成采购表</h2><p className="mt-1 text-xs leading-5 text-slate-600">当前筛选中有 {integer(filteredPurchaseRows.length)} 个 SKU 建议采购，共 {integer(filteredPurchaseUnits)} 件。筛选加入会保留采购表已有内容；自动推荐会按最新库存、销量、船期和在途订单重建整期采购表。</p></div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!filteredPurchaseRows.length || Boolean(purchaseBusy)} onClick={() => void generatePurchaseTable(filteredPurchaseRows, "merge", "filtered")} className="inline-flex items-center gap-2 border border-emerald-700 bg-white px-3 py-2 text-xs font-semibold text-emerald-800 disabled:opacity-40"><Plus className="h-3.5 w-3.5" />{purchaseBusy === "filtered" ? "生成中…" : "筛选加入采购表"}</button>
          <button type="button" disabled={!automaticPurchaseRows.length || Boolean(purchaseBusy)} onClick={() => void generatePurchaseTable(automaticPurchaseRows, "replace", "automatic")} className="inline-flex items-center gap-2 border border-slate-900 bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"><FileSpreadsheet className="h-3.5 w-3.5" />{purchaseBusy === "automatic" ? "生成中…" : "自动推荐生成采购表"}</button>
        </div>
      </div>
      {purchaseMessage ? <p className="border-t border-emerald-200 px-5 py-2.5 text-xs text-emerald-800">{purchaseMessage}</p> : null}
    </OpsCard>

    <OpsCard>
      <OpsCardHeader title="筛选与排序" description={`当前命中 ${integer(filtered.length)}/${integer(calculated.length)} 个 SKU，其中 ${critical} 个紧急、${filteredPurchaseRows.length} 个存在采购建议。`} action={<SlidersHorizontal className="h-4 w-4 text-slate-400" />} />
      <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-7">
        <label className="relative lg:col-span-2"><span className="sr-only">搜索 SKU 或产品</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => changeFilter(() => setQuery(event.target.value))} placeholder="搜索 SKU 或产品名称" className="w-full border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-emerald-600" /></label>
        <FilterSelect label="库存状态" value={risk} onChange={(value) => changeFilter(() => setRisk(value as typeof risk))} options={[['all','全部状态'],['critical','紧急'],['watch','关注'],['healthy','健康'],['excess','库存过量'],['data','数据待补']]} />
        <FilterSelect label="SKU 系列" value={prefix} onChange={(value) => changeFilter(() => setPrefix(value))} options={[["all","全部系列"], ...prefixes.map((item) => [item,item] as [string,string])]} />
        <FilterSelect label="库存来源" value={stockSource} onChange={(value) => changeFilter(() => setStockSource(value as StockSource))} options={[['all','全部来源'],['fba','有 FBA 库存'],['awd','有 AWD 库存'],['domestic','有共享国内现货'],['pending','有共享未完工订单']]} />
        <FilterSelect label="季节位置" value={season} onChange={(value) => changeFilter(() => setSeason(value as SeasonFilter))} options={[['all','全部季节'],['peak','旺季中'],['upcoming','旺季将至'],['steady','相对平稳'],['low','淡季'],['insufficient','样本不足']]} />
        <FilterSelect label="采购建议" value={purchaseFilter} onChange={(value) => changeFilter(() => setPurchaseFilter(value as PurchaseFilter))} options={[['all','全部采购状态'],['recommended','仅看建议采购'],['none','无需采购']]} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-xs text-slate-500"><span>已找到 {integer(filtered.length)} 个 SKU</span><button type="button" onClick={resetFilters} className="font-medium text-emerald-700 hover:underline">清除全部筛选</button></div>
    </OpsCard>

    <div className="grid gap-4 xl:grid-cols-[1.45fr_.75fr]">
      <OpsCard><OpsCardHeader title="主要 SKU 库存结构" description={topSupplyRow ? `${topSupplyRow.sku} 供应总量最高（${integer(topSupplyRow.supplyTotal)} 件），${latestSalesMonth} 销量为 ${integer(topSupplyRow.latestMonthlySales)} 件。` : "当前筛选没有可展示的库存 SKU。"} /><div className="h-[330px] p-4" role="img" aria-label="主要 SKU 的 FBA、AWD、国内现货、未完工订单与月销量对比图"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={chartRows} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}><CartesianGrid stroke="#e5e7eb" vertical={false} /><XAxis dataKey="sku" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} /><YAxis yAxisId="stock" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} /><YAxis yAxisId="sales" orientation="right" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} /><Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} /><Bar yAxisId="stock" dataKey="FBA" stackId="stock" fill="#0f766e" /><Bar yAxisId="stock" dataKey="AWD" stackId="stock" fill="#38bdf8" /><Bar yAxisId="stock" dataKey="国内现货" stackId="stock" fill="#2563eb" /><Bar yAxisId="stock" dataKey="未完工" stackId="stock" fill="#d97706" /><Line yAxisId="sales" type="monotone" dataKey="月销量" stroke="#be123c" strokeWidth={2} dot={{ r: 2 }} /></ComposedChart></ResponsiveContainer></div></OpsCard>
      <OpsCard><OpsCardHeader title="季节销量指数" description={aggregateSeasonality.currentFactor === null ? "当前筛选样本不足，暂不能判断季节位置。" : `当前 ${currentMonth} 月指数 ${formatFactor(aggregateSeasonality.currentFactor)}，历史旺季集中在 ${peakMonths || "暂无明确月份"}。`} /><div className="h-[330px] p-4" role="img" aria-label="一月至十二月的季节销量指数"><ResponsiveContainer width="100%" height="100%"><BarChart data={seasonChart} margin={{ top: 18, right: 4, left: -18, bottom: 0 }}><CartesianGrid stroke="#e5e7eb" vertical={false} /><XAxis dataKey="month" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} /><YAxis domain={[0, "dataMax + 20"]} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} /><Tooltip formatter={(value) => [`${value}%`, "季节指数"]} /><Bar dataKey="index" radius={[3,3,0,0]}>{seasonChart.map((point) => <Cell key={point.month} fill={point.monthNumber === currentMonth ? "#0f766e" : point.index >= 120 ? "#d97706" : "#94a3b8"} />)}</Bar></BarChart></ResponsiveContainer></div><div className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">历史旺季：{aggregateSeasonality.peakMonths.map((month) => `${month}月`).join("、") || "样本不足"} · 未来三个月指数 {formatFactor(aggregateSeasonality.nextQuarterFactor)}</div></OpsCard>
    </div>

    <OpsCard>
      <OpsCardHeader title="SKU 库存清单" description={`${latestSalesMonth} 当前筛选销量 ${integer(monthlySales)} 件、海外库存 ${integer(networkInventory)} 件，综合覆盖 ${days(weightedCover)}。`} action={<span className="text-xs text-slate-500">第 {safePage} / {pageCount} 页</span>} />
      <div className="overflow-x-auto"><table className="w-full min-w-[1740px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase tracking-[0.08em] text-slate-500"><tr>
        <SortableHeader label="SKU / 产品" column="sku" current={sortKey} direction={sortDirection} onSort={changeSort} />
        <SortableHeader label={`${latestSalesMonth} 月销量`} column="monthlySales" current={sortKey} direction={sortDirection} onSort={changeSort} align="right" />
        <th className="px-3 py-3 text-right">近3月均销</th><th className="px-3 py-3">销量趋势</th>
        <SortableHeader label="季节性" column="seasonality" current={sortKey} direction={sortDirection} onSort={changeSort} />
        <th className="px-3 py-3 text-right">FBA</th><th className="px-3 py-3 text-right">AWD</th><th className="px-3 py-3 text-right">共享国内现货</th><th className="px-3 py-3 text-right">共享未完工</th>
        <SortableHeader label="供应总量" column="inventory" current={sortKey} direction={sortDirection} onSort={changeSort} align="right" />
        <SortableHeader label="海外覆盖" column="cover" current={sortKey} direction={sortDirection} onSort={changeSort} align="right" />
        <SortableHeader label="状态" column="risk" current={sortKey} direction={sortDirection} onSort={changeSort} />
        <SortableHeader label="建议发货" column="shipment" current={sortKey} direction={sortDirection} onSort={changeSort} align="right" />
        <th className="px-4 py-3 text-right">发货计划</th>
        <SortableHeader label="建议采购" column="purchase" current={sortKey} direction={sortDirection} onSort={changeSort} align="right" />
      </tr></thead><tbody className="divide-y divide-slate-100">{visible.map((row) => <tr key={row.sku} className="hover:bg-slate-50"><td className="px-4 py-3"><Link href={marketHref(`/inventory/sku/${encodeURIComponent(row.sku)}`, data.market)} className="font-mono font-semibold text-emerald-700 hover:underline">{row.sku}</Link><p className="mt-1 max-w-72 truncate text-slate-500">{row.productName}</p></td><td className="px-3 py-3 text-right text-sm font-semibold text-slate-900">{integer(row.latestMonthlySales)}</td><td className="px-3 py-3 text-right">{integer(row.averageThreeMonths)}</td><td className="px-3 py-3"><SalesSparkline history={row.history.slice(-12)} trend={row.trendPercent} /></td><td className="px-3 py-3"><OpsBadge tone={seasonTone(row.seasonality.band, row.upcomingPeak)}>{seasonLabel(row.seasonality.band, row.upcomingPeak)}</OpsBadge><p className="mt-1 text-[10px] text-slate-400">旺季 {row.seasonality.peakMonths.map((month) => `${month}月`).join("/") || "—"}</p></td><td className="px-3 py-3 text-right">{integer(row.fbaSellable)}</td><td className="px-3 py-3 text-right">{integer(row.awdAvailable + row.awdOutboundToFba)}</td><td className="px-3 py-3 text-right font-medium text-blue-700">{integer(row.localInventory)}</td><td className="px-3 py-3 text-right text-amber-700">{integer(row.pendingOrderQty)}</td><td className="px-3 py-3 text-right font-semibold">{integer(row.supplyTotal)}</td><td className="px-3 py-3 text-right">{days(row.daysCoverNetwork)}</td><td className="px-3 py-3"><OpsBadge tone={riskTones[row.riskLevel]}>{riskLabels[row.riskLevel]}</OpsBadge></td><td className="px-4 py-3 text-right font-semibold text-emerald-700">{integer(row.suggestedShipmentQty)}</td><td className="px-4 py-3 text-right">{row.wholeCartonReadyQty > 0 ? <button type="button" disabled={planSkus.has(row.sku) || Boolean(planBusySku)} onClick={() => void addToShipmentPlan(row)} className="inline-flex items-center gap-1 text-emerald-700 hover:underline disabled:text-slate-400 disabled:no-underline"><Plus className="h-3.5 w-3.5" />{planSkus.has(row.sku) ? "已在计划" : planBusySku === row.sku ? "加入中…" : `加入 ${integer(row.wholeCartonReadyQty)} 件`}</button> : <span className="text-slate-400">无整箱国内现货</span>}</td><td className="px-4 py-3 text-right font-semibold text-blue-700">{row.suggestedPurchaseQty > 0 ? integer(row.suggestedPurchaseQty) : <span className="font-normal text-slate-400">—</span>}</td></tr>)}</tbody></table></div>
      {!visible.length ? <div className="p-10 text-center text-sm text-slate-500">没有符合当前筛选条件的 SKU。</div> : null}
      <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3"><p className="text-xs text-slate-500">每页 {pageSize} 个，共 {integer(filtered.length)} 个</p><div className="flex gap-2"><button type="button" disabled={safePage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="border border-slate-200 bg-white px-3 py-1.5 text-xs disabled:opacity-40">上一页</button><button type="button" disabled={safePage >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))} className="border border-slate-200 bg-white px-3 py-1.5 text-xs disabled:opacity-40">下一页</button></div></div>
    </OpsCard>
  </div>;
}

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: Array<[string,string]>; onChange: (value: string) => void }) {
  return <label><span className="sr-only">{label}</span><select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="w-full border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-emerald-600">{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select></label>;
}

function SortableHeader({ label, column, current, direction, onSort, align = "left" }: { label: string; column: SortKey; current: SortKey; direction: SortDirection; onSort: (column: SortKey) => void; align?: "left" | "right" }) {
  const Icon = current === column ? direction === "asc" ? ArrowUp : ArrowDown : ArrowUpDown;
  return <th className={`px-3 py-3 ${align === "right" ? "text-right" : ""}`}><button type="button" onClick={() => onSort(column)} className={`inline-flex items-center gap-1 font-semibold ${align === "right" ? "ml-auto" : ""}`}>{label}<Icon className="h-3 w-3" /></button></th>;
}

function SalesSparkline({ history, trend }: { history: Array<{ month: string; units: number }>; trend: number | null }) {
  const maximum = Math.max(1, ...history.map((point) => point.units));
  return <div className="flex items-center gap-2"><div className="flex h-7 w-24 items-end gap-[2px]" aria-label={`最近 ${history.length} 个月销量趋势`}>{history.map((point) => <span key={point.month} className="min-w-0 flex-1 bg-emerald-500/70" style={{ height: `${Math.max(8, point.units / maximum * 100)}%` }} />)}</div><span className={`w-12 text-right text-[10px] font-medium ${trend === null ? "text-slate-400" : trend > 10 ? "text-emerald-700" : trend < -10 ? "text-rose-700" : "text-slate-500"}`}>{trend === null ? "—" : `${trend >= 0 ? "+" : ""}${trend.toFixed(0)}%`}</span></div>;
}

function seasonLabel(band: SeasonalityBand, upcomingPeak: boolean) { return upcomingPeak ? "旺季将至" : seasonLabels[band]; }
function seasonTone(band: SeasonalityBand, upcomingPeak: boolean): "amber" | "blue" | "slate" { return band === "peak" || upcomingPeak ? "amber" : band === "low" ? "blue" : "slate"; }
function formatFactor(value: number | null) { return value === null ? "—" : `${Math.round(value * 100)}%`; }
