import { mkdir, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { runFullDataRefresh, runPythonJob } from "@/lib/inventory/data-refresh";
import { automationRoot, runtimePath } from "@/lib/inventory/paths";
import { readGerpgoPreview } from "@/lib/inventory/gerpgo-preview";
import { shipmentPlanDbPath } from "@/lib/inventory/shipment-plan";
import { claimRefreshTask, updateRefreshTask } from "@/lib/inventory/refresh-task-store";
import { collectGerpgoPages, createGerpgoClient, gerpgoSupplementalSources, GerpgoConnectionError, resolveGerpgoEnvironment, resolveGerpgoStoreScope } from "@/lib/inventory/gerpgo";

let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

async function collect(task: NonNullable<ReturnType<typeof claimRefreshTask>>) {
  const environment = resolveGerpgoEnvironment();
  if (!environment.GERPGO_STORE_NAME?.trim()) throw new GerpgoConnectionError("请配置 GERPGO_STORE_NAME；禁止自动汇总全部授权店铺。", 422);
  const client = await createGerpgoClient(environment);
  const folder = runtimePath("incoming", "gerpgo", task.id);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const now = new Date(), scopes = [];
  for (let offset = 6; offset >= 0; offset--) {
    const begin = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    const end = offset === 0 ? now : new Date(Date.UTC(begin.getUTCFullYear(), begin.getUTCMonth() + 1, 0));
    scopes.push({ name: "performance-" + begin.toISOString().slice(0, 7), endpoint: "/operation/sts/productAnalyzeMultiIndex/page", condition: { beginDate: begin.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10), showCurrencyType: "YUAN" } });
  }
  const sources = [
    { name: "shops", endpoint: "/middle/base/market/page", condition: {} },
    { name: "products", endpoint: "/purchase/goods/product/page", condition: {} },
    ...scopes,
    { name: "fba", endpoint: "/purchase/store/fbaInventory/page/V2", condition: {} },
  ];
  type SourceResult = { name: string; endpoint: string; condition: Record<string, unknown>; status: "completed" | "failed" | "skipped"; pages: number; total: number | null; error?: string; totalUnit?: "markets" };
  const completed: SourceResult[] = [], sellers: Record<string, unknown>[] = [], failedEndpoints = new Map<string, string>();
  let storeScope: ReturnType<typeof resolveGerpgoStoreScope> | undefined;
  async function saveManifest(status = "collecting") {
    const manifest = { schemaVersion: 1, taskId: task.id, source: "gerpgo", capturedAt: now.toISOString(), businessAsOf: null, status, sources: completed, storeScope,
      collectionMode: task.includeSupplemental ? "full" : "core", deferredDomains: task.includeSupplemental ? [] : ["ads", "returns", "storage"],
      reason: "全部原始分页保存在服务端；未完成的数据域和未核验的字段不会伪装成已发布业务数据。" };
    await writeFile(path.join(folder, "manifest.json.tmp"), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    await rename(path.join(folder, "manifest.json.tmp"), path.join(folder, "manifest.json"));
  }
  async function collectSource(source: typeof sources[number]) {
    if (stopping) throw new Error("worker 正在停止。");
    const priorFailure = failedEndpoints.get(source.endpoint);
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
      failedEndpoints.set(source.endpoint, safe);
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
  if (missingCore.length) throw new GerpgoConnectionError(`基础数据采集未完成：${missingCore.map(source => source.name).join("、")}。其他成功分页已保留，请查看采集明细；旧报告未修改。`);
  const requestFile = path.join(folder, "prepare-request.json");
  await writeFile(requestFile, JSON.stringify({ sourceTaskId: task.id }), { mode: 0o600 });
  await runPythonJob(automationRoot(), "preview-gerpgo", requestFile);
}
async function main() {
while (!stopping) {
  const task = claimRefreshTask();
  if (!task) { await pause(5000); continue; }
  const db = new DatabaseSync(shipmentPlanDbPath()), started = new Date().toISOString();
  const runId = db.prepare("INSERT INTO runs(job_name,status,started_at,summary_json) VALUES(?,'running',?,?)").run("worker-" + task.kind, started, JSON.stringify({ taskId: task.id })).lastInsertRowid;
  const heartbeat = setInterval(() => {
    try { updateRefreshTask(task.id, task.lease, "running"); }
    catch { stopping = true; }
  }, 15000);
  try {
    if (task.kind === "gerpgo") await collect(task);
    else if (task.kind === "gerpgo_publish") {
      const requestFile = runtimePath("incoming", "gerpgo", task.request!.sourceTaskId, `approval-${task.id}.json`);
      await writeFile(requestFile, JSON.stringify({ ...task.request, taskId: task.id, lease: task.lease }), { mode: 0o600 });
      await runPythonJob(automationRoot(), "publish-gerpgo", requestFile);
    } else await runFullDataRefresh();
    const preview = task.kind === "gerpgo" ? await readGerpgoPreview(task.id) : null;
    const status = preview ? preview.blocked ? "awaiting_mapping" : "awaiting_review" : "completed";
    updateRefreshTask(task.id, task.lease, status, preview ? preview.blocked ? "采集完成，存在映射或缺失字段，未发布；请查看预览" : "差异预览就绪，请人工对账后确认发布" : "整批报告已发布；请刷新运营页面");
    db.prepare("UPDATE runs SET status=?,finished_at=?,summary_json=? WHERE id=?").run(status, new Date().toISOString(), JSON.stringify({ taskId: task.id }), runId);
  } catch (error) {
    const safe = error instanceof GerpgoConnectionError ? error.message : task.kind === "gerpgo" ? "积加采集未完成；旧报告保留，请检查接口权限与 worker。" : task.kind === "gerpgo_publish" ? "积加审核发布失败；可能预览过期或报告基线变化，请检查运营异常记录并重新对账。" : "报告重建失败，请检查运营任务异常记录。";
    try { updateRefreshTask(task.id, task.lease, "failed", "任务失败，请核对当前版本；报告不会被部分覆盖", safe); } catch { /* Expired lease is already marked interrupted. */ }
    db.prepare("UPDATE runs SET status='failed',finished_at=?,error_text=? WHERE id=?").run(new Date().toISOString(), safe, runId);
  } finally { clearInterval(heartbeat); db.close(); }
}

}
void main().catch(() => { console.error("数据 worker 已停止，请检查运营数据库与容器配置。"); process.exitCode = 1; });
