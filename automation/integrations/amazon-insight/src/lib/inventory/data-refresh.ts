import { spawn } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { automationRoot } from "@/lib/inventory/document-exports";
import { runtimePath, sourceDataRoot } from "@/lib/inventory/paths";
import { shipmentPlanDbPath } from "@/lib/inventory/shipment-plan";

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

  const reports = await Promise.all(reportDefinitions.map(async ([key, label, relativePath]) => {
    const info = await stat(runtimePath(relativePath.replace(/^runtime\//, ""))).catch(() => null);
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
  const commands = ["audit-skus", "build-product-catalog", "build-content-workflow", "build-new-product-research", "build-document-master", "build-inventory-dashboard-data"];
  const results = [];
  for (const command of commands) results.push(await runPythonJob(root, command));
  return { status: "completed", commands: results, snapshot: await getDataRefreshStatus() };
}

async function runPythonJob(root: string, command: string) {
  const executable = process.env.STORE_OPS_PYTHON || "python";
  const args = ["-m", "store_ops", "--config", path.join(root, "config", "project.json"), command];
  const startedAt = new Date().toISOString();
  return new Promise<{ command: string; startedAt: string; finishedAt: string; output: string }>((resolve, reject) => {
    const child = spawn(executable, args, { cwd: root, windowsHide: true, env: { ...process.env, PYTHONPATH: path.join(root, "src") } });
    let output = "";
    child.stdout.on("data", (chunk) => { output = `${output}${String(chunk)}`.slice(-16000); });
    child.stderr.on("data", (chunk) => { output = `${output}${String(chunk)}`.slice(-16000); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve({ command, startedAt, finishedAt: new Date().toISOString(), output: output.trim() }) : reject(new Error(`${command} 执行失败（退出码 ${code}）：${output.slice(-1500)}`)));
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
