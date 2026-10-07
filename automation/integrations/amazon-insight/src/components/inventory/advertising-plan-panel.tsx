"use client";

import { CheckCircle2, Download, FilePenLine, RotateCcw, Save, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { OpsBadge, OpsCard, OpsCardHeader } from "@/components/inventory/ops-ui";
import { useInfiniteRows } from "@/components/inventory/use-infinite-rows";
import type { AdvertisingPlanItem, AdvertisingPlanStatus } from "@/lib/inventory/advertising-plan-store";
import type { CalculatedCampaign } from "@/lib/inventory/presentation";
import { advertisingActionLabels } from "@/lib/inventory/presentation";

type Draft = Pick<AdvertisingPlanItem, "campaign" | "sku" | "recommendedAction" | "currentBudget" | "proposedBudget" | "bidChangePercent" | "note">;
const actionable = new Set(["PAUSE_STOCK_RISK", "NO_ORDER_REVIEW", "REDUCE_BID_OR_BUDGET", "INCREASE_BID", "INCREASE_BUDGET", "EXPAND_WINNER"]);

export function AdvertisingPlanPanel({ market, period, rows, currency }: { market: "US" | "CA"; period: string | null; rows: CalculatedCampaign[]; currency: string }) {
  const recommendations = useMemo(() => rows.filter((row) => actionable.has(row.action)).map(suggestDraft), [rows]);
  const metricsByCampaign = useMemo(() => new Map(rows.map((row) => [row.campaign, row] as const)), [rows]);
  const [drafts, setDrafts] = useState<Draft[]>(recommendations);
  const [status, setStatus] = useState<AdvertisingPlanStatus>("DRAFT");
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [actionFilter, setActionFilter] = useState("ALL");
  const locked = status === "CONFIRMED";
  const filtered = useMemo(() => { const normalized = query.trim().toUpperCase(); return drafts.map((item, index) => ({ item, index })).filter(({ item }) => (actionFilter === "ALL" || item.recommendedAction === actionFilter) && (!normalized || `${item.campaign} ${item.sku} ${item.note}`.toUpperCase().includes(normalized))); }, [actionFilter, drafts, query]);
  const { visible, hasMore, sentinelRef } = useInfiniteRows(filtered, 25);

  useEffect(() => {
    if (!period) return;
    fetch(`/api/inventory/advertising-plan?market=${market}&period=${period}`, { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((payload) => {
      if (!payload) return; setStatus(payload.status); setVersion(payload.version); if (payload.items?.length) setDrafts(payload.items);
    }).catch(() => undefined);
  }, [market, period]);

  function patch(index: number, value: Partial<Draft>) { setDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...value } : item)); }
  async function mutate(action: "save" | "confirm" | "reopen") {
    if (!period) return; setBusy(action); setMessage("");
    try {
      const response = await fetch("/api/inventory/advertising-plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ market, period, action, items: action === "save" ? drafts : undefined }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "操作失败");
      setStatus(payload.status); setVersion(payload.version); if (payload.items) setDrafts(payload.items);
      setMessage(action === "save" ? "广告调整草稿已保存。" : action === "confirm" ? "本期广告调整已确认并锁定。" : "广告调整已重新打开为草稿。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "操作失败"); } finally { setBusy(""); }
  }
  async function exportPlan() {
    if (!period) return; setBusy("export"); setMessage("");
    try {
      const response = await fetch("/api/inventory/downloads/advertising-plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ market, period, status, rows: [["活动", "SKU", "系统建议", "当前日预算", "调整后日预算", "竞价调整%", "备注"], ...drafts.map((item) => [item.campaign, item.sku, advertisingActionLabels[item.recommendedAction], item.currentBudget, item.proposedBudget, item.bidChangePercent, item.note])] }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "导出失败"); const anchor = document.createElement("a"); anchor.href = payload.downloadUrl; anchor.download = payload.filename; anchor.click(); setMessage(`已生成 ${payload.filename}，可在下载中心重新下载。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "导出失败"); } finally { setBusy(""); }
  }

  return <OpsCard>
    <OpsCardHeader title="广告决策工作台" description={`${period ?? "当前周期"} ${market} 站有 ${drafts.length} 个活动待处理，其中 ${drafts.filter((item) => item.proposedBudget > item.currentBudget || item.bidChangePercent > 0).length} 个建议扩量、${drafts.filter((item) => item.proposedBudget < item.currentBudget || item.bidChangePercent < 0).length} 个建议控量。`} action={<div className="flex items-center gap-2"><OpsBadge tone={locked ? "emerald" : "amber"}>{locked ? "已确认" : "草稿"}</OpsBadge><FilePenLine className="h-4 w-4 text-emerald-700" /></div>} />
    <div className="flex flex-wrap gap-2 border-t border-slate-100 px-4 py-3"><button type="button" onClick={() => void mutate("save")} disabled={Boolean(busy) || locked || !period} className="inline-flex items-center gap-1.5 bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"><Save className="h-3.5 w-3.5" />保存草稿</button>{locked ? <button type="button" onClick={() => void mutate("reopen")} disabled={Boolean(busy)} className="inline-flex items-center gap-1.5 border border-slate-300 bg-white px-3 py-2 text-xs font-semibold disabled:opacity-40"><RotateCcw className="h-3.5 w-3.5" />重新打开</button> : <button type="button" onClick={() => void mutate("confirm")} disabled={Boolean(busy) || !version} className="inline-flex items-center gap-1.5 border border-emerald-700 bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"><CheckCircle2 className="h-3.5 w-3.5" />确认本期调整</button>}<button type="button" onClick={() => void exportPlan()} disabled={Boolean(busy) || !drafts.length} className="inline-flex items-center gap-1.5 border border-slate-300 bg-white px-3 py-2 text-xs font-semibold disabled:opacity-40"><Download className="h-3.5 w-3.5" />导出调整表</button><button type="button" onClick={() => { setDrafts(recommendations); setMessage("已恢复系统推荐值，保存后生效。"); }} disabled={Boolean(busy) || locked} className="ml-auto text-xs font-medium text-emerald-700 disabled:opacity-40">恢复系统推荐</button></div>
    {message ? <p className={`border-t px-4 py-2.5 text-xs ${message.startsWith("已") || message.includes("确认") ? "border-emerald-100 bg-emerald-50 text-emerald-800" : "border-rose-100 bg-rose-50 text-rose-700"}`}>{message}</p> : null}
    <div className="flex flex-col gap-2 border-t border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between"><label className="relative w-full sm:max-w-sm"><span className="sr-only">搜索广告调整草稿</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索活动、SKU 或备注" className="w-full border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm" /></label><select aria-label="广告草稿动作" value={actionFilter} onChange={(event) => setActionFilter(event.target.value)} className="border border-slate-200 bg-white px-3 py-2 text-sm"><option value="ALL">全部调整动作</option>{[...new Set(drafts.map((item) => item.recommendedAction))].map((action) => <option key={action} value={action}>{advertisingActionLabels[action]}</option>)}</select></div>
    <div className="overflow-x-auto"><table className="w-full min-w-[1280px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr><th className="px-4 py-3">活动 / SKU</th><th className="px-3 py-3">系统建议</th><th className="px-3 py-3">决策证据</th><th className="px-3 py-3 text-right">当前预算</th><th className="px-3 py-3 text-right">调整后预算</th><th className="px-3 py-3 text-right">竞价调整</th><th className="px-4 py-3">运营备注</th></tr></thead><tbody className="divide-y divide-slate-100">{visible.map(({ item, index }) => {
      const metric = metricsByCampaign.get(item.campaign);
      return <tr key={item.campaign}><td className="px-4 py-3"><p className="max-w-72 truncate font-medium">{item.campaign}</p><p className="mt-1 font-mono text-[10px] text-emerald-700">{item.sku || "未关联 SKU"}</p></td><td className="px-3 py-3"><OpsBadge tone={item.recommendedAction.includes("INCREASE") || item.recommendedAction === "EXPAND_WINNER" ? "emerald" : item.recommendedAction === "PAUSE_STOCK_RISK" ? "rose" : "amber"}>{advertisingActionLabels[item.recommendedAction]}</OpsBadge></td><td className="px-3 py-3"><p className="font-mono text-[11px] text-slate-700">{metric?.orders ?? 0} 单 · ACOS {metric?.acos?.toFixed(1) ?? "—"}%</p><p className="mt-1 text-[10px] text-slate-400">花费 {money(metric?.spend ?? 0, currency)} · 库存 {metric?.inventoryDaysCover == null ? "—" : `${metric.inventoryDaysCover.toFixed(0)} 天`}</p></td><td className="px-3 py-3 text-right font-mono">{money(item.currentBudget, currency)}</td><td className="px-3 py-3 text-right"><input type="number" min={0} step={1} disabled={locked} value={item.proposedBudget} onChange={(event) => patch(index, { proposedBudget: Math.max(0, Number(event.target.value) || 0) })} className="w-24 border border-slate-200 px-2 py-1.5 text-right font-mono disabled:bg-slate-100" /></td><td className="px-3 py-3 text-right"><input type="number" min={-100} max={300} step={1} disabled={locked} value={item.bidChangePercent} onChange={(event) => patch(index, { bidChangePercent: Number(event.target.value) || 0 })} className="w-20 border border-slate-200 px-2 py-1.5 text-right font-mono disabled:bg-slate-100" />%</td><td className="px-4 py-3"><input disabled={locked} value={item.note} onChange={(event) => patch(index, { note: event.target.value })} placeholder="关键词、否词或执行说明" className="w-full min-w-64 border border-slate-200 px-2 py-1.5 disabled:bg-slate-100" /></td></tr>;
    })}</tbody></table></div>
    <div ref={sentinelRef} className="border-t border-slate-100 px-4 py-3 text-center text-xs text-slate-500">显示 {visible.length} / {filtered.length} 项 · {hasMore ? "继续下滑加载" : "已显示全部"}</div>
  </OpsCard>;
}

function suggestDraft(row: CalculatedCampaign): Draft { let proposedBudget = row.budget; let bidChangePercent = 0; if (row.action === "PAUSE_STOCK_RISK") proposedBudget = 0; else if (row.action === "INCREASE_BUDGET") proposedBudget = round(row.budget * 1.15); else if (row.action === "REDUCE_BID_OR_BUDGET") { proposedBudget = round(row.budget * 0.85); bidChangePercent = -10; } else if (row.action === "NO_ORDER_REVIEW") bidChangePercent = -10; else if (row.action === "INCREASE_BID") bidChangePercent = 8; else if (row.action === "EXPAND_WINNER") bidChangePercent = 5; return { campaign: row.campaign, sku: row.sku ?? "", recommendedAction: row.action, currentBudget: row.budget, proposedBudget, bidChangePercent, note: row.reason }; }
function round(value: number) { return Math.round(value * 100) / 100; }
function money(value: number, currency: string) { return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(value); }
