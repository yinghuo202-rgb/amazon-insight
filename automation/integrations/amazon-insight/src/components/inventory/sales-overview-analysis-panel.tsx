import Link from "next/link";
import { ArrowUpRight, ChevronDown } from "lucide-react";

import type { SalesOverviewAnalysis } from "@/lib/inventory/sales-overview-analysis";
import { fullCurrency } from "@/lib/inventory/presentation";
import { skuOperatingHref } from "@/lib/inventory/operating-navigation";

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const signedPercent = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
const points = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(1)} 个百分点`;
const tone = (value: number) => value < 0 ? "var(--danger)" : value > 0 ? "var(--positive)" : "var(--foreground-soft)";
type AnalysisContext = Parameters<typeof skuOperatingHref>[3];

export function SalesOverviewAnalysisPanel({ analysis, onNavigate, context, expanded, onExpandedChange }: { analysis: SalesOverviewAnalysis; onNavigate?: () => void; context?: AnalysisContext; expanded?: boolean; onExpandedChange?: (open: boolean) => void }) {
  const { period, currency, comparisons, advertising, profit, topFive } = analysis;
  const money = (value: number) => fullCurrency(value, currency);
  const signedMoney = (value: number) => `${value > 0 ? "+" : ""}${money(value)}`;
  const comparisonItems = [
    { label: "较上月", value: comparisons.month },
    { label: "近三月较前三月", value: comparisons.quarter },
    { label: "较去年同月", value: comparisons.year },
  ].filter(item => item.value !== null);

  return <section className="ops-surface ops-sales-analysis" aria-label="整体销售分析">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="ops-section-title">整体销售分析</h2><p className="ops-subtext mt-1">{analysis.market} · {currency}{period ? ` · ${period} 完整月` : ""}</p></div>
      {period && <span className="ops-badge ops-badge-slate">{analysis.skuCount ? `${analysis.skuCount} 个有记录 SKU` : "历史月度汇总"}</span>}
    </header>
    {analysis.fallback && <p className="ops-subtext mt-3">当前选择 {analysis.requestedPeriod}；以下使用最近完整月 {period} 分析。</p>}
    {analysis.status !== "available" ? <p className="ops-subtext mt-4">{analysis.status === "incomplete" ? "所选月份尚未完整，暂不生成整月销售比较。" : "暂无可用于历史分析的完整月份。"}</p> : <>
      <div className="ops-analysis-narrative mt-4">
        {analysis.conclusions.length ? analysis.conclusions.map((text, index) => <p key={text} className={index === 0 ? "ops-analysis-lead" : "ops-subtext mt-2"}>{text}</p>) : <p className="ops-analysis-lead">{period} 已报销售额 {analysis.revenue === null ? "—" : money(analysis.revenue)}。</p>}
      </div>
      {comparisonItems.length > 0 && <dl className="ops-analysis-comparisons mt-5">{comparisonItems.map(({ label, value }) => value && <div key={label}>
        <dt className="ops-subtext">{label}</dt><dd className="ops-analysis-comparison-value" style={{ color: tone(value.delta) }}>{value.percent === null ? signedMoney(value.delta) : signedPercent(value.percent)}</dd>
        <dd className="ops-subtext">{value.percent !== null ? `${signedMoney(value.delta)} · ` : ""}对比 {value.previousPeriod}</dd>
        {label === "近三月较前三月" && <dd className="ops-subtext">本期 {value.currentPeriod}</dd>}
      </div>)}</dl>}
      <div className="ops-analysis-observations mt-5">
        {topFive && <div><h3>销售集中度</h3><p>前 {topFive.skuCount} 个 SKU 贡献 {percent(topFive.share)} 的销售额。</p><p className="ops-subtext mt-1">合计 {money(topFive.revenue)}{topFive.pointChange !== null ? ` · 较上月 ${points(topFive.pointChange)}` : ""}</p></div>}
        {advertising && <div><h3>广告投入</h3><p>{advertising.spendShare !== null ? `花费占销售额 ${percent(advertising.spendShare)}` : `花费 ${money(advertising.currentCost)}`}{advertising.spendSharePointChange !== null ? `，较上月 ${points(advertising.spendSharePointChange)}` : ""}。</p>{advertising.acos !== null && <p className="ops-subtext mt-1">ACOS {percent(advertising.acos)}{advertising.acosPointChange !== null ? ` · ${points(advertising.acosPointChange)}` : ""}</p>}</div>}
        {profit && <div><h3>利润联动</h3><p>已核验利润 {money(profit.current)}{profit.delta !== null ? `，较上月 ${signedMoney(profit.delta)}` : ""}。</p>{profit.margin !== null && <p className="ops-subtext mt-1">利润率 {percent(profit.margin)}{profit.marginPointChange !== null ? ` · ${points(profit.marginPointChange)}` : ""}</p>}</div>}
      </div>
    </>}
    <details className="ops-analysis-evidence mt-5" open={expanded} onToggle={event => onExpandedChange?.(event.currentTarget.open)}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium">查看历史分析依据 <ChevronDown size={16} aria-hidden="true" /></summary>
      {analysis.decomposition && <div className="ops-analysis-detail-grid mt-4">
        <div><h3 className="text-sm font-semibold">销售额变化拆解</h3><p className="ops-subtext mt-1">{comparisons.month?.previousPeriod} → {period} · 合计 {signedMoney(analysis.decomposition.total)}</p><ContributionBars analysis={analysis} />
          <p className="ops-subtext mt-3">销量与成交均价按两月都有记录的同一 SKU 拆解；“记录范围差异”是仅出现在单月的报告金额，不等同于新品或流失。</p></div>
        <div><h3 className="text-sm font-semibold">同 SKU 的主要变化</h3><p className="ops-subtext mt-1">按销售额增减金额排序</p><div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
          <MoverList title="增长贡献" items={analysis.movers.gainers} analysis={analysis} onNavigate={onNavigate} context={context} />
          <MoverList title="下降贡献" items={analysis.movers.decliners} analysis={analysis} onNavigate={onNavigate} context={context} />
        </div></div>
      </div>}
      <div className="ops-subtext space-y-2 pt-4">
        {analysis.skuCount > 0 && <p>本月 {analysis.basis.currentSkuCount} 个、上月 {analysis.basis.previousSkuCount} 个有记录 SKU；两月共有 {analysis.basis.matchedSkuCount} 个。</p>}
        {analysis.basis.notes.map(note => <p key={note}>{note}</p>)}
        <p>来源：{analysis.basis.sources.join("、") || "已发布经营报告"}{analysis.basis.generatedAt ? ` · 更新 ${analysis.basis.generatedAt}` : ""}</p>
        {analysis.basis.version && <p className="break-all">数据版本 {analysis.basis.version}</p>}
      </div>
    </details>
  </section>;
}

function ContributionBars({ analysis }: { analysis: SalesOverviewAnalysis }) {
  const data = analysis.decomposition!;
  const rows = [
    { label: "销量变化", value: data.volume, neutral: false },
    { label: "成交均价变化", value: data.price, neutral: false },
    { label: "其他同 SKU 变化", value: data.otherMatched, neutral: true },
    { label: "记录范围差异", value: data.coverageDifference, neutral: true },
  ];
  const scale = Math.max(...rows.map(item => Math.abs(item.value)), 1);
  return <ul className="mt-4 space-y-3" aria-label="销售额变化金额拆解">{rows.map(item => <li key={item.label}>
    <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-xs"><span>{item.label}</span><strong className="tabular-nums" style={{ color: item.neutral ? "var(--foreground-soft)" : tone(item.value) }}>{item.value > 0 ? "+" : ""}{fullCurrency(item.value, analysis.currency)}</strong></div>
    <div className="ops-contribution-track" aria-hidden="true"><span style={{ width: `${Math.abs(item.value) / scale * 50}%`, left: item.value < 0 ? `${50 - Math.abs(item.value) / scale * 50}%` : "50%", background: item.neutral ? "var(--foreground-soft)" : tone(item.value) }} /></div>
  </li>)}</ul>;
}

function MoverList({ title, items, analysis, onNavigate, context }: { title: string; items: SalesOverviewAnalysis["movers"]["gainers"]; analysis: SalesOverviewAnalysis; onNavigate?: () => void; context?: AnalysisContext }) {
  return <section><h4 className="ops-subtext">{title}</h4>{items.length ? <ul className="mt-1 divide-y divide-[var(--border)]">{items.map(item => <li key={item.sku}><Link onClick={onNavigate} href={skuOperatingHref(item.sku, analysis.market, analysis.period!, { ...context, origin: "overview", returnPeriod: analysis.requestedPeriod })} className="ops-analysis-mover">
    <span className="min-w-0"><strong className="block text-xs font-semibold">{item.sku}</strong><span className="ops-subtext block truncate">{item.productName || item.sku}</span></span>
    <span className="shrink-0 text-xs font-semibold tabular-nums" style={{ color: tone(item.delta) }}>{item.delta > 0 ? "+" : ""}{fullCurrency(item.delta, analysis.currency)}</span><ArrowUpRight size={14} aria-hidden="true" />
  </Link></li>)}</ul> : <p className="ops-subtext py-3">无{title === "增长贡献" ? "增长" : "下降"}记录</p>}</section>;
}
