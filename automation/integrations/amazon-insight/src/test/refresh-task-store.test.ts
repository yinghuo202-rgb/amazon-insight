import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ file: "" }));
vi.mock("@/lib/inventory/shipment-plan", () => ({ shipmentPlanDbPath: () => mocks.file }));
import { claimRefreshTask, listRefreshTasks, submitRefreshTask, updateRefreshTask } from "@/lib/inventory/refresh-task-store";
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
