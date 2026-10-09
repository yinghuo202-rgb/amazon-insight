import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), rebuild: vi.fn(), check: vi.fn(), status: vi.fn(), save: vi.fn(), settings: vi.fn(), submit: vi.fn(), preview: vi.fn(), candidate: vi.fn(), schedules: vi.fn(), scheduleSave: vi.fn(), restart: vi.fn(), wpsStatus: vi.fn(), wpsSave: vi.fn(), wpsBegin: vi.fn(), wpsFinish: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/inventory/data-refresh", () => ({ runFullDataRefresh: mocks.rebuild, runGerpgoConnectionCheck: mocks.check, getDataRefreshStatus: mocks.status }));
vi.mock("@/lib/inventory/gerpgo", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/inventory/gerpgo")>(), saveGerpgoCredentials: mocks.save, getGerpgoSettingsStatus: mocks.settings }));
vi.mock("@/lib/inventory/refresh-task-store", async original => ({ ...await original<typeof import("@/lib/inventory/refresh-task-store")>(), submitRefreshTask: mocks.submit, listRefreshTasks: vi.fn(), listSyncSchedules: mocks.schedules, saveSyncSchedule: mocks.scheduleSave, restartSyncSchedule: mocks.restart }));
vi.mock("@/lib/inventory/wps", async original => ({ ...await original<typeof import("@/lib/inventory/wps")>(), getWpsStatus: mocks.wpsStatus, saveWpsSettings: mocks.wpsSave, beginWpsAuthorization: mocks.wpsBegin, finishWpsAuthorization: mocks.wpsFinish }));
vi.mock("@/lib/inventory/gerpgo-preview", async original => ({ ...await original<typeof import("@/lib/inventory/gerpgo-preview")>(), readGerpgoPreview: mocks.preview, readGerpgoCandidatePage: mocks.candidate }));
import { GET, POST } from "@/app/api/inventory/data-refresh/route";
import { GerpgoConnectionError } from "@/lib/inventory/gerpgo";
const request = (body?: string, headers?: HeadersInit) => new Request("https://example.invalid/api/inventory/data-refresh", { method: "POST", body, headers: { origin: "https://example.invalid", ...headers } });
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("NEXT_PUBLIC_APP_URL", ""); mocks.user.mockResolvedValue({ id: "shared" }); mocks.settings.mockReturnValue({ configured: false }); mocks.wpsStatus.mockReturnValue({ authorized: false }); mocks.schedules.mockReturnValue([]); mocks.status.mockResolvedValue({ summary: { missingCount: 0 } }); mocks.submit.mockReturnValue({ status: "queued" }); });
afterEach(() => vi.unstubAllEnvs());

describe("durable schedule and WPS writes reuse session and CSRF checks", () => {
  const headers = { "content-type": "application/json" };
  it("saves bounded schedules but rejects unknown sources and simple cross-site forms", async () => {
    const input = { action: "save_sync_schedule", key: "gerpgo", enabled: true, intervalMinutes: 240, autoPublish: true };
    expect((await POST(request(JSON.stringify(input), headers))).status).toBe(200);
    expect(mocks.scheduleSave).toHaveBeenCalledWith({ key: "gerpgo", enabled: true, intervalMinutes: 240, autoPublish: true });
    expect((await POST(request(JSON.stringify({ ...input, key: "AU" }), headers))).status).toBe(422);
    expect((await POST(request(JSON.stringify({ ...input, intervalMinutes: 1 }), headers))).status).toBe(422);
    expect((await POST(request(JSON.stringify(input), { ...headers, origin: "https://attacker.invalid" }))).status).toBe(403);
    expect((await POST(request(JSON.stringify(input)))).status).toBe(403);
    expect(mocks.scheduleSave).toHaveBeenCalledOnce();
  });
  it("requires explicit interrupted-task recovery and blocks recovery of running jobs", async () => {
    expect((await POST(request('{"action":"restart_sync_schedule","key":"gerpgo","acknowledged":false}', headers))).status).toBe(422);
    mocks.restart.mockImplementation(() => { throw new Error("running"); });
    expect((await POST(request('{"action":"restart_sync_schedule","key":"gerpgo","acknowledged":true}', headers))).status).toBe(409);
  });
  it("does not download WPS in an HTTP request and requires stored authorization", async () => {
    expect((await POST(request('{"action":"pull_wps"}', headers))).status).toBe(422);
    mocks.wpsStatus.mockReturnValue({ authorized: true });
    expect((await POST(request('{"action":"pull_wps"}', headers))).status).toBe(202);
    expect(mocks.submit).toHaveBeenCalledWith("wps_inventory");
  });
  it("protects WPS keys over plaintext HTTP and redirects callback without exposing code or secrets", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://example.invalid");
    expect((await POST(request(JSON.stringify({ action: "save_wps_settings", appId: "id", appKey: "key", fileToken: "file", shareUrl: "https://www.kdocs.cn/l/Example123" }), { ...headers, origin: "http://example.invalid" }))).status).toBe(403);
    expect(mocks.wpsSave).not.toHaveBeenCalled();
    const response = await GET(new Request("https://example.invalid/api/inventory/data-refresh?wps_callback=1&code=private-code&state=test-state"));
    expect(mocks.wpsFinish).toHaveBeenCalledWith("shared", "private-code", "test-state");
    expect(response.status).toBe(303); expect(response.headers.get("location")).toBe("/inventory/data?wps=authorized");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    mocks.user.mockResolvedValue(null);
    expect((await GET(new Request("https://example.invalid/api/inventory/data-refresh?wps_callback=1"))).status).toBe(401);
  });
});

describe("existing refresh endpoint authorization dispatch", () => {
  it("queues explicit core/full imports but rejects unconfigured and invalid options", async () => {
    expect((await POST(request('{"action":"pull_gerpgo"}'))).status).toBe(422);
    expect(mocks.submit).not.toHaveBeenCalled();
    mocks.settings.mockReturnValue({ configured: true });
    expect((await POST(request('{"action":"pull_gerpgo"}'))).status).toBe(202);
    expect(mocks.submit).toHaveBeenLastCalledWith("gerpgo", { includeSupplemental: false });
    expect((await POST(request('{"action":"pull_gerpgo","includeSupplemental":true}'))).status).toBe(202);
    expect(mocks.submit).toHaveBeenLastCalledWith("gerpgo", { includeSupplemental: true });
    expect((await POST(request('{"action":"pull_gerpgo","includeSupplemental":"true"}'))).status).toBe(422);
    expect((await POST(request('{"action":"pull_gerpgo","storeId":99}'))).status).toBe(422);
    expect(mocks.submit).toHaveBeenCalledTimes(2);
  });
  it("rejects unauthenticated checks without calling the provider", async () => {
    mocks.user.mockResolvedValue(null);
    expect((await POST(request('{"action":"test_gerpgo"}'))).status).toBe(401);
    expect(mocks.check).not.toHaveBeenCalled();
    expect(mocks.rebuild).not.toHaveBeenCalled();
  });
  it("queues empty-body rebuild without executing it in the web request", async () => {
    expect((await POST(request())).status).toBe(202);
    expect(mocks.submit).toHaveBeenCalledWith("rebuild");
    expect(mocks.rebuild).not.toHaveBeenCalled();
    expect(mocks.check).not.toHaveBeenCalled();
  });
  it("checks the connection without rebuilding any reports", async () => {
    mocks.check.mockResolvedValue({ status: "authorized", marketAccess: true });
    const response = await POST(request('{"action":"test_gerpgo"}'));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.check).toHaveBeenCalledOnce();
    expect(mocks.rebuild).not.toHaveBeenCalled();
  });
  it.each(['{', 'null', '[]', '{}', '{"action":"unknown"}', '{"action":"test_gerpgo","appKey":"do-not-accept"}'])("does not rebuild for malformed or unsupported actions", async body => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.check).not.toHaveBeenCalled();
    expect(mocks.rebuild).not.toHaveBeenCalled();
  });
  it("surfaces safe configuration errors and redacts unexpected failures", async () => {
    mocks.check.mockRejectedValueOnce(new GerpgoConnectionError("未配置凭证", 422));
    expect((await POST(request('{"action":"test_gerpgo"}'))).status).toBe(422);
    mocks.check.mockRejectedValueOnce(new Error("secret-key-and-token"));
    expect(JSON.stringify(await (await POST(request('{"action":"test_gerpgo"}'))).json())).not.toContain("secret-key-and-token");
  });
});

describe("reviewed publication reuses the authenticated refresh endpoint", () => {
  const approval = { action: "publish_gerpgo", sourceTaskId: "d8a4f702-f57b-4aa1-8300-9bfcb005e001", previewHash: "a".repeat(64), confirmed: true };
  const headers = { "content-type": "application/json" };
  it("requires explicit confirmation and does not call the provider or publish in HTTP", async () => {
    mocks.preview.mockResolvedValue({ blocked: false, previewHash: approval.previewHash });
    expect((await POST(request(JSON.stringify({ ...approval, confirmed: false }), headers))).status).toBe(422);
    expect(mocks.submit).not.toHaveBeenCalled();
    expect((await POST(request(JSON.stringify(approval), headers))).status).toBe(202);
    expect(mocks.submit).toHaveBeenCalledWith("gerpgo_publish", { sourceTaskId: approval.sourceTaskId, previewHash: approval.previewHash, confirmed: true });
    expect(mocks.check).not.toHaveBeenCalled();
    expect(mocks.rebuild).not.toHaveBeenCalled();
  });
  it.each([{ blocked: true, previewHash: "a".repeat(64) }, { blocked: false, previewHash: "b".repeat(64) }])("rejects blocked or changed previews", async preview => {
    mocks.preview.mockResolvedValue(preview);
    expect((await POST(request(JSON.stringify(approval), headers))).status).toBe(409);
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("protects preview records and prevents appending a changed preview version", async () => {
    mocks.user.mockResolvedValueOnce(null);
    expect((await GET(new Request("https://example.invalid/api/inventory/data-refresh?preview=" + approval.sourceTaskId))).status).toBe(401);
    expect(mocks.preview).not.toHaveBeenCalled();
    mocks.preview.mockResolvedValue({ previewHash: approval.previewHash });
    expect((await GET(new Request("https://example.invalid/api/inventory/data-refresh?preview=" + approval.sourceTaskId + "&offset=20&version=wrong"))).status).toBe(409);
    expect(mocks.candidate).not.toHaveBeenCalled();
    expect((await GET(new Request("https://example.invalid/api/inventory/data-refresh?preview=" + approval.sourceTaskId + "&offset=-1"))).status).toBe(400);
  });
});

describe("credential writes require a signed-in same-origin HTTPS browser request", () => {
  const body = JSON.stringify({ action: "save_gerpgo_credentials", appId: "test-id", appKey: "test-key" });
  const headers = { origin: "https://example.invalid", "content-type": "application/json" };
  it("saves through the existing endpoint without rebuilding or connecting", async () => {
    mocks.save.mockReturnValue({ configured: true, source: "database" });
    const response = await POST(request(body, headers));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.save).toHaveBeenCalledWith({ appId: "test-id", appKey: "test-key" });
    expect(mocks.check).not.toHaveBeenCalled();
    expect(mocks.rebuild).not.toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).not.toContain("test-key");
  });
  it.each([{ origin: "" }, { ...headers, origin: "https://attacker.invalid" }, { ...headers, "content-type": "text/plain" }])("rejects missing Origin, cross-site Origin and simple form content types", async invalidHeaders => {
    expect((await POST(request(body, invalidHeaders))).status).toBe(403);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("rejects public plaintext HTTP but permits TLS termination at the proxy", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://example.invalid");
    expect((await POST(request(body, { ...headers, origin: "http://example.invalid" }))).status).toBe(403);
    expect(mocks.save).not.toHaveBeenCalled();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.invalid");
    expect((await POST(new Request("http://app:3000/api/inventory/data-refresh", { method: "POST", body, headers }))).status).toBe(200);
  });
  it("rejects unauthenticated, malformed and oversized saves", async () => {
    mocks.user.mockResolvedValueOnce(null);
    expect((await POST(request(body, headers))).status).toBe(401);
    expect((await POST(request('{"action":"save_gerpgo_credentials","appId":1,"appKey":"key"}', headers))).status).toBe(422);
    expect((await POST(request("x".repeat(8193), headers))).status).toBe(413);
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
