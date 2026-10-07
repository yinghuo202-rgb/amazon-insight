import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { automationRoot } from "@/lib/inventory/paths";
import { runtimePath } from "@/lib/inventory/paths";

export type ImportFilePreview = {
  name: string;
  size: number;
  sha256: string;
  type: string;
  label: string;
  publishable: boolean;
  sheets?: string[];
  preview?: Record<string, unknown>;
  error?: string;
};

export type ImportBatch = {
  schemaVersion: 1;
  batchId: string;
  createdAt: string;
  status: "ready" | "needs_review" | "published";
  summary: { fileCount: number; recognizedCount: number; unknownCount: number; publishableCount: number };
  warnings: string[];
  files: ImportFilePreview[];
  publishedAt?: string;
  dataVersion?: string;
  updatedReports?: string[];
  stagedFiles?: string[];
};

export type DataVersion = { version: string; createdAt: string; fileCount: number };

const MAX_FILE_SIZE = 300 * 1024 * 1024;
const MAX_BATCH_SIZE = 900 * 1024 * 1024;
const MAX_CHUNK_SIZE = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([".xlsx", ".xlsm"]);

function uploadsRoot() {
  return path.resolve(process.env.STORE_OPS_UPLOAD_ROOT?.trim() || runtimePath("uploads"));
}

function snapshotsRoot() {
  return path.resolve(process.env.STORE_OPS_SNAPSHOT_ROOT?.trim() || runtimePath("snapshots"));
}

function safeBatchId(value: string) {
  if (!/^batch-[a-zA-Z0-9-]{8,80}$/.test(value)) throw new Error("上传批次编号不正确。");
  return value;
}

function safeFilename(value: string) {
  const base = path.basename(value).replaceAll(/[^\p{L}\p{N}._()\- ]/gu, "_").slice(0, 180);
  if (!base || !ALLOWED_EXTENSIONS.has(path.extname(base).toLowerCase())) throw new Error(`不支持的文件：${value}`);
  return base;
}

type UploadPlan = { batchId: string; files: Array<{ index: number; name: string; serverName: string; size: number }> };

export async function initializeChunkedImport(inputFiles: Array<{ name: string; size: number }>): Promise<UploadPlan> {
  if (!inputFiles.length) throw new Error("请选择至少一个 Excel 文件。");
  if (inputFiles.reduce((sum, file) => sum + file.size, 0) > MAX_BATCH_SIZE) throw new Error("单次上传总大小不能超过 900 MB。");
  const batchId = `batch-${new Date().toISOString().replaceAll(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;
  const sourceDirectory = path.join(uploadsRoot(), batchId, "source");
  await mkdir(sourceDirectory, { recursive: true });
  const used = new Set<string>();
  const files = inputFiles.map((file, index) => {
    if (file.size <= 0 || file.size > MAX_FILE_SIZE) throw new Error(`${file.name} 必须小于 300 MB。`);
    let serverName = safeFilename(file.name);
    if (used.has(serverName)) serverName = `${path.parse(serverName).name}-${randomUUID().slice(0, 6)}${path.extname(serverName)}`;
    used.add(serverName);
    return { index, name: file.name, serverName, size: file.size };
  });
  const plan = { batchId, files };
  await writeFile(path.join(uploadsRoot(), batchId, "upload.json"), JSON.stringify(plan), { flag: "wx" });
  return plan;
}

export async function appendImportChunk(batchId: string, fileIndex: number, offset: number, content: Buffer) {
  if (!content.length || content.length > MAX_CHUNK_SIZE) throw new Error("上传分片大小不正确。");
  const directory = path.join(uploadsRoot(), safeBatchId(batchId));
  const plan = JSON.parse(await readFile(path.join(directory, "upload.json"), "utf8")) as UploadPlan;
  const file = plan.files.find((item) => item.index === fileIndex);
  if (!file) throw new Error("上传文件编号不存在。");
  const target = path.join(directory, "source", file.serverName);
  const currentSize = await stat(target).then((info) => info.size).catch(() => 0);
  if (currentSize !== offset) throw new Error(`上传位置不一致，请重试（当前 ${currentSize}，请求 ${offset}）。`);
  if (currentSize + content.length > file.size) throw new Error("上传内容超过文件声明大小。");
  await appendFile(target, content, { flag: "a" });
  return { received: currentSize + content.length, size: file.size };
}

export async function finalizeChunkedImport(batchId: string) {
  const directory = path.join(uploadsRoot(), safeBatchId(batchId));
  const plan = JSON.parse(await readFile(path.join(directory, "upload.json"), "utf8")) as UploadPlan;
  for (const file of plan.files) {
    const info = await stat(path.join(directory, "source", file.serverName)).catch(() => null);
    if (!info || info.size !== file.size) throw new Error(`${file.name} 尚未完整上传。`);
  }
  return runImporter("inspect", directory);
}

export async function publishImportBatch(batchId: string) {
  const batchDirectory = path.join(uploadsRoot(), safeBatchId(batchId));
  const manifest = await readManifest(batchDirectory);
  if (manifest.status === "published") throw new Error("该批次已经发布。");
  if (!manifest.summary.publishableCount) throw new Error("该批次没有可以发布的数据。");
  await mkdir(snapshotsRoot(), { recursive: true });
  return runImporter("publish", batchDirectory, ["--reports-dir", runtimePath("reports"), "--snapshots-dir", snapshotsRoot()]);
}

export async function listImportBatches() {
  const root = uploadsRoot();
  await mkdir(root, { recursive: true });
  const entries = await readdir(root, { withFileTypes: true });
  const batches = await Promise.all(entries.filter((entry) => entry.isDirectory() && entry.name.startsWith("batch-")).map((entry) => readManifest(path.join(root, entry.name)).catch(() => null)));
  return batches.filter((batch): batch is ImportBatch => Boolean(batch)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 20);
}

export async function listDataVersions(): Promise<DataVersion[]> {
  const root = snapshotsRoot();
  await mkdir(root, { recursive: true });
  const entries = await readdir(root, { withFileTypes: true });
  return Promise.all(entries.filter((entry) => entry.isDirectory() && entry.name.startsWith("data-")).map(async (entry) => {
    const reports = await readdir(path.join(root, entry.name, "reports")).catch(() => []);
    return { version: entry.name, createdAt: versionDate(entry.name), fileCount: reports.filter((name) => name.endsWith(".json")).length };
  })).then((versions) => versions.sort((left, right) => right.version.localeCompare(left.version)).slice(0, 20));
}

export async function restoreDataVersion(version: string) {
  if (!/^data-\d{8}-\d{6}-[a-zA-Z0-9-]{1,20}$/.test(version)) throw new Error("数据版本编号不正确。");
  return runPythonJson(["-m", "store_ops.uploaded_data", "restore", "--version", version, "--reports-dir", runtimePath("reports"), "--snapshots-dir", snapshotsRoot()]);
}

async function readManifest(batchDirectory: string): Promise<ImportBatch> {
  return JSON.parse(await readFile(path.join(batchDirectory, "manifest.json"), "utf8")) as ImportBatch;
}

async function runImporter(command: "inspect" | "publish", batchDirectory: string, extraArgs: string[] = []) {
  const executable = process.env.STORE_OPS_PYTHON || "python";
  const root = automationRoot();
  const args = ["-m", "store_ops.uploaded_data", command, "--batch-dir", batchDirectory, ...extraArgs];
  return new Promise<ImportBatch>((resolve, reject) => {
    const child = spawn(executable, args, { cwd: root, windowsHide: true, env: { ...process.env, PYTHONPATH: path.join(root, "src") } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout = `${stdout}${String(chunk)}`.slice(-500_000); });
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(-20_000); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`表格解析失败：${stderr.slice(-1500) || `退出码 ${code}`}`));
      try { resolve(JSON.parse(stdout) as ImportBatch); }
      catch { reject(new Error("表格解析结果格式不正确。")); }
    });
  });
}

async function runPythonJson(args: string[]) {
  const executable = process.env.STORE_OPS_PYTHON || "python";
  const root = automationRoot();
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const child = spawn(executable, args, { cwd: root, windowsHide: true, env: { ...process.env, PYTHONPATH: path.join(root, "src") } });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { stdout = `${stdout}${String(chunk)}`.slice(-200_000); });
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(-20_000); });
    child.on("error", reject);
    child.on("close", (code) => { if (code !== 0) reject(new Error(stderr.slice(-1500) || `操作失败（${code}）`)); else { try { resolve(JSON.parse(stdout)); } catch { reject(new Error("操作结果格式不正确。")); } } });
  });
}

function versionDate(version: string) {
  const match = version.match(/^data-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z` : new Date(0).toISOString();
}
