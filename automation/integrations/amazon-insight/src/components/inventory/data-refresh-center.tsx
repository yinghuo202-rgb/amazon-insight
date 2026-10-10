"use client";

import { CheckCircle2, DatabaseZap, FileSpreadsheet, FolderSearch, History, LoaderCircle, RefreshCw, RotateCcw, TriangleAlert, UploadCloud } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { OpsBadge, OpsCard, OpsCardHeader, OpsKpi } from "@/components/inventory/ops-ui";
import type { RefreshTask, SyncSchedule } from "@/lib/inventory/refresh-task-store";
import type { OperatingPerformanceRow } from "@/lib/inventory/operating-performance";
import type { GerpgoPreview, GerpgoCollectionSummary } from "@/lib/inventory/gerpgo-preview";
import type { DataRefreshStatus } from "@/lib/inventory/data-refresh";
import type { DataVersion, ImportBatch } from "@/lib/inventory/data-import";
import type { GerpgoConnectionResult, GerpgoSettingsStatus } from "@/lib/inventory/gerpgo";
import type { getWpsStatus } from "@/lib/inventory/wps";

type WpsStatus = ReturnType<typeof getWpsStatus>;
function SyncScheduleControls({ value, ready, onSave, onRestart }: { value: SyncSchedule; ready: boolean; onSave: (input: Record<string, unknown>) => Promise<void>; onRestart: (key: SyncSchedule["key"]) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const activeWorker = value.workerActive;
  if (value.environmentManaged) return <div className="rounded-xl bg-[#f5f5f7] p-4 text-xs" aria-label="积加自动同步状态">
    <h3 className="font-semibold">积加销售及广告自动采集 · env 管理</h3>
    <p className="mt-2 leading-6 text-slate-500">{!ready ? "env 凭证未完整配置，尚未开始拉取。" : !activeWorker ? "未检测到 worker 心跳，请检查同步容器。" : value.enabled ? `每 ${value.intervalMinutes} 分钟自动拉取，通过校验后发布；下次 ${formatDateTime(value.nextRunAt)}` : "env 已暂停自动同步。"}</p>
    <p className="mt-2 leading-6 text-slate-500">无需网页保存凭证或手动更新。{value.lastStatus && `上次任务：${value.lastStatus}。`}异常时保留旧报告和采集证据；后续定时重新采集，不重放旧发布任务。</p>
  </div>;
  return <form key={`${value.enabled}-${value.intervalMinutes}-${value.autoPublish}`} onSubmit={async event => {
    event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true);
    try { await onSave({ key: value.key, enabled: data.has("enabled"), intervalMinutes: Number(data.get("interval")), autoPublish: data.has("automatic") }); }
    finally { setBusy(false); }
  }} aria-label={value.key === "gerpgo" ? "积加定时设置" : "WPS 库存定时设置"} className="rounded-xl bg-[#f5f5f7] p-4 text-xs">
    <h3 className="font-semibold">{value.key === "gerpgo" ? "积加销售及广告采集" : "WPS 库存规划同步"}</h3>
    <div className="mt-3 flex flex-wrap items-center gap-4"><label className="flex min-h-11 items-center gap-2"><input name="enabled" type="checkbox" defaultChecked={value.enabled} />开启定时拉取</label><label>间隔（分钟）<input name="interval" type="number" required min={60} max={10080} defaultValue={value.intervalMinutes} className="ml-2 min-h-11 w-24 rounded-lg border px-2" /></label><button disabled={busy} className="min-h-11 rounded-full bg-[#1d1d1f] px-4 text-white disabled:opacity-50">{busy ? "保存中…" : "保存设置"}</button></div>
    <label className="mt-2 flex min-h-11 items-center gap-2"><input name="automatic" type="checkbox" defaultChecked={value.autoPublish} />通过校验后自动发布，首次仍须人工确认</label>
    <p className="leading-6 text-slate-500">{!ready ? "等待凭证或文件授权，尚未开始拉取。" : !activeWorker ? "未检测到近期 worker 心跳，请检查同步容器。" : value.enabled ? `已开启；计划执行 ${formatDateTime(value.nextRunAt)}` : "定时同步已暂停。"}{value.lastStatus && ` 上次任务：${value.lastStatus}。`}</p>
    {value.lastStatus && ["awaiting_review", "awaiting_mapping", "interrupted"].includes(value.lastStatus) && <p className="mt-1 leading-6 text-amber-800">当前任务需要审核或恢复确认；不会继续堆积新任务。</p>}
    {value.enabled && value.lastStatus && ["awaiting_review", "awaiting_mapping", "interrupted", "failed"].includes(value.lastStatus) && <button type="button" disabled={busy} onClick={async () => {
      if (!window.confirm("确认重新拉取？原始文件和旧预览会保留，当前报告不变；不会直接重放中断的发布任务。")) return;
      setBusy(true); try { await onRestart(value.key); } finally { setBusy(false); }
    }} className="mt-2 min-h-11 rounded-full border bg-white px-3">确认后重新拉取</button>}
  </form>;
}

function WpsSyncSettings({ value, onChange, onError }: { value: WpsStatus; onChange: (s: WpsStatus) => void; onError: (s: string) => void }) {
  const [busy, setBusy] = useState(false), [appId, setAppId] = useState(""), [appKey, setAppKey] = useState("");
  async function action(payload: Record<string, unknown>) {
    if (window.location.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)) { setAppKey(""); onError("WPS 配置请通过 HTTPS 操作，本次未发送密钥。"); return; }
    setBusy(true); onError("");
    try {
      const response = await fetch("/api/inventory/data-refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "WPS 操作失败。");
      if (data.wps) onChange(data.wps);
      if (data.authorizationUrl) { const u = new URL(data.authorizationUrl); if (u.origin !== "https://developer.kdocs.cn") throw new Error("授权地址异常。"); window.location.assign(u.href); }
    } catch (error) { onError(error instanceof Error ? error.message : "WPS 操作失败。"); }
    finally { setBusy(false); }
  }
  return <div className="mt-4 rounded-xl border border-black/5 p-4 text-xs">
    <h3 className="font-semibold">WPS 自动下载授权</h3><p role="status" className="mt-2 leading-6 text-slate-500">{value.message}</p>
    <details className="mt-2"><summary className="min-h-11 cursor-pointer">配置金山文档应用和库存文件</summary>
      <form onSubmit={event => { event.preventDefault(); const d = new FormData(event.currentTarget), payload = { action: "save_wps_settings", appId, appKey, fileToken: d.get("fileToken"), shareUrl: d.get("shareUrl") }; setAppId(""); setAppKey(""); void action(payload); }} className="grid gap-3 sm:grid-cols-2">
        <label>WPS APPID<input required autoComplete="off" value={appId} onChange={e => setAppId(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border px-3" /></label>
        <label>WPS APPKEY<input required type="password" autoComplete="new-password" value={appKey} onChange={e => setAppKey(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border px-3" /></label>
        <label>库存文件 ID（file_token，不是分享短码）<input required name="fileToken" defaultValue={value.fileToken} className="mt-1 min-h-11 w-full rounded-lg border px-3" /></label>
        <label>库存分享链接<input required name="shareUrl" type="url" defaultValue={value.shareUrl} className="mt-1 min-h-11 w-full rounded-lg border px-3" /></label>
        <button disabled={busy} className="min-h-11 rounded-full bg-[#1d1d1f] px-4 text-white disabled:opacity-50">保存配置（需要重新授权）</button>
      </form><p className="mt-2 leading-6 text-slate-500">回调地址：本站 /api/inventory/data-refresh?wps_callback=1。需开放平台下载个人文件权限，文件 ID 从开放平台文件列表取得。密钥及刷新令牌仅加密保存在服务器。</p>
    </details>
    <div className="mt-3 flex flex-wrap gap-2"><button disabled={busy || !value.configured} onClick={() => void action({ action: "authorize_wps" })} className="min-h-11 rounded-full bg-[#0071e3] px-4 text-white disabled:opacity-50">授权库存表</button><button disabled={busy || !value.authorized} onClick={() => void action({ action: "pull_wps" })} className="min-h-11 rounded-full border px-4 disabled:opacity-50">立即同步 WPS</button></div>
    <p className="mt-2 leading-6 text-slate-500">授权可使用当前 WPS 登录态，无需复制 Cookie。分享链接本身不是下载授权；授权失效时保留旧数据。WPS 规划值不覆盖积加海外库存。</p>
  </div>;
}

export function GerpgoConnectionCheck({ initialConfiguration }: { initialConfiguration: GerpgoSettingsStatus }) {
  const [configuration, setConfiguration] = useState(initialConfiguration);
  const [busy, setBusy] = useState<"save" | "check" | "">("");
  const [appId, setAppId] = useState("");
  const [appKey, setAppKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [result, setResult] = useState<GerpgoConnectionResult | null>(null);
  const [error, setError] = useState("");
  async function save() {
    if (window.location.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)) {
      setAppKey(""); setError("保存密钥请通过 HTTPS 访问网站；本次没有发送凭证。"); return;
    }
    const body = JSON.stringify({ action: "save_gerpgo_credentials", appId, appKey });
    setBusy("save"); setError(""); setResult(null); setSaved(false);
    setAppId(""); setAppKey("");
    try {
      const response = await fetch("/api/inventory/data-refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body, cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "凭证保存失败。");
      setConfiguration(payload.configuration); setSaved(true);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "凭证保存失败，请稍后重试。"); }
    finally { setBusy(""); }
  }
  async function check() {
    setBusy("check"); setError(""); setResult(null); setSaved(false);
    try {
      const response = await fetch("/api/inventory/data-refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "test_gerpgo" }), cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "连接检查失败。");
      setResult(payload);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "连接检查失败，请稍后重试。"); }
    finally { setBusy(""); }
  }
  return <div className="py-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-medium">积加经营数据</h3><p className="mt-1 text-xs leading-6 text-slate-500">本轮同步销售和广告；库存、历史发货保留本地来源。授权检查不更新业务数据。</p></div><button type="button" disabled={!configuration.configured || Boolean(busy)} onClick={() => void check()} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[#0071e3] px-4 text-sm text-white disabled:opacity-50">{busy === "check" && <LoaderCircle className="h-4 w-4 animate-spin" />}{busy === "check" ? "正在检查…" : "测试积加连接"}</button></div>
    {configuration.source !== "env" && <form onSubmit={(event) => { event.preventDefault(); void save(); }} className="mt-4 rounded-2xl bg-[#f5f5f7] p-4">
      <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs text-slate-600">积加 appId<input type="text" required autoComplete="off" maxLength={512} value={appId} disabled={Boolean(busy) || !configuration.canSave} onChange={(event) => setAppId(event.target.value)} className="mt-2 block min-h-11 w-full rounded-xl border border-black/10 bg-white px-3 text-sm outline-none focus:border-[#0071e3]" /></label><label className="text-xs text-slate-600">积加 appKey<input type="password" required autoComplete="new-password" maxLength={4096} value={appKey} disabled={Boolean(busy) || !configuration.canSave} onChange={(event) => setAppKey(event.target.value)} className="mt-2 block min-h-11 w-full rounded-xl border border-black/10 bg-white px-3 text-sm outline-none focus:border-[#0071e3]" /></label></div>
      <div className="mt-3 flex flex-wrap items-center gap-3"><button type="submit" disabled={Boolean(busy) || !configuration.canSave || !appId.trim() || !appKey.trim()} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[#1d1d1f] px-4 text-sm text-white disabled:opacity-50">{busy === "save" && <LoaderCircle className="h-4 w-4 animate-spin" />}{busy === "save" ? "正在保存…" : "保存积加凭证"}</button><span className="text-xs leading-6 text-slate-500">{configuration.source === "database" ? "已在网页保存；更新时重新填写两项凭证" : "保存后再测试连接"}</span></div>
      <p className="mt-2 text-xs leading-6 text-slate-500">仅通过 HTTPS 提交，保存后清空输入框、不回显密钥。凭证加密保存在 NAS 运营数据库中。</p>
      {!configuration.canSave && <p className="mt-2 text-xs leading-6 text-amber-700">网页保存需要至少 32 字符的 SECRET_KEY；请在 NAS 保留并配置原有密钥。</p>}
    </form>}
    <p role="status" aria-live="polite" className={`mt-2 text-xs leading-6 ${error || (result && !result.marketAccess) ? "text-amber-700" : "text-slate-500"}`}>{error || result?.message || (saved ? `凭证已加密保存。${configuration.message}` : configuration.message)}</p>
    {result && <p className="mt-1 text-xs leading-6 text-slate-500">本次检查：{formatDateTime(result.checkedAt)}；令牌预计有效至 {formatDateTime(result.expiresAt)}。令牌不保存到浏览器或日志。</p>}
    <p className="mt-1 text-xs leading-6 text-slate-500">NAS 公网出口 IP 需要加入积加白名单；不要填写 Cloudflare Tunnel 地址。共用账号的使用者均可更新凭证，请只分享给可信人员。</p>
  </div>;
}

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
      setMessage(scanOnly ? "已重新检查所有源文件。" : "重建任务已排队，请在同步任务面板查看状态；完成前仍显示原报告。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "操作失败"); }
    finally { setBusy(""); }
  }

  const latestReport = status.reports.map((item) => item.modifiedAt).filter(Boolean).sort().at(-1) ?? null;
  const latestRun = status.runs[0] ?? null;
  const topException = [...status.exceptions].sort((left, right) => right.count - left.count)[0];
  return <div className="space-y-5">
    <RefreshTaskPanel />
    <OpsCard className="border-blue-200 bg-blue-50/30">
      <OpsCardHeader title="网页上传 Excel" description={isAdmin ? "支持库存规划、新品调研、发货清单、销售、广告、成本、产品明细和月度分析；先解析预览，确认后再发布。" : "只有管理员可以上传和发布数据，普通成员可查看当前数据状态。"} action={<UploadCloud className="h-5 w-5 text-blue-700" />} />
      {isAdmin ? <div className="p-5"><input ref={inputRef} type="file" multiple accept=".xlsx,.xlsm" className="hidden" onChange={(event) => void upload(event.target.files)} /><button type="button" disabled={Boolean(importBusy)} onClick={() => inputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void upload(event.dataTransfer.files); }} className="flex min-h-28 w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-blue-200 bg-white px-5 text-center transition hover:border-blue-500 hover:bg-blue-50 disabled:opacity-50">{importBusy === "upload" ? <LoaderCircle className="h-6 w-6 animate-spin text-blue-700" /> : <UploadCloud className="h-6 w-6 text-blue-700" />}<span className="mt-2 text-sm font-semibold text-slate-800">{importBusy === "upload" ? `正在上传并解析… ${uploadProgress}%` : "选择或拖入多个 Excel 文件"}</span><span className="mt-1 text-[11px] text-slate-500">使用 8 MB 分片，支持通过 Cloudflare 上传大工作簿；上传不会立即覆盖网站数据</span>{importBusy === "upload" ? <span className="mt-3 h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-blue-100"><span className="block h-full bg-blue-600 transition-all" style={{ width: `${uploadProgress}%` }} /></span> : null}</button></div> : <div className="px-5 py-4 text-xs text-slate-500">请使用管理员账号进行数据更新。</div>}
      {message ? <p className={`border-t px-5 py-3 text-xs ${message.startsWith("已") || message.includes("发布") ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-700"}`}>{message}</p> : null}
    </OpsCard>

    {batches.length ? <OpsCard><OpsCardHeader title="上传批次与发布预览" description="识别结果只显示结构和汇总；确认发布前现有网站数据保持不变。" /><div className="divide-y divide-slate-100">{batches.slice(0, 8).map((batch) => <div key={batch.batchId} className="p-4 sm:p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><p className="font-mono text-xs font-semibold text-slate-800">{batch.batchId}</p><OpsBadge tone={batch.status === "published" ? "emerald" : batch.status === "ready" ? "blue" : "amber"}>{batch.status === "published" ? "已发布" : batch.status === "ready" ? "待确认" : "需检查"}</OpsBadge></div><p className="mt-1 text-[11px] text-slate-500">{formatDateTime(batch.createdAt)} · 识别 {batch.summary.recognizedCount}/{batch.summary.fileCount} 个文件{batch.dataVersion ? ` · ${batch.dataVersion}` : ""}</p></div>{isAdmin && batch.status !== "published" ? <button type="button" disabled={Boolean(importBusy) || !batch.summary.publishableCount} onClick={() => void publish(batch.batchId)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-40">{importBusy === "publish" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <DatabaseZap className="h-4 w-4" />}确认发布</button> : null}</div><div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{batch.files.map((file) => <div key={file.sha256} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3"><div className="flex items-start gap-2"><FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" /><div className="min-w-0"><p className="truncate text-xs font-semibold text-slate-800" title={file.name}>{file.name}</p><div className="mt-1 flex items-center gap-2"><OpsBadge tone={file.type === "unknown" ? "amber" : "emerald"}>{file.label}</OpsBadge><span className="text-[10px] text-slate-400">{formatSize(file.size)}</span></div><PreviewSummary preview={file.preview} error={file.error} /></div></div></div>)}</div>{batch.source && <p className="mt-3 text-[11px] text-slate-500">来源：{batch.source.kind === "wps-api-download" ? "WPS 官方授权自动下载" : "WPS 现有登录态下载"} · 文件校验 {batch.source.sha256.slice(0, 12)} · 业务截止日期 {batch.source.businessAsOf ?? "待核验"}</p>}{batch.warnings.map(warning => <p key={warning} role="status" className="mt-2 text-[11px] leading-6 text-amber-800">{warning}</p>)}{batch.stagedFiles?.length ? <p className="mt-3 text-[11px] text-amber-700">已安全保存、等待专用转换器：{batch.stagedFiles.join("、")}</p> : null}</div>)}</div></OpsCard> : null}

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

function RefreshTaskPanel() {
  const [tasks, setTasks] = useState<RefreshTask[]>([]), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [schedules, setSchedules] = useState<SyncSchedule[]>([]), [wps, setWps] = useState<WpsStatus | null>(null), [gerpgoReady, setGerpgoReady] = useState(false);
  const [wpsReturn, setWpsReturn] = useState(""), [pollError, setPollError] = useState("");
  async function saveSchedule(input: Record<string, unknown>) {
    setError("");
    try {
      const response = await fetch("/api/inventory/data-refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save_sync_schedule", ...input }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "定时设置保存失败。"); setSchedules(data.schedules);
    } catch (error) { setError(error instanceof Error ? error.message : "定时设置保存失败。"); }
  }
  async function restartSchedule(key: SyncSchedule["key"]) {
    setError("");
    try {
      const response = await fetch("/api/inventory/data-refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "restart_sync_schedule", key, acknowledged: true }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "重新拉取失败。"); setSchedules(data.schedules);
    } catch (error) { setError(error instanceof Error ? error.message : "重新拉取失败。"); }
  }
  const [preview, setPreview] = useState<GerpgoPreview | null>(null), [confirmed, setConfirmed] = useState(false);
  const [records, setRecords] = useState<OperatingPerformanceRow[]>([]), [nextOffset, setNextOffset] = useState<number | null>(null);
  const [collection, setCollection] = useState<GerpgoCollectionSummary | null>(null);
  async function inspectCollection(id: string) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/inventory/data-refresh?collection=" + encodeURIComponent(id), { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "无法读取采集明细。");
      setCollection(payload.collection);
    } catch (error) { setError(error instanceof Error ? error.message : "无法读取采集明细。"); }
    finally { setBusy(false); }
  }
  async function inspect(id: string, offset = 0) {
    setBusy(true); setError(""); setConfirmed(false);
    if (!offset) { setPreview(null); setRecords([]); }
    try {
      const response = await fetch("/api/inventory/data-refresh?preview=" + encodeURIComponent(id) + `&offset=${offset}` + (offset && preview ? `&version=${preview.previewHash}` : ""), { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "预览读取失败。");
      setPreview(payload.preview); setRecords(current => offset ? [...current, ...payload.records] : payload.records); setNextOffset(payload.nextOffset);
    } catch (error) { setError(error instanceof Error ? error.message : "预览读取失败。"); }
    finally { setBusy(false); }
  }
  async function publish() {
    if (!preview || !confirmed || preview.blocked) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/inventory/data-refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "publish_gerpgo", sourceTaskId: preview.taskId, previewHash: preview.previewHash, confirmed: true }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "审核提交失败。");
      setTasks(current => [payload.task, ...current.filter(task => task.id !== payload.task.id)]);
      setPreview(null); setConfirmed(false);
    } catch (error) { setError(error instanceof Error ? error.message : "审核提交失败。"); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    const controller = new AbortController();
    const result = new URL(window.location.href).searchParams.get("wps");
    async function check() {
      try {
        const response = await fetch("/api/inventory/data-refresh?tasks=1", { signal: controller.signal, cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error("同步任务状态暂不可用。");
        if (result) setWpsReturn(result === "authorized" ? "WPS 授权已保存，请先拉取并审核首次库存预览。" : "WPS 授权未完成或回调过期，请重新授权并检查注册回调地址。");
        setTasks(payload.tasks ?? []); setSchedules(payload.schedules ?? []); setWps(payload.wps ?? null); setGerpgoReady(Boolean(payload.gerpgoConfigured)); setPollError("");
      } catch { if (!controller.signal.aborted) setPollError("同步任务状态暂不可用，请稍后重新打开页面。"); }
    }
    void check(); const timer = setInterval(() => void check(), 5000);
    return () => { controller.abort(); clearInterval(timer); };
  }, []);
  async function pull(includeSupplemental = false) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/inventory/data-refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "pull_gerpgo", includeSupplemental }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "提交失败。");
      setTasks(current => [payload.task, ...current.filter(task => task.id !== payload.task.id)]);
    } catch (error) { setError(error instanceof Error ? error.message : "提交失败。"); }
    finally { setBusy(false); }
  }
  const labels: Record<string, string> = { queued: "已排队", running: "处理中", awaiting_mapping: "映射待核验", awaiting_review: "待对账确认", completed: "已完成", failed: "失败", interrupted: "已中断，需核查", superseded: "旧预览已保留，已重新拉取" };
  return <section className="rounded-2xl border border-black/5 bg-white p-5" aria-label="同步任务">
    <h2 className="text-sm font-semibold">定时同步</h2>
    <div className="mb-4 mt-3 grid gap-3 lg:grid-cols-2">{schedules.map(value => <SyncScheduleControls key={value.key} value={value} ready={value.key === "gerpgo" ? gerpgoReady : Boolean(wps?.authorized)} onSave={saveSchedule} onRestart={restartSchedule} />)}</div>
    {wpsReturn && <p role="status" className="mb-3 text-xs leading-6 text-slate-600">{wpsReturn}</p>}
    {pollError && <p role="alert" className="mb-3 text-xs leading-6 text-rose-700">{pollError}</p>}
    {wps && <WpsSyncSettings value={wps} onChange={setWps} onError={setError} />}
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-semibold">同步任务</h2>{!schedules.find(s => s.key === "gerpgo")?.environmentManaged && <div className="flex flex-wrap gap-2"><button disabled={busy} onClick={() => void pull()} className="min-h-11 rounded-full bg-[#0071e3] px-4 text-sm text-white disabled:opacity-50">{busy ? "正在提交…" : "拉取销售预览"}</button><button disabled={busy} onClick={() => void pull(true)} className="min-h-11 rounded-full border px-4 text-sm disabled:opacity-50">销售及广告采集</button></div>}</div>
    <p className="mt-2 text-xs leading-6 text-slate-500">env 模式首次自动拉近六个完整月和当月的销售及广告，随后重拉上月和当月并保留历史。广告按逐日逐站点采集；缺页、映射异常、历史金额或 SKU 数修订超过 10% 时保留旧报告。库存和历史发货不从积加同步，本轮不重建本地数据。长期排队请检查 worker 容器。</p>
    {tasks.filter(task => task.kind === "wps_inventory").map(task => <div key={task.id} className="mt-3 rounded-xl bg-slate-50 p-3 text-xs"><p>WPS 库存同步 · {labels[task.status] || task.status}</p><p role="status" className="mt-1 leading-6 text-slate-500">{task.progress}{task.error ? ` · ${task.error}` : ""}</p>{task.batchId && <button type="button" onClick={() => window.location.reload()} className="mt-2 min-h-11 rounded-full border px-3">查看上传批次预览 · {task.batchId}</button>}</div>)}
    {error && <p role="alert" className="mt-2 text-xs text-rose-700">{error}</p>}
    <div className="mt-3 divide-y divide-slate-100">{tasks.filter(task => task.kind !== "wps_inventory").slice(0, 10).map(task => <div key={task.id} className="py-3 text-xs"><p className="font-medium">{task.kind === "gerpgo" ? "积加采集" : task.kind === "gerpgo_publish" ? "积加审核发布" : "报告重建"} · {labels[task.status] || task.status}</p><p role="status" className="mt-1 break-words leading-6 text-slate-500">{task.progress || "等待 worker"}{task.error ? ` · ${task.error}` : ""}</p><p className="mt-1 text-[10px] text-slate-400">{formatDateTime(task.createdAt)} · {task.id.slice(0, 8)}</p>{task.kind === "gerpgo" && task.status !== "queued" && <button disabled={busy} onClick={() => void inspectCollection(task.id)} className="mr-2 mt-2 min-h-11 rounded-lg border border-slate-200 px-3 disabled:opacity-50">查看采集明细</button>}{task.kind === "gerpgo" && ["awaiting_mapping", "awaiting_review"].includes(task.status) && <button disabled={busy} onClick={() => void inspect(task.id)} className="mt-2 min-h-11 rounded-lg border border-slate-200 px-3 disabled:opacity-50">查看差异预览</button>}</div>)}</div>
    {collection && <div className="mt-4 rounded-xl bg-slate-50 p-4 text-xs leading-6" aria-label="积加采集覆盖"><h3 className="font-semibold">原始数据采集覆盖</h3><p>采集 {formatDateTime(collection.capturedAt)}；成功采集不等于业务映射已核验或已发布。</p>{collection.domains.map(domain => <div key={domain.name} className="mt-2 rounded-lg bg-white p-3"><p className="font-medium">{{ shops: "店铺站点", products: "产品", performance: "经营表现", fba: "FBA", ads: "广告（逐日逐站点）", returns: "退货", storage: "仓储" }[domain.name] || domain.name}</p><p>完成 {domain.completed} 个范围 · 失败 {domain.failed} · 跳过 {domain.skipped} · {domain.pages} 页 / {domain.records} 条</p>{domain.errors.map(error => <p key={error} className="text-rose-700">{error}</p>)}</div>)}</div>}
    {preview && <div className="mt-4 rounded-xl bg-slate-50 p-4 text-xs leading-6" aria-label="积加差异预览"><h3 className="font-semibold">经营报告预览 · {preview.recordCount} 条 SKU 月度记录</h3><p>采集日期 {formatDateTime(preview.capturedAt)}；基线 {preview.baseline.slice(0, 12)}。跳过父体汇总 {preview.ignoredParentRows} 条。</p>{preview.withheld.map(text => <p key={text} className="text-amber-800">{text}</p>)}{preview.reviewReasons.map(text => <p key={text}>{text}</p>)}<div className="mt-3 space-y-2">{preview.differences.map(item => <div key={`${item.market}-${item.reportMonth}`} className="rounded-lg bg-white p-3"><p className="font-medium">{item.market} {item.reportMonth} · {item.currency} · {item.completePeriod ? "完整月" : "当月截至采集日"}</p><p>销售额 {item.previousRevenue ?? "无历史"} → {item.candidateRevenue}；SKU {item.previousSkuCount} → {item.candidateSkuCount}</p><p>销售额变化 {item.revenueChangePercent == null ? "无可比基线" : `${item.revenueChangePercent.toFixed(1)}%`}{item.protected ? " · 超过发布保护线，需重点对账" : ""}</p></div>)}</div>{records.length > 0 && <details className="mt-3"><summary className="min-h-11 cursor-pointer font-medium">逐 SKU 对账明细（已加载 {records.length} 条）</summary><div className="max-h-96 overflow-y-auto">{records.map(record => <div key={`${record.market}-${record.reportMonth}-${record.sku}`} className="border-t border-slate-200 py-2"><p>{record.market} {record.reportMonth} · {record.sku}</p><p>{record.units} 件 · 销售额 {record.currency} {record.productSales} · 来源利润 {record.actualProfit ?? "未提供"}</p></div>)}</div>{nextOffset !== null && <button disabled={busy} onClick={() => void inspect(preview.taskId, nextOffset)} className="min-h-11 rounded-lg border px-3">继续加载 20 条对账明细</button>}</details>}{preview.blocked ? <div role="alert" className="mt-3 text-rose-700"><p>有 {preview.issueCount} 条校验问题，禁止发布。补齐口径后重新拉取。</p>{preview.issues.map((item, index) => <p key={index}>{item.source} 第 {item.row} 条：{item.reason}</p>)}</div> : <><label className="mt-3 flex min-h-11 items-start gap-2"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-2" /><span>已核对站点、SKU、原币种、期间及金额差异；仅确认经营报告，不确认完整利润、退货口径或 FBA 库存。</span></label><button disabled={busy || !confirmed} onClick={() => void publish()} className="mt-2 min-h-11 rounded-full bg-[#0071e3] px-4 text-white disabled:opacity-50">确认并交给 worker 发布</button></>}</div>}
    {!tasks.length && <p className="mt-3 text-xs text-slate-500">尚无同步任务。</p>}
  </section>;
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
  const marketSummaries = preview.markets && typeof preview.markets === "object" ? Object.entries(preview.markets).flatMap(([market, value]) => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>, skipped = item.skipped as Record<string, number> | undefined;
    return [`${market} · 有效 ${item.skuCount ?? "待核验"} · 唯一 SKU ${item.uniqueSkuCount ?? "待核验"} · 已匹配 ${item.matchedSkuCount ?? "待核验"} · 未映射 ${item.unmappedSkuCount ?? "待核验"} · 跳过 ${skipped ? Object.values(skipped).reduce((sum, count) => sum + count, 0) : "待核验"}`];
  }) : [];
  return <div className="mt-2 text-[10px] leading-5 text-slate-500"><p>{[candidates, skuCount, marketCount, impacts ? `影响：${impacts}` : ""].filter(Boolean).join(" · ") || "结构已识别"}</p>{marketSummaries.map(summary => <p key={summary}>{summary}</p>)}</div>;
}
