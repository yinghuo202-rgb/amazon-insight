"use client";

import { CircleAlert, Search, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { OpsBadge, OpsCard, OpsCardHeader, OpsKpi } from "@/components/inventory/ops-ui";
import { AdvertisingPlanPanel } from "@/components/inventory/advertising-plan-panel";
import { calculateAdvertisingDecision } from "@/lib/inventory/advertising-calculator";
import { withTargetAcos, type AdvertisingViewModel } from "@/lib/inventory/client-view-models";
import type { AdvertisingParameters } from "@/lib/inventory/contracts";
import {
  advertisingActionLabels,
  compact,
  fullCurrency as formatCurrency,
  integer,
  marketHref,
  toneByAdvertisingAction,
} from "@/lib/inventory/presentation";

const adjustmentActions = ["PAUSE_STOCK_RISK", "NO_ORDER_REVIEW", "REDUCE_BID_OR_BUDGET"];
const growthActions = ["INCREASE_BUDGET", "INCREASE_BID"];

export function AdvertisingWorkbench({ data }: { data: AdvertisingViewModel }) {
  const pageSize = 40;
  const fullCurrency = (value: number) => formatCurrency(value, data.currency);
  const [targetAcos, setTargetAcos] = useState(data.parameters.targetAcosPercent);
  const [query, setQuery] = useState("");
  const [actionFilter, setActionFilter] = useState("ALL");
  const [sortBy, setSortBy] = useState("priority");
  const [page, setPage] = useState(1);
  const parameters: AdvertisingParameters = useMemo(
    () => withTargetAcos(data.parameters, targetAcos),
    [data.parameters, targetAcos],
  );
  const inventoryBySku = useMemo(() => new Map(data.inventory.map((row) => [row.sku, row] as const)), [data.inventory]);
  const campaigns = useMemo(
    () => data.campaigns.map((campaign) => {
      const inventory = campaign.sku ? inventoryBySku.get(campaign.sku) ?? null : null;
      return {
        ...campaign,
        inventoryRisk: inventory?.riskLevel ?? null,
        inventoryDaysCover: inventory?.daysCoverNetwork ?? null,
        ...calculateAdvertisingDecision(campaign, parameters, inventory?.riskLevel ?? null),
      };
    }),
    [data.campaigns, inventoryBySku, parameters],
  );
  const normalized = query.trim().toLowerCase();
  const filtered = campaigns
    .filter((row) => (actionFilter === "ALL" || row.action === actionFilter)
      && (!normalized || row.campaign.toLowerCase().includes(normalized) || row.sku?.toLowerCase().includes(normalized)))
    .sort((a, b) => sortCampaigns(a, b, sortBy));
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const latest = data.monthlySeries.at(-1);
  const adjustments = campaigns.filter((row) => adjustmentActions.includes(row.action));
  const bidGrowth = campaigns.filter((row) => row.action === "INCREASE_BID");
  const budgetGrowth = campaigns.filter((row) => row.action === "INCREASE_BUDGET");
  const growth = campaigns.filter((row) => growthActions.includes(row.action));
  const stockRisk = campaigns.filter((row) => row.action === "PAUSE_STOCK_RISK");
  const advertisingStale = data.ageDaysAtSnapshot === null || data.ageDaysAtSnapshot > 62;
  const previous = data.monthlySeries.at(-2);
  const spendChange = previous?.spend ? ((latest?.spend ?? 0) - previous.spend) / previous.spend * 100 : null;

  return <div className="space-y-4">
    <div className={`flex items-start gap-3 border px-4 py-3 text-xs leading-5 ${advertisingStale ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}>
      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <p>广告活动数据截止 <strong>{data.latestMonth ?? "未识别"}</strong>{advertisingStale ? `，距库存快照相差 ${data.ageDaysAtSnapshot ?? "未知"} 天。当前竞价和预算建议仅作历史参考，请导入最新广告活动报表后再执行。` : "，可用于本期广告调整。"}</p>
    </div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <OpsKpi label="本期广告结果" value={fullCurrency(latest?.spend ?? 0)} detail={`${integer(latest?.orders ?? 0)} 个广告订单 · 花费`} />
      <OpsKpi label="效率 / 目标" value={`${latest?.acos?.toFixed(1) ?? "—"}%`} detail={`目标 ACOS ${targetAcos}%`} tone={(latest?.acos ?? 0) > targetAcos ? "warning" : "positive"} />
      <OpsKpi label="待控量队列" value={`${adjustments.length} 项`} detail={`${stockRisk.length} 项受库存约束`} tone="danger" />
      <OpsKpi label="可扩量队列" value={`${growth.length} 项`} detail={`${bidGrowth.length} 提竞价 · ${budgetGrowth.length} 加预算`} tone="positive" />
    </div>

    <div className="grid gap-4 xl:grid-cols-[1.4fr_.6fr]">
      <OpsCard>
        <OpsCardHeader title="广告趋势" description={latest ? `${latest.month} 花费 ${fullCurrency(latest.spend)}${spendChange === null ? "" : `，环比${spendChange >= 0 ? "增长" : "下降"} ${Math.abs(spendChange).toFixed(1)}%`}，ACOS 为 ${latest.acos?.toFixed(1) ?? "—"}%。` : "当前没有可用的月度广告数据。"} />
        <div className="h-[280px] p-4">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data.monthlySeries} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid stroke="#e5e7eb" vertical={false} />
              <XAxis dataKey="month" tickFormatter={(value) => value.slice(5)} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="money" tickFormatter={compact} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="acos" orientation="right" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip />
              <Bar yAxisId="money" dataKey="advertisingSales" name="广告销售" fill="#0f766e" radius={[3, 3, 0, 0]} />
              <Bar yAxisId="money" dataKey="spend" name="花费" fill="#94a3b8" radius={[3, 3, 0, 0]} />
              <Line yAxisId="acos" dataKey="acos" name="ACOS %" stroke="#d97706" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </OpsCard>
      <OpsCard>
        <OpsCardHeader title="扩量判断" description={`${growth.length} 个活动满足扩量条件，另有 ${adjustments.length} 个需控量，其中 ${stockRisk.length} 个受库存约束。`} />
        <div className="p-5">
          <label>
            <span className="flex justify-between text-xs font-medium text-slate-600"><span>目标 ACOS</span><span className="font-mono text-emerald-700">{targetAcos}%</span></span>
            <input type="range" min={15} max={50} value={targetAcos} onChange={(event) => setTargetAcos(Number(event.target.value))} className="mt-4 w-full accent-emerald-700" />
          </label>
          <div className="mt-6 space-y-3 border-t border-slate-100 pt-5">
            <Decision label="库存风险暂停" value={stockRisk.length} tone="rose" />
            <Decision label="降低竞价/预算" value={campaigns.filter((row) => row.action === "REDUCE_BID_OR_BUDGET").length} tone="amber" />
            <Decision label="提高竞价测试" value={bidGrowth.length} tone="blue" />
            <Decision label="提高广告预算" value={budgetGrowth.length} tone="emerald" />
          </div>
          <p className="mt-5 border-t border-slate-100 pt-4 text-[11px] leading-5 text-slate-500">只有已有订单、ACOS 不高于目标的 90%、库存健康的活动才进入扩量判断。日均花费达到预算的 {parameters.budgetUtilizationThresholdPercent}% 才建议加预算，否则优先判断是否小幅提竞价。</p>
        </div>
      </OpsCard>
    </div>

    <details className="group overflow-hidden border border-slate-200 bg-white">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 marker:content-none">
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-900"><TrendingUp className="h-4 w-4 text-emerald-700" />扩量候选依据</span>
        <span className="text-xs text-slate-500">{growth.length} 项 · 点击展开样本与判断原因</span>
      </summary>
      {growth.length ? <div className="grid border-t border-slate-100 md:grid-cols-2 xl:grid-cols-3">
        {growth.slice(0, 6).map((row) => <div key={row.campaign} className="border-b border-slate-100 p-4 md:border-r">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{row.campaign}</p>{row.sku ? <Link href={marketHref(`/inventory/sku/${encodeURIComponent(row.sku)}`, data.market)} className="mt-1 inline-block font-mono text-[11px] font-semibold text-emerald-700 hover:underline">{row.sku}</Link> : null}</div>
            <ActionBadge action={row.action} />
          </div>
          <div className="mt-3 grid grid-cols-4 gap-2 text-[11px]"><MiniMetric label="订单" value={integer(row.orders)} /><MiniMetric label="点击" value={integer(row.clicks)} /><MiniMetric label="ACOS" value={`${row.acos?.toFixed(1) ?? "—"}%`} /><MiniMetric label="预算利用" value={`${row.budgetUtilizationPercent?.toFixed(0) ?? "—"}%`} /></div>
          <p className="mt-3 text-xs leading-5 text-slate-500">{row.reason}</p>
        </div>)}
      </div> : <div className="border-t border-slate-100 px-5 py-8 text-center text-sm text-slate-500">当前没有同时满足转化、效率和库存条件的扩量活动。</div>}
    </details>

    <AdvertisingPlanPanel market={data.market} period={data.latestMonth} rows={campaigns} currency={data.currency} />

    <details className="group overflow-hidden border border-slate-200 bg-white">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 marker:content-none">
        <span className="text-sm font-semibold text-slate-900">原始广告活动明细</span>
        <span className="text-xs text-slate-500">{campaigns.length} 项 · 决策、保存与导出请在上方工作台完成</span>
      </summary>
      <div className="flex flex-col gap-3 border-y border-slate-100 p-4 xl:flex-row xl:items-center xl:justify-between">
        <div><p className="text-xs text-slate-500">显示 {visible.length} / {filtered.length} 项 · 第 {safePage}/{pageCount} 页</p></div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="搜索活动或 SKU" className="w-full border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500 sm:w-64" /></label>
          <select value={actionFilter} onChange={(event) => { setActionFilter(event.target.value); setPage(1); }} className="border border-slate-200 bg-white px-3 py-2 text-sm outline-none"><option value="ALL">全部动作</option>{Object.entries(advertisingActionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <select value={sortBy} onChange={(event) => { setSortBy(event.target.value); setPage(1); }} className="border border-slate-200 bg-white px-3 py-2 text-sm outline-none"><option value="priority">建议优先</option><option value="spend">花费最高</option><option value="orders">订单最多</option><option value="impressions">曝光最多</option></select>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1240px] text-left text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-[0.08em] text-slate-500"><tr><th className="px-4 py-3">活动 / SKU</th><th className="px-3 py-3 text-right">预算</th><th className="px-3 py-3 text-right">日均花费</th><th className="px-3 py-3 text-right">曝光 / 点击</th><th className="px-3 py-3 text-right">CTR / 转化率</th><th className="px-3 py-3 text-right">订单</th><th className="px-3 py-3 text-right">ACOS</th><th className="px-3 py-3">建议</th><th className="px-4 py-3">分析依据</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{visible.map((row) => <tr key={row.campaign} className="hover:bg-slate-50">
            <td className="px-4 py-3"><p className="max-w-72 truncate font-medium text-slate-900">{row.campaign}</p>{row.sku ? <Link href={marketHref(`/inventory/sku/${encodeURIComponent(row.sku)}`, data.market)} className="mt-1 inline-block font-mono text-[11px] font-semibold text-emerald-700 hover:underline">{row.sku}</Link> : <span className="mt-1 block text-[11px] text-slate-400">未关联 SKU</span>}</td>
            <td className="px-3 py-3 text-right"><p>{fullCurrency(row.budget)}</p><p className="mt-1 text-[10px] text-slate-400">利用 {row.budgetUtilizationPercent?.toFixed(0) ?? "—"}%</p></td>
            <td className="px-3 py-3 text-right"><p>{fullCurrency(row.averageDailySpend)}</p><p className="mt-1 text-[10px] text-slate-400">总计 {fullCurrency(row.spend)}</p></td>
            <td className="px-3 py-3 text-right"><p>{integer(row.impressions)}</p><p className="mt-1 text-[10px] text-slate-400">{integer(row.clicks)} 点击</p></td>
            <td className="px-3 py-3 text-right"><p>{row.ctr?.toFixed(2) ?? "—"}%</p><p className="mt-1 text-[10px] text-slate-400">CVR {row.conversionRate?.toFixed(1) ?? "—"}%</p></td>
            <td className="px-3 py-3 text-right">{integer(row.orders)}</td>
            <td className="px-3 py-3 text-right"><p>{row.acos?.toFixed(1) ?? "—"}%</p><p className="mt-1 text-[10px] text-slate-400">ROAS {row.roas?.toFixed(2) ?? "—"}</p></td>
            <td className="px-3 py-3"><ActionBadge action={row.action} /></td>
            <td className="max-w-sm px-4 py-3 leading-5 text-slate-500">{row.reason}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3"><button type="button" disabled={safePage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs disabled:opacity-40">上一页</button><button type="button" disabled={safePage >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs disabled:opacity-40">下一页</button></div>
    </details>
  </div>;
}

type CampaignRow = ReturnType<typeof calculateAdvertisingDecision> & AdvertisingViewModel["campaigns"][number] & { inventoryRisk: AdvertisingViewModel["inventory"][number]["riskLevel"] | null; inventoryDaysCover: number | null };

function sortCampaigns(a: CampaignRow, b: CampaignRow, sortBy: string) {
  if (sortBy === "spend") return b.spend - a.spend;
  if (sortBy === "orders") return b.orders - a.orders;
  if (sortBy === "impressions") return b.impressions - a.impressions;
  const priority: Record<string, number> = { INCREASE_BUDGET: 0, INCREASE_BID: 1, PAUSE_STOCK_RISK: 2, REDUCE_BID_OR_BUDGET: 3, NO_ORDER_REVIEW: 4, EXPAND_WINNER: 5, MONITOR: 6, NO_CHANGE_LOW_DATA: 7 };
  return (priority[a.action] ?? 9) - (priority[b.action] ?? 9) || b.spend - a.spend;
}

function ActionBadge({ action }: { action: CampaignRow["action"] }) {
  const tone = toneByAdvertisingAction[action];
  return <OpsBadge tone={tone === "rose" ? "rose" : tone === "amber" ? "amber" : tone === "emerald" ? "emerald" : tone === "blue" ? "blue" : "slate"}>{advertisingActionLabels[action]}</OpsBadge>;
}

function MiniMetric({ label, value }: { label: string; value: string }) { return <div><p className="text-slate-400">{label}</p><p className="mt-1 font-mono font-semibold text-slate-800">{value}</p></div>; }

function Decision({ label, value, tone }: { label: string; value: number; tone: "rose" | "amber" | "blue" | "emerald" }) { return <div className="flex items-center justify-between"><span className="text-xs text-slate-600">{label}</span><OpsBadge tone={tone}>{value} 项</OpsBadge></div>; }
