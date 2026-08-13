import { ExternalLink, FlaskConical, PackagePlus, Sparkles } from "lucide-react";

import { OpsBadge, OpsCard, OpsCardHeader, OpsKpi } from "@/components/inventory/ops-ui";
import type { NewProductResearchData } from "@/lib/inventory/contracts";

const number = new Intl.NumberFormat("zh-CN");
const money = (value: number | null) => value === null ? "—" : `$${value.toFixed(2)}`;

export function NewProductResearchBoard({ data }: { data: NewProductResearchData }) {
  const candidates = [...data.candidates].sort((a, b) => (b.grossMargin ?? -1) - (a.grossMargin ?? -1)).slice(0, 8);
  const latestOrders = data.monthlyOrders.filter((item) => item.month === data.summary.latestOrderMonth).slice(0, 8);
  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <OpsKpi label="调研候选" value={`${data.summary.candidateCount} 个`} detail="来自最新调研表 Sheet1" icon={<FlaskConical className="h-4 w-4" />} />
      <OpsKpi label="优先候选" value={`${data.summary.viableCandidateCount} 个`} detail="毛利率 ≥ 30%" tone="positive" icon={<Sparkles className="h-4 w-4" />} />
      <OpsKpi label="平均毛利率" value={`${(data.summary.averageGrossMargin * 100).toFixed(1)}%`} detail="按有完整成本数据的候选计算" tone="positive" />
      <OpsKpi label="最近下单" value={data.summary.latestOrderMonth ?? "—"} detail={`${number.format(data.summary.plannedUnits)} 件计划量`} icon={<PackagePlus className="h-4 w-4" />} />
    </div>
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,.65fr)]">
      <OpsCard>
        <OpsCardHeader title="优先候选" description="按毛利率排序，先看价格、成本和竞品链接。" />
        <div className="overflow-x-auto"><table className="min-w-[680px] w-full text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase tracking-[0.12em] text-slate-500"><tr><th className="px-5 py-3">SKU</th><th className="px-3 py-3">售价</th><th className="px-3 py-3">采购成本</th><th className="px-3 py-3">毛利</th><th className="px-3 py-3">毛利率</th><th className="px-3 py-3">竞品</th></tr></thead><tbody className="divide-y divide-slate-100">{candidates.map((item) => <tr key={item.sku} className="hover:bg-slate-50/80"><td className="px-5 py-3 font-semibold text-slate-900">{item.sku}<span className="mt-0.5 block text-[10px] font-normal text-slate-400">{item.name}</span></td><td className="px-3 py-3 text-slate-700">{money(item.amazonPrice)}</td><td className="px-3 py-3 text-slate-700">{item.purchaseCostRmb === null ? "—" : `¥${item.purchaseCostRmb.toFixed(2)}`}</td><td className="px-3 py-3 text-slate-700">{money(item.grossProfit)}</td><td className="px-3 py-3">{item.grossMargin === null ? <OpsBadge>待补成本</OpsBadge> : <OpsBadge tone={item.grossMargin >= .3 ? "emerald" : "amber"}>{(item.grossMargin * 100).toFixed(1)}%</OpsBadge>}</td><td className="px-3 py-3">{item.competitorUrl ? <a href={item.competitorUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-700 hover:text-blue-900">查看 <ExternalLink className="h-3 w-3" /></a> : <span className="text-slate-400">—</span>}</td></tr>)}</tbody></table></div>
      </OpsCard>
      <OpsCard>
        <OpsCardHeader title="新品进度" description={data.summary.latestOrderMonth ? `${data.summary.latestOrderMonth} 下单记录` : "最近月份下单记录"} />
        <div className="space-y-2.5 p-4">{latestOrders.length ? latestOrders.map((item) => <div key={`${item.month}-${item.sku}`} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2.5"><div className="min-w-0"><p className="truncate text-xs font-semibold text-slate-800">{item.sku}</p><p className="truncate text-[10px] text-slate-500">{item.name}</p></div><div className="shrink-0 text-right"><p className="text-xs font-semibold text-slate-800">{item.orderQuantity ? `${number.format(item.orderQuantity)} 件` : "待确认"}</p><p className="text-[10px] text-slate-500">{item.costRmb === null ? "成本待补" : `¥${item.costRmb.toFixed(2)}`}</p></div></div>) : <p className="py-6 text-center text-xs text-slate-400">暂无下单记录</p>}</div>
      </OpsCard>
    </div>
  </div>;
}
