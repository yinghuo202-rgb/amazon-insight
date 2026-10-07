import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), rebuild: vi.fn(), check: vi.fn(), status: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/inventory/data-refresh", () => ({ runFullDataRefresh: mocks.rebuild, runGerpgoConnectionCheck: mocks.check, getDataRefreshStatus: mocks.status }));
vi.mock("@/lib/inventory/gerpgo", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/inventory/gerpgo")>(), saveGerpgoCredentials: mocks.save }));
import { POST } from "@/app/api/inventory/data-refresh/route";
import { GerpgoConnectionError } from "@/lib/inventory/gerpgo";
const request = (body?: string, headers?: HeadersInit) => new Request("https://example.invalid/api/inventory/data-refresh", { method: "POST", body, headers });
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("NEXT_PUBLIC_APP_URL", ""); mocks.user.mockResolvedValue({ id: "shared" }); mocks.rebuild.mockResolvedValue({ status: "completed" }); });
afterEach(() => vi.unstubAllEnvs());

describe("existing refresh endpoint authorization dispatch", () => {
  it("rejects unauthenticated checks without calling the provider", async () => {
    mocks.user.mockResolvedValue(null);
    expect((await POST(request('{"action":"test_gerpgo"}'))).status).toBe(401);
    expect(mocks.check).not.toHaveBeenCalled();
    expect(mocks.rebuild).not.toHaveBeenCalled();
  });
  it("keeps legacy empty-body rebuild behavior", async () => {
    expect((await POST(request())).status).toBe(200);
    expect(mocks.rebuild).toHaveBeenCalledOnce();
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
  it.each([{}, { ...headers, origin: "https://attacker.invalid" }, { ...headers, "content-type": "text/plain" }])("rejects missing Origin, cross-site Origin and simple form content types", async invalidHeaders => {
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
