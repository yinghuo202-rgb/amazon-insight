"use client";

import { CheckCircle2, DatabaseZap, FolderSearch, LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { OpsBadge, OpsCard, OpsCardHeader, OpsKpi } from "@/components/inventory/ops-ui";
import type { DataRefreshStatus } from "@/lib/inventory/data-refresh";

export function DataRefreshCenter({ initialStatus }: { initialStatus: DataRefreshStatus }) {
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState<"scan" | "rebuild" | "">("");
  const [message, setMessage] = useState("");

  async function refresh(scanOnly: boolean) {
    setBusy(scanOnly ? "scan" : "rebuild"); setMessage("");
    try {
      const response = await fetch("/api/inventory/data-refresh", { method: scanOnly ? "GET" : "POST", cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "操作失败");
      setStatus(scanOnly ? payload : payload.snapshot);
      setMessage(scanOnly ? "已重新检查所有源文件。" : "数据重建完成，库存、采购、内容与单据数据已更新。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "操作失败"); }
    finally { setBusy(""); }
  }

  const latestReport = status.reports.map((item) => item.modifiedAt).filter(Boolean).sort().at(-1) ?? null;
  const latestRun = status.runs[0] ?? null;
  const topException = [...status.exceptions].sort((left, right) => right.count - left.count)[0];
  return <div className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <OpsKpi label="已识别数据源" value={`${status.summary.sourceCount} 项`} detail={`${status.summary.missingCount} 项必需源缺失`} tone={status.summary.missingCount ? "danger" : "positive"} />
      <OpsKpi label="标准数据集" value={`${status.summary.reportCount} / ${status.reports.length}`} detail="库存、采购、内容与单据" tone={status.summary.reportCount === status.reports.length ? "positive" : "warning"} />
      <OpsKpi label="开放异常" value={`${status.summary.openExceptionCount} 项`} detail="SKU 映射与源数据异常" tone={status.summary.openExceptionCount ? "warning" : "positive"} />
      <OpsKpi label="近期失败" value={`${status.summary.failedRunCount} 次`} detail="最近 20 次任务" tone={status.summary.failedRunCount ? "danger" : "positive"} />
      <OpsKpi label="最近生成" value={latestReport ? formatDate(latestReport) : "—"} detail={latestReport ? formatTime(latestReport) : "暂无标准数据"} />
    </div>

    <OpsCard className="border-emerald-200 bg-emerald-50/40">
      <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between"><div className="flex items-start gap-3"><DatabaseZap className="mt-0.5 h-5 w-5 text-emerald-700" /><div><h2 className="text-sm font-semibold">一键更新运营数据</h2><p className="mt-1 max-w-3xl text-xs leading-5 text-slate-600">将最新文件放入原有目录后，先检查数据源，再依次执行 SKU 审计、产品目录、内容任务、订单主数据、双站库存和采购计划重建。原始文件保持只读。</p></div></div><div className="flex shrink-0 gap-2"><button type="button" onClick={() => void refresh(true)} disabled={Boolean(busy)} className="inline-flex items-center gap-2 border border-slate-300 bg-white px-3 py-2 text-xs font-semibold disabled:opacity-50">{busy === "scan" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FolderSearch className="h-4 w-4" />}检查文件</button><button type="button" onClick={() => void refresh(false)} disabled={Boolean(busy) || Boolean(status.summary.missingCount)} className="inline-flex items-center gap-2 bg-emerald-800 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy === "rebuild" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}{busy === "rebuild" ? "完整重建中（约 3–5 分钟）" : "重建全部数据"}</button></div></div>
      {message ? <p className={`border-t px-5 py-3 text-xs ${message.startsWith("已") || message.includes("完成") ? "border-emerald-200 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-700"}`}>{message}</p> : null}
    </OpsCard>

    <div className="grid gap-5 xl:grid-cols-[1.25fr_.75fr]">
      <OpsCard><OpsCardHeader title="源文件检查" description={status.summary.missingCount ? `已识别 ${status.summary.sourceCount} 项数据源，仍缺 ${status.summary.missingCount} 项必需文件，暂不能完整重建。` : `${status.summary.sourceCount} 项数据源均已识别，可以执行完整重建。`} action={<FolderSearch className="h-4 w-4 text-emerald-700" />} /><div className="divide-y divide-slate-100 border-t border-slate-100">{status.sources.map((source) => <div key={source.key} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_110px_130px] sm:items-center"><div className="min-w-0"><div className="flex items-center gap-2"><p className="truncate text-xs font-medium text-slate-800">{source.label}</p>{source.required ? <OpsBadge tone="blue">必需</OpsBadge> : <OpsBadge tone="slate">辅助</OpsBadge>}</div><p className="mt-1 truncate font-mono text-[10px] text-slate-400" title={source.relativePath}>{source.relativePath}</p></div><div>{source.exists ? <OpsBadge tone="emerald"><CheckCircle2 className="mr-1 h-3 w-3" />已识别</OpsBadge> : <OpsBadge tone={source.required ? "rose" : "amber"}><TriangleAlert className="mr-1 h-3 w-3" />缺失</OpsBadge>}</div><p className="text-right text-[10px] text-slate-500">{source.modifiedAt ? `${formatDate(source.modifiedAt)} ${formatTime(source.modifiedAt)}` : "—"}{source.kind === "folder" ? ` · ${source.fileCount} 文件` : ""}</p></div>)}</div></OpsCard>
      <div className="space-y-5"><OpsCard><OpsCardHeader title="标准数据集" description={`${status.summary.reportCount}/${status.reports.length} 份标准数据集可用${latestReport ? `，最近于 ${formatDateTime(latestReport)} 更新` : ""}。`} /><div className="divide-y divide-slate-100 border-t border-slate-100">{status.reports.map((report) => <div key={report.key} className="flex items-center justify-between gap-3 px-4 py-3"><div><p className="text-xs font-medium">{report.label}</p><p className="mt-1 font-mono text-[10px] text-slate-400">{report.relativePath}</p></div><div className="text-right"><OpsBadge tone={report.exists ? "emerald" : "rose"}>{report.exists ? "可用" : "缺失"}</OpsBadge><p className="mt-1 text-[10px] text-slate-400">{report.modifiedAt ? formatTime(report.modifiedAt) : "—"}</p></div></div>)}</div></OpsCard>{status.exceptions.length ? <OpsCard><OpsCardHeader title="开放异常" description={topException ? `当前共有 ${status.summary.openExceptionCount} 项异常，${topException.category} 数量最多（${topException.count} 项）。` : "当前没有开放异常。"} /><div className="divide-y divide-slate-100 border-t border-slate-100">{status.exceptions.map((item) => <div key={`${item.category}-${item.severity}`} className="flex justify-between px-4 py-3 text-xs"><span>{item.category}</span><OpsBadge tone={item.severity === "error" ? "rose" : "amber"}>{item.count} 项</OpsBadge></div>)}</div></OpsCard> : null}</div>
    </div>

    <OpsCard><OpsCardHeader title="最近运行记录" description={latestRun ? `最近任务 ${latestRun.jobName} 状态为 ${latestRun.status}，近 20 次共失败 ${status.summary.failedRunCount} 次。` : "当前尚无自动化运行记录。"} /><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr><th className="px-4 py-3">任务</th><th className="px-3 py-3">状态</th><th className="px-3 py-3">开始</th><th className="px-3 py-3">完成</th><th className="px-4 py-3">错误</th></tr></thead><tbody className="divide-y divide-slate-100">{status.runs.map((run) => <tr key={run.id}><td className="px-4 py-3 font-mono">{run.jobName}</td><td className="px-3 py-3"><OpsBadge tone={run.status === "completed" ? "emerald" : run.status === "failed" ? "rose" : "blue"}>{run.status}</OpsBadge></td><td className="px-3 py-3">{formatDateTime(run.startedAt)}</td><td className="px-3 py-3">{run.finishedAt ? formatDateTime(run.finishedAt) : "运行中"}</td><td className="max-w-sm truncate px-4 py-3 text-rose-700" title={run.error}>{run.error || "—"}</td></tr>)}</tbody></table></div></OpsCard>
  </div>;
}

function formatDate(value: string) { return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value)); }
function formatTime(value: string) { return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)); }
function formatDateTime(value: string) { return `${formatDate(value)} ${formatTime(value)}`; }
