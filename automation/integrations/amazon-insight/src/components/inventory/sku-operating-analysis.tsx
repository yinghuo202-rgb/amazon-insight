"use client";
import { useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { OperatingSku, operatingFacts } from "@/lib/inventory/dashboard-view-model";
import { fullCurrency } from "@/lib/inventory/presentation";

export function SkuOperatingAnalysis({ row, period, facts }: { row: OperatingSku; period: string; facts: ReturnType<typeof operatingFacts> }) {
  const [metric, setMetric] = useState<"productSales" | "actualProfit">("productSales");
  const history = row.history.filter(point => point.reportMonth <= period).slice(-6);
  const suggestions = [...facts.hypotheses, ...(facts.suggestion ? [facts.suggestion] : [])];
  const price = (value: number | null) => value === null ? "—" : fullCurrency(value, row.currency);
  return <div className="ops-detail-analysis-grid">
    <section className="ops-surface p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="ops-section-title">近六个月经营趋势</h2><p className="ops-subtext mt-2">{row.sku} · {row.market} · {row.currency}</p></div><div className="ops-chart-control">{(["productSales", "actualProfit"] as const).map(key => <button key={key} aria-pressed={metric === key} className={metric === key ? "active" : ""} onClick={() => setMetric(key)}>{key === "productSales" ? "销售额" : "利润"}</button>)}</div></div>
      {history.filter(point => point[metric] !== null).length > 1 ? <div className="my-5 h-64"><ResponsiveContainer width="100%" height="100%"><AreaChart data={history} margin={{ top: 10, right: 8, bottom: 4, left: 0 }}><CartesianGrid vertical={false} stroke="#edf1ed" /><XAxis dataKey="reportMonth" tick={{ fontSize: 10, fill: "#677b70" }} tickLine={false} axisLine={false} /><YAxis tickFormatter={value => new Intl.NumberFormat("en", { notation: "compact" }).format(value)} width={48} tick={{ fontSize: 10, fill: "#677b70" }} tickLine={false} axisLine={false} /><Tooltip formatter={value => price(value == null ? null : Number(value))} contentStyle={{ borderRadius: 10, fontSize: 12 }} /><Area dataKey={metric} name={metric === "productSales" ? "销售额" : "报告利润"} stroke="#357866" fill="#e3f0e9" fillOpacity={0.6} strokeWidth={2.5} connectNulls={false} /></AreaChart></ResponsiveContainer></div> : <p className="ops-subtext py-12 text-center">暂无连续月份数据</p>}
      <h3 className="text-xs font-semibold">历史成交均价</h3><div className="mt-3 flex flex-wrap gap-2">{history.map(point => <span key={point.reportMonth} className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">{point.reportMonth} · {price(point.averagePrice ?? (point.units > 0 ? point.productSales / point.units : null))}</span>)}</div>
      {row.seasonality.evidenceMonths >= 12 && <p className="ops-subtext mt-4">历史高销量月份：{row.seasonality.peakMonths.join("、")} 月</p>}
    </section>
    <aside className="ops-surface p-5"><h2 className="ops-section-title">经营观察</h2>{facts.issues.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{facts.issues.map(issue => <span key={issue} className="ops-status">{issue}</span>)}</div>}{suggestions.length > 0 ? <ul className="mt-3 divide-y divide-slate-100">{suggestions.map((text, index) => <li key={text} className="flex gap-3 py-4 text-xs leading-6 text-slate-600"><span className="ops-focus-index">{index + 1}</span><p>{text}</p></li>)}</ul> : <p className="ops-subtext py-8">本期无补充建议</p>}<details className="mt-3 border-t border-slate-100 pt-4 text-xs leading-6 text-slate-500"><summary className="cursor-pointer">数据与经营依据</summary><p className="mt-3">经营 {period} · 截至 {facts.current?.quality?.businessAsOf || "—"}</p><p>仓储费 {price(facts.current?.storageCost ?? null)} · 退货 {facts.current?.returns ?? "—"} 件</p>{facts.dataIssues.length > 0 && <p>{facts.dataIssues.join(" · ")}</p>}</details></aside>
  </div>;
}
