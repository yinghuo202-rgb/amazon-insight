import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ folder: "", dns: vi.fn() }));
vi.mock("@/lib/inventory/shipment-plan", () => ({ shipmentPlanDbPath: () => path.join(mocks.folder, "operations.sqlite3") }));
vi.mock("@/lib/inventory/paths", () => ({ runtimePath: (...parts: string[]) => path.join(mocks.folder, ...parts) }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.dns }));
import { beginWpsAuthorization, finishWpsAuthorization, getWpsStatus, saveWpsSettings, downloadWpsInventory, validateWpsDownloadUrl } from "@/lib/inventory/wps";
const input = { appId: "demo", appKey: "private-app-key-for-test", fileToken: "inventory-file-id", shareUrl: "https://www.kdocs.cn/l/Example123" };
const taskId = "d8a4f702-f57b-4aa1-8300-9bfcb005e001";
const token = (expires = 3600) => new Response(JSON.stringify({ code: 0, data: { app_id: "demo", access_token: "private-access-token", refresh_token: "private-refresh-token", expires_in: expires } }));
beforeEach(() => {
  mocks.folder = mkdtempSync(path.join(tmpdir(), "measureman-wps-tests-"));
  vi.stubEnv("SECRET_KEY", "x".repeat(40));
  const db = new DatabaseSync(path.join(mocks.folder, "operations.sqlite3")); db.exec("CREATE TABLE runs(id INTEGER PRIMARY KEY,job_name TEXT,status TEXT,started_at TEXT,finished_at TEXT,summary_json TEXT)"); db.close();
  mocks.dns.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
});
afterEach(() => { rmSync(mocks.folder, { recursive: true, force: true }); vi.unstubAllEnvs(); vi.clearAllMocks(); });
async function authorize(expires = 3600) {
  saveWpsSettings(input);
  const u = new URL(beginWpsAuthorization("shared", "https://example.invalid"));
  await finishWpsAuthorization("shared", "test-code", u.searchParams.get("state")!, vi.fn().mockResolvedValue(token(expires)));
}
it("never equates a share link with authorization and encrypts all application and OAuth secrets", async () => {
  expect(getWpsStatus().authorized).toBe(false);
  await authorize(); expect(getWpsStatus().authorized).toBe(true);
  const publicStatus = JSON.stringify(getWpsStatus()), bytes = readFileSync(path.join(mocks.folder, "operations.sqlite3")).toString();
  for (const secret of [input.appKey, "private-access-token", "private-refresh-token"]) { expect(publicStatus).not.toContain(secret); expect(bytes).not.toContain(secret); }
});
it("reuses the current WPS session with a single-use, account-bound expiring state", async () => {
  saveWpsSettings(input); const url = new URL(beginWpsAuthorization("shared", "https://example.invalid"));
  expect(url.origin).toBe("https://developer.kdocs.cn"); expect(url.searchParams.has("force_login")).toBe(false);
  expect(url.searchParams.get("redirect_uri")).toBe("https://example.invalid/api/inventory/data-refresh?wps_callback=1");
  const fetcher = vi.fn().mockResolvedValue(token());
  await expect(finishWpsAuthorization("another", "code", url.searchParams.get("state")!, fetcher)).rejects.toThrow("账号"); expect(fetcher).not.toHaveBeenCalled();
  await finishWpsAuthorization("shared", "code", url.searchParams.get("state")!, fetcher);
  await expect(finishWpsAuthorization("shared", "code", url.searchParams.get("state")!, fetcher)).rejects.toThrow("已使用"); expect(fetcher).toHaveBeenCalledOnce();
});
it("rejects expired callbacks and callbacks for replaced app/file configurations", async () => {
  saveWpsSettings(input); const u = new URL(beginWpsAuthorization("shared", "https://example.invalid"));
  const db = new DatabaseSync(path.join(mocks.folder, "operations.sqlite3")); db.exec("UPDATE wps_oauth_states_v1 SET expires_at='2000'"); db.close();
  await expect(finishWpsAuthorization("shared", "code", u.searchParams.get("state")!, vi.fn())).rejects.toThrow("过期");
  const old = new URL(beginWpsAuthorization("shared", "https://example.invalid")); saveWpsSettings({ ...input, fileToken: "new-file" });
  await expect(finishWpsAuthorization("shared", "code", old.searchParams.get("state")!, vi.fn())).rejects.toThrow("过期");
});
it("pauses scheduling and invalidates queued auto-publication authority when the source configuration changes", async () => {
  await authorize();
  const db = new DatabaseSync(path.join(mocks.folder, "operations.sqlite3"));
  db.exec("UPDATE data_sync_schedules_v1 SET enabled=1,last_task_id='in-flight' WHERE key='wps_inventory'");
  saveWpsSettings({ ...input, fileToken: "replacement-file" });
  const schedule = db.prepare("SELECT enabled,last_task_id FROM data_sync_schedules_v1 WHERE key='wps_inventory'").get(); db.close();
  expect(schedule?.enabled).toBe(0); expect(schedule?.last_task_id).toBeNull();
  expect(getWpsStatus().authorized).toBe(false);
});
it.each(["http://files.kdocs.cn/x", "https://files.kdocs.cn.attacker.invalid/x", "https://token@files.kdocs.cn/x", "https://127.0.0.1/x", "https://files.kdocs.cn:8443/x"])("blocks unsafe provider download URL %s", value => {
  expect(() => validateWpsDownloadUrl(value)).toThrow();
});
it("refreshes tokens server-side and checks size/checksum before saving a download without leaking tokens", async () => {
  await authorize(1);
  const bytes = Buffer.from("504b0304616263", "hex"), sha1 = createHash("sha1").update(bytes).digest("hex");
  const fetcher = vi.fn(async (url: URL | string, init?: RequestInit) => {
    const u = new URL(String(url));
    if (u.pathname.endsWith("refresh_token")) { expect(init?.method).toBe("POST"); return token(); }
    if (u.pathname.endsWith("/download")) return new Response(JSON.stringify({ code: 0, data: { fsize: bytes.length, checksums: { sha1 }, url: "https://wpsfile.ks3-cn-beijing.ksyun.com/inventory" } }));
    expect(init?.headers).toBeUndefined(); expect(String(url)).not.toContain("access_token"); return new Response(bytes);
  });
  const d = await downloadWpsInventory(taskId, fetcher as typeof fetch);
  expect(readFileSync(d.file)).toEqual(bytes); expect(d.fileToken).toBe(input.fileToken); expect(fetcher).toHaveBeenCalledTimes(3);
});
it("preserves old data on corrupt or truncated downloads and rejects private DNS results", async () => {
  await authorize(); const bytes = Buffer.from("504b0304616263", "hex");
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { fsize: bytes.length, checksums: { sha1: "a".repeat(40) }, url: "https://files.kdocs.cn/inventory" } }))).mockResolvedValueOnce(new Response(bytes));
  await expect(downloadWpsInventory(taskId, fetcher)).rejects.toThrow("校验失败"); expect(existsSync(path.join(mocks.folder, "incoming", "wps", taskId, "库存规划.xlsx"))).toBe(false);
  mocks.dns.mockResolvedValue([{ address: "192.168.0.1", family: 4 }]);
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { fsize: bytes.length, checksums: { sha1: "a".repeat(40) }, url: "https://files.kdocs.cn/inventory" } })));
  await expect(downloadWpsInventory(taskId, fetcher)).rejects.toThrow("解析异常");
});
it("never exposes API response or network errors containing secrets", async () => {
  saveWpsSettings(input); const url = new URL(beginWpsAuthorization("shared", "https://example.invalid"));
  await expect(finishWpsAuthorization("shared", "code", url.searchParams.get("state")!, vi.fn().mockRejectedValue(new Error("private-app-key-for-test")))).rejects.toThrow("无法连接 WPS");
  expect(getWpsStatus().authorized).toBe(false);
});
