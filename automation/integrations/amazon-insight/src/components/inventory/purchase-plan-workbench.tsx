"use client";

import { CalendarClock, CheckCircle2, CircleAlert, Download, LockKeyhole, RotateCcw, Save, Search, ShoppingCart, ChartSpline, SunMedium, Truck } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { OpsBadge, OpsCard, OpsKpi } from "@/components/inventory/ops-ui";
import type { PurchasePlanData, PurchasePlanRow } from "@/lib/inventory/contracts";
import type { PurchasePlanCycleStatus } from "@/lib/inventory/purchase-plan-store";
import { days, integer } from "@/lib/inventory/presentation";
import { adjustedSeasonalPurchaseQuantity, type SeasonalPurchaseAction } from "@/lib/inventory/seasonal-plan-integration";

type View = "next" | "reconcile";
type DraftValue = { quantity: number; note: string };
type PurchaseCandidate = PurchasePlanRow & { baseSuggestedPurchaseQty: number; seasonalAction?: SeasonalPurchaseAction };

const stageLabels = { mid_month: "月中采购", month_end: "月末采购" } as const;
const reconciliationLabels = {
  MATCHED: "计划一致",
  ORDERED_MORE: "实际多采",
  ORDERED_LESS: "实际少采",
  PLAN_ONLY: "计划未下单",
  ORDER_ONLY: "订单外新增",
  NO_ORDER: "无本期订单",
} as const;
const cycleStatusLabels: Record<PurchasePlanCycleStatus, string> = { DRAFT: "草稿", REVIEWED: "已复核", LOCKED: "已锁定", ORDERED: "已下单" };

export function PurchasePlanWorkbench({ data, seasonalActions }: { data: PurchasePlanData; seasonalActions: SeasonalPurchaseAction[] }) {
  const pageSize = 40;
  const seasonalActionBySku = useMemo(() => new Map(seasonalActions.map((action) => [action.sku, action] as const)), [seasonalActions]);
  const purchaseRowBySku = useMemo(() => new Map(data.rows.map((row) => [row.sku, row] as const)), [data.rows]);
  const nextCandidates = useMemo(() => data.rows.map((row) => {
    const seasonalAction = seasonalActionBySku.get(row.sku);
    return {
      ...row,
      baseSuggestedPurchaseQty: row.suggestedPurchaseQty,
      suggestedPurchaseQty: adjustedSeasonalPurchaseQuantity(row.suggestedPurchaseQty, row.cartonQty, seasonalAction),
      seasonalAction,
    } satisfies PurchaseCandidate;
  }).filter((row) => row.suggestedPurchaseQty > 0).sort((a, b) => riskRank(a) - riskRank(b) || b.suggestedPurchaseQty - a.suggestedPurchaseQty), [data.rows, seasonalActionBySku]);
  const reconciliationRows = useMemo(() => data.rows.filter((row) => row.manualPlannedQty > 0 || row.actualOrderedQty > 0).sort((a, b) => Math.abs(b.varianceQty) - Math.abs(a.varianceQty) || b.actualOrderedQty - a.actualOrderedQty), [data.rows]);
  const [view, setView] = useState<View>("next");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [drafts, setDrafts] = useState<Record<string, DraftValue>>(() => Object.fromEntries(nextCandidates.map((row) => [row.sku, { quantity: row.suggestedPurchaseQty, note: row.seasonalAction?.reason ?? "" }])));
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState("");
  const [cycleStatus, setCycleStatus] = useState<PurchasePlanCycleStatus>("DRAFT");
  const [cycleVersion, setCycleVersion] = useState(0);

  useEffect(() => {
    let active = true;
    fetch(`/api/inventory/purchase-plan?cycle=${data.cycle.nextReviewDate}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        if (!active || !payload) return;
        if (payload.cycle) { setCycleStatus(payload.cycle.status); setCycleVersion(payload.cycle.version); }
        if (payload.items?.length) { setDrafts(Object.fromEntries(payload.items.map((item: { sku: string; quantity: number; note: string }) => [item.sku, { quantity: item.quantity, note: item.note }]))); setSaved(true); }
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [data.cycle.nextReviewDate]);

  const normalizedQuery = query.trim().toUpperCase();
  const visibleNext = nextCandidates.filter((row) => !normalizedQuery || `${row.sku} ${row.productName} ${row.factory}`.toUpperCase().includes(normalizedQuery));
  const visibleReconciliation = reconciliationRows.filter((row) => !normalizedQuery || `${row.sku} ${row.productName} ${row.factory} ${row.orders.map((order) => order.poNumber).join(" ")}`.toUpperCase().includes(normalizedQuery));
  const currentRows = view === "next" ? visibleNext : visibleReconciliation;
  const pageCount = Math.max(1, Math.ceil(currentRows.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageStart = (safePage - 1) * pageSize;
  const draftUnits = nextCandidates.reduce((sum, row) => sum + (drafts[row.sku]?.quantity ?? 0), 0);
  const draftSkuCount = nextCandidates.filter((row) => (drafts[row.sku]?.quantity ?? 0) > 0).length;
  const blockedPurchaseRows = seasonalActions.filter((action) => action.blockPurchase);
  const urgentPurchaseRows = seasonalActions.filter((action) => action.kind === "urgent_purchase");
  const blockedBaseQuantity = data.rows.reduce((sum, row) => sum + (seasonalActionBySku.get(row.sku)?.blockPurchase ? row.suggestedPurchaseQty : 0), 0);
  const seasonalUpliftQuantity = nextCandidates.reduce((sum, row) => sum + Math.max(0, row.suggestedPurchaseQty - row.baseSuggestedPurchaseQty), 0);

  function updateDraft(sku: string, patch: Partial<DraftValue>) {
    setDrafts((current) => ({ ...current, [sku]: { quantity: current[sku]?.quantity ?? 0, note: current[sku]?.note ?? "", ...patch } }));
    setSaved(false);
  }

  async function saveDraft() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/inventory/purchase-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cycleDate: data.cycle.nextReviewDate, items: nextCandidates.filter((row) => (drafts[row.sku]?.quantity ?? 0) > 0).map((row) => ({ sku: row.sku, quantity: drafts[row.sku].quantity, suggestedQuantity: row.suggestedPurchaseQty, note: drafts[row.sku].note })) }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "保存失败");
      setSaved(true); setCycleStatus(payload.cycle.status); setCycleVersion(payload.cycle.version); setMessage("采购草稿已保存到本地数据库。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "保存失败"); }
    finally { setBusy(false); }
  }

  async function transitionCycle(action: "review" | "lock" | "reopen" | "ordered") {
    setBusy(true); setMessage("");
    try { const response = await fetch("/api/inventory/purchase-plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cycleDate: data.cycle.nextReviewDate, action }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "状态更新失败"); setCycleStatus(payload.cycle.status); setCycleVersion(payload.cycle.version); setMessage(`采购计划已更新为“${cycleStatusLabels[payload.cycle.status as PurchasePlanCycleStatus]}”。`); }
    catch (error) { setMessage(error instanceof Error ? error.message : "状态更新失败"); } finally { setBusy(false); }
  }

  async function exportCurrentView() {
    const blockedRows = blockedPurchaseRows.flatMap((action) => {
      const row = purchaseRowBySku.get(action.sku);
      if (!row || (normalizedQuery && !`${row.sku} ${row.productName} ${row.factory}`.toUpperCase().includes(normalizedQuery))) return [];
      return [[row.sku, row.productName, row.factory, seasonalPurchaseLabel(action), integer(row.combinedDailySales * 30), row.usNetworkInventory, row.caNetworkInventory, row.localInventory, row.pendingOrderQty, row.suggestedPurchaseQty, 0, 0, action.reason]];
    });
    const rows = view === "next" ? [...visibleNext.map((row) => [row.sku, row.productName, row.factory, row.seasonalAction ? seasonalPurchaseLabel(row.seasonalAction) : "常规采购", integer(row.combinedDailySales * 30), row.usNetworkInventory, row.caNetworkInventory, row.localInventory, row.pendingOrderQty, row.baseSuggestedPurchaseQty, row.suggestedPurchaseQty, drafts[row.sku]?.quantity ?? 0, drafts[row.sku]?.note ?? ""]), ...blockedRows]
      : visibleReconciliation.map((row) => [row.sku, row.productName, row.factory, row.usPlannedQty, row.caPlannedQty, row.manualPlannedQty, row.actualOrderedQty, row.varianceQty, row.orders.map((order) => order.poNumber).join(" / "), reconciliationLabels[row.reconciliationStatus]]);
    const headers = view === "next" ? ["SKU", "产品", "供应商", "季节动作", "美加月销", "美国海外库存", "加拿大海外库存", "国内现货", "未完工订单", "原系统建议", "季节校正后建议", "确认采购数量", "备注"] : ["SKU", "产品", "供应商", "US计划", "CA计划", "计划合计", "实际下单", "差异", "采购订单", "核对状态"];
    setExporting(true); setMessage("");
    try {
      const response = await fetch("/api/inventory/downloads/purchase-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cycleDate: data.cycle.nextReviewDate, view, rows: [headers, ...rows] }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "采购表导出失败");
      const anchor = document.createElement("a");
      anchor.href = payload.downloadUrl; anchor.download = payload.filename; anchor.click();
      setMessage(`已生成 ${payload.filename}，可在下载中心重新下载。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "采购表导出失败");
    } finally { setExporting(false); }
  }

  return <div className="space-y-5">
    <div className="flex flex-wrap justify-end gap-2"><Link href="/inventory/purchasing/orders" className="inline-flex items-center gap-2 border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 hover:border-amber-600"><Truck className="h-3.5 w-3.5" />进入催货订单</Link><Link href="/inventory/purchasing/backtest" className="inline-flex items-center gap-2 border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-emerald-700 hover:text-emerald-700"><ChartSpline className="h-3.5 w-3.5" />查看采购算法回测</Link></div>
    <div className="ops-kpi-grid grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <OpsKpi label="本轮计划 / 实际" value={`${integer(data.summary.manualPlanQuantity)} / ${integer(data.summary.actualOrderQuantity)} 件`} detail={`差异 ${data.summary.varianceQuantity >= 0 ? "+" : ""}${integer(data.summary.varianceQuantity)} · ${data.summary.discrepancySkuCount} SKU 待复核`} tone={data.summary.discrepancySkuCount ? "warning" : "positive"} />
      <OpsKpi label="下期确认草稿" value={`${integer(draftUnits)} 件`} detail={`${draftSkuCount} SKU · 系统建议 ${integer(data.summary.nextCycleQuantity)} 件 · ${saved ? "已保存" : "未保存"}`} tone={saved ? "positive" : "warning"} />
      <OpsKpi label="库存风险队列" value={`${data.summary.criticalSkuCount + blockedPurchaseRows.length} SKU`} detail={`${data.summary.criticalSkuCount} 紧急 · ${blockedPurchaseRows.length} 清货禁采`} tone={data.summary.criticalSkuCount || blockedPurchaseRows.length ? "danger" : "positive"} />
      <OpsKpi label="季节修正影响" value={`${urgentPurchaseRows.length} SKU 加量`} detail={`增加 ${integer(seasonalUpliftQuantity)} 件 · 拦截 ${integer(blockedBaseQuantity)} 件`} tone="warning" />
    </div>

    <OpsCard className="border-blue-200 bg-blue-50/40">
      <div className="grid gap-4 p-5 lg:grid-cols-[1fr_auto] lg:items-center">
        <div className="flex min-w-0 items-start gap-3"><CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" /><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold text-slate-950">{data.cycle.latestOrderDate} {stageLabels[data.cycle.latestStage]}已核对</h2><OpsBadge tone="blue">下一次 {data.cycle.nextReviewDate} · {stageLabels[data.cycle.nextStage]}</OpsBadge><OpsBadge tone={cycleStatus === "ORDERED" || cycleStatus === "LOCKED" ? "emerald" : cycleStatus === "REVIEWED" ? "blue" : "amber"}>{cycleStatusLabels[cycleStatus]} · V{cycleVersion}</OpsBadge></div><p className="mt-2 text-xs leading-5 text-slate-600">下期建议按美加合并销量计算，国内现货和未完工订单只扣减一次；需求窗口为生产 {data.parameters.productionLeadDays} 天 + 海运 {data.parameters.oceanLeadDays} 天 + 复核周期 {data.parameters.reviewCycleDays} 天 + 安全库存 {data.parameters.safetyStockDays} 天，共 {data.parameters.demandHorizonDays} 天。</p></div></div>
        <div className="flex max-w-xl flex-wrap justify-end gap-2"><button type="button" onClick={() => void saveDraft()} disabled={busy || cycleStatus !== "DRAFT"} className="inline-flex items-center gap-2 border border-slate-900 bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"><Save className="h-3.5 w-3.5" />保存采购草稿</button>{cycleStatus === "DRAFT" ? <button type="button" onClick={() => void transitionCycle("review")} disabled={busy || !saved} className="inline-flex items-center gap-2 border border-blue-700 bg-blue-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"><CheckCircle2 className="h-3.5 w-3.5" />提交复核</button> : cycleStatus === "REVIEWED" ? <button type="button" onClick={() => void transitionCycle("lock")} disabled={busy} className="inline-flex items-center gap-2 border border-emerald-700 bg-emerald-700 px-3 py-2 text-xs font-semibold text-white"><LockKeyhole className="h-3.5 w-3.5" />锁定版本</button> : cycleStatus === "LOCKED" ? <button type="button" onClick={() => void transitionCycle("ordered")} disabled={busy} className="inline-flex items-center gap-2 border border-emerald-700 bg-emerald-700 px-3 py-2 text-xs font-semibold text-white"><CheckCircle2 className="h-3.5 w-3.5" />标记已下单</button> : null}{cycleStatus === "REVIEWED" || cycleStatus === "LOCKED" ? <button type="button" onClick={() => void transitionCycle("reopen")} disabled={busy} className="inline-flex items-center gap-2 border border-slate-300 bg-white px-3 py-2 text-xs font-semibold"><RotateCcw className="h-3.5 w-3.5" />退回草稿</button> : null}<button type="button" onClick={() => void exportCurrentView()} disabled={exporting} className="inline-flex items-center gap-2 border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-slate-900 disabled:opacity-50"><Download className="h-3.5 w-3.5" />{exporting ? "生成中…" : view === "next" ? "导出采购表" : "导出复盘表"}</button></div>
      </div>
      {message ? <p className={`border-t px-5 py-2.5 text-xs ${message.startsWith("已") ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-700"}`}>{message}</p> : null}
    </OpsCard>

    {data.summary.discrepancySkuCount ? <div className="flex items-start gap-2 border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /><span>最新采购数量列为 {integer(data.summary.manualPlanQuantity)} 件，供应商订单识别为 {integer(data.summary.actualOrderQuantity)} 件，相差 {data.summary.varianceQuantity >= 0 ? "+" : ""}{integer(data.summary.varianceQuantity)} 件。请在“本轮采购复盘”核对订单外新增、少采和多采 SKU。</span></div> : null}

    <details className="group border border-amber-200 bg-amber-50/40">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 marker:content-none"><span className="flex items-center gap-2 text-sm font-semibold text-slate-900"><SunMedium className="h-4 w-4 text-amber-700" />季节规则明细（已并入下期计划）</span><span className="text-xs text-slate-500">{blockedPurchaseRows.length} 个清货禁采 · {urgentPurchaseRows.length} 个旺季采购底线 · 点击展开</span></summary>
      <div className="overflow-x-auto border-t border-amber-200"><table className="w-full min-w-[980px] text-left text-xs"><thead className="bg-amber-50 text-[10px] uppercase tracking-[0.08em] text-amber-900/70"><tr><th className="px-4 py-3">SKU / 产品</th><th className="px-3 py-3">采购动作</th><th className="px-3 py-3 text-right">国内先调拨</th><th className="px-3 py-3 text-right">旺季采购底线</th><th className="px-3 py-3 text-right">未完工需处置</th><th className="px-3 py-3">截止日期</th><th className="px-4 py-3">执行说明</th></tr></thead><tbody className="divide-y divide-amber-100">{seasonalActions.map((action) => <tr key={action.sku}><td className="px-4 py-3"><Link href={`/inventory/sku/${encodeURIComponent(action.sku)}`} className="font-mono font-semibold text-emerald-700 hover:underline">{action.sku}</Link><p className="mt-1 max-w-64 truncate text-slate-500">{action.productName}</p></td><td className="px-3 py-3"><SeasonalPurchaseBadge action={action} /></td><td className="px-3 py-3 text-right font-mono">{integer(action.domesticTransferQty)}</td><td className="px-3 py-3 text-right font-mono font-semibold text-emerald-700">{integer(action.urgentPurchaseQty)}</td><td className="px-3 py-3 text-right font-mono font-semibold text-rose-700">{integer(action.pendingMitigationQty)}</td><td className="px-3 py-3 font-mono">{action.deadline}</td><td className="px-4 py-3 max-w-lg text-slate-600">{action.reason}</td></tr>)}</tbody></table></div>
    </details>

    <OpsCard>
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1"><ViewButton active={view === "next"} onClick={() => { setView("next"); setPage(1); }}>下期采购草稿</ViewButton><ViewButton active={view === "reconcile"} onClick={() => { setView("reconcile"); setPage(1); }}>本轮采购复盘</ViewButton></div>
        <label className="relative w-full lg:w-80"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="搜索 SKU、产品、供应商或订单号" className="w-full border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500" /></label>
      </div>
      {view === "next" ? <NextPlanTable rows={visibleNext.slice(pageStart, pageStart + pageSize)} drafts={drafts} onChange={updateDraft} editable={cycleStatus === "DRAFT"} /> : <ReconciliationTable rows={visibleReconciliation.slice(pageStart, pageStart + pageSize)} />}
      <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-xs text-slate-500"><span>{currentRows.length} 个 SKU · 第 {safePage}/{pageCount} 页</span><div className="flex gap-2"><button type="button" disabled={safePage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 disabled:opacity-40">上一页</button><button type="button" disabled={safePage >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 disabled:opacity-40">下一页</button></div></div>
    </OpsCard>

    <details className="group border border-slate-200 bg-white"><summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 marker:content-none"><span className="flex items-center gap-2 text-sm font-semibold text-slate-900"><ShoppingCart className="h-4 w-4 text-emerald-700" />数据口径与自动化来源</span><span className="text-xs text-slate-500">{data.sources.length} 个来源 · 点击查看</span></summary><div className="grid gap-3 border-t border-slate-100 p-4 md:grid-cols-2 xl:grid-cols-4">{data.sources.map((source) => <div key={`${source.kind}-${source.path}-${source.sheet ?? ""}`} className="border border-slate-200 bg-slate-50 px-3 py-3"><p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">{source.kind}</p><p className="mt-1 truncate text-xs font-medium text-slate-700" title={source.path}>{source.path}</p>{source.sheet ? <p className="mt-1 text-[10px] text-slate-500">{source.sheet} · {source.column} 列 · {source.header}</p> : null}</div>)}</div></details>
  </div>;
}

function NextPlanTable({ rows, drafts, onChange, editable }: { rows: PurchaseCandidate[]; drafts: Record<string, DraftValue>; onChange: (sku: string, patch: Partial<DraftValue>) => void; editable: boolean }) {
  if (!rows.length) return <Empty text="当前没有符合搜索条件的采购建议。" />;
  return <div className="overflow-x-auto"><table className="w-full min-w-[1600px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase tracking-[0.08em] text-slate-500"><tr><th className="px-4 py-3">SKU / 产品</th><th className="px-3 py-3">季节动作</th><th className="px-3 py-3">供应商</th><th className="px-3 py-3 text-right">美加月销</th><th className="px-3 py-3 text-right">US 海外</th><th className="px-3 py-3 text-right">CA 海外</th><th className="px-3 py-3 text-right">国内现货</th><th className="px-3 py-3 text-right">未完工</th><th className="px-3 py-3 text-right">总覆盖</th><th className="px-3 py-3 text-right">窗口需求</th><th className="px-3 py-3 text-right">原系统建议</th><th className="px-3 py-3 text-right">季节校正后</th><th className="px-3 py-3 text-right">确认采购</th><th className="px-4 py-3">备注</th></tr></thead><tbody className="divide-y divide-slate-100">{rows.map((row) => <tr key={row.sku} className="hover:bg-slate-50"><td className="px-4 py-3"><div className="flex items-center gap-2"><Link href={`/inventory/sku/${encodeURIComponent(row.sku)}`} className="font-mono font-semibold text-emerald-700 hover:underline">{row.sku}</Link><RiskBadge row={row} /></div><p className="mt-1 max-w-64 truncate text-slate-500">{row.productName}</p></td><td className="px-3 py-3">{row.seasonalAction ? <SeasonalPurchaseBadge action={row.seasonalAction} /> : <span className="text-slate-400">常规采购</span>}</td><td className="px-3 py-3"><p className="max-w-44 truncate text-slate-700" title={row.factory}>{row.factory || "待映射"}</p><p className="mt-1 text-[10px] text-slate-400">{row.cartonQty} 件/箱</p></td><td className="px-3 py-3 text-right font-semibold">{integer(row.combinedDailySales * 30)}</td><td className="px-3 py-3 text-right"><StockPill tone="emerald" value={row.usNetworkInventory} /></td><td className="px-3 py-3 text-right"><StockPill tone="amber" value={row.caNetworkInventory} /></td><td className="px-3 py-3 text-right"><StockPill tone="blue" value={row.localInventory} /></td><td className="px-3 py-3 text-right"><StockPill tone="orange" value={row.pendingOrderQty} /></td><td className="px-3 py-3 text-right">{days(row.coverageDays)}</td><td className="px-3 py-3 text-right">{integer(row.projectedDemand)}</td><td className="px-3 py-3 text-right text-slate-500">{integer(row.baseSuggestedPurchaseQty)}</td><td className="px-3 py-3 text-right font-semibold text-emerald-700">{integer(row.suggestedPurchaseQty)}</td><td className="px-3 py-3 text-right"><input type="number" min={0} step={row.cartonQty} disabled={!editable} value={drafts[row.sku]?.quantity ?? 0} onChange={(event) => onChange(row.sku, { quantity: Math.max(0, Number(event.target.value) || 0) })} className="w-24 border border-emerald-200 bg-white px-2 py-1.5 text-right font-mono font-semibold outline-none focus:border-emerald-700 disabled:bg-slate-100" /></td><td className="px-4 py-3"><input value={drafts[row.sku]?.note ?? ""} disabled={!editable} onChange={(event) => onChange(row.sku, { note: event.target.value })} placeholder="供应商、优先级等" className="w-52 border border-slate-200 bg-white px-2 py-1.5 outline-none focus:border-emerald-600 disabled:bg-slate-100" /></td></tr>)}</tbody></table></div>;
}

function ReconciliationTable({ rows }: { rows: PurchasePlanRow[] }) {
  if (!rows.length) return <Empty text="当前没有符合搜索条件的采购记录。" />;
  return <div className="overflow-x-auto"><table className="w-full min-w-[1160px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase tracking-[0.08em] text-slate-500"><tr><th className="px-4 py-3">SKU / 产品</th><th className="px-3 py-3">供应商</th><th className="px-3 py-3 text-right">US 计划</th><th className="px-3 py-3 text-right">CA 计划</th><th className="px-3 py-3 text-right">计划合计</th><th className="px-3 py-3 text-right">实际订单</th><th className="px-3 py-3 text-right">差异</th><th className="px-3 py-3">采购订单</th><th className="px-4 py-3">核对状态</th></tr></thead><tbody className="divide-y divide-slate-100">{rows.map((row) => <tr key={row.sku} className={row.reconciliationStatus === "MATCHED" ? "" : "bg-amber-50/30"}><td className="px-4 py-3"><Link href={`/inventory/sku/${encodeURIComponent(row.sku)}`} className="font-mono font-semibold text-emerald-700 hover:underline">{row.sku}</Link><p className="mt-1 max-w-64 truncate text-slate-500">{row.productName}</p></td><td className="px-3 py-3"><p className="max-w-48 truncate" title={row.factory}>{row.factory || "—"}</p></td><td className="px-3 py-3 text-right">{integer(row.usPlannedQty)}</td><td className="px-3 py-3 text-right">{integer(row.caPlannedQty)}</td><td className="px-3 py-3 text-right font-semibold">{integer(row.manualPlannedQty)}</td><td className="px-3 py-3 text-right font-semibold text-blue-700">{integer(row.actualOrderedQty)}</td><td className={`px-3 py-3 text-right font-semibold ${row.varianceQty ? "text-amber-700" : "text-emerald-700"}`}>{row.varianceQty > 0 ? "+" : ""}{integer(row.varianceQty)}</td><td className="px-3 py-3">{row.orders.length ? <div className="space-y-1">{row.orders.map((order) => <Link key={`${order.poNumber}-${order.quantity}`} href={`/inventory/purchasing/orders/${encodeURIComponent(order.poNumber)}`} className="block font-mono text-[11px] font-semibold text-emerald-700 hover:underline">{order.poNumber} · {integer(order.quantity)} 件</Link>)}</div> : <span className="text-slate-400">未识别订单</span>}</td><td className="px-4 py-3"><ReconciliationBadge status={row.reconciliationStatus} /></td></tr>)}</tbody></table></div>;
}

function ViewButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <button type="button" onClick={onClick} className={`px-3 py-2 text-xs font-medium ${active ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>{children}</button>; }
function RiskBadge({ row }: { row: PurchasePlanRow }) { const tone = row.riskLevel === "critical" ? "rose" : row.riskLevel === "watch" ? "amber" : row.riskLevel === "healthy" ? "emerald" : "slate"; const label = row.riskLevel === "critical" ? "紧急" : row.riskLevel === "watch" ? "关注" : row.riskLevel === "healthy" ? "正常" : "数据不足"; return <OpsBadge tone={tone}>{label}</OpsBadge>; }
function SeasonalPurchaseBadge({ action }: { action: SeasonalPurchaseAction }) { const tone = action.kind === "stop_purchase" ? "rose" : action.kind === "urgent_purchase" ? "amber" : action.kind === "transfer_first" ? "blue" : "slate"; return <OpsBadge tone={tone}>{seasonalPurchaseLabel(action)}</OpsBadge>; }
function seasonalPurchaseLabel(action: SeasonalPurchaseAction) { return action.kind === "stop_purchase" ? "清货禁采" : action.kind === "urgent_purchase" ? "旺季加急采购" : action.kind === "transfer_first" ? "国内调拨优先" : "旺季关注"; }
function ReconciliationBadge({ status }: { status: PurchasePlanRow["reconciliationStatus"] }) { const tone = status === "MATCHED" ? "emerald" : status === "PLAN_ONLY" || status === "ORDERED_LESS" ? "rose" : "amber"; return <OpsBadge tone={tone}>{status === "MATCHED" ? <CheckCircle2 className="mr-1 h-3 w-3" /> : null}{reconciliationLabels[status]}</OpsBadge>; }
function StockPill({ value, tone }: { value: number; tone: "emerald" | "amber" | "blue" | "orange" }) { const styles = { emerald: "border-emerald-200 bg-emerald-50 text-emerald-800", amber: "border-amber-200 bg-amber-50 text-amber-800", blue: "border-blue-200 bg-blue-50 text-blue-800", orange: "border-orange-200 bg-orange-50 text-orange-800" }; return <span className={`inline-flex min-w-14 justify-end rounded border px-2 py-1 font-mono font-semibold ${styles[tone]}`}>{integer(value)}</span>; }
function Empty({ text }: { text: string }) { return <div className="grid place-items-center gap-2 p-12 text-center"><ShoppingCart className="h-7 w-7 text-slate-300" /><p className="text-sm text-slate-500">{text}</p></div>; }
function riskRank(row: PurchasePlanRow) { return row.riskLevel === "critical" ? 0 : row.riskLevel === "watch" ? 1 : row.riskLevel === "data" ? 2 : 3; }
