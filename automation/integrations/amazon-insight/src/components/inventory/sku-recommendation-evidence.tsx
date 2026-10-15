"use client";

import { useId } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { OperatingSku } from "@/lib/inventory/dashboard-view-model";
import { fullCurrency } from "@/lib/inventory/presentation";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export type SkuRecommendationEvidencePoint = {
  month: string;
  revenue: number | null;
  averagePrice: number | null;
  advertisingCost: number | null;
  advertisingSales: number | null;
  acos: number | null;
};

function priorMonth(month: string, count = 1) {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - count);
  return date.toISOString().slice(0, 7);
}

function completeAdvertisingMonth(row: OperatingSku["advertisingHistory"][number]) {
  const month = row.reportMonth;
  if (!MONTH.test(month)) return false;
  const [year, number] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
  return row.startDate.slice(0, 10) <= `${month}-01` && row.businessAsOf.slice(0, 10) >= lastDay;
}

// One shared calendar axis, with nulls for missing or ineligible observations.
// No adjacent-month substitution, mixed-currency conversion, or partial-month extrapolation.
export function buildSkuRecommendationEvidence(row: OperatingSku, period: string, now = new Date()): SkuRecommendationEvidencePoint[] {
  if (!MONTH.test(period)) return [];
  const currentMonth = now.toISOString().slice(0, 7);
  const lastComplete = period < currentMonth ? period : priorMonth(currentMonth);
  const months = Array.from({ length: 6 }, (_, index) => priorMonth(lastComplete, 5 - index));
  const history = new Map(row.history.filter(point =>
    MONTH.test(point.reportMonth) && point.reportMonth < currentMonth && point.currency === row.currency && point.quality?.completePeriod !== false,
  ).map(point => [point.reportMonth, point]));
  const advertising = new Map((row.advertisingHistory ?? []).filter(point =>
    point.currency === row.currency && point.reportMonth < currentMonth && completeAdvertisingMonth(point),
  ).map(point => [point.reportMonth, point]));

  return months.map(month => {
    const sales = history.get(month);
    const ads = advertising.get(month);
    const averagePrice = sales?.averagePrice ?? (sales && sales.units > 0 && sales.productSales >= 0 ? sales.productSales / sales.units : null);
    const advertisingCost = ads?.cost ?? null;
    const advertisingSales = ads?.sales ?? null;
    return {
      month,
      revenue: sales?.productSales ?? null,
      averagePrice,
      advertisingCost,
      advertisingSales,
      acos: advertisingCost !== null && advertisingSales !== null && advertisingSales > 0 ? advertisingCost / advertisingSales : null,
    };
  });
}

type Metric = "revenue" | "averagePrice" | "advertisingCost" | "advertisingSales" | "acos";

function EvidenceTrend({ points, metric, label, color, currency }: {
  points: SkuRecommendationEvidencePoint[];
  metric: Metric;
  label: string;
  color: string;
  currency: string;
}) {
  const format = metric === "acos" ? (value: number) => `${(value * 100).toFixed(1)}%` : (value: number) => fullCurrency(value, currency);
  const present = points.filter(point => point[metric] !== null);
  const latest = present.at(-1);
  if (present.length === 0) return <div className="border-t border-[var(--border)] py-4"><h4 className="text-sm font-medium">{label}</h4><p className="ops-subtext mt-1">最近 6 个完整月暂无同口径数据</p></div>;
  return <section className="min-w-0 border-t border-[var(--border)] py-4" aria-label={`${label}月度趋势`}>
    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><h4 className="text-sm font-medium">{label}</h4><p className="text-sm font-semibold tabular-nums">{latest?.month} · {latest && latest[metric] !== null ? format(latest[metric]!) : "—"}</p></div>
    <div className="h-28 min-w-0" role="img" aria-label={`${label}，${points.length} 个完整月份，缺失月份保留空档`}>
      <ResponsiveContainer width="100%" height="100%"><LineChart data={points} margin={{ top: 8, right: 6, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "var(--foreground-soft)" }} tickFormatter={value => String(value).slice(5) + "月"} interval={0} />
        <YAxis axisLine={false} tickLine={false} width={48} tick={{ fontSize: 10, fill: "var(--foreground-soft)" }} tickFormatter={value => metric === "acos" ? `${Math.round(Number(value) * 100)}%` : new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(Number(value))} />
        <Tooltip content={({ active, payload, label: tooltipMonth }) => {
          if (!active) return null;
          const value = payload?.[0]?.value;
          return <div className="ops-chart-tooltip"><strong>{String(tooltipMonth)} · 完整月</strong><p>{label} {typeof value === "number" ? format(value) : "—"}</p></div>;
        }} />
        <Line type="monotone" dataKey={metric} name={label} stroke={color} strokeWidth={2} dot={{ r: 2, fill: color, stroke: "var(--surface)", strokeWidth: 1 }} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />
      </LineChart></ResponsiveContainer>
    </div>
    <ul className="sr-only">{points.map(point => <li key={point.month}>{point.month}：{point[metric] === null ? "无数据" : format(point[metric]!)}</li>)}</ul>
  </section>;
}

export function SkuRecommendationEvidence({ row, period }: { row: OperatingSku; period: string }) {
  const id = useId();
  const points = buildSkuRecommendationEvidence(row, period);
  const range = points.length ? `${points[0].month}—${points.at(-1)!.month}` : "暂无可用月份";
  return <div className="grid items-start gap-4 lg:grid-cols-2" aria-label="SKU 调整建议的可视化依据">
    <section className="ops-surface min-w-0 p-5" aria-labelledby={`${id}-price`}>
      <h3 id={`${id}-price`} className="ops-section-title">价格与销售</h3>
      <p className="ops-subtext mt-1">{range} · {row.currency} · 同月对照</p>
      <EvidenceTrend points={points} metric="averagePrice" label="实际成交均价" color="var(--chart-secondary)" currency={row.currency} />
      <EvidenceTrend points={points} metric="revenue" label="商品销售额" color="var(--chart-primary)" currency={row.currency} />
      <p className="ops-subtext mt-2">成交均价＝商品销售额 ÷ 销售件数，不等于当前标价；并列趋势不证明调价导致销量变化。</p>
    </section>
    <section className="ops-surface min-w-0 p-5" aria-labelledby={`${id}-advertising`}>
      <h3 id={`${id}-advertising`} className="ops-section-title">广告投入与回报</h3>
      <p className="ops-subtext mt-1">{range} · {row.currency} · 同月完整广告数据</p>
      <EvidenceTrend points={points} metric="advertisingCost" label="广告花费" color="var(--chart-tertiary)" currency={row.currency} />
      <EvidenceTrend points={points} metric="advertisingSales" label="广告归因销售" color="var(--chart-primary)" currency={row.currency} />
      <EvidenceTrend points={points} metric="acos" label="ACOS" color="var(--chart-secondary)" currency={row.currency} />
      <p className="ops-subtext mt-2">ACOS＝广告花费 ÷ 广告归因销售；只取同月且覆盖整月的广告报告，缺失不补零。</p>
    </section>
  </div>;
}
