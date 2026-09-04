"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { OpsCard, OpsCardHeader } from "@/components/inventory/ops-ui";
import { integer } from "@/lib/inventory/presentation";

type StockSeries = { key: "usOverseas" | "caOverseas" | "fba" | "awd" | "domestic" | "pending"; label: string; color: string };

export type InventoryStockVisualRow = {
  sku: string;
  usOverseas?: number;
  caOverseas?: number;
  fba?: number;
  awd?: number;
  domestic: number;
  pending: number;
  action: number;
  reference: number;
};

export function InventoryStockVisual({
  title,
  description,
  mode,
  rows,
  actionLabel,
  referenceLabel,
}: {
  title: string;
  description: string;
  mode: "combined" | "market";
  rows: InventoryStockVisualRow[];
  actionLabel: string;
  referenceLabel: string;
}) {
  const stockSeries: StockSeries[] = mode === "combined"
    ? [
      { key: "usOverseas", label: "US 海外库存", color: "#2563eb" },
      { key: "caOverseas", label: "CA 海外库存", color: "#d97706" },
      { key: "domestic", label: "共享国内现货", color: "#0f766e" },
      { key: "pending", label: "未完工订单", color: "#94a3b8" },
    ]
    : [
      { key: "fba", label: "FBA 可售", color: "#2563eb" },
      { key: "awd", label: "AWD 可用/转出", color: "#38bdf8" },
      { key: "domestic", label: "共享国内现货", color: "#0f766e" },
      { key: "pending", label: "未完工订单", color: "#94a3b8" },
    ];
  const totals = Object.fromEntries(stockSeries.map((series) => [series.key, rows.reduce((sum, row) => sum + (row[series.key] ?? 0), 0)]));
  const totalStock = Object.values(totals).reduce((sum, value) => sum + value, 0);
  const structureRows = [{ name: "当前库存", ...totals }];
  const focusRows = [...rows]
    .sort((left, right) => Math.max(right.action, right.reference) - Math.max(left.action, left.reference)
      || stockSeries.reduce((sum, series) => sum + (right[series.key] ?? 0) - (left[series.key] ?? 0), 0))
    .slice(0, 12)
    .map((row) => ({ ...row, [actionLabel]: row.action, [referenceLabel]: row.reference }));

  return <OpsCard>
    <OpsCardHeader title={title} description={description} action={<span className="text-xs text-slate-500">库存合计 {integer(totalStock)} 件</span>} />
    <div className="grid gap-0 xl:grid-cols-[.72fr_1.5fr]">
      <div className="border-b border-slate-100 p-4 xl:border-b-0 xl:border-r">
        <h3 className="text-xs font-semibold text-slate-900">国内外库存结构</h3>
        <p className="mt-1 text-[11px] text-slate-500">按当前数据快照汇总全部 SKU</p>
        <div className="mt-4 h-[190px]" role="img" aria-label="国内外库存总体结构图">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={structureRows} layout="vertical" margin={{ top: 20, right: 12, left: 0, bottom: 16 }}>
              <CartesianGrid stroke="#e5e7eb" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" width={58} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip formatter={(value) => `${integer(Number(value))} 件`} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              {stockSeries.map((series) => <Bar key={series.key} dataKey={series.key} name={series.label} stackId="stock" fill={series.color} />)}
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="grid grid-cols-2 gap-px overflow-hidden border border-slate-100 bg-slate-100">
          {stockSeries.map((series) => <div key={series.key} className="bg-white px-3 py-2.5"><div className="flex items-center gap-2 text-[10px] text-slate-500"><span className="h-2 w-2" style={{ backgroundColor: series.color }} />{series.label}</div><p className="mt-1 font-mono text-sm font-semibold text-slate-900">{integer(totals[series.key] ?? 0)}</p></div>)}
        </div>
      </div>
      <div className="min-w-0 p-4">
        <h3 className="text-xs font-semibold text-slate-900">重点 SKU：库存、需求与计划</h3>
        <p className="mt-1 text-[11px] text-slate-500">优先展示计划量或需求量最高的 12 个 SKU；柱形为现有库存，折线为需求和执行计划</p>
        <div className="mt-4 overflow-x-auto">
          <div className="h-[300px] min-w-[760px]" role="img" aria-label={`重点 SKU 库存与${actionLabel}对比图`}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={focusRows} margin={{ top: 14, right: 14, left: -8, bottom: 4 }}>
                <CartesianGrid stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="sku" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(value) => `${integer(Number(value))} 件`} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                {stockSeries.map((series) => <Bar key={series.key} dataKey={series.key} name={series.label} stackId="stock" fill={series.color} />)}
                <Line type="monotone" dataKey={referenceLabel} stroke="#be123c" strokeWidth={2} dot={{ r: 2 }} />
                <Line type="monotone" dataKey={actionLabel} stroke="#7c3aed" strokeWidth={2.5} strokeDasharray="5 3" dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  </OpsCard>;
}
