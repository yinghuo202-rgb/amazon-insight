import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { gerpgoReviewRequestSchema } from "@/lib/inventory/gerpgo-preview";
import { shipmentPlanDbPath } from "@/lib/inventory/shipment-plan";

export type RefreshTaskKind = "rebuild" | "gerpgo" | "gerpgo_publish";
export const gerpgoCollectionRequestSchema = z.object({ includeSupplemental: z.boolean().default(false) }).strict();
export type RefreshTask = { id: string; kind: RefreshTaskKind; status: string; progress: string; error: string; createdAt: string; updatedAt: string; includeSupplemental?: boolean };
function open() {
  const db = new DatabaseSync(shipmentPlanDbPath());
  db.exec(`PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS data_refresh_tasks_v1 (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL,
      progress TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '',
      lease TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS data_refresh_one_active_v1 ON data_refresh_tasks_v1((1)) WHERE status='running';`);
  db.exec("BEGIN IMMEDIATE");
  try {
    if (!db.prepare("PRAGMA table_info(data_refresh_tasks_v1)").all().some(row => row.name === "request_json")) db.exec("ALTER TABLE data_refresh_tasks_v1 ADD COLUMN request_json TEXT NOT NULL DEFAULT '{}'");
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); db.close(); throw error; }
  return db;
}
function map(row: Record<string, unknown>): RefreshTask {
  return { id: String(row.id), kind: String(row.kind) as RefreshTaskKind, status: String(row.status), progress: String(row.progress), error: String(row.error), createdAt: String(row.created_at), updatedAt: String(row.updated_at), ...(row.kind === "gerpgo" ? { includeSupplemental: gerpgoCollectionRequestSchema.parse(JSON.parse(String(row.request_json))).includeSupplemental } : {}) };
}
export function listRefreshTasks() {
  const db = open();
  try { return db.prepare("SELECT * FROM data_refresh_tasks_v1 ORDER BY created_at DESC LIMIT 20").all().map(map); }
  finally { db.close(); }
}
export function submitRefreshTask(kind: RefreshTaskKind, request: unknown = {}) {
  const payload = kind === "gerpgo_publish" ? gerpgoReviewRequestSchema.parse(request) : kind === "gerpgo" ? gerpgoCollectionRequestSchema.parse(request) : {};
  const requestJson = JSON.stringify(payload);
  if (!["rebuild", "gerpgo", "gerpgo_publish"].includes(kind)) throw new Error("不支持的任务类型。");
  const db = open();
  try {
    db.exec("BEGIN IMMEDIATE");
    const existing = db.prepare("SELECT * FROM data_refresh_tasks_v1 WHERE kind=? AND request_json=? AND status IN ('queued','running') ORDER BY created_at LIMIT 1").get(kind, requestJson);
    if (existing) { db.exec("COMMIT"); return map(existing); }
    const id = randomUUID(), now = new Date().toISOString();
    db.prepare("INSERT INTO data_refresh_tasks_v1(id,kind,status,created_at,updated_at,request_json) VALUES(?,?,'queued',?,?,?)").run(id, kind, now, now, requestJson);
    db.prepare("INSERT INTO runs(job_name,status,started_at,finished_at,summary_json) VALUES('refresh-task-submit','completed',?,?,?)").run(now, now, JSON.stringify({ taskId: id, kind, actor: "shared-account" }));
    db.exec("COMMIT");
    return { id, kind, status: "queued", progress: "等待独立 worker", error: "", createdAt: now, updatedAt: now, ...(kind === "gerpgo" ? { includeSupplemental: gerpgoCollectionRequestSchema.parse(payload).includeSupplemental } : {}) };
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  finally { db.close(); }
}
export function claimRefreshTask() {
  const db = open();
  try {
    db.exec("BEGIN IMMEDIATE");
    const cutoff = new Date(Date.now() - 120000).toISOString();
    // A crashed rebuild might have reached its commit point. Do not replay it silently.
    db.prepare("UPDATE data_refresh_tasks_v1 SET status='interrupted',error='worker 心跳中断；请核对发布版本后重新提交。' WHERE status='running' AND updated_at<?").run(cutoff);
    if (db.prepare("SELECT id FROM data_refresh_tasks_v1 WHERE status='running'").get()) { db.exec("COMMIT"); return null; }
    const row = db.prepare("SELECT * FROM data_refresh_tasks_v1 WHERE status='queued' ORDER BY created_at,id LIMIT 1").get();
    if (!row) { db.exec("COMMIT"); return null; }
    const lease = randomUUID();
    db.prepare("UPDATE data_refresh_tasks_v1 SET status='running',lease=?,updated_at=? WHERE id=?").run(lease, new Date().toISOString(), String(row.id));
    db.exec("COMMIT");
    return { ...map(row), status: "running", lease, request: String(row.kind) === "gerpgo_publish" ? gerpgoReviewRequestSchema.parse(JSON.parse(String(row.request_json))) : null };
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  finally { db.close(); }
}
export function updateRefreshTask(id: string, lease: string, status: string, progress: string | null = null, error = "") {
  if (!["running", "completed", "awaiting_mapping", "awaiting_review", "failed"].includes(status)) throw new Error("任务状态无效。");
  const db = open();
  try {
    const result = db.prepare("UPDATE data_refresh_tasks_v1 SET status=?,progress=COALESCE(?,progress),error=?,updated_at=? WHERE id=? AND lease=? AND status='running'").run(status, progress, error, new Date().toISOString(), id, lease);
    if (!result.changes) throw new Error("任务租约失效，已停止写入。");
  } finally { db.close(); }
}
