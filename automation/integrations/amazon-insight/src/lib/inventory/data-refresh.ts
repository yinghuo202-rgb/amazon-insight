import { spawn } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";

import { automationRoot, runtimePath, sourceDataRoot } from "@/lib/inventory/paths";
import { shipmentPlanDbPath } from "@/lib/inventory/shipment-plan";
import { checkGerpgoConnection, GerpgoConnectionError, resolveGerpgoEnvironment } from "@/lib/inventory/gerpgo";
import { publishedReportPath } from "@/lib/inventory/report-version";

export type DataRefreshSource = {
  key: string;
  label: string;
  relativePath: string;
  exists: boolean;
  kind: "file" | "folder";
  modifiedAt: string | null;
  fileCount: number;
  required: boolean;
};

export type DataRefreshReport = {
  key: string;
  label: string;
  relativePath: string;
  exists: boolean;
  modifiedAt: string | null;
  size: number;
};

export type DataRefreshRun = {
  id: number;
  jobName: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  error: string;
};

export type DataRefreshStatus = {
  checkedAt: string;
  sources: DataRefreshSource[];
  reports: DataRefreshReport[];
  runs: DataRefreshRun[];
  exceptions: Array<{ category: string; severity: string; count: number }>;
  summary: { sourceCount: number; missingCount: number; reportCount: number; failedRunCount: number; openExceptionCount: number };
};

const reportDefinitions = [
  ["inventory_us", "美国库存与运营", "runtime/reports/inventory_dashboard.json"],
  ["inventory_ca", "加拿大库存与运营", "runtime/reports/inventory_dashboard.ca.json"],
  ["purchase", "采购计划", "runtime/reports/purchase_plan.json"],
  ["documents", "订单与单据主数据", "runtime/reports/document_master.json"],
  ["products", "产品与图片目录", "runtime/reports/product_catalog.json"],
  ["content", "Listing 与美工任务", "runtime/reports/content_workflow.json"],
  ["research", "新品调研", "runtime/reports/new_product_research.json"],
] as const;

// A configured share link is not proof of download permission or a successful sync.
export function getOnlineSourceConfiguration(env: Record<string, string | undefined> = process.env) {
  return [
    { key: "inventory", label: "WPS 库存规划", variable: "STORE_OPS_WPS_INVENTORY_URL", owns: "国内库存、订单、在途与规划参数" },
    { key: "research", label: "WPS 新品资料", variable: "STORE_OPS_WPS_RESEARCH_URL", owns: "新品成本、箱规、包装重量与调研记录" },
  ].map(source => {
    const value = env[source.variable]?.trim();
    let url: string | null = null;
    if (value) {
      try {
        const parsed = new URL(value);
        if (parsed.protocol === "https:" && ["www.kdocs.cn", "kdocs.cn"].includes(parsed.hostname) && !parsed.username && !parsed.password && /^\/l\/[a-zA-Z0-9]+\/?$/.test(parsed.pathname) && !parsed.search && !parsed.hash) url = parsed.href;
      } catch { /* Invalid configuration is surfaced, never used as a link. */ }
    }
    return { ...source, url, status: value ? url ? source.key === "inventory" ? "分享链接已配置；请在同步任务中完成 WPS 授权并开启定时同步" : "分享链接已配置；新品自动同步尚未启用" : "分享链接无效，请配置 HTTPS 金山文档分享地址" : "尚未配置分享链接" };
  });
}

export async function getDataRefreshStatus(): Promise<DataRefreshStatus> {
  const root = automationRoot();
  const config = JSON.parse(await readFile(path.join(root, "config", "project.json"), "utf8")) as Record<string, unknown>;
  const dataRoot = sourceDataRoot(String(config.data_root ?? "../"));
  const inventory = (config.inventory_dashboard ?? {}) as Record<string, unknown>;
  const markets = (inventory.markets ?? {}) as Record<string, Record<string, unknown>>;
  const documentSources = (inventory.document_master_sources ?? {}) as Record<string, unknown>;
  const configuredSources = Array.isArray(config.sources) ? config.sources as Array<Record<string, unknown>> : [];
  const definitions = new Map<string, { label: string; required: boolean }>();
  const add = (relativePath: unknown, label: string, required = true) => {
    if (typeof relativePath !== "string" || !relativePath.trim()) return;
    definitions.set(relativePath.replaceAll("\\", "/"), { label, required });
  };
  for (const source of configuredSources) add(source.path, String(source.name ?? source.path), Boolean(source.canonical));
  add(inventory.master_workbook, "库存规划主表");
  add(inventory.product_details_workbook, "产品明细表");
  add(inventory.new_product_research_workbook, "新品调研表", false);
  add(inventory.sales_workbook, "月度销量主表");
  add(inventory.listing_workbook, "Listing 主表");
  add(inventory.creative_brief_folder, "历史美工对接目录", false);
  add(inventory.advertising_folder, "美国广告数据目录");
  add(markets.CA?.advertising_folder, "加拿大广告数据目录");
  add(documentSources.purchase_order_root, "采购订单目录");
  add(documentSources.shipment_root, "历史发货目录", false);
  add(documentSources.shipment_register_workbook, "出货记录");

  const sources = await Promise.all([...definitions].map(async ([relativePath, definition], index) => {
    const absolute = path.resolve(dataRoot, relativePath);
    const info = await stat(absolute).catch(() => null);
    if (!info) return { key: `source-${index}`, label: definition.label, relativePath, exists: false, kind: "file" as const, modifiedAt: null, fileCount: 0, required: definition.required };
    if (info.isDirectory()) {
      const folder = await folderSummary(absolute);
      return { key: `source-${index}`, label: definition.label, relativePath, exists: true, kind: "folder" as const, modifiedAt: folder.modifiedAt, fileCount: folder.fileCount, required: definition.required };
    }
    return { key: `source-${index}`, label: definition.label, relativePath, exists: true, kind: "file" as const, modifiedAt: info.mtime.toISOString(), fileCount: 1, required: definition.required };
  }));

  const reports = await Promise.all([...reportDefinitions, ["profitability", "月度经营与利润", "runtime/reports/profitability.json"] as const].map(async ([key, label, relativePath]) => {
    const selected = await publishedReportPath(runtimePath(relativePath.replace(/^runtime\//, "")));
    const info = await stat(selected).catch(() => null);
    return { key, label, relativePath, exists: Boolean(info), modifiedAt: info?.mtime.toISOString() ?? null, size: info?.size ?? 0 };
  }));
  const { runs, exceptions } = operationHistory();
  const missingCount = sources.filter((source) => source.required && !source.exists).length;
  return {
    checkedAt: new Date().toISOString(), sources: sources.sort((a, b) => Number(b.required) - Number(a.required) || a.label.localeCompare(b.label, "zh-CN")), reports, runs, exceptions,
    summary: {
      sourceCount: sources.filter((source) => source.exists).length,
      missingCount,
      reportCount: reports.filter((report) => report.exists).length,
      failedRunCount: runs.filter((run) => run.status === "failed").length,
      openExceptionCount: exceptions.reduce((sum, item) => sum + item.count, 0),
    },
  };
}

export async function runFullDataRefresh() {
  const root = automationRoot();
  const before = await getDataRefreshStatus();
  if (before.summary.missingCount) throw new Error(`存在 ${before.summary.missingCount} 个必需数据源缺失，请先补齐后再重建。`);
  const commands = ["rebuild-reports"];
  const results = [];
  for (const command of commands) results.push(await runPythonJob(root, command));
  return { status: "completed", commands: results, snapshot: await getDataRefreshStatus() };
}

export async function runGerpgoConnectionCheck() {
  let database: DatabaseSync;
  let runId: number | bigint;
  const startedAt = new Date().toISOString();
  try {
    database = new DatabaseSync(shipmentPlanDbPath());
    database.exec("PRAGMA busy_timeout=5000; BEGIN IMMEDIATE");
    const last = database.prepare("SELECT started_at FROM runs WHERE job_name='gerpgo-connection-check' ORDER BY id DESC LIMIT 1").get();
    if (last && Date.now() - Date.parse(String(last.started_at)) < 10000) throw new GerpgoConnectionError("请等待 10 秒后再检查积加连接。", 429);
    runId = database.prepare("INSERT INTO runs(job_name,status,started_at) VALUES('gerpgo-connection-check','running',?)").run(startedAt).lastInsertRowid;
    database.exec("COMMIT");
  } catch (error) {
    // No provider call is made if audit persistence is unavailable.
    try { database!.exec("ROLLBACK"); } catch { /* May not have opened a transaction. */ }
    try { database!.close(); } catch { /* May not have opened the database. */ }
    throw error instanceof GerpgoConnectionError ? error : new GerpgoConnectionError("无法保存连接检查记录，请检查 NAS 数据目录写入权限。", 500);
  }
  function finish(status: string, summary: unknown, errorMessage: string | null) {
    const finishedAt = new Date().toISOString();
    try {
      database.exec("BEGIN IMMEDIATE");
      database.prepare("UPDATE runs SET status=?,finished_at=?,summary_json=?,error_text=? WHERE id=?").run(status, finishedAt, JSON.stringify(summary), errorMessage, runId);
      if (errorMessage) {
        const category = "gerpgo_connection";
        const fingerprint = createHash("sha256").update(JSON.stringify([category, "gerpgo", null, null, null])).digest("hex");
        database.prepare("INSERT INTO exceptions(first_run_id,last_run_id,fingerprint,category,severity,source_name,details_json,created_at,updated_at) VALUES(?,?,?,?,'error','gerpgo',?,?,?) ON CONFLICT(fingerprint) DO UPDATE SET last_run_id=excluded.last_run_id,details_json=excluded.details_json,review_status='open',occurrences=exceptions.occurrences+1,updated_at=excluded.updated_at").run(runId, runId, fingerprint, category, JSON.stringify({ message: errorMessage }), finishedAt, finishedAt);
      } else {
        database.prepare("UPDATE exceptions SET review_status='resolved',last_run_id=?,updated_at=? WHERE category='gerpgo_connection' AND source_name='gerpgo' AND review_status='open'").run(runId, finishedAt);
      }
      database.exec("COMMIT");
    } catch {
      try { database.exec("ROLLBACK"); } catch { /* Preserve a clear persistence failure. */ }
      throw new GerpgoConnectionError("连接检查记录保存失败，请检查 NAS 数据目录权限；尚不能确认本次结果。", 500);
    }
  }
  try {
    let result;
    try { result = await checkGerpgoConnection(resolveGerpgoEnvironment()); }
    catch (error) {
      const safe = error instanceof GerpgoConnectionError ? error : new GerpgoConnectionError("积加连接检查失败，请检查服务端配置。");
      finish("failed", null, safe.message);
      throw safe;
    }
    finish(result.marketAccess ? "completed" : "failed", result, result.marketAccess ? null : result.message);
    return result;
  } finally { database.close(); }
}

export async function runPythonJob(root: string, command: string, requestFile?: string) {
  const executable = process.env.STORE_OPS_PYTHON || "python";
  const args = ["-m", "store_ops", "--config", path.join(root, "config", "project.json"), command, ...(requestFile ? ["--request", requestFile] : [])];
  const startedAt = new Date().toISOString();
  return new Promise<{ command: string; startedAt: string; finishedAt: string; output: string }>((resolve, reject) => {
    const child = spawn(executable, args, { cwd: root, windowsHide: true, env: { ...process.env, PYTHONPATH: path.join(root, "src") } });
    const timer = setTimeout(() => child.kill("SIGKILL"), 30 * 60 * 1000);
    let output = "";
    child.stdout.on("data", (chunk) => { output = `${output}${String(chunk)}`.slice(-16000); });
    child.stderr.on("data", (chunk) => { output = `${output}${String(chunk)}`.slice(-16000); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => { clearTimeout(timer); if (code === 0) resolve({ command, startedAt, finishedAt: new Date().toISOString(), output: output.trim() }); else reject(new Error(`${command} 执行失败（退出码 ${code}）：${output.slice(-1500)}`)); });
  });
}

async function folderSummary(root: string) {
  let fileCount = 0;
  let latest = 0;
  const queue = [root];
  while (queue.length) {
    const current = queue.shift()!;
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) queue.push(target);
      else if (entry.isFile() && !entry.name.startsWith("~$")) {
        fileCount += 1;
        const info = await stat(target).catch(() => null);
        latest = Math.max(latest, info?.mtimeMs ?? 0);
      }
    }
  }
  return { fileCount, modifiedAt: latest ? new Date(latest).toISOString() : null };
}

function operationHistory() {
  const database = new DatabaseSync(shipmentPlanDbPath());
  try {
    const runs = database.prepare("SELECT id,job_name,status,started_at,finished_at,error_text FROM runs ORDER BY id DESC LIMIT 20").all().map((row) => {
      const item = row as Record<string, unknown>;
      return { id: Number(item.id), jobName: String(item.job_name), status: String(item.status), startedAt: String(item.started_at), finishedAt: item.finished_at ? String(item.finished_at) : null, error: String(item.error_text ?? "") };
    });
    const exceptions = database.prepare("SELECT category,severity,COUNT(*) AS count FROM exceptions WHERE review_status='open' GROUP BY category,severity ORDER BY count DESC").all().map((row) => {
      const item = row as Record<string, unknown>;
      return { category: String(item.category), severity: String(item.severity), count: Number(item.count) };
    });
    return { runs, exceptions };
  } finally { database.close(); }
}
