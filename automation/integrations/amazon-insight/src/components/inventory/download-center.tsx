"use client";

import { Download, FileArchive, FileSpreadsheet, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { OpsBadge, OpsCard, OpsCardHeader, OpsKpi } from "@/components/inventory/ops-ui";
import type { DownloadCategory, DownloadHistoryItem } from "@/lib/inventory/download-center";

const categoryLabels: Record<DownloadCategory, string> = { documents: "发货与报运", creative: "美工对接", purchase: "采购表", advertising: "广告调整" };
const kindLabels: Record<DownloadHistoryItem["kind"], string> = { shipment: "发货清单", declaration: "报运单", creative: "美工对接表", purchase: "采购计划", advertising: "广告调整表" };

export function DownloadCenter({ items }: { items: DownloadHistoryItem[] }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | DownloadCategory>("all");
  const visible = useMemo(() => {
    const normalized = query.trim().toUpperCase();
    return items.filter((item) => (category === "all" || item.category === category) && (!normalized || `${item.filename} ${item.exportId} ${item.market} ${kindLabels[item.kind]}`.toUpperCase().includes(normalized)));
  }, [category, items, query]);
  const totalSize = items.reduce((sum, item) => sum + item.size, 0);
  const totalDownloads = items.reduce((sum, item) => sum + item.downloadCount, 0);
  const latest = items[0]?.createdAt ?? null;

  return <div className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <OpsKpi label="历史文件" value={`${items.length} 份`} detail="本地生成文件，可重复下载" />
      <OpsKpi label="发货与报运" value={`${items.filter((item) => item.category === "documents").length} 份`} detail="严格模板导出" tone="positive" />
      <OpsKpi label="采购、广告与美工" value={`${items.filter((item) => item.category !== "documents").length} 份`} detail={`占用 ${formatBytes(totalSize)}`} />
      <OpsKpi label="累计下载" value={`${totalDownloads} 次`} detail="按实际文件请求记录" tone="positive" />
      <OpsKpi label="最近生成" value={latest ? formatDate(latest, false) : "—"} detail={latest ? formatDate(latest, true) : "暂无文件"} tone="warning" />
    </div>

    <OpsCard>
      <OpsCardHeader title="历史下载" description={`当前筛选显示 ${visible.length}/${items.length} 份文件，累计下载 ${totalDownloads} 次，共占用 ${formatBytes(totalSize)}。`} action={<FileArchive className="h-4 w-4 text-emerald-700" />} />
      <div className="flex flex-col gap-3 border-t border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative w-full sm:max-w-md"><span className="sr-only">搜索下载文件</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索文件名、批次号或站点" className="w-full border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-emerald-600" /></label>
        <select aria-label="下载类型" value={category} onChange={(event) => setCategory(event.target.value as typeof category)} className="border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-emerald-600"><option value="all">全部文件</option><option value="documents">发货与报运</option><option value="purchase">采购表</option><option value="advertising">广告调整</option><option value="creative">美工对接</option></select>
      </div>
      <div className="overflow-x-auto"><table className="w-full min-w-[1120px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase tracking-[0.08em] text-slate-500"><tr><th className="px-4 py-3">文件</th><th className="px-3 py-3">类型</th><th className="px-3 py-3">站点</th><th className="px-3 py-3">生成时间</th><th className="px-3 py-3">下载记录</th><th className="px-3 py-3 text-right">大小</th><th className="px-4 py-3 text-right">操作</th></tr></thead><tbody className="divide-y divide-slate-100">{visible.map((item) => <tr key={item.id} className="hover:bg-slate-50"><td className="px-4 py-3"><div className="flex items-start gap-3"><FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" /><div className="min-w-0"><p className="max-w-xl truncate font-medium text-slate-900" title={item.filename}>{item.filename}</p><p className="mt-1 font-mono text-[10px] text-slate-400">{item.exportId}</p></div></div></td><td className="px-3 py-3"><OpsBadge tone={item.kind === "declaration" ? "blue" : item.kind === "purchase" || item.kind === "advertising" ? "amber" : item.kind === "creative" ? "slate" : "emerald"}>{kindLabels[item.kind]}</OpsBadge></td><td className="px-3 py-3">{item.market === "BOTH" ? "美加/通用" : item.market}</td><td className="px-3 py-3"><p>{formatDate(item.createdAt, true)}</p><p className="mt-1 text-[10px] text-slate-400">{formatDate(item.createdAt, false)}</p></td><td className="px-3 py-3"><p className="font-mono text-slate-700">{item.downloadCount} 次</p><p className="mt-1 text-[10px] text-slate-400">{item.lastDownloadedAt ? `最近 ${formatDate(item.lastDownloadedAt, true)}` : "尚未下载"}</p></td><td className="px-3 py-3 text-right font-mono">{formatBytes(item.size)}</td><td className="px-4 py-3 text-right"><a href={item.downloadUrl} className="inline-flex items-center gap-1.5 font-medium text-emerald-700 hover:underline"><Download className="h-3.5 w-3.5" />下载</a></td></tr>)}</tbody></table></div>
      {!visible.length ? <div className="p-12 text-center text-sm text-slate-500">没有符合当前筛选条件的历史文件。</div> : null}
      <div className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">显示 {visible.length} / {items.length} 份文件 · {category === "all" ? "全部类型" : categoryLabels[category]}</div>
    </OpsCard>
  </div>;
}

function formatBytes(value: number) { if (value < 1024) return `${value} B`; if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`; return `${(value / 1024 / 1024).toFixed(1)} MB`; }
function formatDate(value: string, time: boolean) { const date = new Date(value); return new Intl.DateTimeFormat("zh-CN", time ? { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false } : { year: "numeric", month: "2-digit", day: "2-digit" }).format(date); }
