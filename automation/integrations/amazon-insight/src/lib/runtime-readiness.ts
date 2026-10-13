import { accessSync, constants, statSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { integrationProjectRoot, runtimePath } from "@/lib/inventory/paths";

type CheckStatus = "ok" | "missing" | "unavailable" | "read_only" | "schema_missing";
type WorkerStatus = "online" | "stale" | "disabled" | "uninitialized" | "unavailable";
type WorkerCheck = {
  status: WorkerStatus;
  synchronization: "enabled" | "disabled" | "unknown";
  heartbeatAgeSeconds: number | null;
  lastTaskStatus: string | null;
};

export type RuntimeReadiness = {
  ready: boolean;
  status: "ready" | "degraded" | "not_ready";
  checks: {
    accountDatabase: CheckStatus;
    operationsDatabase: CheckStatus;
    reports: CheckStatus;
    worker: WorkerCheck;
  };
  warnings: string[];
};

// Prisma resolves relative SQLite URLs against the schema directory, not cwd.
export function accountDatabasePathFromUrl(url: string | undefined, root = integrationProjectRoot()) {
  if (!url?.startsWith("file:")) return null;
  const filename = decodeURIComponent(url.slice(5).split("?")[0]);
  if (!filename || filename === ":memory:") return null;
  return path.isAbsolute(filename) ? filename : path.resolve(root, "prisma", filename);
}

function writable(file: string, directory = false) {
  try {
    accessSync(file, constants.R_OK | constants.W_OK);
    if (!directory) accessSync(path.dirname(file), constants.W_OK);
    return true;
  } catch { return false; }
}

function existsAs(file: string, directory = false): CheckStatus {
  try {
    const stat = statSync(file);
    return (directory ? stat.isDirectory() : stat.isFile()) ? "ok" : "unavailable";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unavailable";
  }
}

function hasTable(db: DatabaseSync, name: string) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function inspectDatabase(file: string | null, tables: string[], inspect?: (db: DatabaseSync) => void): CheckStatus {
  if (!file) return "unavailable";
  const existence = existsAs(file);
  if (existence !== "ok") return existence;
  let db: DatabaseSync | undefined;
  try {
    // Never use an application opener here: those initialize/migrate tables.
    db = new DatabaseSync(file, { readOnly: true });
    db.exec("PRAGMA busy_timeout=1000");
    if (!tables.every(table => hasTable(db!, table))) return "schema_missing";
    inspect?.(db);
    return writable(file) ? "ok" : "read_only";
  } catch { return "unavailable"; }
  finally { db?.close(); }
}

const taskStatuses = new Set(["queued", "running", "completed", "failed", "interrupted", "awaiting_review", "awaiting_mapping", "superseded"]);

function inspectWorker(db: DatabaseSync, now: Date): WorkerCheck {
  if (!hasTable(db, "data_sync_schedules_v1") || !hasTable(db, "data_refresh_tasks_v1")) {
    return { status: "uninitialized", synchronization: "unknown", heartbeatAgeSeconds: null, lastTaskStatus: null };
  }
  const schedules = db.prepare("SELECT key,enabled,worker_heartbeat FROM data_sync_schedules_v1").all();
  if (!["gerpgo", "wps_inventory"].every(key => schedules.some(row => row.key === key))) {
    return { status: "uninitialized", synchronization: "unknown", heartbeatAgeSeconds: null, lastTaskStatus: null };
  }
  const recent = db.prepare("SELECT status FROM data_refresh_tasks_v1 ORDER BY updated_at DESC LIMIT 1").get();
  const pending = Boolean(db.prepare("SELECT 1 FROM data_refresh_tasks_v1 WHERE status IN ('queued','running') LIMIT 1").get());
  const synchronization = schedules.some(row => Boolean(row.enabled)) ? "enabled" : "disabled";
  const heartbeats = schedules.map(row => Date.parse(String(row.worker_heartbeat ?? "")))
    .filter(stamp => Number.isFinite(stamp) && stamp <= now.getTime());
  const heartbeatAgeSeconds = heartbeats.length ? Math.floor((now.getTime() - Math.max(...heartbeats)) / 1000) : null;
  const online = heartbeatAgeSeconds !== null && heartbeatAgeSeconds < 120;
  return {
    status: synchronization === "disabled" && !pending ? "disabled" : online ? "online" : "stale",
    synchronization,
    heartbeatAgeSeconds,
    lastTaskStatus: recent && taskStatuses.has(String(recent.status)) ? String(recent.status) : null,
  };
}

export function readRuntimeReadiness(options: {
  accountDatabasePath?: string;
  operationsDatabasePath?: string;
  reportDirectory?: string;
  now?: Date;
} = {}): RuntimeReadiness {
  let worker: WorkerCheck = { status: "unavailable", synchronization: "unknown", heartbeatAgeSeconds: null, lastTaskStatus: null };
  let accountDatabase: CheckStatus;
  try {
    accountDatabase = inspectDatabase(options.accountDatabasePath ?? accountDatabasePathFromUrl(process.env.DATABASE_URL), ["User", "Session"]);
  } catch { accountDatabase = "unavailable"; }
  const operationsFile = options.operationsDatabasePath ?? (process.env.STORE_OPS_STATE_DB?.trim() || runtimePath("db", "operations.sqlite3"));
  const operationsDatabase = inspectDatabase(operationsFile, ["runs", "exceptions"], db => {
    try { worker = inspectWorker(db, options.now ?? new Date()); }
    catch { /* Keep sanitized unavailable status; never expose SQLite errors. */ }
  });
  const reportDirectory = options.reportDirectory ?? runtimePath("reports");
  const reportExistence = existsAs(reportDirectory, true);
  const reports = reportExistence === "ok" && !writable(reportDirectory, true) ? "read_only" : reportExistence;
  const ready = [accountDatabase, operationsDatabase, reports].every(status => status === "ok");
  const warnings = [];
  if (["stale", "uninitialized", "unavailable"].includes(worker.status)) warnings.push(`worker_${worker.status}`);
  if (["failed", "interrupted"].includes(worker.lastTaskStatus ?? "")) warnings.push(`last_task_${worker.lastTaskStatus}`);
  return {
    ready,
    status: !ready ? "not_ready" : warnings.length ? "degraded" : "ready",
    checks: { accountDatabase, operationsDatabase, reports, worker },
    warnings,
  };
}
