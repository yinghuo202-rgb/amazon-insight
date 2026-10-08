import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), rebuild: vi.fn(), check: vi.fn(), status: vi.fn(), save: vi.fn(), settings: vi.fn(), submit: vi.fn(), preview: vi.fn(), candidate: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/inventory/data-refresh", () => ({ runFullDataRefresh: mocks.rebuild, runGerpgoConnectionCheck: mocks.check, getDataRefreshStatus: mocks.status }));
vi.mock("@/lib/inventory/gerpgo", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/inventory/gerpgo")>(), saveGerpgoCredentials: mocks.save, getGerpgoSettingsStatus: mocks.settings }));
vi.mock("@/lib/inventory/refresh-task-store", () => ({ submitRefreshTask: mocks.submit, listRefreshTasks: vi.fn() }));
vi.mock("@/lib/inventory/gerpgo-preview", async original => ({ ...await original<typeof import("@/lib/inventory/gerpgo-preview")>(), readGerpgoPreview: mocks.preview, readGerpgoCandidatePage: mocks.candidate }));
import { GET, POST } from "@/app/api/inventory/data-refresh/route";
import { GerpgoConnectionError } from "@/lib/inventory/gerpgo";
const request = (body?: string, headers?: HeadersInit) => new Request("https://example.invalid/api/inventory/data-refresh", { method: "POST", body, headers: { origin: "https://example.invalid", ...headers } });
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("NEXT_PUBLIC_APP_URL", ""); mocks.user.mockResolvedValue({ id: "shared" }); mocks.settings.mockReturnValue({ configured: false }); mocks.status.mockResolvedValue({ summary: { missingCount: 0 } }); mocks.submit.mockReturnValue({ status: "queued" }); });
afterEach(() => vi.unstubAllEnvs());

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
