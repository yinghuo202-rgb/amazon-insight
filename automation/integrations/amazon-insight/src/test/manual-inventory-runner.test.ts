import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const child = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: child.spawn }));
import { appendImportChunk, finalizeChunkedImport, initializeChunkedImport } from "@/lib/inventory/data-import";

let folder: string;
beforeEach(() => { folder = mkdtempSync(path.join(tmpdir(), "inventory-runner-")); vi.stubEnv("STORE_OPS_UPLOAD_ROOT", folder); child.spawn.mockReset(); });
afterEach(() => { vi.unstubAllEnvs(); rmSync(folder, { recursive: true, force: true }); });
function parserResponse(stdout: string, stderr: string, code: number) {
  child.spawn.mockImplementation(() => {
    const process = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
    queueMicrotask(() => { process.stdout.emit("data", stdout); process.stderr.emit("data", stderr); process.emit("close", code); });
    return process;
  });
}
async function uploaded() {
  const plan = await initializeChunkedImport([{ name: "库存规划.xlsx", size: 4 }]);
  await appendImportChunk(plan.batchId, 0, 0, Buffer.from("test"));
  return plan.batchId;
}
it("preserves explicit actual inventory options at the Python boundary", async () => {
  const batchId = await uploaded();
  parserResponse('{"status":"ready"}', "", 0);
  await expect(finalizeChunkedImport(batchId, { scope: "actual", businessAsOf: "2026-10-12" })).resolves.toEqual({ status: "ready" });
  expect(child.spawn.mock.calls[0][1]).toEqual(expect.arrayContaining(["--inventory-scope", "actual", "--confirmed-inventory-date", "2026-10-12"]));
});
it("classifies only the deliberate validation envelope as safe for the browser", async () => {
  const batchId = await uploaded();
  parserResponse('{"code":"MANUAL_INVENTORY_VALIDATION","error":"实际库存缺少必需列：AWD备货"}', "internal diagnostic not public", 1);
  await expect(finalizeChunkedImport(batchId)).rejects.toMatchObject({ name: "DataImportValidationError", message: "实际库存缺少必需列：AWD备货" });
  parserResponse('{"code":"OTHER","error":"private-host-path"}', "private-host-traceback", 1);
  const error = await finalizeChunkedImport(batchId).catch(error => error);
  expect(error.name).not.toBe("DataImportValidationError");
});
