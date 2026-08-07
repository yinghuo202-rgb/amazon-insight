import { randomBytes } from "node:crypto";
import type { Dirent } from "node:fs";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { runtimePath } from "@/lib/inventory/paths";
import { shipmentPlanDbPath } from "@/lib/inventory/shipment-plan";

export type DownloadCategory = "documents" | "creative" | "purchase" | "advertising";

export type DownloadHistoryItem = {
  id: string;
  category: DownloadCategory;
  kind: "shipment" | "declaration" | "creative" | "purchase" | "advertising";
  filename: string;
  exportId: string;
  createdAt: string;
  size: number;
  market: "US" | "CA" | "BOTH";
  downloadUrl: string;
  downloadCount: number;
  lastDownloadedAt: string | null;
};

const eventSchema = `
CREATE TABLE IF NOT EXISTS download_events_v1 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  export_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  downloaded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_download_events_v1_file
ON download_events_v1(category,export_id,filename,downloaded_at DESC);
`;

const roots: Record<DownloadCategory, string> = {
  documents: runtimePath("output", "exports"),
  creative: runtimePath("output", "creative-handoffs"),
  purchase: runtimePath("output", "purchase-plans"),
  advertising: runtimePath("output", "advertising-plans"),
};

export async function listDownloadHistory(limit = 2000): Promise<DownloadHistoryItem[]> {
  const groups = await Promise.all((Object.keys(roots) as DownloadCategory[]).map((category) => listCategory(category)));
  const events = downloadEventSummary();
  return groups.flat().map((item) => ({ ...item, ...(events.get(item.id) ?? { downloadCount: 0, lastDownloadedAt: null }) })).sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, limit);
}

async function listCategory(category: DownloadCategory) {
  const root = roots[category];
  let directories: Dirent<string>[];
  try {
    directories = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const result: DownloadHistoryItem[] = [];
  for (const directory of directories) {
    if (!directory.isDirectory() || !safeSegment(directory.name)) continue;
    const folder = path.join(root, directory.name);
    const files = await readdir(folder, { withFileTypes: true }).catch(() => []);
    for (const file of files) {
      if (!file.isFile() || !isDownloadable(category, file.name)) continue;
      const info = await stat(path.join(folder, file.name));
      result.push({
        id: `${category}:${directory.name}:${file.name}`,
        category,
        kind: detectKind(category, file.name),
        filename: file.name,
        exportId: directory.name,
        createdAt: info.mtime.toISOString(),
        size: info.size,
        market: detectDownloadMarket(file.name),
        downloadUrl: buildDownloadUrl(category, directory.name, file.name),
        downloadCount: 0,
        lastDownloadedAt: null,
      });
    }
  }
  return result;
}

function openEventDatabase() {
  const database = new DatabaseSync(shipmentPlanDbPath());
  database.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
  database.exec(eventSchema);
  return database;
}

function downloadEventSummary() {
  const database = openEventDatabase();
  try {
    const rows = database.prepare(`
      SELECT category,export_id,filename,COUNT(*) AS download_count,MAX(downloaded_at) AS last_downloaded_at
      FROM download_events_v1 GROUP BY category,export_id,filename
    `).all() as Array<Record<string, string | number>>;
    return new Map(rows.map((row) => [`${row.category}:${row.export_id}:${row.filename}`, {
      downloadCount: Number(row.download_count),
      lastDownloadedAt: String(row.last_downloaded_at),
    }]));
  } finally { database.close(); }
}

export function recordDownloadEvent(category: DownloadCategory, exportId: string, filename: string) {
  if (!safeSegment(exportId) || path.basename(filename) !== filename) return;
  const database = openEventDatabase();
  try {
    database.prepare("INSERT INTO download_events_v1(category,export_id,filename,downloaded_at) VALUES(?,?,?,?)")
      .run(category, exportId, filename, new Date().toISOString());
  } finally { database.close(); }
}

function isDownloadable(category: DownloadCategory, filename: string) {
  const extension = path.extname(filename).toLowerCase();
  if (category === "purchase" || category === "advertising") return extension === ".csv";
  return extension === ".xlsx" && !filename.endsWith(".inspect.xlsx");
}

function detectKind(category: DownloadCategory, filename: string): DownloadHistoryItem["kind"] {
  if (category === "creative") return "creative";
  if (category === "purchase") return "purchase";
  if (category === "advertising") return "advertising";
  return /报运|declaration/i.test(filename) ? "declaration" : "shipment";
}

export function detectDownloadMarket(filename: string): DownloadHistoryItem["market"] {
  if (/(^|[-_ ])CA(?=[^A-Z0-9]|$)|加拿大/i.test(filename)) return "CA";
  if (/(^|[-_ ])US(?=[^A-Z0-9]|$)|美国/i.test(filename)) return "US";
  return "BOTH";
}

function buildDownloadUrl(category: DownloadCategory, exportId: string, filename: string) {
  const encoded = encodeURIComponent(filename);
  if (category === "documents") return `/api/inventory/exports/${exportId}/${encoded}`;
  if (category === "creative") return `/api/inventory/content/creative-handoff/${exportId}/${encoded}`;
  if (category === "advertising") return `/api/inventory/downloads/advertising-plan/${exportId}/${encoded}`;
  return `/api/inventory/downloads/purchase-plan/${exportId}/${encoded}`;
}

function safeSegment(value: string) {
  return /^[A-Za-z0-9._+-]+$/.test(value) && !value.includes("..");
}

export async function savePurchasePlanCsv(args: { cycleDate: string; view: "next" | "reconcile"; rows: Array<Array<string | number>> }) {
  const now = new Date();
  const exportId = `${compactTimestamp(now)}-${randomBytes(4).toString("hex")}`;
  const filename = `${args.cycleDate}-${args.view === "next" ? "采购计划" : "采购复盘"}.csv`;
  const folder = path.join(roots.purchase, exportId);
  await mkdir(folder, { recursive: true });
  const csv = args.rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n");
  await writeFile(path.join(folder, filename), `\ufeff${csv}`, "utf8");
  return { exportId, filename, downloadUrl: buildDownloadUrl("purchase", exportId, filename) };
}

export async function saveAdvertisingPlanCsv(args: { market: "US" | "CA"; period: string; status: "DRAFT" | "CONFIRMED"; rows: Array<Array<string | number>> }) {
  const now = new Date();
  const exportId = `${compactTimestamp(now)}-${randomBytes(4).toString("hex")}`;
  const filename = `${args.market}-${args.period}-广告调整-${args.status === "CONFIRMED" ? "已确认" : "草稿"}.csv`;
  const folder = path.join(roots.advertising, exportId);
  await mkdir(folder, { recursive: true });
  const csv = args.rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n");
  await writeFile(path.join(folder, filename), `\ufeff${csv}`, "utf8");
  return { exportId, filename, downloadUrl: buildDownloadUrl("advertising", exportId, filename) };
}

export function purchasePlanDownloadPath(exportId: string, filename: string) {
  if (!/^\d{8}-\d{6}-[a-f0-9]{8}$/.test(exportId) || path.basename(filename) !== filename || path.extname(filename).toLowerCase() !== ".csv") {
    throw new Error("无效的采购表下载路径");
  }
  return path.join(roots.purchase, exportId, filename);
}

export function advertisingPlanDownloadPath(exportId: string, filename: string) {
  if (!/^\d{8}-\d{6}-[a-f0-9]{8}$/.test(exportId) || path.basename(filename) !== filename || path.extname(filename).toLowerCase() !== ".csv") throw new Error("无效的广告调整表下载路径");
  return path.join(roots.advertising, exportId, filename);
}

function compactTimestamp(value: Date) {
  return value.toISOString().replace(/[-:T]/g, "").slice(0, 8) + "-" + value.toISOString().replace(/[-:T]/g, "").slice(8, 14);
}
