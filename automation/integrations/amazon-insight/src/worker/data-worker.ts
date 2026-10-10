import { mkdir, writeFile, rename, readFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { runFullDataRefresh, runPythonJob } from "@/lib/inventory/data-refresh";
import { automationRoot, runtimePath } from "@/lib/inventory/paths";
import { readGerpgoPreview } from "@/lib/inventory/gerpgo-preview";
import { shipmentPlanDbPath } from "@/lib/inventory/shipment-plan";
import { claimRefreshTask, updateRefreshTask, listRefreshTasks, listSyncSchedules, enqueueDueSyncTasks, completeReviewedSyncTask, configureGerpgoEnvironmentSchedule } from "@/lib/inventory/refresh-task-store";
import { collectGerpgoPages, createGerpgoClient, gerpgoSupplementalSources, GerpgoConnectionError, getGerpgoSettingsStatus, resolveGerpgoEnvironment, resolveGerpgoStoreScope, getGerpgoAutoSyncConfiguration } from "@/lib/inventory/gerpgo";
import { publishedReportPath } from "@/lib/inventory/report-version";
import { getWpsStatus, downloadWpsInventory, WpsError } from "@/lib/inventory/wps";
import { receiveWpsInventoryDownload, autoPublishWpsInventory, getImportBatch } from "@/lib/inventory/data-import";

let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

async function currentPerformance() {
  const file = await publishedReportPath(runtimePath("reports", "gerpgo-performance.json"));
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

export async function collectGerpgoTask(task: NonNullable<ReturnType<typeof claimRefreshTask>>) {
  const environment = resolveGerpgoEnvironment();
  if (!environment.GERPGO_STORE_NAME?.trim()) throw new GerpgoConnectionError("请配置 GERPGO_STORE_NAME；禁止自动汇总全部授权店铺。", 422);
  const client = await createGerpgoClient(environment);
  const folder = runtimePath("incoming", "gerpgo", task.id);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const recent = task.scheduled && Boolean(await currentPerformance());
  const now = new Date(), scopes = [];
  for (let offset = recent ? 1 : 6; offset >= 0; offset--) {
    const begin = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    const end = offset === 0 ? now : new Date(Date.UTC(begin.getUTCFullYear(), begin.getUTCMonth() + 1, 0));
    scopes.push({ name: "performance-" + begin.toISOString().slice(0, 7), endpoint: "/operation/sts/productAnalyzeMultiIndex/page", condition: { beginDate: begin.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10), showCurrencyType: "YUAN" } });
  }
  const sources = [
    { name: "shops", endpoint: "/middle/base/market/page", condition: {} },
    { name: "products", endpoint: "/purchase/goods/product/page", condition: {} },
    ...scopes,
  ];
  type SourceResult = { name: string; endpoint: string; condition: Record<string, unknown>; status: "completed" | "failed" | "skipped"; pages: number; total: number | null; error?: string; totalUnit?: "markets" };
  const completed: SourceResult[] = [], sellers: Record<string, unknown>[] = [], failedEndpoints = new Map<string, string>();
  let storeScope: ReturnType<typeof resolveGerpgoStoreScope> | undefined;
  async function saveManifest(status = "collecting") {
    const manifest = { schemaVersion: 1, taskId: task.id, source: "gerpgo", capturedAt: now.toISOString(), businessAsOf: null, status, sources: completed, storeScope,
      collectionMode: task.includeSupplemental ? "sales_ads" : "sales", collectionScope: recent ? "recent" : "initial", deferredDomains: task.includeSupplemental ? [] : ["ads"],
      excludedDomains: ["fba", "returns", "storage", "shipments"],
      reason: "全部原始分页保存在服务端；未完成的数据域和未核验的字段不会伪装成已发布业务数据。" };
    await writeFile(path.join(folder, "manifest.json.tmp"), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    await rename(path.join(folder, "manifest.json.tmp"), path.join(folder, "manifest.json"));
  }
  async function collectSource(source: Pick<SourceResult, "name" | "endpoint" | "condition">) {
    if (stopping) throw new Error("worker 正在停止。");
    const failureKey = source.name.startsWith("ads-") ? `${source.endpoint}:${source.condition.marketId}` : source.endpoint;
    const priorFailure = failedEndpoints.get(failureKey);
    if (priorFailure) {
      completed.push({ ...source, status: "skipped", pages: 0, total: null, error: priorFailure });
      return;
    }
    try {
      const result = await collectGerpgoPages(client, source.endpoint, source.condition, async page => {
      if (stopping) throw new Error("worker 正在停止。");
      updateRefreshTask(task.id, task.lease, "running", `${source.name}：第 ${page.page} 页 / ${page.total} 条`);
      // Server-side evidence only; never send entire raw pages or credentials to the browser.
      await writeFile(path.join(folder, `${source.name}-${page.page}.json`), JSON.stringify(page), { mode: 0o600 });
      if (source.name === "shops") sellers.push(...page.rows);
      });
      completed.push({ ...source, ...result, status: "completed" });
    } catch (error) {
      if (stopping) throw error;
      const safe = error instanceof GerpgoConnectionError ? error.message : "该数据域采集未完成，请检查 worker 和数据卷权限。";
      // Only permission/rate/provider failures suppress remaining scopes of the same endpoint.
      if (!source.name.startsWith("ads-") || error instanceof GerpgoConnectionError && [401, 403, 429].includes(error.httpStatus)) failedEndpoints.set(failureKey, safe);
      completed.push({ ...source, status: "failed", pages: 0, total: null, error: safe });
    }
    await saveManifest();
  }
  for (const source of sources) {
    await collectSource(source);
    if (source.name === "shops") {
      storeScope = resolveGerpgoStoreScope(sellers, environment.GERPGO_STORE_NAME);
      await saveManifest();
    }
  }
  const shopComplete = completed.find(source => source.name === "shops")?.status === "completed";
  if (task.includeSupplemental) {
    for (const source of gerpgoSupplementalSources(scopes, shopComplete ? storeScope!.marketIds : [])) await collectSource(source);
    if (!shopComplete || !storeScope?.marketIds.length) completed.push({ name: "ads", endpoint: "/operation/ads/adsAsinAnalytical/page", condition: {}, status: "skipped", pages: 0, total: null, error: "店铺采集未完成或没有已授权站点，无法安排逐站点广告采集。" });
  }
  await saveManifest(completed.some(source => source.status !== "completed") ? "incomplete" : "collected");
  const missingCore = completed.filter(source => sources.some(core => core.name === source.name) && source.status !== "completed");
  const missingAds = completed.filter(source => source.name.startsWith("ads") && source.status !== "completed");
  if (missingCore.length || missingAds.length) throw new GerpgoConnectionError(`销售或广告采集未完成：${missingCore.length} 个基础范围、${missingAds.length} 个广告范围。成功分页已保留，请查看采集明细；旧报告未修改。`);
  const requestFile = path.join(folder, "prepare-request.json");
  await writeFile(requestFile, JSON.stringify({ sourceTaskId: task.id }), { mode: 0o600 });
  await runPythonJob(automationRoot(), "preview-gerpgo", requestFile);
}
async function main() {
configureGerpgoEnvironmentSchedule();
while (!stopping) {
  // Reconcile manually published WPS batches before scheduling their next update.
  for (const waiting of listRefreshTasks().filter(t => t.kind === "wps_inventory" && t.status === "awaiting_review" && t.batchId)) {
    if ((await getImportBatch(waiting.batchId!)).status === "published") completeReviewedSyncTask(waiting.id);
  }
  enqueueDueSyncTasks({ gerpgo: getGerpgoSettingsStatus().configured && Boolean(process.env.GERPGO_STORE_NAME?.trim()), wps_inventory: getWpsStatus().authorized });
  const task = claimRefreshTask();
  if (!task) { await pause(5000); continue; }
  const db = new DatabaseSync(shipmentPlanDbPath()), started = new Date().toISOString();
  const runId = db.prepare("INSERT INTO runs(job_name,status,started_at,summary_json) VALUES(?,'running',?,?)").run("worker-" + task.kind, started, JSON.stringify({ taskId: task.id })).lastInsertRowid;
  const heartbeat = setInterval(() => {
    try { updateRefreshTask(task.id, task.lease, "running"); }
    catch { stopping = true; }
  }, 15000);
  try {
    let wpsResult: { status: string; batchId: string; reason?: string } | null = null;
    let automaticallyPublished = false;
    if (task.kind === "gerpgo") await collectGerpgoTask(task);
    else if (task.kind === "gerpgo_publish") {
      const requestFile = runtimePath("incoming", "gerpgo", task.request!.sourceTaskId, `approval-${task.id}.json`);
      await writeFile(requestFile, JSON.stringify({ ...task.request, taskId: task.id, lease: task.lease }), { mode: 0o600 });
      await runPythonJob(automationRoot(), "publish-gerpgo", requestFile);
      completeReviewedSyncTask(task.request!.sourceTaskId);
    } else if (task.kind === "wps_inventory") {
      updateRefreshTask(task.id, task.lease, "running", "正在下载并校验 WPS 库存文件");
      const batch = await receiveWpsInventoryDownload(await downloadWpsInventory(task.id));
      updateRefreshTask(task.id, task.lease, "running", "WPS 文件已解析，正在检查自动发布条件", "", { batchId: batch.batchId });
      const settings = listSyncSchedules().find(s => s.key === "wps_inventory")!;
      wpsResult = task.scheduled && settings.enabled && settings.autoPublish ? await autoPublishWpsInventory(batch.batchId, task.id, task.lease)
        : { status: "awaiting_review", batchId: batch.batchId, reason: "请在上传批次中确认 WPS 库存预览；尚未发布" };
    } else await runFullDataRefresh();
    const preview = task.kind === "gerpgo" ? await readGerpgoPreview(task.id) : null;
    if (preview && task.scheduled && !preview.blocked && !preview.differences.some(d => d.protected)) {
      const settings = listSyncSchedules().find(s => s.key === "gerpgo")!, previous = await currentPerformance();
      const candidate = JSON.parse(await readFile(runtimePath("incoming", "gerpgo", task.id, "candidate.json"), "utf8"));
      const policy = getGerpgoAutoSyncConfiguration();
      const reviewed = previous?.publication?.initialReview?.storeScope ?? (previous?.publication?.actor === "shared-account" ? previous.storeScope : null);
      const scope = candidate.storeScope;
      const authorized = policy.managed && policy.enabled ? previous?.storeScope ?? scope : reviewed;
      const sameScope = authorized && scope && authorized.storeName === scope.storeName && authorized.serverId === scope.serverId && Array.isArray(authorized.marketIds) && authorized.marketIds.join(",") === scope.marketIds.join(",");
      if (settings.enabled && settings.autoPublish && sameScope) {
        const requestFile = runtimePath("incoming", "gerpgo", task.id, "automatic-publication.json");
        await writeFile(requestFile, JSON.stringify({ sourceTaskId: task.id, previewHash: preview.previewHash, automatic: true, taskId: task.id, lease: task.lease }), { mode: 0o600 });
        await runPythonJob(automationRoot(), "publish-gerpgo", requestFile); automaticallyPublished = true;
      }
    }
    const status = wpsResult?.status ?? (automaticallyPublished ? "completed" : preview ? preview.blocked ? "awaiting_mapping" : "awaiting_review" : "completed");
    updateRefreshTask(task.id, task.lease, status, wpsResult ? wpsResult.reason || "WPS 库存已校验并发布；海外库存未被 WPS 规划值覆盖" : automaticallyPublished ? "定时采集校验通过，已自动发布经营数据" : preview ? preview.blocked ? "采集完成，存在映射或缺失字段，未发布；请查看预览" : "差异预览就绪，请人工对账后确认发布" : "整批报告已发布；请刷新运营页面");
    db.prepare("UPDATE runs SET status=?,finished_at=?,summary_json=? WHERE id=?").run(status, new Date().toISOString(), JSON.stringify({ taskId: task.id }), runId);
  } catch (error) {
    const safe = error instanceof GerpgoConnectionError || error instanceof WpsError ? error.message : task.kind === "wps_inventory" ? "WPS 同步或发布失败；旧数据保留，请检查授权、任务预览和数据卷。" : task.kind === "gerpgo" ? "积加采集未完成；旧报告保留，请检查接口权限与 worker。" : task.kind === "gerpgo_publish" ? "积加审核发布失败；可能预览过期或报告基线变化，请检查运营异常记录并重新对账。" : "报告重建失败，请检查运营任务异常记录。";
    try { updateRefreshTask(task.id, task.lease, "failed", "任务失败，请核对当前版本；报告不会被部分覆盖", safe); } catch { /* Expired lease is already marked interrupted. */ }
    db.prepare("UPDATE runs SET status='failed',finished_at=?,error_text=? WHERE id=?").run(new Date().toISOString(), safe, runId);
  } finally { clearInterval(heartbeat); db.close(); }
}

}
if (require.main === module) {
  void main().catch(() => { console.error("数据 worker 已停止，请检查运营数据库与容器配置。"); process.exitCode = 1; });
}
