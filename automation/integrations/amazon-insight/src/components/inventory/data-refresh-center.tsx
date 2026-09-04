"use client";

import { CheckCircle2, DatabaseZap, FileSpreadsheet, FolderSearch, History, LoaderCircle, RefreshCw, RotateCcw, TriangleAlert, UploadCloud } from "lucide-react";
import { useRef, useState } from "react";

import { OpsBadge, OpsCard, OpsCardHeader, OpsKpi } from "@/components/inventory/ops-ui";
import type { DataRefreshStatus } from "@/lib/inventory/data-refresh";
import type { DataVersion, ImportBatch } from "@/lib/inventory/data-import";

export function DataRefreshCenter({ initialStatus, initialBatches, initialVersions, isAdmin }: { initialStatus: DataRefreshStatus; initialBatches: ImportBatch[]; initialVersions: DataVersion[]; isAdmin: boolean }) {
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState<"scan" | "rebuild" | "">("");
  const [message, setMessage] = useState("");
  const [batches, setBatches] = useState(initialBatches);
  const [versions, setVersions] = useState(initialVersions);
  const [importBusy, setImportBusy] = useState<"upload" | "publish" | "">("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setImportBusy("upload"); setMessage("");
    try {
      const selected = Array.from(files);
      const totalBytes = selected.reduce((sum, file) => sum + file.size, 0);
      const initialize = await fetch("/api/inventory/data-import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "initialize", files: selected.map((file) => ({ name: file.name, size: file.size })) }) });
      const initialized = await initialize.json();
      if (!initialize.ok) throw new Error(initialized.error || "无法创建上传批次。");
      let uploadedBytes = 0;
      const chunkSize = 8 * 1024 * 1024;
      for (const planned of initialized.upload.files as Array<{ index: number }>) {
        const file = selected[planned.index];
        for (let offset = 0; offset < file.size; offset += chunkSize) {
          const response = await fetch(`/api/inventory/data-import?batchId=${encodeURIComponent(initialized.upload.batchId)}&fileIndex=${planned.index}&offset=${offset}`, { method: "PUT", headers: { "content-type": "application/octet-stream" }, body: file.slice(offset, Math.min(offset + chunkSize, file.size)) });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error || `${file.name} 上传失败。`);
          uploadedBytes += Math.min(chunkSize, file.size - offset);
          setUploadProgress(Math.round(uploadedBytes / totalBytes * 100));
        }
      }
      const response = await fetch("/api/inventory/data-import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "finalize", batchId: initialized.upload.batchId }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "上传解析失败。");
      setBatches((current) => [payload.batch, ...current.filter((item) => item.batchId !== payload.batch.batchId)]);
      setMessage(`已识别 ${payload.batch.summary.recognizedCount}/${payload.batch.summary.fileCount} 个文件，请确认后发布。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "上传解析失败。"); }
    finally { setImportBusy(""); setUploadProgress(0); if (inputRef.current) inputRef.current.value = ""; }
  }

  async function publish(batchId: string) {
    setImportBusy("publish"); setMessage("");
    try {
      const response = await fetch("/api/inventory/data-import", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ batchId }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "发布失败。");
      setBatches((current) => current.map((item) => item.batchId === batchId ? payload.batch : item));
      setStatus(await fetch("/api/inventory/data-refresh", { cache: "no-store" }).then((result) => result.json()));
      const history = await fetch("/api/inventory/data-import", { cache: "no-store" }).then((result) => result.json());
      setVersions(history.versions ?? []);
      setMessage(`数据版本 ${payload.batch.dataVersion} 已发布，网站已切换到最新数据。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "发布失败。"); }
    finally { setImportBusy(""); }
  }

  async function restore(version: string) {
    if (!window.confirm(`确定回滚到 ${version}？当前报告会先自动备份。`)) return;
    setImportBusy("publish"); setMessage("");
    try {
      const response = await fetch("/api/inventory/data-import", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "restore", version }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "回滚失败。");
      setStatus(await fetch("/api/inventory/data-refresh", { cache: "no-store" }).then((result) => result.json()));
      setMessage(`已回滚到 ${version}。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "回滚失败。"); }
    finally { setImportBusy(""); }
  }

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
    <OpsCard className="border-blue-200 bg-blue-50/30">
      <OpsCardHeader title="网页上传 Excel" description={isAdmin ? "支持库存规划、新品调研、发货清单、销售、广告、成本、产品明细和月度分析；先解析预览，确认后再发布。" : "只有管理员可以上传和发布数据，普通成员可查看当前数据状态。"} action={<UploadCloud className="h-5 w-5 text-blue-700" />} />
      {isAdmin ? <div className="p-5"><input ref={inputRef} type="file" multiple accept=".xlsx,.xlsm" className="hidden" onChange={(event) => void upload(event.target.files)} /><button type="button" disabled={Boolean(importBusy)} onClick={() => inputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void upload(event.dataTransfer.files); }} className="flex min-h-28 w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-blue-200 bg-white px-5 text-center transition hover:border-blue-500 hover:bg-blue-50 disabled:opacity-50">{importBusy === "upload" ? <LoaderCircle className="h-6 w-6 animate-spin text-blue-700" /> : <UploadCloud className="h-6 w-6 text-blue-700" />}<span className="mt-2 text-sm font-semibold text-slate-800">{importBusy === "upload" ? `正在上传并解析… ${uploadProgress}%` : "选择或拖入多个 Excel 文件"}</span><span className="mt-1 text-[11px] text-slate-500">使用 8 MB 分片，支持通过 Cloudflare 上传大工作簿；上传不会立即覆盖网站数据</span>{importBusy === "upload" ? <span className="mt-3 h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-blue-100"><span className="block h-full bg-blue-600 transition-all" style={{ width: `${uploadProgress}%` }} /></span> : null}</button></div> : <div className="px-5 py-4 text-xs text-slate-500">请使用管理员账号进行数据更新。</div>}
      {message ? <p className={`border-t px-5 py-3 text-xs ${message.startsWith("已") || message.includes("发布") ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-700"}`}>{message}</p> : null}
    </OpsCard>

    {batches.length ? <OpsCard><OpsCardHeader title="上传批次与发布预览" description="识别结果只显示结构和汇总；确认发布前现有网站数据保持不变。" /><div className="divide-y divide-slate-100">{batches.slice(0, 8).map((batch) => <div key={batch.batchId} className="p-4 sm:p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><p className="font-mono text-xs font-semibold text-slate-800">{batch.batchId}</p><OpsBadge tone={batch.status === "published" ? "emerald" : batch.status === "ready" ? "blue" : "amber"}>{batch.status === "published" ? "已发布" : batch.status === "ready" ? "待确认" : "需检查"}</OpsBadge></div><p className="mt-1 text-[11px] text-slate-500">{formatDateTime(batch.createdAt)} · 识别 {batch.summary.recognizedCount}/{batch.summary.fileCount} 个文件{batch.dataVersion ? ` · ${batch.dataVersion}` : ""}</p></div>{isAdmin && batch.status !== "published" ? <button type="button" disabled={Boolean(importBusy) || !batch.summary.publishableCount} onClick={() => void publish(batch.batchId)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-40">{importBusy === "publish" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <DatabaseZap className="h-4 w-4" />}确认发布</button> : null}</div><div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{batch.files.map((file) => <div key={file.sha256} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3"><div className="flex items-start gap-2"><FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" /><div className="min-w-0"><p className="truncate text-xs font-semibold text-slate-800" title={file.name}>{file.name}</p><div className="mt-1 flex items-center gap-2"><OpsBadge tone={file.type === "unknown" ? "amber" : "emerald"}>{file.label}</OpsBadge><span className="text-[10px] text-slate-400">{formatSize(file.size)}</span></div><PreviewSummary preview={file.preview} error={file.error} /></div></div></div>)}</div>{batch.stagedFiles?.length ? <p className="mt-3 text-[11px] text-amber-700">已安全保存、等待专用转换器：{batch.stagedFiles.join("、")}</p> : null}</div>)}</div></OpsCard> : null}

    {isAdmin && versions.length ? <OpsCard><OpsCardHeader title="数据版本与回滚" description="每次发布前都会保存完整报告快照；回滚时也会先备份当前版本。" action={<History className="h-4 w-4 text-blue-700" />} /><div className="divide-y divide-slate-100">{versions.slice(0, 8).map((version) => <div key={version.version} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"><div><p className="font-mono text-xs font-semibold text-slate-800">{version.version}</p><p className="mt-1 text-[10px] text-slate-500">{formatDateTime(version.createdAt)} · {version.fileCount} 份报告</p></div><button type="button" disabled={Boolean(importBusy)} onClick={() => void restore(version.version)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-40"><RotateCcw className="h-3.5 w-3.5" />回滚</button></div>)}</div></OpsCard> : null}
    <div className="ops-kpi-grid grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <OpsKpi label="已识别数据源" value={`${status.summary.sourceCount} 项`} detail={`${status.summary.missingCount} 项必需源缺失`} tone={status.summary.missingCount ? "danger" : "positive"} />
      <OpsKpi label="标准数据集" value={`${status.summary.reportCount} / ${status.reports.length}`} detail="库存、采购、内容与单据" tone={status.summary.reportCount === status.reports.length ? "positive" : "warning"} />
      <OpsKpi label="开放异常" value={`${status.summary.openExceptionCount} 项`} detail="SKU 映射与源数据异常" tone={status.summary.openExceptionCount ? "warning" : "positive"} />
      <OpsKpi label="近期失败" value={`${status.summary.failedRunCount} 次`} detail="最近 20 次任务" tone={status.summary.failedRunCount ? "danger" : "positive"} />
      <OpsKpi label="最近生成" value={latestReport ? formatDate(latestReport) : "—"} detail={latestReport ? formatTime(latestReport) : "暂无标准数据"} />
    </div>

    <OpsCard className="border-emerald-200 bg-emerald-50/40">
      <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between"><div className="flex items-start gap-3"><DatabaseZap className="mt-0.5 h-5 w-5 text-emerald-700" /><div><h2 className="text-sm font-semibold">一键更新运营数据</h2><p className="mt-1 max-w-3xl text-xs leading-5 text-slate-600">将最新文件放入原有目录后，先检查数据源，再依次执行 SKU 审计、产品目录、内容任务、订单主数据、双站库存和采购计划重建。原始文件保持只读。</p></div></div><div className="flex shrink-0 gap-2"><button type="button" onClick={() => void refresh(true)} disabled={Boolean(busy)} className="inline-flex items-center gap-2 border border-slate-300 bg-white px-3 py-2 text-xs font-semibold disabled:opacity-50">{busy === "scan" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FolderSearch className="h-4 w-4" />}检查文件</button><button type="button" onClick={() => void refresh(false)} disabled={Boolean(busy) || Boolean(status.summary.missingCount)} className="inline-flex items-center gap-2 bg-emerald-800 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy === "rebuild" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}{busy === "rebuild" ? "完整重建中（约 3–5 分钟）" : "重建全部数据"}</button></div></div>
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
function formatSize(value: number) { return value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(value / 1024))} KB`; }
function PreviewSummary({ preview, error }: { preview?: Record<string, unknown>; error?: string }) {
  if (error) return <p className="mt-2 text-[10px] leading-4 text-rose-700">{error}</p>;
  if (!preview) return null;
  const impacts = Array.isArray(preview.impacts) ? preview.impacts.join("、") : "";
  const candidates = typeof preview.candidateCount === "number" ? `候选 ${preview.candidateCount} 个` : "";
  const skuCount = typeof preview.skuCount === "number" ? `SKU ${preview.skuCount} 个` : "";
  const marketCount = preview.markets && typeof preview.markets === "object" ? `站点 ${Object.keys(preview.markets).length} 个` : "";
  return <p className="mt-2 text-[10px] leading-4 text-slate-500">{[candidates, skuCount, marketCount, impacts ? `影响：${impacts}` : ""].filter(Boolean).join(" · ") || "结构已识别"}</p>;
}
