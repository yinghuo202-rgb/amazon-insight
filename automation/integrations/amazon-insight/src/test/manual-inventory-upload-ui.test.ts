// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DataRefreshCenter } from "@/components/inventory/data-refresh-center";
import type { DataRefreshStatus } from "@/lib/inventory/data-refresh";
import type { ImportBatch } from "@/lib/inventory/data-import";

const status = { summary: { sourceCount: 0, reportCount: 0, openExceptionCount: 0, failedRunCount: 0, missingCount: 0 }, reports: [], runs: [], sources: [], exceptions: [] } as unknown as DataRefreshStatus;
const batch = { batchId: "batch-20261015-manual-test", status: "ready", createdAt: "2026-10-15", summary: { publishableCount: 1, recognizedCount: 1, fileCount: 1 }, files: [], warnings: [], source: { kind: "manual-inventory-upload", inventoryScope: "actual", businessAsOf: "2026-10-12", capturedAt: "2026-10-15", sha256: "a".repeat(64), authentication: "manual-upload" } } as unknown as ImportBatch;
let calls: Array<{ method: string; body: Record<string, unknown> }>;
beforeEach(() => {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
    const method = options?.method || "GET", body = typeof options?.body === "string" ? JSON.parse(options.body) : {};
    calls.push({ method, body });
    if (body.action === "initialize") return Response.json({ upload: { batchId: batch.batchId, files: [{ index: 0 }] } });
    if (body.action === "finalize") return Response.json({ batch });
    return Response.json({ ...status, tasks: [], schedules: [], wps: null });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function show() { return render(createElement(DataRefreshCenter, { initialStatus: status, initialBatches: [], initialVersions: [], isAdmin: true })); }
function drop(files = [new File(["synthetic workbook"], "库存规划.xlsx")]) { fireEvent.drop(screen.getByRole("button", { name: /选择或拖入/ }), { dataTransfer: { files } }); }

it("uploads ordinary files as planning by default without publishing", async () => {
  show(); drop();
  await waitFor(() => expect(calls.find(call => call.body.action === "finalize")).toBeDefined());
  expect(calls.find(call => call.body.action === "finalize")!.body.inventory).toEqual({ scope: "planning" });
  expect(calls.some(call => call.method === "PATCH")).toBe(false);
});
it("requires business date and one workbook before uploading actual inventory", async () => {
  show();
  fireEvent.change(screen.getByLabelText("库存导入方式"), { target: { value: "actual" } });
  drop();
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("业务日期"));
  expect(calls.some(call => call.body.action === "initialize")).toBe(false);
  fireEvent.change(screen.getByLabelText("库存业务日期"), { target: { value: "2026-10-12" } });
  drop([new File(["a"], "库存规划.xlsx"), new File(["b"], "产品成本.xlsx")]);
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("单个库存工作簿"));
  expect(calls.some(call => call.body.action === "initialize")).toBe(false);
});
it("shows actual date and honest manual provenance, then clears confirmation for the next batch", async () => {
  show();
  fireEvent.change(screen.getByLabelText("库存导入方式"), { target: { value: "actual" } });
  fireEvent.change(screen.getByLabelText("库存业务日期"), { target: { value: "2026-10-12" } });
  drop();
  await waitFor(() => expect(calls.find(call => call.body.action === "finalize")).toBeDefined());
  expect(calls.find(call => call.body.action === "finalize")!.body.inventory).toEqual({ scope: "actual", businessAsOf: "2026-10-12" });
  await waitFor(() => expect(screen.getByText(/手动上传.*实际库存/)).toBeInTheDocument());
  expect(screen.getByText(/手动上传.*实际库存/)).toHaveTextContent("2026-10-12");
  expect(screen.queryByText(/来源：WPS 现有登录态下载/)).toBeNull();
  expect(screen.getByLabelText("库存导入方式")).toHaveValue("planning");
  expect(screen.queryByLabelText("库存业务日期")).toBeNull();
  expect(calls.some(call => call.method === "PATCH")).toBe(false);
});

it.each([false, true])("keeps WPS auto download optional while preserving configured access (%s)", async configured => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...status, tasks: [], schedules: [{ key: "wps_inventory", enabled: false, intervalMinutes: 240, autoPublish: false, nextRunAt: "", lastTaskId: null, lastStatus: null, lastUpdatedAt: null, workerHeartbeat: null, workerActive: false }], wps: { configured, authorized: configured, fileToken: "", shareUrl: "", expiresAt: null, message: configured ? "已授权" : "尚未配置" } })));
  show();
  const summary = await screen.findByText(/WPS 自动下载（可选）/);
  const optional = summary.closest("details");
  expect(optional).not.toBeNull();
  expect(optional).toHaveProperty("open", configured);
  expect(screen.getByRole("button", { name: /选择或拖入多个 Excel 文件/ })).toBeVisible();
});
