import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { gerpgoReviewRequestSchema } from "@/lib/inventory/gerpgo-preview";
import { shipmentPlanDbPath } from "@/lib/inventory/shipment-plan";
import { getGerpgoAutoSyncConfiguration } from "@/lib/inventory/gerpgo";

export type RefreshTaskKind = "rebuild" | "gerpgo" | "gerpgo_publish" | "wps_inventory";
export const gerpgoCollectionRequestSchema = z.object({ includeSupplemental: z.boolean().default(false), scheduled: z.literal(true).optional() }).strict();
export const wpsCollectionRequestSchema = z.object({ scheduled: z.literal(true).optional() }).strict();
export const syncScheduleSchema = z.object({ key: z.enum(["gerpgo", "wps_inventory"]), enabled: z.boolean(), intervalMinutes: z.number().int().min(60).max(10080), autoPublish: z.boolean() }).strict();
export type SyncSchedule = z.infer<typeof syncScheduleSchema> & { environmentManaged?: boolean; nextRunAt: string; lastTaskId: string | null; lastStatus: string | null; lastUpdatedAt: string | null; workerHeartbeat: string | null; workerActive: boolean };
export type RefreshTask = { id: string; kind: RefreshTaskKind; status: string; progress: string; error: string; createdAt: string; updatedAt: string; includeSupplemental?: boolean; batchId?: string };
export function openRefreshDatabase() {
  const db = new DatabaseSync(shipmentPlanDbPath());
  db.exec(`PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS data_refresh_tasks_v1 (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL,
      progress TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '',
      lease TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS data_refresh_one_active_v1 ON data_refresh_tasks_v1((1)) WHERE status='running';
    CREATE TABLE IF NOT EXISTS data_sync_schedules_v1 (
      key TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, interval_minutes INTEGER NOT NULL,
      auto_publish INTEGER NOT NULL DEFAULT 1, next_run_at TEXT NOT NULL, last_task_id TEXT,
      worker_heartbeat TEXT);
    INSERT OR IGNORE INTO data_sync_schedules_v1(key,interval_minutes,next_run_at) VALUES('gerpgo',1440,'1970-01-01T00:00:00.000Z');
    INSERT OR IGNORE INTO data_sync_schedules_v1(key,interval_minutes,next_run_at) VALUES('wps_inventory',240,'1970-01-01T00:00:00.000Z');`);
  db.exec("BEGIN IMMEDIATE");
  try {
    if (!db.prepare("PRAGMA table_info(data_refresh_tasks_v1)").all().some(row => row.name === "request_json")) db.exec("ALTER TABLE data_refresh_tasks_v1 ADD COLUMN request_json TEXT NOT NULL DEFAULT '{}'");
    if (!db.prepare("PRAGMA table_info(data_refresh_tasks_v1)").all().some(row => row.name === "artifact_json")) db.exec("ALTER TABLE data_refresh_tasks_v1 ADD COLUMN artifact_json TEXT NOT NULL DEFAULT '{}'");
    if (!db.prepare("PRAGMA table_info(data_sync_schedules_v1)").all().some(row => row.name === "environment_policy")) db.exec("ALTER TABLE data_sync_schedules_v1 ADD COLUMN environment_policy TEXT NOT NULL DEFAULT ''");
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); db.close(); throw error; }
  return db;
}
function map(row: Record<string, unknown>): RefreshTask {
  const artifact = JSON.parse(String(row.artifact_json ?? "{}"));
  return { id: String(row.id), kind: String(row.kind) as RefreshTaskKind, status: String(row.status), progress: String(row.progress), error: String(row.error), createdAt: String(row.created_at), updatedAt: String(row.updated_at), ...(row.kind === "gerpgo" ? { includeSupplemental: gerpgoCollectionRequestSchema.parse(JSON.parse(String(row.request_json))).includeSupplemental } : {}), ...(typeof artifact.batchId === "string" && /^batch-[a-zA-Z0-9-]{8,80}$/.test(artifact.batchId) ? { batchId: artifact.batchId } : {}) };
}
export function listRefreshTasks() {
  const db = openRefreshDatabase();
  try { return db.prepare("SELECT * FROM data_refresh_tasks_v1 ORDER BY created_at DESC LIMIT 20").all().map(map); }
  finally { db.close(); }
}
export function submitRefreshTask(kind: RefreshTaskKind, request: unknown = {}) {
  const payload = kind === "gerpgo_publish" ? gerpgoReviewRequestSchema.parse(request) : kind === "gerpgo" ? gerpgoCollectionRequestSchema.parse(request) : kind === "wps_inventory" ? wpsCollectionRequestSchema.parse(request) : {};
  const requestJson = JSON.stringify(payload);
  if (!["rebuild", "gerpgo", "gerpgo_publish", "wps_inventory"].includes(kind)) throw new Error("不支持的任务类型。");
  const db = openRefreshDatabase();
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
  const db = openRefreshDatabase();
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
    return { ...map(row), status: "running", lease, scheduled: JSON.parse(String(row.request_json)).scheduled === true, request: String(row.kind) === "gerpgo_publish" ? gerpgoReviewRequestSchema.parse(JSON.parse(String(row.request_json))) : null };
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  finally { db.close(); }
}
export function updateRefreshTask(id: string, lease: string, status: string, progress: string | null = null, error = "", artifact?: { batchId: string }) {
  if (!["running", "completed", "awaiting_mapping", "awaiting_review", "failed"].includes(status)) throw new Error("任务状态无效。");
  const db = openRefreshDatabase();
  try {
    const result = db.prepare("UPDATE data_refresh_tasks_v1 SET status=?,progress=COALESCE(?,progress),error=?,updated_at=? WHERE id=? AND lease=? AND status='running'").run(status, progress, error, new Date().toISOString(), id, lease);
    if (!result.changes) throw new Error("任务租约失效，已停止写入。");
    if (artifact) db.prepare("UPDATE data_refresh_tasks_v1 SET artifact_json=? WHERE id=? AND lease=?").run(JSON.stringify(artifact), id, lease);
    db.prepare("UPDATE data_sync_schedules_v1 SET worker_heartbeat=?").run(new Date().toISOString());
    if (status === "failed") db.prepare("UPDATE data_sync_schedules_v1 SET next_run_at=? WHERE last_task_id=?").run(new Date(Date.now() + 3600000).toISOString(), id);
  } finally { db.close(); }
}

export function completeReviewedSyncTask(sourceTaskId: string) {
  const db = openRefreshDatabase();
  try { db.prepare("UPDATE data_refresh_tasks_v1 SET status='completed',progress='已人工确认并发布',updated_at=? WHERE id=? AND status IN ('awaiting_review','awaiting_mapping')").run(new Date().toISOString(), sourceTaskId); }
  finally { db.close(); }
}

export function restartSyncSchedule(key: "gerpgo" | "wps_inventory") {
  const db = openRefreshDatabase(), now = new Date().toISOString();
  try {
    db.exec("BEGIN IMMEDIATE");
    const row = db.prepare("SELECT * FROM data_sync_schedules_v1 WHERE key=?").get(key);
    if (!row?.enabled) throw new Error("请先开启此来源的定时同步。");
    const last = row.last_task_id ? db.prepare("SELECT status FROM data_refresh_tasks_v1 WHERE id=?").get(String(row.last_task_id)) : null;
    if (last && ["queued", "running"].includes(String(last.status))) throw new Error("当前任务仍在执行，不能重新排队。");
    db.prepare("UPDATE data_refresh_tasks_v1 SET status='superseded',progress='已确认重新拉取，旧预览保留',updated_at=? WHERE id=? AND status IN ('awaiting_review','awaiting_mapping','interrupted','failed')").run(now, String(row.last_task_id ?? ""));
    db.prepare("UPDATE data_sync_schedules_v1 SET last_task_id=NULL,next_run_at=? WHERE key=?").run(now, key);
    db.prepare("INSERT INTO runs(job_name,status,started_at,finished_at,summary_json) VALUES('sync-schedule-restart','completed',?,?,?)").run(now, now, JSON.stringify({ key, previousTaskId: row.last_task_id, actor: "shared-account" }));
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  finally { db.close(); }
  return listSyncSchedules();
}

export function listSyncSchedules(): SyncSchedule[] {
  const db = openRefreshDatabase();
  try {
    return db.prepare(`SELECT s.*,t.status AS last_status,t.updated_at AS last_updated_at FROM data_sync_schedules_v1 s
      LEFT JOIN data_refresh_tasks_v1 t ON t.id=s.last_task_id ORDER BY s.key`).all().map(row => ({
      key: row.key as SyncSchedule["key"], enabled: Boolean(row.enabled), intervalMinutes: Number(row.interval_minutes), autoPublish: Boolean(row.auto_publish),
      environmentManaged: row.key === "gerpgo" && getGerpgoAutoSyncConfiguration().managed,
      nextRunAt: String(row.next_run_at), lastTaskId: row.last_task_id ? String(row.last_task_id) : null,
      lastStatus: row.last_status ? String(row.last_status) : null, lastUpdatedAt: row.last_updated_at ? String(row.last_updated_at) : null,
      workerHeartbeat: row.worker_heartbeat ? String(row.worker_heartbeat) : null,
      workerActive: Boolean(row.worker_heartbeat) && Date.now() - Date.parse(String(row.worker_heartbeat)) < 120000,
    }));
  } finally { db.close(); }
}

export function saveSyncSchedule(input: unknown, now = new Date()) {
  const value = syncScheduleSchema.parse(input);
  if (value.key === "gerpgo" && getGerpgoAutoSyncConfiguration().managed) throw new Error("积加定时同步由 NAS env 管理，请修改 env 并重新创建容器。");
  const db = openRefreshDatabase();
  try {
    db.exec("BEGIN IMMEDIATE");
    const old = db.prepare("SELECT enabled,interval_minutes,next_run_at FROM data_sync_schedules_v1 WHERE key=?").get(value.key)!;
    // Saving an unchanged setting must not cause an extra collection or reset its due date.
    const due = value.enabled && (!old.enabled || Number(old.interval_minutes) !== value.intervalMinutes) ? now.toISOString() : String(old.next_run_at);
    db.prepare("UPDATE data_sync_schedules_v1 SET enabled=?,interval_minutes=?,auto_publish=?,next_run_at=? WHERE key=?").run(Number(value.enabled), value.intervalMinutes, Number(value.autoPublish), due, value.key);
    db.prepare("INSERT INTO runs(job_name,status,started_at,finished_at,summary_json) VALUES('sync-schedule-save','completed',?,?,?)").run(now.toISOString(), now.toISOString(), JSON.stringify({ ...value, actor: "shared-account" }));
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  finally { db.close(); }
  return listSyncSchedules();
}

// Apply server configuration once per policy change, retaining durable due dates on restart.
export function configureGerpgoEnvironmentSchedule(env: Record<string, string | undefined> = process.env, now = new Date()) {
  const policy = getGerpgoAutoSyncConfiguration(env);
  const db = openRefreshDatabase(), stamp = now.toISOString();
  const signature = JSON.stringify({ ...policy, storeName: env.GERPGO_STORE_NAME?.trim() ?? "" });
  try {
    db.exec("BEGIN IMMEDIATE");
    const old = db.prepare("SELECT * FROM data_sync_schedules_v1 WHERE key='gerpgo'").get()!;
    if (!policy.managed) {
      if (old.environment_policy) {
        db.prepare("UPDATE data_sync_schedules_v1 SET enabled=0,environment_policy='' WHERE key='gerpgo'").run();
        db.prepare("INSERT INTO runs(job_name,status,started_at,finished_at,summary_json) VALUES('gerpgo-env-schedule','completed',?,?,?)").run(stamp, stamp, JSON.stringify({ enabled: false, reason: "env-credentials-removed", actor: "environment-policy" }));
      }
      db.exec("COMMIT"); return;
    }
    if (old.environment_policy !== signature) {
      // New collection only: never replay an old publish request or alter the old reports.
      const last = old.last_task_id ? db.prepare("SELECT status FROM data_refresh_tasks_v1 WHERE id=?").get(String(old.last_task_id)) : null;
      const pending = last && ["queued", "running"].includes(String(last.status));
      if (last && !pending) db.prepare("UPDATE data_refresh_tasks_v1 SET status='superseded',progress='env 自动同步已接管，原始预览保留',updated_at=? WHERE id=? AND status IN ('awaiting_review','awaiting_mapping','interrupted','failed')").run(stamp, String(old.last_task_id));
      db.prepare("UPDATE data_sync_schedules_v1 SET enabled=?,interval_minutes=?,auto_publish=1,next_run_at=?,last_task_id=?,environment_policy=? WHERE key='gerpgo'").run(Number(policy.enabled), policy.intervalMinutes, stamp, pending ? String(old.last_task_id) : null, signature);
      db.prepare("INSERT INTO runs(job_name,status,started_at,finished_at,summary_json) VALUES('gerpgo-env-schedule','completed',?,?,?)").run(stamp, stamp, JSON.stringify({ ...policy, actor: "environment-policy" }));
    }
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  finally { db.close(); }
}

// One durable queue and one transaction: multiple worker containers cannot enqueue twice.
export function enqueueDueSyncTasks(available: { gerpgo: boolean; wps_inventory: boolean }, now = new Date()) {
  const db = openRefreshDatabase(), stamp = now.toISOString();
  try {
    db.exec("BEGIN IMMEDIATE");
    db.prepare("UPDATE data_sync_schedules_v1 SET worker_heartbeat=?").run(stamp);
    for (const row of db.prepare("SELECT * FROM data_sync_schedules_v1 WHERE enabled=1 AND next_run_at<=? ORDER BY next_run_at,key").all(stamp)) {
      const key = row.key as "gerpgo" | "wps_inventory";
      if (!available[key]) continue;
      const previous = row.last_task_id ? db.prepare("SELECT status,updated_at FROM data_refresh_tasks_v1 WHERE id=?").get(String(row.last_task_id)) : null;
      // Do not replace an outstanding review with an ever-growing queue of newer previews.
      const environment = getGerpgoAutoSyncConfiguration();
      if (previous && ["queued", "running"].includes(String(previous.status))) continue;
      if (previous && ["awaiting_review", "awaiting_mapping", "interrupted"].includes(String(previous.status))) {
        if (key !== "gerpgo" || !environment.managed || !environment.enabled) continue;
        db.prepare("UPDATE data_refresh_tasks_v1 SET status='superseded',progress='已安排新的自动采集，旧异常证据保留',updated_at=? WHERE id=?").run(stamp, String(row.last_task_id));
      }
      if (db.prepare("SELECT id FROM data_refresh_tasks_v1 WHERE kind=? AND status IN ('queued','running')").get(key)) continue;
      const id = randomUUID(), request = key === "gerpgo" ? { includeSupplemental: environment.managed ? environment.includeSupplemental : false, scheduled: true } : { scheduled: true };
      db.prepare("INSERT INTO data_refresh_tasks_v1(id,kind,status,created_at,updated_at,request_json) VALUES(?,?,'queued',?,?,?)").run(id, key, stamp, stamp, JSON.stringify(request));
      const delay = previous?.status === "failed" ? Math.min(60, Number(row.interval_minutes)) : Number(row.interval_minutes);
      db.prepare("UPDATE data_sync_schedules_v1 SET next_run_at=?,last_task_id=? WHERE key=?").run(new Date(now.getTime() + delay * 60000).toISOString(), id, key);
      db.prepare("INSERT INTO runs(job_name,status,started_at,finished_at,summary_json) VALUES('sync-schedule-submit','completed',?,?,?)").run(stamp, stamp, JSON.stringify({ taskId: id, kind: key, actor: "scheduled-worker" }));
    }
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  finally { db.close(); }
}
