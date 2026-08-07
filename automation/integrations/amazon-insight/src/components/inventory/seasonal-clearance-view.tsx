"use client";

import { ArrowDownAZ, ArrowUpAZ, ChevronDown, CircleAlert, Download, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { OpsBadge, OpsCard, OpsCardHeader, OpsKpi } from "@/components/inventory/ops-ui";
import { integer } from "@/lib/inventory/presentation";
import type { ClearancePricingSuggestion, SeasonalInventoryCandidate, SeasonalInventoryPlanResult } from "@/lib/inventory/seasonal-clearance";
import { buildSeasonalDecisionRows, buildSeasonalDecisionSummary, type SeasonalDecisionKind, type SeasonalDecisionRow } from "@/lib/inventory/seasonal-decision";

type MarketView = "ALL" | "US" | "CA";
type SkuSort = "priority" | "sku-asc" | "sku-desc";
const marketLabels: Record<MarketView, string> = { ALL: "美加合计", US: "美国", CA: "加拿大" };
const decisionLabels: Record<SeasonalDecisionKind, string> = { cross_market: "跨站供需错配", clearance: "季末清货", urgent_replenishment: "紧急补货", domestic_transfer: "国内调拨", expedite_pending: "加急未完工", monitor: "旺季关注" };
const decisionTones: Record<SeasonalDecisionKind, "rose" | "amber" | "emerald" | "blue"> = { cross_market: "amber", clearance: "rose", urgent_replenishment: "rose", domestic_transfer: "emerald", expedite_pending: "amber", monitor: "blue" };

export function SeasonalClearanceView({ result, initialMarket = "ALL" }: { result: SeasonalInventoryPlanResult; initialMarket?: MarketView }) {
  const [marketView, setMarketView] = useState<MarketView>(initialMarket);
  const [listOpen, setListOpen] = useState(true);
  const [methodOpen, setMethodOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [skuFilter, setSkuFilter] = useState("ALL");
  const [skuSort, setSkuSort] = useState<SkuSort>("priority");
  const [showAllRows, setShowAllRows] = useState(false);
  const decisions = useMemo(() => buildSeasonalDecisionRows(result), [result]);
  const summary = useMemo(() => buildSeasonalDecisionSummary(result), [result]);
  const marketRows = decisions.filter((row) => marketView === "ALL" || marketRelevant(row, marketView));
  const skuOptions = useMemo(() => [...new Set(decisions.map((row) => row.candidate.sku))].sort((left, right) => left.localeCompare(right)), [decisions]);
  const normalizedQuery = query.trim().toUpperCase();
  const visibleRows = marketRows.filter((row) => (skuFilter === "ALL" || row.candidate.sku === skuFilter) && (!normalizedQuery || `${row.candidate.sku} ${row.candidate.productName} ${decisionLabels[row.kind]}`.toUpperCase().includes(normalizedQuery)));
  const sortedRows = skuSort === "priority" ? visibleRows : [...visibleRows].sort((left, right) => {
    const comparison = left.candidate.sku.localeCompare(right.candidate.sku, "en", { numeric: true });
    return skuSort === "sku-asc" ? comparison : -comparison;
  });
  const displayedRows = showAllRows || normalizedQuery || skuFilter !== "ALL" ? sortedRows : sortedRows.slice(0, 25);
  const selectedMarketSummary = marketView === "ALL" ? null : summary.markets[marketView];
  const replenishmentGap = selectedMarketSummary?.replenishmentGapQty ?? summary.replenishmentGapQty;
  const clearanceStock = selectedMarketSummary?.clearanceQty ?? summary.clearanceStockQty;
  const transferCoverage = selectedMarketSummary ? selectedMarketSummary.transferQty + selectedMarketSummary.pendingCoverageQty : result.summary.domesticTransferQty + result.summary.pendingCoverageQty;
  const urgentGap = selectedMarketSummary?.urgentQty ?? result.summary.urgentReplenishmentQty;
  const seasonalSeries = aggregateSeasonality(marketRows, marketView);
  const peakSeasonPoint = [...seasonalSeries].sort((left, right) => right.units - left.units)[0];
  const coveredGap = Math.min(replenishmentGap, transferCoverage);
  const coveragePercent = replenishmentGap ? Math.round(coveredGap / replenishmentGap * 100) : 100;
  const topDecision = sortedRows[0];

  return <div className="space-y-5">
    <div className="flex flex-col gap-3 border border-slate-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div><p className="text-xs font-semibold text-slate-900">执行视图</p><p className="mt-1 text-[11px] text-slate-500">同一 SKU 的补货和清货合并为一条决策；美国、加拿大独立计算，国内与未完工订单仍是共享池。</p></div>
      <div className="inline-flex w-fit border border-slate-200 bg-slate-50 p-1" role="group" aria-label="选择季节库存市场视图">{(["ALL", "US", "CA"] as const).map((market) => <button key={market} type="button" aria-pressed={marketView === market} onClick={() => { setMarketView(market); setShowAllRows(false); }} className={`px-4 py-2 text-xs font-semibold transition ${marketView === market ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:bg-white hover:text-slate-900"}`}>{marketLabels[market]}</button>)}</div>
    </div>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <OpsKpi label={`${marketView === "ALL" ? "" : `${marketLabels[marketView]} · `}执行 SKU`} value={`${integer(marketRows.length)} 个`} detail={marketView === "ALL" ? `补货 ${result.summary.replenishmentCandidateCount} · 清货 ${result.summary.clearanceCandidateCount} · 重合 ${summary.overlapCount} 已合并` : `仅保留本站存在缺口、清货或旺季需求的商品`} />
      <OpsKpi label="站点补货缺口" value={integer(replenishmentGap)} detail={`国内及未完工可覆盖 ${integer(transferCoverage)} 件`} tone={urgentGap ? "warning" : "positive"} />
      <OpsKpi label="季末前需清现货" value={integer(clearanceStock)} detail={marketView === "ALL" ? `海外 ${integer(result.summary.overseasClearanceQty)} · 国内共享 ${integer(result.summary.domesticClearanceQty)}` : "本站仅统计海外清货；国内共享池单列"} tone="danger" />
      <OpsKpi label="需新增采购 / 处置" value={integer(urgentGap + result.summary.pendingMitigationQty)} detail={`扣减国内与未完工后需采购 ${integer(urgentGap)} · 未完工需处置 ${integer(result.summary.pendingMitigationQty)}`} tone="warning" />
    </div>

    <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
      <OpsCard>
        <OpsCardHeader title={`${marketLabels[marketView]}季节销量形态`} description={peakSeasonPoint?.units ? `行动 SKU 历史月均销量在 ${peakSeasonPoint.month} 月最高，合计 ${integer(peakSeasonPoint.units)} 件。` : "当前行动 SKU 的季节销量样本不足。"} />
        <SeasonalityVolumeChart series={seasonalSeries} />
      </OpsCard>
      <OpsCard>
        <OpsCardHeader title="市场执行量对比" description={`${marketLabels[marketView]}补货缺口 ${integer(replenishmentGap)} 件、季末需清现货 ${integer(clearanceStock)} 件，需分别推进。`} />
        <MarketComparisonChart summary={summary.markets} marketView={marketView} />
      </OpsCard>
    </div>

    <OpsCard>
      <OpsCardHeader title="供给处理结构" description={`国内现货与未完工可覆盖补货缺口的 ${coveragePercent}%，扣减后仍需新增采购 ${integer(urgentGap)} 件。`} />
      <ActionStructureChart result={result} />
    </OpsCard>

    <div className="flex items-start gap-3 border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-950">
      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <p>已识别 {summary.crossMarketMismatchCount} 个跨站供需错配 SKU，应先确认跨站调拨可行性，再决定缺货站补货和积压站降价；清货定价覆盖 {result.summary.pricedClearanceSkuCount}/{result.summary.clearanceCandidateCount} 个 SKU，成本风险商品不会被压到亏损价格。</p>
    </div>

    <OpsCard>
      <OpsCardHeader title={`${marketLabels[marketView]}季节执行清单`} description={topDecision ? `当前共 ${visibleRows.length} 个行动 SKU，${topDecision.candidate.sku} 的首要动作是${decisionLabels[topDecision.kind]}。` : "当前市场与筛选条件下没有季节执行动作。"} action={<div className="flex flex-wrap items-center gap-2"><SectionToggle open={listOpen} onClick={() => setListOpen((current) => !current)} label="执行清单" /><ExportLink kind="replenishment" market={marketView}>下载补货表</ExportLink><ExportLink kind="clearance" market={marketView}>下载清货表</ExportLink></div>} />
      {listOpen ? <>
        <div className="flex flex-col gap-3 border-y border-slate-100 bg-slate-50/60 px-4 py-3 xl:flex-row xl:items-center xl:justify-between"><p className="text-[11px] text-slate-500">优先顺序：跨站错配 → 清货 → 紧急补货 → 国内调拨 → 加急未完工 → 旺季关注</p><div className="flex flex-col gap-2 sm:flex-row"><label className="relative"><span className="sr-only">季节清单排序</span>{skuSort === "sku-desc" ? <ArrowDownAZ className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /> : <ArrowUpAZ className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />}<select aria-label="季节清单排序" value={skuSort} onChange={(event) => setSkuSort(event.target.value as SkuSort)} className="w-full border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-emerald-600 sm:w-48"><option value="priority">按执行优先级</option><option value="sku-asc">SKU 升序（A→Z）</option><option value="sku-desc">SKU 降序（Z→A）</option></select></label><label><span className="sr-only">按 SKU 筛选</span><select value={skuFilter} onChange={(event) => { setSkuFilter(event.target.value); setShowAllRows(false); }} className="w-full border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-600 sm:w-44"><option value="ALL">全部 SKU</option>{skuOptions.map((sku) => <option key={sku} value={sku}>{sku}</option>)}</select></label><label className="relative"><span className="sr-only">搜索 SKU 或产品</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索产品 / 动作" className="w-full border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-emerald-600 sm:w-64" /></label></div></div>
        {visibleRows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[960px] text-left text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-[0.06em] text-slate-500"><tr><th className="px-4 py-3">SKU / 首要动作</th><th className="px-3 py-3">美国计划</th><th className="px-3 py-3">加拿大计划</th><th className="px-3 py-3">国内供给 / 需采购</th><th className="px-3 py-3">执行建议</th><th className="px-4 py-3 text-right">截止 / 置信度</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{displayedRows.map((row) => <DecisionTableRow key={row.candidate.sku} row={row} result={result} />)}</tbody>
        </table></div> : <div className="p-10 text-center text-sm text-slate-500">当前市场或搜索条件下没有季节执行 SKU。</div>}
        {!normalizedQuery && visibleRows.length > 25 ? <div className="border-t border-slate-100 px-4 py-3 text-center"><button type="button" onClick={() => setShowAllRows((current) => !current)} className="text-xs font-semibold text-emerald-700 hover:underline">{showAllRows ? "收起，仅显示前 25 个高优先级 SKU" : `显示全部 ${visibleRows.length} 个执行 SKU`}</button></div> : null}
      </> : null}
    </OpsCard>

    <OpsCard>
      <OpsCardHeader title="统计与计算口径" description={`当前识别 ${summary.crossMarketMismatchCount} 个跨站错配 SKU，清货定价已覆盖 ${result.summary.pricedClearanceSkuCount}/${result.summary.clearanceCandidateCount} 个候选。`} action={<SectionToggle open={methodOpen} onClick={() => setMethodOpen((current) => !current)} label="计算口径" />} />
      {methodOpen ? <div className="grid gap-px bg-slate-200 sm:grid-cols-2 xl:grid-cols-4">
        <Rule title="滞销基准" body="美加海外库存加国内现货，除以最近 12 个月有记录的美加合并平均月销；≥12 个月或无销量保留为参考表滞销标记，未完工订单不计入该基准。" />
        <Rule title="稳健销量节奏" body="以完整历史年度形成月度季节曲线；最近三个月实际销量相对历史同期的倍率取中位数，并限制在 60%–140%，避免单月异常放大补货量。" />
        <Rule title="补货分配" body="按站点预测需求加 15% 安全量，先扣海外库存；缺口按比例分配国内共享库存，再分配未完工订单，最后剩余量才列为紧急采购。" />
        <Rule title="清货与定价" body="海外、国内现货和未完工订单分开计算；清货期优先停广告，建议价不得低于包含平台扣费、FOB、头程和仓储后的 5% 毛利保护价。" />
      </div> : null}
    </OpsCard>
  </div>;
}

function DecisionTableRow({ row, result }: { row: SeasonalDecisionRow; result: SeasonalInventoryPlanResult }) {
  const candidate = row.candidate;
  const recommendation = [row.replenishment ? candidate.replenishmentRecommendation : "", row.clearance ? candidate.clearanceRecommendation : ""].filter(Boolean).join(" ");
  return <tr className="align-top hover:bg-slate-50">
    <td className="px-4 py-4"><div className="flex flex-wrap gap-1.5"><OpsBadge tone={decisionTones[row.kind]}>{decisionLabels[row.kind]}</OpsBadge>{row.clearance && row.replenishment ? <OpsBadge tone="blue">补货 + 清货已合并</OpsBadge> : null}</div><CandidateLink candidate={candidate} /><p className="mt-2 text-[10px] text-slate-400">处理量 {integer(row.actionQuantity)} 件</p></td>
    <td className="px-3 py-4"><MarketPlan candidate={candidate} market="US" clearance={row.clearance} replenishment={row.replenishment} /></td>
    <td className="px-3 py-4"><MarketPlan candidate={candidate} market="CA" clearance={row.clearance} replenishment={row.replenishment} /></td>
    <td className="px-3 py-4"><SharedSupply candidate={candidate} clearance={row.clearance} replenishment={row.replenishment} /></td>
    <td className="max-w-sm px-3 py-4 text-[11px] leading-5 text-slate-600">{recommendation || "按周复核销量与库存。"}</td>
    <td className="px-4 py-4 text-right"><p className="font-mono font-semibold text-slate-900">{row.clearance ? result.seasonEndDate : candidate.replenishmentHorizonEnd}</p><p className="mt-1 text-[10px] text-slate-400">{row.clearance ? "季末前售罄" : "旺季覆盖截止"}</p><p className={`mt-2 text-[10px] font-medium ${row.confidence === "low" ? "text-amber-700" : "text-emerald-700"}`}>数据置信度 {row.confidence === "high" ? "高" : row.confidence === "medium" ? "中" : "低"}</p></td>
  </tr>;
}

function MarketPlan({ candidate, market, clearance, replenishment }: { candidate: SeasonalInventoryCandidate; market: "US" | "CA"; clearance: boolean; replenishment: boolean }) {
  const inventory = market === "US" ? candidate.usOverseasInventory : candidate.caOverseasInventory;
  const reserve = market === "US" ? candidate.usReserveUnits : candidate.caReserveUnits;
  const gap = market === "US" ? candidate.usReplenishmentGap : candidate.caReplenishmentGap;
  const clearQty = clearance ? market === "US" ? candidate.usClearanceQty : candidate.caClearanceQty : 0;
  const urgent = market === "US" ? candidate.usUrgentReplenishmentQty : candidate.caUrgentReplenishmentQty;
  const pricing = market === "US" ? candidate.usPricing : candidate.caPricing;
  return <div className="min-w-36 space-y-1"><p className="font-semibold text-slate-900">库存 {integer(inventory)} · 保留 {integer(reserve)}</p>{replenishment && gap ? <p className="text-rose-700">站点缺口 {integer(gap)}{urgent ? ` · 分摊采购 ${integer(urgent)}` : ""}</p> : null}{clearQty ? <p className="text-rose-700">清货 {integer(clearQty)}</p> : null}{clearQty ? <PricingLine pricing={pricing} /> : null}{!gap && !clearQty ? <p className="text-slate-400">本站暂无数量动作</p> : null}</div>;
}

function SharedSupply({ candidate, clearance, replenishment }: { candidate: SeasonalInventoryCandidate; clearance: boolean; replenishment: boolean }) {
  return <div className="min-w-40 space-y-1"><p className="font-semibold text-blue-700">国内现货 {integer(candidate.domesticInventory)}</p>{replenishment && candidate.domesticTransferQty ? <p className="text-emerald-700">先调拨 {integer(candidate.domesticTransferQty)}</p> : null}{clearance && candidate.domesticClearanceQty ? <p className="text-rose-700">国内清货 {integer(candidate.domesticClearanceQty)}</p> : null}<p className="pt-1 text-slate-500">未完工 {integer(candidate.pendingOrderQty)}</p>{replenishment && candidate.pendingCoverageQty ? <p className="text-amber-700">再加急 {integer(candidate.pendingCoverageQty)}</p> : null}{replenishment && candidate.urgentReplenishmentQty ? <p className="font-semibold text-rose-700">需新增采购 {integer(candidate.urgentReplenishmentQty)}</p> : replenishment ? <p className="text-emerald-700">无需新增采购</p> : null}{clearance && candidate.pendingMitigationQty ? <p className="text-amber-700">停单/转款 {integer(candidate.pendingMitigationQty)}</p> : null}</div>;
}

function SeasonalityVolumeChart({ series }: { series: Array<{ month: number; units: number }> }) {
  const maximum = Math.max(1, ...series.map((point) => point.units));
  const peak = new Set([...series].sort((left, right) => right.units - left.units).slice(0, 3).map((point) => point.month));
  return <div className="px-4 pb-5 pt-4" role="img" aria-label={`一月至十二月行动 SKU 历史销量，最高月份为${[...peak].sort((a, b) => a - b).map((month) => `${month}月`).join("、")}`}><div className="flex h-44 items-end gap-2 border-b border-slate-200">{series.map((point) => <div key={point.month} className="flex h-full min-w-0 flex-1 items-end"><div title={`${point.month}月：${integer(point.units)} 件`} className={`relative w-full ${peak.has(point.month) ? "bg-emerald-500" : "bg-slate-300"}`} style={{ height: `${Math.max(4, point.units / maximum * 100)}%` }}>{peak.has(point.month) ? <span className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium text-slate-700">{integer(point.units)}</span> : null}</div></div>)}</div><div className="mt-2 flex gap-2">{series.map((point) => <span key={point.month} className="min-w-0 flex-1 text-center text-[10px] text-slate-400">{point.month}月</span>)}</div></div>;
}

function MarketComparisonChart({ summary, marketView }: { summary: ReturnType<typeof buildSeasonalDecisionSummary>["markets"]; marketView: MarketView }) {
  const rows = (["US", "CA"] as const).filter((market) => marketView === "ALL" || market === marketView);
  const maximum = Math.max(1, ...rows.flatMap((market) => [summary[market].replenishmentGapQty, summary[market].clearanceQty]));
  return <div className="space-y-5 p-4">{rows.map((market) => <div key={market}><div className="mb-2 flex items-center justify-between"><p className="text-xs font-semibold text-slate-900">{marketLabels[market]}</p><p className="text-[10px] text-slate-400">调拨 {integer(summary[market].transferQty)} · 在途 {integer(summary[market].pendingCoverageQty)} · 紧急 {integer(summary[market].urgentQty)}</p></div><VolumeBar label="补货缺口" value={summary[market].replenishmentGapQty} maximum={maximum} tone="emerald" /><VolumeBar label="海外清货" value={summary[market].clearanceQty} maximum={maximum} tone="rose" /></div>)}</div>;
}

function ActionStructureChart({ result }: { result: SeasonalInventoryPlanResult }) {
  const rows = [
    { label: "国内调拨覆盖", value: result.summary.domesticTransferQty, tone: "emerald" as const },
    { label: "未完工覆盖", value: result.summary.pendingCoverageQty, tone: "blue" as const },
    { label: "扣减后需采购", value: result.summary.urgentReplenishmentQty, tone: "amber" as const },
    { label: "现货清货", value: result.summary.currentClearanceQty, tone: "rose" as const },
    { label: "未完工需处置", value: result.summary.pendingMitigationQty, tone: "slate" as const },
  ];
  const maximum = Math.max(1, ...rows.map((row) => row.value));
  return <div className="grid gap-x-8 gap-y-3 p-4 lg:grid-cols-2">{rows.map((row) => <VolumeBar key={row.label} label={row.label} value={row.value} maximum={maximum} tone={row.tone} />)}</div>;
}

function VolumeBar({ label, value, maximum, tone }: { label: string; value: number; maximum: number; tone: "emerald" | "rose" | "amber" | "blue" | "slate" }) {
  const colors = { emerald: "bg-emerald-500", rose: "bg-rose-500", amber: "bg-amber-500", blue: "bg-blue-500", slate: "bg-slate-500" };
  return <div className="mb-2 grid grid-cols-[6rem_1fr_4.5rem] items-center gap-3"><span className="text-[11px] text-slate-500">{label}</span><div className="h-2.5 bg-slate-100"><div className={`h-full ${colors[tone]}`} style={{ width: `${Math.max(value ? 2 : 0, value / maximum * 100)}%` }} /></div><span className="text-right font-mono text-xs font-semibold text-slate-800">{integer(value)}</span></div>;
}

function aggregateSeasonality(rows: SeasonalDecisionRow[], market: MarketView) {
  return Array.from({ length: 12 }, (_, index) => ({ month: index + 1, units: rows.reduce((total, row) => total + ((market === "US" ? row.candidate.usCalendarAverage[index]?.units : market === "CA" ? row.candidate.caCalendarAverage[index]?.units : row.candidate.calendarAverage[index]?.units) ?? 0), 0) }));
}

function marketRelevant(row: SeasonalDecisionRow, market: Exclude<MarketView, "ALL">) {
  const candidate = row.candidate;
  const gap = market === "US" ? candidate.usReplenishmentGap : candidate.caReplenishmentGap;
  const clearQty = market === "US" ? candidate.usClearanceQty : candidate.caClearanceQty;
  const demand = market === "US" ? candidate.usProjectedDemandUnits : candidate.caProjectedDemandUnits;
  return gap > 0 || clearQty > 0 || row.kind === "monitor" && demand > 0;
}

function PricingLine({ pricing }: { pricing: ClearancePricingSuggestion | null }) { if (!pricing) return <p className="text-[10px] text-slate-400">暂无毛利记录</p>; return <p className="text-[10px] text-emerald-700">建议 {marketPrice(pricing.suggestedPrice, pricing.currency)} · 毛利 {Math.round(pricing.projectedMargin * 100)}%</p>; }
function CandidateLink({ candidate }: { candidate: SeasonalInventoryCandidate }) { return <><Link href={`/inventory/sku/${encodeURIComponent(candidate.sku)}${candidate.detailMarket === "CA" ? "?market=CA" : ""}`} className="mt-2 inline-block font-mono font-semibold text-emerald-700 hover:underline">{candidate.sku}</Link><p className="mt-1 max-w-64 font-medium text-slate-800">{candidate.productName}</p></>; }
function marketPrice(value: number, currency: "USD" | "CAD") { return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value); }
function SectionToggle({ open, onClick, label }: { open: boolean; onClick: () => void; label: string }) { return <button type="button" aria-expanded={open} aria-label={`${open ? "收起" : "展开"}${label}`} onClick={onClick} className="inline-flex items-center gap-1.5 border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-emerald-600 hover:text-emerald-700"><ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />{open ? "收起" : "展开"}</button>; }
function ExportLink({ kind, market, children }: { kind: "replenishment" | "clearance"; market: MarketView; children: React.ReactNode }) { return <a href={`/api/inventory/seasonal-clearance/export?kind=${kind}&market=${market}`} download className="inline-flex items-center gap-1.5 border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-emerald-600 hover:text-emerald-700"><Download className="h-3.5 w-3.5" />{children}</a>; }
function Rule({ title, body }: { title: string; body: string }) { return <div className="bg-white p-4"><p className="text-xs font-semibold text-slate-900">{title}</p><p className="mt-1.5 text-[11px] leading-5 text-slate-500">{body}</p></div>; }
