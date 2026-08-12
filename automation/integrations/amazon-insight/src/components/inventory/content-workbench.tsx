"use client";

import { Search, Sparkles } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { OpsBadge, OpsCard, OpsKpi } from "@/components/inventory/ops-ui";
import { CreativeHandoffExportButton } from "@/components/inventory/creative-handoff-export-button";
import type { ContentListViewModel } from "@/lib/inventory/client-view-models";
import { integer } from "@/lib/inventory/presentation";

type VariantGroup = ContentListViewModel["groups"][number];

export function ContentWorkbench({ data }: { data: ContentListViewModel }) {
  const pageSize = 25;
  const [query, setQuery] = useState("");
  const [copyFilter, setCopyFilter] = useState("ALL");
  const [briefFilter, setBriefFilter] = useState("ALL");
  const [growthFilter, setGrowthFilter] = useState("GROWTH");
  const [marketFilter, setMarketFilter] = useState("ALL");
  const [category, setCategory] = useState("ALL");
  const [page, setPage] = useState(1);
  const normalized = query.trim().toLowerCase();
  const categories = useMemo(() => Array.from(new Set(data.tasks.map((task) => task.category).filter(Boolean))).sort(), [data.tasks]);
  const taskVariant = useMemo(() => {
    const mapping = new Map<string, { group: VariantGroup; variantValue: string }>();
    for (const item of data.variants) {
      if (item.role !== "Child" || mapping.has(item.sku)) continue;
      const group = data.groups.find((candidate) => candidate.market === item.market && candidate.parentSku === item.parentSku);
      if (group) mapping.set(item.sku, { group, variantValue: item.variantValue });
    }
    return mapping;
  }, [data.groups, data.variants]);
  const mappedGroups = data.groups;
  const [quickGroupKey, setQuickGroupKey] = useState("");
  const quickGroup = mappedGroups.find((group) => `${group.market}:${group.parentSku}` === quickGroupKey) ?? mappedGroups[0] ?? null;
  const quickMembers = quickGroup ? data.variants.filter((item) => item.market === quickGroup.market && item.parentSku === quickGroup.parentSku) : [];
  const [quickSku, setQuickSku] = useState("");
  const quickTargetSku = quickMembers.some((item) => item.sku === quickSku) ? quickSku : quickMembers[0]?.sku || "";

  const marketTasks = data.tasks.map((task) => {
    if (marketFilter === "ALL") return task;
    const opportunity = task.growth.marketOpportunities.find((item) => item.market === marketFilter);
    if (!opportunity) return task;
    return {
      ...task,
      growth: {
        ...task.growth,
        ...opportunity,
        targetMarket: opportunity.market,
        marketUnits: {
          US: opportunity.market === "US" ? opportunity.latestUnits : 0,
          CA: opportunity.market === "CA" ? opportunity.latestUnits : 0,
          MX: 0,
        },
      },
    };
  });
  const filtered = marketTasks.filter((task) => {
    const matchesQuery = !normalized || task.sku.toLowerCase().includes(normalized) || task.productName.toLowerCase().includes(normalized) || task.copy.title.toLowerCase().includes(normalized);
    const matchesCopy = copyFilter === "ALL" || task.copy.source === copyFilter;
    const matchesCategory = category === "ALL" || task.category === category;
    const hasArchive = task.mainImageBrief.source === "creative_archive" || task.aPlusBrief.source === "creative_archive";
    const matchesBrief = briefFilter === "ALL" || (briefFilter === "ARCHIVE" ? hasArchive : !hasArchive);
    const matchesGrowth = growthFilter === "ALL"
      || (growthFilter === "GROWTH" && ["SCALE", "WATCH"].includes(task.growth.status))
      || task.growth.status === growthFilter;
    return matchesQuery && matchesCopy && matchesCategory && matchesBrief && matchesGrowth;
  }).sort((left, right) => right.growth.priorityScore - left.growth.priorityScore || left.sku.localeCompare(right.sku));
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  return <div className="space-y-4">
    <div className="ops-kpi-grid grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <OpsKpi label="优先拉量" value={integer(data.summary.scaleCount)} detail={`${data.summary.latestMonth} · 有需求、正毛利且库存可承接`} tone="positive" />
      <OpsKpi label="验证后拉量" value={integer(data.summary.watchCount)} detail="先修转化与搜索词，再逐步增加预算" tone="warning" />
      <OpsKpi label="可承接库存" value={integer(data.summary.growthInventory)} detail="US + CA 可用库存，仅统计拉量候选" />
      <OpsKpi label="清货观察" value={integer(data.summary.clearanceCount)} detail="零销或覆盖过长，不纳入拉量预算" tone="danger" />
    </div>

    <OpsCard className="overflow-hidden border-emerald-200 bg-[linear-gradient(110deg,#f3faf7_0%,#ffffff_58%,#f8f6f0_100%)]">
      <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div>
          <div className="flex items-center gap-2 text-emerald-800"><Sparkles className="h-4 w-4" /><span className="text-[11px] font-semibold uppercase tracking-[0.14em]">Variant Content System</span></div>
          <h2 className="mt-2 text-lg font-semibold text-slate-950">按产品特性生成主图与 A+ 美工对接表</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-600">系统先提取材料、机芯、量程、精度、接口、尺寸与使用场景，再编排每个画面的信息目标。订单不参与画面策划；同系列历史文件只用于颜色、字体和构图一致性参考。</p>
        </div>
        <div className="flex flex-col gap-2 md:flex-row">
          <select value={quickGroup ? `${quickGroup.market}:${quickGroup.parentSku}` : ""} onChange={(event) => setQuickGroupKey(event.target.value)} className="w-full min-w-0 border border-emerald-200 bg-white px-3 py-2.5 text-xs text-slate-700 outline-none focus:border-emerald-600 md:w-auto md:min-w-56">{mappedGroups.map((group) => <option key={`${group.market}:${group.parentSku}`} value={`${group.market}:${group.parentSku}`}>{group.market} · {group.parentSku} · {group.familyName}</option>)}</select>
          <select value={quickTargetSku} onChange={(event) => setQuickSku(event.target.value)} className="w-full min-w-0 border border-emerald-200 bg-white px-3 py-2.5 text-xs text-slate-700 outline-none focus:border-emerald-600 md:w-auto md:min-w-40">{quickMembers.map((item) => <option key={item.sku} value={item.sku}>{item.sku} · {item.variantValue || "默认款"}</option>)}</select>
          {quickTargetSku ? <CreativeHandoffExportButton sku={quickTargetSku} /> : null}
        </div>
      </div>
    </OpsCard>

    <OpsCard>
      <div className="border-b border-slate-100 px-4 py-3"><h2 className="text-sm font-semibold text-slate-950">A+ 策划口径</h2><p className="mt-1 text-xs text-slate-500">先回答客户为什么需要，再用可核验的产品事实证明；每个模块只承担一个沟通任务。</p></div>
      <div className="grid divide-y divide-slate-100 md:grid-cols-5 md:divide-x md:divide-y-0">
        {[
          ["01", "核心承诺", "产品 + 真实场景，只表达一个使用结果"],
          ["02", "使用问题", "说明振动、读数、调压或安装等具体任务"],
          ["03", "结构证据", "材料、机芯、充液、表盘与关键部件特写"],
          ["04", "规格兼容", "量程、精度、接口、尺寸与安装方向"],
          ["05", "场景选型", "适用范围、变体差异、包装与审核边界"],
        ].map(([index, title, description]) => <div key={index} className="p-4"><p className="font-mono text-[10px] font-semibold text-emerald-700">{index}</p><p className="mt-2 text-xs font-semibold text-slate-900">{title}</p><p className="mt-1 text-[11px] leading-5 text-slate-500">{description}</p></div>)}
      </div>
    </OpsCard>

    {data.summary.exceptionCount ? <OpsCard className="border-amber-200 bg-amber-50/40"><div className="px-4 py-3 text-xs leading-5 text-amber-900">另有 {data.summary.exceptionCount} 份旧版 .xls 美工文件尚未结构化导入；将旧文件另存为 .xlsx 后，下次运行会自动补入。</div></OpsCard> : null}

    <OpsCard>
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 xl:flex-row xl:items-center xl:justify-between">
        <div><h2 className="text-sm font-semibold text-slate-950">慢销产品拉量待办</h2><p className="mt-1 text-xs text-slate-500">默认只看可拉量 SKU；销量、利润和库存不满足条件的产品不会误进入加预算名单</p></div>
        <div className="flex flex-col gap-2 lg:flex-row">
          <label className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="搜索 SKU、品名或标题" className="w-full border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500 sm:w-64" /></label>
          <select value={growthFilter} onChange={(event) => { setGrowthFilter(event.target.value); setPage(1); }} className="border border-slate-200 bg-white px-3 py-2 text-sm"><option value="GROWTH">待拉量</option><option value="SCALE">优先拉量</option><option value="WATCH">验证后拉量</option><option value="CLEARANCE">清货观察</option><option value="HEALTHY">正常销售</option><option value="ALL">全部产品</option></select>
          <select value={marketFilter} onChange={(event) => { setMarketFilter(event.target.value); setPage(1); }} className="border border-slate-200 bg-white px-3 py-2 text-sm"><option value="ALL">全部市场</option><option value="US">美国 US</option><option value="CA">加拿大 CA</option></select>
          <select value={copyFilter} onChange={(event) => { setCopyFilter(event.target.value); setPage(1); }} className="border border-slate-200 bg-white px-3 py-2 text-sm"><option value="ALL">全部文案</option><option value="listing_master">已有 Listing</option><option value="structured_product_draft">待 AI 完善</option></select>
          <select value={briefFilter} onChange={(event) => { setBriefFilter(event.target.value); setPage(1); }} className="border border-slate-200 bg-white px-3 py-2 text-sm"><option value="ALL">全部参考状态</option><option value="ARCHIVE">有历史风格参考</option><option value="GENERATED">无历史风格参考</option></select>
          <select value={category} onChange={(event) => { setCategory(event.target.value); setPage(1); }} className="border border-slate-200 bg-white px-3 py-2 text-sm"><option value="ALL">全部品类</option>{categories.map((value) => <option key={value} value={value}>{value}</option>)}</select>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1240px] text-left text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-[0.08em] text-slate-500"><tr><th className="px-4 py-3">SKU / 产品</th><th className="px-3 py-3">拉量判断</th><th className="px-3 py-3">{data.summary.latestMonth} 销量</th><th className="px-3 py-3">库存 / 覆盖</th><th className="px-3 py-3">趋势 / 毛利</th><th className="px-3 py-3">广告 / 季节</th><th className="px-3 py-3">建议动作</th><th className="px-3 py-3">内容准备</th><th className="px-4 py-3 text-right">操作</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{visible.map((task) => {
            const variant = taskVariant.get(task.sku);
            return <tr key={task.sku} className="hover:bg-slate-50">
              <td className="px-4 py-3"><p className="font-mono text-xs font-semibold text-slate-900">{task.sku}</p><p className="mt-1 max-w-56 truncate text-[11px] text-slate-500">{task.productName}</p>{task.category ? <p className="mt-1 text-[10px] text-slate-400">{task.category}</p> : null}</td>
              <td className="px-3 py-3"><GrowthBadge status={task.growth.status} /><p className="mt-1 text-[10px] text-slate-500">{task.growth.targetMarket} · 优先分 {task.growth.priorityScore}</p>{variant ? <p className="mt-1 max-w-32 truncate text-[10px] text-slate-400">{variant.group.parentSku} · {variant.variantValue || variant.group.variationTheme}</p> : null}</td>
              <td className="px-3 py-3 font-mono text-[11px] text-slate-700">{marketFilter === "ALL" ? <><p>US {integer(task.growth.marketUnits.US)} · CA {integer(task.growth.marketUnits.CA)}</p><p className="mt-1 text-slate-400">MX {integer(task.growth.marketUnits.MX)}</p></> : <p>{task.growth.targetMarket} {integer(task.growth.latestUnits)}</p>}</td>
              <td className="px-3 py-3"><p className="font-medium text-slate-800">海外 {integer(task.growth.networkInventory)}</p><p className="mt-1 text-[10px] text-slate-500">国内 {integer(task.growth.localInventory)} · {task.growth.coverDays === null ? "覆盖待补" : `${integer(task.growth.coverDays)} 天`}</p></td>
              <td className="px-3 py-3"><p className={task.growth.trendPercent !== null && task.growth.trendPercent < 0 ? "font-medium text-rose-700" : "font-medium text-slate-700"}>{task.growth.trendPercent === null ? "趋势待补" : `${task.growth.trendPercent > 0 ? "+" : ""}${task.growth.trendPercent}%`}</p><p className="mt-1 text-[10px] text-slate-500">实际毛利率 {task.growth.actualMargin === null ? "—" : task.growth.actualMargin > 1 ? "口径异常" : `${(task.growth.actualMargin * 100).toFixed(1)}%`}</p></td>
              <td className="px-3 py-3"><p className="font-medium text-slate-700">{task.growth.advertising.action ? advertisingActionLabel(task.growth.advertising.action) : task.growth.advertising.spend > 0 ? "持续投放" : "广告待验证"}</p><p className="mt-1 text-[10px] text-slate-500">{task.growth.advertising.acos === null ? "ACOS —" : `ACOS ${task.growth.advertising.acos.toFixed(1)}%`} · {task.growth.advertising.confidence === "low" ? "历史广告" : "近期广告"}</p><p className={task.growth.season.upcomingPeak ? "mt-1 text-[10px] font-medium text-emerald-700" : "mt-1 text-[10px] text-slate-400"}>{task.growth.season.upcomingPeak ? "季节上行窗口" : task.growth.season.clearance ? "季节清货" : task.growth.season.upcomingRisePercent > 0 ? `季节预期 +${task.growth.season.upcomingRisePercent.toFixed(0)}%` : "季节中性"}</p></td>
              <td className="max-w-xs px-3 py-3 text-[11px] leading-5 text-slate-600">{task.growth.action}</td>
              <td className="px-3 py-3"><div className="flex flex-wrap gap-1"><OpsBadge tone={task.copy.source === "listing_master" ? "emerald" : "amber"}>{task.copy.source === "listing_master" ? "Listing 已有" : "文案待完善"}</OpsBadge><BriefSource source={task.aPlusBrief.source} count={task.aPlusBrief.sectionCount} /></div></td>
              <td className="px-4 py-3 text-right"><div className="flex items-center justify-end gap-3"><CreativeHandoffExportButton sku={task.sku} compact /><Link href={`/inventory/content/${encodeURIComponent(task.sku)}`} className="font-medium text-emerald-700 hover:underline">查看任务</Link></div></td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-xs text-slate-500"><span>显示 {visible.length} / {filtered.length} 个 SKU · 第 {safePage}/{pageCount} 页</span><div className="flex gap-2"><button type="button" disabled={safePage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 disabled:opacity-40">上一页</button><button type="button" disabled={safePage >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 disabled:opacity-40">下一页</button></div></div>
    </OpsCard>

  </div>;
}

function BriefSource({ source, count }: { source: "creative_archive" | "generated_template"; count: number }) {
  return <div><OpsBadge tone={source === "creative_archive" ? "blue" : "slate"}>{source === "creative_archive" ? "有风格参考" : "产品驱动"}</OpsBadge><p className="mt-1 text-[10px] text-slate-400">{count} 个画面</p></div>;
}

function GrowthBadge({ status }: { status: ContentListViewModel["tasks"][number]["growth"]["status"] }) {
  const values = {
    SCALE: { label: "优先拉量", tone: "emerald" as const },
    WATCH: { label: "验证后拉量", tone: "amber" as const },
    CLEARANCE: { label: "清货观察", tone: "rose" as const },
    HEALTHY: { label: "正常销售", tone: "blue" as const },
    NO_DATA: { label: "数据待补", tone: "slate" as const },
  };
  return <OpsBadge tone={values[status].tone}>{values[status].label}</OpsBadge>;
}

function advertisingActionLabel(action: string) {
  const labels: Record<string, string> = {
    PAUSE_STOCK_RISK: "库存风险控量",
    NO_ORDER_REVIEW: "无订单复核",
    REDUCE_BID_OR_BUDGET: "降低竞价/预算",
    INCREASE_BID: "提高竞价测试",
    INCREASE_BUDGET: "提高广告预算",
    EXPAND_WINNER: "优质活动扩量",
  };
  return labels[action] ?? "广告观察";
}
