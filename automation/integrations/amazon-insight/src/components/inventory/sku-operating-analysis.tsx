"use client";
import { useState } from "react";
import type { OperatingSku, operatingFacts } from "@/lib/inventory/dashboard-view-model";
import { fullCurrency } from "@/lib/inventory/presentation";
import { OperatingHistoryChart } from "@/components/inventory/operating-history-chart";
import { fillOperatingChartMonths } from "@/lib/inventory/operating-chart";

export function SkuOperatingAnalysis({ row, period, facts }: { row: OperatingSku; period: string; facts: ReturnType<typeof operatingFacts> }) {
  const [metric, setMetric] = useState<"revenue" | "profit">("revenue");
  const currentMonth = new Date().toISOString().slice(0, 7);
  const history = row.history.filter(point => point.reportMonth <= period).slice(-6);
  const chart = fillOperatingChartMonths(history.map(point => ({ month: point.reportMonth, revenue: point.productSales, profit: point.actualProfit, complete: point.reportMonth < currentMonth && point.quality?.completePeriod !== false, mtd: point.reportMonth === currentMonth, asOf: point.quality?.businessAsOf || null })), period);
  const suggestions = [...facts.hypotheses, ...(facts.suggestion ? [facts.suggestion] : [])];
  const price = (value: number | null) => value === null ? "—" : fullCurrency(value, row.currency);
  const basis = row.stock?.demandBasis;
  return <div className="ops-detail-analysis-grid">
    <section className="ops-surface p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="ops-section-title">经营趋势</h2><p className="ops-subtext mt-2">最近 {chart.length} 个月 · {row.currency}</p></div><div className="ops-chart-control" aria-label="SKU 趋势指标">{(["revenue", "profit"] as const).map(key => <button key={key} aria-pressed={metric === key} className={metric === key ? "active" : ""} onClick={() => setMetric(key)}>{key === "revenue" ? "销售额" : "利润"}</button>)}</div></div>
      <OperatingHistoryChart points={chart} metric={metric} currency={row.currency} />
      <h3 className="mt-5 text-sm font-semibold">历史成交均价</h3><div className="mt-3 flex flex-wrap gap-2">{history.map(point => <span key={point.reportMonth} className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">{point.reportMonth} · {price(point.averagePrice ?? (point.units > 0 ? point.productSales / point.units : null))}</span>)}</div>
      {row.seasonality.evidenceMonths >= 12 ? <p className="ops-subtext mt-4">历史高销量月份：{row.seasonality.peakMonths.join("、")} 月</p> : null}
    </section>
    <aside className="ops-surface p-5"><h2 className="ops-section-title">经营观察</h2>{facts.issues.length > 0 ? <div className="mt-4 flex flex-wrap gap-2">{facts.issues.map(issue => <span key={issue} className="ops-status">{issue}</span>)}</div> : null}{suggestions.length > 0 ? <ul className="mt-3 divide-y divide-slate-100">{suggestions.map((text, index) => <li key={text} className="flex gap-3 py-4 text-sm leading-6 text-slate-600"><span className="ops-focus-index">{index + 1}</span><p>{text}</p></li>)}</ul> : <p className="ops-subtext py-8">本期无补充建议</p>}<details className="mt-3 border-t border-slate-100 pt-4 text-xs leading-6 text-slate-500"><summary className="min-h-11 cursor-pointer">数据与经营依据</summary><p className="mt-3">经营 {period} · 截至 {facts.current?.quality?.businessAsOf || "—"}</p><p>仓储费 {price(facts.current?.storageCost ?? null)} · 退货 {facts.current?.returns ?? "—"} 件</p>{basis ? <p>需求基线：{basis.label} · {basis.monthlySales === null ? `${basis.dailySales.toFixed(1)} 件/日` : `${basis.monthlySales} 件/月`} · {basis.date || "期间未知"} · {basis.method}</p> : null}{facts.dataIssues.length > 0 ? <p>{facts.dataIssues.join(" · ")}</p> : null}</details></aside>
  </div>;
}
