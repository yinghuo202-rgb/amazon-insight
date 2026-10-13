// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DataRefreshCenter } from "@/components/inventory/data-refresh-center";
import type { DataRefreshStatus } from "@/lib/inventory/data-refresh";
import type { ImportBatch } from "@/lib/inventory/data-import";
const batchId = "batch-20261013-synthetic", version = "data-20261013-000000-test";
const status = { summary: { sourceCount: 0, reportCount: 0, openExceptionCount: 0, failedRunCount: 0, missingCount: 0 }, reports: [], runs: [], sources: [], exceptions: [] } as unknown as DataRefreshStatus;
const batch = { batchId, status: "ready", createdAt: "2026-10-13", summary: { publishableCount: 1, recognizedCount: 1, fileCount: 1 }, files: [], warnings: [] } as unknown as ImportBatch;
let calls: Array<{ method: string; body: Record<string, unknown> }>;
beforeEach(() => {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
    const method = options?.method || "GET", body = options?.body ? JSON.parse(String(options.body)) : {};
    calls.push({ method, body });
    if (body.action === "confirm_operation") return Response.json({ confirmation: { token: "synthetic-confirmation", expiresAt: "2099-01-01T00:00:00Z" } });
    if (method === "PATCH") return Response.json({ batch: { ...batch, status: "published", dataVersion: version }, restored: { status: "restored" } });
    return Response.json({ ...status, tasks: [], schedules: [], batches: [batch], versions: [], configuration: {}, wps: null });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const show = () => render(createElement(DataRefreshCenter, { initialStatus: status, initialBatches: [batch], initialVersions: [{ version, createdAt: "2026-10-13", fileCount: 1 }], isAdmin: true }));

it.each(["publish", "restore"])("requires explicit password verification and target-bound confirmation for %s", async operation => {
  show();
  fireEvent.click(screen.getByRole("button", { name: operation === "publish" ? "确认发布" : "回滚" }));
  expect(calls.filter(call => call.method === "PATCH")).toHaveLength(0);
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveTextContent(operation === "publish" ? batchId : version);
  fireEvent.change(within(dialog).getByLabelText("当前共用账号密码"), { target: { value: "synthetic-password" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "验证密码" }));
  await waitFor(() => expect(within(dialog).getByRole("button", { name: operation === "publish" ? "验证后确认发布" : "验证后确认回退" })).toBeEnabled());
  expect(within(dialog).queryByDisplayValue("synthetic-password")).toBeNull();
  const verification = calls.find(call => call.body.action === "confirm_operation")!;
  expect(verification.body).toMatchObject({ operation, currentPassword: "synthetic-password", ...(operation === "publish" ? { batchId } : { version }) });
  fireEvent.click(within(dialog).getByRole("button", { name: operation === "publish" ? "验证后确认发布" : "验证后确认回退" }));
  await waitFor(() => expect(calls.filter(call => call.method === "PATCH")).toHaveLength(1));
  expect(calls.find(call => call.method === "PATCH")!.body).toEqual({ action: operation, ...(operation === "publish" ? { batchId } : { version }), confirmationToken: "synthetic-confirmation" });
});
it("cancels without executing and clears the verification input", () => {
  show(); fireEvent.click(screen.getByRole("button", { name: "确认发布" }));
  fireEvent.change(screen.getByLabelText("当前共用账号密码"), { target: { value: "synthetic-password" } });
  fireEvent.click(screen.getByRole("button", { name: "取消二次验证" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(calls.filter(call => call.method !== "GET")).toHaveLength(0);
});
it.each(["http:", "file:"])("blocks password transmission before fetch on unsafe %s origins", async protocol => {
  const realWindow = window;
  vi.stubGlobal("window", new Proxy(realWindow, { get(target, key) { return key === "location" ? { protocol, hostname: "unsafe.example", href: protocol === "file:" ? "file:///synthetic" : "http://unsafe.example/" } : Reflect.get(target, key); } }));
  show(); fireEvent.click(screen.getByRole("button", { name: "确认发布" }));
  fireEvent.change(screen.getByLabelText("当前共用账号密码"), { target: { value: "synthetic-password" } });
  fireEvent.click(screen.getByRole("button", { name: "验证密码" }));
  await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent("本次未发送密码"));
  expect(screen.queryByDisplayValue("synthetic-password")).toBeNull();
  expect(calls.filter(call => "currentPassword" in call.body || call.method !== "GET")).toHaveLength(0);
});
