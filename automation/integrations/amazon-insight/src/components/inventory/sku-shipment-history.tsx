import { Ship } from "lucide-react";

import { OpsBadge, OpsCard, OpsCardHeader } from "@/components/inventory/ops-ui";
import type { ShipmentHistoryItem } from "@/lib/inventory/data";
import { integer } from "@/lib/inventory/presentation";

const dateFormatter = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });

export function SkuShipmentHistory({ history, sku }: { history: ShipmentHistoryItem[]; sku: string }) {
  const ordered = [...history].sort((left, right) => right.shipmentDate.localeCompare(left.shipmentDate) || right.batch - left.batch);
  const totalQuantity = ordered.reduce((sum, item) => sum + item.quantity, 0);
  const totalCartons = ordered.reduce((sum, item) => sum + item.cartonCount, 0);
  const marketCount = new Set(ordered.map((item) => item.market)).size;
  const latest = ordered[0]?.shipmentDate;

  return <OpsCard id="shipment-history">
    <OpsCardHeader title="SKU 历史发货记录" description={ordered.length ? `${sku} 共识别 ${ordered.length} 次历史发货，累计 ${integer(totalQuantity)} 件${latest ? `，最近一次 ${formatDate(latest)}` : ""}。` : `${sku} 当前没有匹配到历史发货记录。`} action={<div className="flex items-center gap-2"><Ship className="h-4 w-4 text-blue-700" /><OpsBadge tone={ordered.length ? "blue" : "slate"}>{ordered.length} 次 · {integer(totalQuantity)} 件</OpsBadge></div>} />
    {ordered.length ? <>
      <div className="grid gap-px border-b border-slate-200 bg-slate-200 sm:grid-cols-3">
        <HistoryMetric label="累计发货" value={`${integer(totalQuantity)} 件`} detail={`${marketCount} 个站点`} />
        <HistoryMetric label="累计箱数" value={`${integer(totalCartons)} 箱`} detail="按历史发货清单记录" />
        <HistoryMetric label="最近发货" value={latest ? formatDate(latest) : "—"} detail={`CM${String(ordered[0]?.batch ?? 0).padStart(3, "0")}`} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-[0.08em] text-slate-500"><tr><th className="px-4 py-3">发货日期 / 批次</th><th className="px-3 py-3">站点</th><th className="px-3 py-3 text-right">发货数量</th><th className="px-3 py-3 text-right">箱数</th><th className="px-4 py-3">来源文件</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{ordered.map((item, index) => <tr key={`${item.market}-${item.batch}-${item.shipmentDate}-${index}`} className="hover:bg-slate-50"><td className="px-4 py-3"><p className="font-mono font-semibold text-slate-800">CM{String(item.batch).padStart(3, "0")}</p><p className="mt-1 text-[10px] text-slate-500">{formatDate(item.shipmentDate)}</p></td><td className="px-3 py-3"><OpsBadge tone={item.market === "US" ? "blue" : "amber"}>{item.market === "US" ? "美国站" : "加拿大站"}</OpsBadge></td><td className="px-3 py-3 text-right font-semibold text-slate-900">{integer(item.quantity)} 件</td><td className="px-3 py-3 text-right text-slate-700">{item.cartonCount ? `${integer(item.cartonCount)} 箱` : "—"}</td><td className="max-w-[360px] px-4 py-3"><p className="truncate text-[10px] text-slate-500" title={item.sourcePath}>{item.sourcePath || "历史发货清单"}</p></td></tr>)}</tbody>
        </table>
      </div>
    </> : <div className="grid place-items-center gap-2 p-8 text-sm text-slate-500"><Ship className="h-7 w-7 text-slate-300" /><p>历史发货清单中尚未匹配到 {sku}。</p><p className="text-xs text-slate-400">导入发货清单并运行数据刷新后，这里会自动补齐。</p></div>}
  </OpsCard>;
}

function HistoryMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="bg-white px-4 py-3"><p className="text-[10px] font-medium text-slate-400">{label}</p><p className="mt-1 text-base font-semibold text-slate-900">{value}</p><p className="mt-1 text-[10px] text-slate-500">{detail}</p></div>;
}

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
}
