import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ file: "" }));
vi.mock("@/lib/inventory/shipment-plan", () => ({ shipmentPlanDbPath: () => mocks.file }));
import { claimRefreshTask, listRefreshTasks, submitRefreshTask, updateRefreshTask, listSyncSchedules, saveSyncSchedule, enqueueDueSyncTasks, completeReviewedSyncTask, restartSyncSchedule } from "@/lib/inventory/refresh-task-store";
let folder: string;
beforeEach(() => {
  folder = mkdtempSync(path.join(tmpdir(), "measureman-worker-tests-")); mocks.file = path.join(folder, "operations.sqlite3");
  const db = new DatabaseSync(mocks.file);
  db.exec("CREATE TABLE runs(id INTEGER PRIMARY KEY,job_name TEXT,status TEXT,started_at TEXT,finished_at TEXT,summary_json TEXT)"); db.close();
});
afterEach(() => rmSync(folder, { recursive: true, force: true }));
it("separates core and full collections while rejecting ambiguous request options", () => {
  const core = submitRefreshTask("gerpgo");
  const full = submitRefreshTask("gerpgo", { includeSupplemental: true });
  expect(full.id).not.toBe(core.id);
  expect(core.includeSupplemental).toBe(false);
  expect(full.includeSupplemental).toBe(true);
  expect(submitRefreshTask("gerpgo", { includeSupplemental: false }).id).toBe(core.id);
  expect(submitRefreshTask("gerpgo", { includeSupplemental: true }).id).toBe(full.id);
  expect(() => submitRefreshTask("gerpgo", { includeSupplemental: "true" })).toThrow();
  expect(() => submitRefreshTask("gerpgo", { storeId: 2 })).toThrow();
  expect(listRefreshTasks()).toHaveLength(2);
});
it("deduplicates submissions and serializes workers across task types", () => {
  const task = submitRefreshTask("gerpgo");
  expect(submitRefreshTask("gerpgo").id).toBe(task.id);
  submitRefreshTask("rebuild");
  const lease = claimRefreshTask()!;
  expect(claimRefreshTask()).toBeNull();
  updateRefreshTask(lease.id, lease.lease, "running", "第 2 页");
  updateRefreshTask(lease.id, lease.lease, "running");
  expect(listRefreshTasks().find(task => task.id === lease.id)?.progress).toBe("第 2 页");
  expect(() => updateRefreshTask(lease.id, "wrong", "completed")).toThrow("租约");
  updateRefreshTask(lease.id, lease.lease, "awaiting_mapping", "待对账");
  expect(claimRefreshTask()?.kind).not.toBe(lease.kind);
});
it("marks crashed tasks interrupted instead of blindly replaying a possibly published rebuild", () => {
  submitRefreshTask("rebuild"); const lease = claimRefreshTask()!;
  const db = new DatabaseSync(mocks.file); db.prepare("UPDATE data_refresh_tasks_v1 SET updated_at=? WHERE id=?").run("2000-01-01", lease.id); db.close();
  expect(claimRefreshTask()).toBeNull();
  expect(listRefreshTasks()[0].status).toBe("interrupted");
  expect(() => updateRefreshTask(lease.id, lease.lease, "completed")).toThrow();
  expect(submitRefreshTask("rebuild").id).not.toBe(lease.id);
});
it("migrates the existing queue and keeps review details out of public task status", () => {
  const approval = { sourceTaskId: "d8a4f702-f57b-4aa1-8300-9bfcb005e001", previewHash: "a".repeat(64), confirmed: true };
  expect(() => submitRefreshTask("gerpgo_publish", { ...approval, confirmed: false })).toThrow();
  const task = submitRefreshTask("gerpgo_publish", approval);
  expect(submitRefreshTask("gerpgo_publish", approval).id).toBe(task.id);
  expect(JSON.stringify(listRefreshTasks())).not.toContain(approval.previewHash);
  expect(claimRefreshTask()?.request).toEqual(approval);
});

it("defaults to paused durable schedules and refuses invalid intervals", () => {
  expect(listSyncSchedules().map(s => [s.key, s.enabled, s.intervalMinutes])).toEqual([["gerpgo", false, 1440], ["wps_inventory", false, 240]]);
  enqueueDueSyncTasks({ gerpgo: true, wps_inventory: true }); expect(listRefreshTasks()).toHaveLength(0);
  expect(() => saveSyncSchedule({ key: "gerpgo", enabled: true, intervalMinutes: 59, autoPublish: true })).toThrow();
  expect(() => saveSyncSchedule({ key: "AU", enabled: true, intervalMinutes: 60, autoPublish: true })).toThrow();
});
it("enqueues once, checks authorization, and preserves a pending review across worker restarts", () => {
  const now = new Date("2026-10-09T00:00:00Z");
  saveSyncSchedule({ key: "gerpgo", enabled: true, intervalMinutes: 60, autoPublish: true }, now);
  saveSyncSchedule({ key: "wps_inventory", enabled: true, intervalMinutes: 240, autoPublish: false }, now);
  enqueueDueSyncTasks({ gerpgo: true, wps_inventory: false }, now);
  enqueueDueSyncTasks({ gerpgo: true, wps_inventory: false }, now);
  expect(listRefreshTasks()).toHaveLength(1); expect(listSyncSchedules()[0].workerHeartbeat).toBe(now.toISOString());
  const task = claimRefreshTask()!; expect(task.scheduled).toBe(true);
  updateRefreshTask(task.id, task.lease, "awaiting_review");
  enqueueDueSyncTasks({ gerpgo: true, wps_inventory: false }, new Date(now.getTime() + 86400000));
  expect(listRefreshTasks()).toHaveLength(1);
  completeReviewedSyncTask(task.id);
  enqueueDueSyncTasks({ gerpgo: true, wps_inventory: true }, new Date(now.getTime() + 86400000));
  expect(listRefreshTasks()).toHaveLength(3); // next ERP update and first authorized WPS update
});
it("saving unchanged settings does not reset due dates and pausing prevents new tasks", () => {
  const now = new Date("2026-10-09T00:00:00Z"), settings = { key: "gerpgo", enabled: true, intervalMinutes: 240, autoPublish: true };
  saveSyncSchedule(settings, now); enqueueDueSyncTasks({ gerpgo: true, wps_inventory: false }, now);
  const due = listSyncSchedules()[0].nextRunAt;
  saveSyncSchedule(settings, new Date(now.getTime() + 30000)); expect(listSyncSchedules()[0].nextRunAt).toBe(due);
  const task = claimRefreshTask()!; updateRefreshTask(task.id, task.lease, "completed");
  saveSyncSchedule({ ...settings, enabled: false }, now);
  enqueueDueSyncTasks({ gerpgo: true, wps_inventory: false }, new Date(now.getTime() + 86400000)); expect(listRefreshTasks()).toHaveLength(1);
});
it("requires explicit recovery after a crashed scheduled job and preserves the old evidence", () => {
  const ready = { gerpgo: true, wps_inventory: false };
  expect(() => restartSyncSchedule("gerpgo")).toThrow("开启");
  saveSyncSchedule({ key: "gerpgo", enabled: true, intervalMinutes: 60, autoPublish: true });
  enqueueDueSyncTasks(ready);
  const task = claimRefreshTask()!;
  expect(() => restartSyncSchedule("gerpgo")).toThrow("执行");
  const db = new DatabaseSync(mocks.file);
  db.prepare("UPDATE data_refresh_tasks_v1 SET updated_at=? WHERE id=?").run("2000-01-01", task.id); db.close();
  expect(claimRefreshTask()).toBeNull();
  enqueueDueSyncTasks(ready, new Date(Date.now() + 86400000));
  expect(listRefreshTasks()).toHaveLength(1);
  restartSyncSchedule("gerpgo"); enqueueDueSyncTasks(ready);
  expect(listRefreshTasks()).toHaveLength(2);
  expect(listRefreshTasks().find(t => t.id === task.id)?.status).toBe("superseded");
  expect(claimRefreshTask()?.id).not.toBe(task.id);
});
it("persists a one-hour retry delay after failure without immediately flooding the queue", () => {
  const ready = { gerpgo: true, wps_inventory: false };
  saveSyncSchedule({ key: "gerpgo", enabled: true, intervalMinutes: 1440, autoPublish: true });
  enqueueDueSyncTasks(ready); const task = claimRefreshTask()!;
  updateRefreshTask(task.id, task.lease, "failed", "旧报告保留");
  const due = Date.parse(listSyncSchedules()[0].nextRunAt);
  expect(due - Date.now()).toBeGreaterThan(3590000);
  enqueueDueSyncTasks(ready, new Date(due - 1)); expect(listRefreshTasks()).toHaveLength(1);
  enqueueDueSyncTasks(ready, new Date(due)); expect(listRefreshTasks()).toHaveLength(2);
});
