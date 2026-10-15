"use client";

import { useId } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fullCurrency } from "@/lib/inventory/presentation";
import { fillOperatingChartMonths, type OperatingChartPoint } from "@/lib/inventory/operating-chart";

export function OperatingHistoryChart({ points: input, metric, currency }: { points: OperatingChartPoint[]; metric: "revenue" | "profit"; currency: string }) {
  const points = fillOperatingChartMonths(input);
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const color = metric === "revenue" ? "var(--chart-primary)" : "var(--positive)";
  const name = metric === "revenue" ? "销售额" : "报告利润";
  const partial = points.filter(point => !point.complete && point[metric] !== null);
  const data = points.map(point => ({ ...point,
    fullValue: point.complete ? point[metric] : null,
    partialValue: point.complete ? null : point[metric],
  }));
  if (points.filter(point => point[metric] !== null).length < 2) return <p className="ops-subtext py-12 text-center">暂无连续月份数据</p>;
  return <>
    <div className="ops-chart-legend" aria-label="图表口径"><span><i />完整月</span>{partial.length > 0 ? <><span><i className="partial" />{partial.some(point => point.mtd) ? "当月累计" : "期间未完整"}{partial.at(-1)?.asOf ? ` · 截至 ${partial.at(-1)!.asOf}` : ""}</span><span>不与完整月直接比较</span></> : null}</div>
    <div className="ops-history-chart h-64">
      <ResponsiveContainer width="100%" height="100%"><AreaChart data={data} margin={{ top: 12, right: 12, bottom: 4, left: 0 }}>
        <defs><linearGradient id={`ops-history-${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.18} /><stop offset="100%" stopColor={color} stopOpacity={0.01} /></linearGradient></defs>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--foreground-soft)" }} axisLine={false} tickLine={false} tickFormatter={month => { const point = points.find(item => item.month === month); return `${Number(String(month).slice(5))}月${point && point.revenue === null && point.profit === null ? "·缺失" : point && !point.complete ? point.mtd ? "·累计" : "·未完整" : ""}`; }} />
        <YAxis tick={{ fontSize: 11, fill: "var(--foreground-soft)" }} tickFormatter={value => new Intl.NumberFormat("en", { notation: "compact" }).format(value)} axisLine={false} tickLine={false} width={48} />
        <Tooltip content={({ active, payload }) => { const point = payload?.[0]?.payload as OperatingChartPoint | undefined; return active && point ? <div className="ops-chart-tooltip"><strong>{point.month} · {point.complete ? "完整月" : point.mtd ? "当月累计" : "期间未完整"}</strong><p>{name} {point[metric] === null ? "—" : fullCurrency(point[metric]!, currency)}</p>{!point.complete && point.asOf ? <small>截至 {point.asOf} · 不与完整月直接比较</small> : null}</div> : null; }} />
        <Area dataKey="fullValue" name={name} stroke={color} fill={`url(#ops-history-${id})`} strokeWidth={2.5} connectNulls={false} isAnimationActive={false} dot={{ r: 3, fill: color, stroke: "var(--surface)", strokeWidth: 2 }} />
        {partial.length > 0 ? <Area dataKey="partialValue" name={partial.some(point => point.mtd) ? "当月累计" : "期间未完整"} stroke={color} fill="none" strokeWidth={2.5} strokeDasharray="5 5" connectNulls={false} isAnimationActive={false} dot={{ r: 4, fill: "var(--surface)", stroke: color, strokeWidth: 2 }} /> : null}
      </AreaChart></ResponsiveContainer>
    </div>
    <ul className="sr-only" aria-label={`${name}趋势数据`}>{points.map(point => <li key={point.month}>{point.month}，{point.complete ? "完整月" : "期间未完整"}，{point[metric] === null ? "无数据" : fullCurrency(point[metric]!, currency)}</li>)}</ul>
  </>;
}
