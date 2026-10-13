import { chmodSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { accountDatabasePathFromUrl, readRuntimeReadiness } from "@/lib/runtime-readiness";

let folder: string;
let options: { accountDatabasePath: string; operationsDatabasePath: string; reportDirectory: string; now: Date };
const now = new Date("2026-10-13T08:00:00.000Z");
beforeEach(() => {
  folder = mkdtempSync(path.join(tmpdir(), "measureman-readiness-"));
  options = { accountDatabasePath: path.join(folder, "accounts.db"), operationsDatabasePath: path.join(folder, "operations.db"), reportDirectory: path.join(folder, "reports"), now };
  mkdirSync(options.reportDirectory);
  const accounts = new DatabaseSync(options.accountDatabasePath);
  accounts.exec("CREATE TABLE User(id TEXT); CREATE TABLE Session(id TEXT);");
  accounts.close();
  const operations = new DatabaseSync(options.operationsDatabasePath);
  operations.exec(`CREATE TABLE runs(id INTEGER); CREATE TABLE exceptions(id INTEGER);
    CREATE TABLE data_sync_schedules_v1(key TEXT PRIMARY KEY,enabled INTEGER,worker_heartbeat TEXT);
    CREATE TABLE data_refresh_tasks_v1(status TEXT,updated_at TEXT);
    INSERT INTO data_sync_schedules_v1 VALUES('gerpgo',1,'2026-10-13T07:59:45.000Z'),('wps_inventory',0,'2026-10-13T07:59:45.000Z');`);
  operations.close();
});
afterEach(() => { rmSync(folder, { recursive: true, force: true }); });

it("uses Prisma schema-relative paths without selecting a new runtime directory", () => {
  expect(accountDatabasePathFromUrl("file:./selection.db", "/app")).toBe("/app/prisma/selection.db");
  expect(accountDatabasePathFromUrl("file:/data/app/selection.db?mode=rw", "/app")).toBe("/data/app/selection.db");
  expect(accountDatabasePathFromUrl("postgres://private-credential")).toBeNull();
  expect(accountDatabasePathFromUrl("file::memory:")).toBeNull();
});

it("reports live worker health without writing any database or creating files", () => {
  const accountBefore = readFileSync(options.accountDatabasePath);
  const operationsBefore = readFileSync(options.operationsDatabasePath);
  const namesBefore = readdirSync(folder);
  const result = readRuntimeReadiness(options);
  expect(result).toMatchObject({ ready: true, status: "ready", checks: { accountDatabase: "ok", operationsDatabase: "ok", reports: "ok", worker: { status: "online", synchronization: "enabled", heartbeatAgeSeconds: 15 } } });
  expect(readFileSync(options.accountDatabasePath)).toEqual(accountBefore);
  expect(readFileSync(options.operationsDatabasePath)).toEqual(operationsBefore);
  expect(readdirSync(folder)).toEqual(namesBefore);
  expect(JSON.stringify(result)).not.toContain(folder);
});

it("keeps the website ready when worker heartbeat is stale", () => {
  const result = readRuntimeReadiness({ ...options, now: new Date(now.getTime() + 180000) });
  expect(result).toMatchObject({ ready: true, status: "degraded", checks: { worker: { status: "stale" } } });
  expect(result.warnings).toEqual(["worker_stale"]);
});

it("describes paused synchronization as disabled rather than a worker fault", () => {
  const db = new DatabaseSync(options.operationsDatabasePath);
  db.exec("UPDATE data_sync_schedules_v1 SET enabled=0,worker_heartbeat=NULL");
  db.close();
  expect(readRuntimeReadiness(options)).toMatchObject({ ready: true, status: "ready", checks: { worker: { status: "disabled", synchronization: "disabled" } }, warnings: [] });
});

it("still diagnoses a missing worker when a manually queued job needs it", () => {
  const db = new DatabaseSync(options.operationsDatabasePath);
  db.exec("UPDATE data_sync_schedules_v1 SET enabled=0,worker_heartbeat=NULL; INSERT INTO data_refresh_tasks_v1 VALUES('queued','2026-10-13T07:59:00.000Z')");
  db.close();
  expect(readRuntimeReadiness(options)).toMatchObject({ ready: true, status: "degraded", checks: { worker: { status: "stale", synchronization: "disabled", lastTaskStatus: "queued" } } });
});

it("does not initialize a missing operational database or swallow a missing schema", () => {
  const missing = path.join(folder, "not-created", "operations.db");
  expect(readRuntimeReadiness({ ...options, operationsDatabasePath: missing })).toMatchObject({ ready: false, status: "not_ready", checks: { operationsDatabase: "missing" } });
  expect(readdirSync(folder)).not.toContain("not-created");
  const db = new DatabaseSync(options.operationsDatabasePath);
  db.exec("DROP TABLE exceptions"); db.close();
  expect(readRuntimeReadiness(options)).toMatchObject({ ready: false, checks: { operationsDatabase: "schema_missing" } });
});

it("checks mount permission without test writes and does not disclose connection errors", () => {
  chmodSync(options.accountDatabasePath, 0o444);
  try {
    expect(readRuntimeReadiness(options)).toMatchObject({ ready: false, checks: { accountDatabase: "read_only" } });
  } finally { chmodSync(options.accountDatabasePath, 0o600); }
  chmodSync(options.reportDirectory, 0o555);
  try {
    expect(readRuntimeReadiness(options)).toMatchObject({ ready: false, checks: { reports: "read_only" } });
  } finally { chmodSync(options.reportDirectory, 0o700); }
  const result = readRuntimeReadiness({ ...options, accountDatabasePath: folder });
  expect(result.checks.accountDatabase).toBe("unavailable");
  expect(JSON.stringify(result)).not.toContain(folder);
});

it("warns about failed tasks without returning job payloads or marking the app unavailable", () => {
  const db = new DatabaseSync(options.operationsDatabasePath);
  db.exec("INSERT INTO data_refresh_tasks_v1 VALUES('failed','2026-10-13T07:59:00.000Z')"); db.close();
  expect(readRuntimeReadiness(options)).toMatchObject({ ready: true, status: "degraded", warnings: ["last_task_failed"] });
});
