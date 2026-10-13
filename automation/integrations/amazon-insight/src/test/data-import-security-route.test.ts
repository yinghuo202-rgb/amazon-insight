import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
const mocks = vi.hoisted(() => ({ user: vi.fn(), shared: vi.fn(), verify: vi.fn(), cookies: vi.fn(), publish: vi.fn(), restore: vi.fn(), initialize: vi.fn(), finalize: vi.fn(), chunk: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireCurrentUser: mocks.user, getSharedLoginUser: mocks.shared, verifyPassword: mocks.verify, SESSION_COOKIE: "measureman_session" }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/inventory/data-import", () => ({ publishImportBatch: mocks.publish, restoreDataVersion: mocks.restore, initializeChunkedImport: mocks.initialize, finalizeChunkedImport: mocks.finalize, appendImportChunk: mocks.chunk, listImportBatches: vi.fn(), listDataVersions: vi.fn() }));
import { PATCH, POST, PUT } from "@/app/api/inventory/data-import/route";
const batchId = "batch-20261013-synthetic";
const version = "data-20261013-000000-test";
let folder: string;
const request = (method: string, body: unknown, headers: Record<string, string> = {}) => new Request("https://example.invalid/api/inventory/data-import", { method, headers: { origin: "https://example.invalid", "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.invalid");
  folder = mkdtempSync(path.join(tmpdir(), "data-import-route-"));
  vi.stubEnv("STORE_OPS_RUNTIME_ROOT", folder); vi.stubEnv("STORE_OPS_UPLOAD_ROOT", path.join(folder, "uploads")); vi.stubEnv("STORE_OPS_SNAPSHOT_ROOT", path.join(folder, "snapshots")); vi.stubEnv("STORE_OPS_STATE_DB", path.join(folder, "state.sqlite3"));
  mkdirSync(path.join(folder, "reports")); writeFileSync(path.join(folder, "reports", "manual.json"), '{"notes":"human-kept"}');
  mkdirSync(path.join(folder, "uploads", batchId, "source"), { recursive: true });
  writeFileSync(path.join(folder, "uploads", batchId, "source", "test.xlsx"), "synthetic-source");
  writeFileSync(path.join(folder, "uploads", batchId, "manifest.json"), JSON.stringify({ status: "ready", summary: { publishableCount: 1 }, files: [{ name: "test.xlsx" }] }));
  mkdirSync(path.join(folder, "snapshots", version, "reports"), { recursive: true }); writeFileSync(path.join(folder, "snapshots", version, "reports", "test.json"), '{"rows":[1]}');
  mocks.user.mockResolvedValue({ id: "shared" }); mocks.cookies.mockResolvedValue({ get: () => ({ value: "synthetic-session" }) }); mocks.shared.mockResolvedValue({ id: "shared", passwordHash: "synthetic-hash" }); mocks.verify.mockReturnValue(false); mocks.publish.mockResolvedValue({ batchId }); mocks.restore.mockResolvedValue({ status: "restored" }); mocks.chunk.mockResolvedValue({ received: 15, size: 15 });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); rmSync(folder, { recursive: true, force: true }); });

it("requires a fresh confirmation rather than a logged-in session or a client boolean", async () => {
  expect((await PATCH(request("PATCH", { batchId }))).status).toBe(409);
  expect((await PATCH(request("PATCH", { batchId, confirmed: true }))).status).toBeGreaterThanOrEqual(400);
  expect(mocks.publish).not.toHaveBeenCalled();
});
it("rejects unsigned-in writes before accessing any publication functions", async () => {
  mocks.user.mockRejectedValue(new Error("UNAUTHENTICATED"));
  expect((await PATCH(request("PATCH", { batchId }))).status).toBe(401);
  expect(mocks.publish).not.toHaveBeenCalled();
});
it("rejects missing or foreign Origin and non-JSON publication requests", async () => {
  const invalidHeaders: Array<Record<string, string>> = [{ origin: "" }, { origin: "https://attacker.invalid" }, { "content-type": "text/plain" }];
  for (const headers of invalidHeaders) {
    expect((await PATCH(request("PATCH", { batchId }, headers))).status).toBe(403);
  }
  expect(mocks.publish).not.toHaveBeenCalled();
});

async function confirm(operation = "publish") {
  mocks.verify.mockReturnValue(true);
  const response = await POST(request("POST", { action: "confirm_operation", operation, ...(operation === "publish" ? { batchId } : { version }), currentPassword: "synthetic-password" }));
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  const payload = await response.json();
  expect(JSON.stringify(payload)).not.toContain("synthetic-password");
  return payload.confirmation.token as string;
}
it("rejects incorrect password without issuing or publishing", async () => {
  const response = await POST(request("POST", { action: "confirm_operation", operation: "publish", batchId, currentPassword: "incorrect-synthetic-password" }));
  expect(response.status).toBe(403); expect((await response.json()).confirmation).toBeUndefined();
  expect(mocks.publish).not.toHaveBeenCalled();
});
it.each([true, false])("reserves only five same-session concurrent password attempts before async lookup (valid=%s)", async valid => {
  let release!: () => void, settled = 0;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  mocks.verify.mockReturnValue(valid);
  mocks.shared.mockImplementation(async () => { await barrier; return { id: "shared", passwordHash: "synthetic-hash" }; });
  const pending = Array.from({ length: 12 }, () => POST(request("POST", { action: "confirm_operation", operation: "publish", batchId, currentPassword: "synthetic-password" })).then(response => { settled++; return response; }));
  try {
    // Every request is either blocked by the lookup barrier or already rejected.
    await vi.waitFor(() => expect(mocks.shared.mock.calls.length + settled).toBe(12));
  } finally { release(); }
  const responses = await Promise.all(pending);
  expect(responses.filter(response => response.status === 429)).toHaveLength(7);
  expect(responses.filter(response => response.status === (valid ? 200 : 403))).toHaveLength(5);
  expect(mocks.shared).toHaveBeenCalledTimes(5);
  expect(mocks.verify).toHaveBeenCalledTimes(5);
  // A new request opens another SQLite connection and still sees exhaustion.
  expect((await POST(request("POST", { action: "confirm_operation", operation: "publish", batchId, currentPassword: "synthetic-password" }))).status).toBe(429);
});
it.each(["publish", "restore"])("executes a correctly confirmed %s once with mandatory Python guard hashes", async action => {
  const token = await confirm(action), body = { action, ...(action === "publish" ? { batchId } : { version }), confirmationToken: token };
  expect((await PATCH(request("PATCH", body))).status).toBe(200);
  const operation = action === "publish" ? mocks.publish : mocks.restore;
  expect(operation).toHaveBeenCalledWith(action === "publish" ? batchId : version, { expectedBaseline: expect.stringMatching(/^[a-f0-9]{64}$/), expectedTarget: expect.stringMatching(/^[a-f0-9]{64}$/) });
  expect((await PATCH(request("PATCH", body))).status).toBe(409);
  expect(operation).toHaveBeenCalledOnce();
});
it.each(["expired", "session", "operation", "baseline", "target_contents"])("rejects confirmation changed by %s without calling a publisher", async change => {
  const token = await confirm();
  if (change === "expired") vi.spyOn(Date, "now").mockReturnValue(Date.now() + 120001);
  if (change === "session") mocks.cookies.mockResolvedValue({ get: () => ({ value: "different-synthetic-session" }) });
  if (change === "baseline") writeFileSync(path.join(folder, "reports", "manual.json"), '{"notes":"human-newer"}');
  if (change === "target_contents") writeFileSync(path.join(folder, "uploads", batchId, "source", "test.xlsx"), "changed-synthetic-source");
  const body = change === "operation" ? { action: "restore", version, confirmationToken: token } : { batchId, confirmationToken: token };
  expect((await PATCH(request("PATCH", body))).status).toBe(409);
  expect(mocks.publish).not.toHaveBeenCalled(); expect(mocks.restore).not.toHaveBeenCalled();
});
it("does not restore a consumed confirmation when publication fails or leak private errors", async () => {
  const token = await confirm(); mocks.publish.mockRejectedValue(new Error("synthetic-private-error-and-password"));
  const body = { batchId, confirmationToken: token }, response = await PATCH(request("PATCH", body));
  expect(response.status).toBe(400); expect(JSON.stringify(await response.json())).not.toContain("synthetic-private");
  expect((await PATCH(request("PATCH", body))).status).toBe(409); expect(mocks.publish).toHaveBeenCalledOnce();
});
it("retains binary chunk uploads but requires the same Origin and octet-stream", async () => {
  const url = `https://example.invalid/api/inventory/data-import?batchId=${batchId}&fileIndex=0&offset=0`;
  expect((await PUT(new Request(url, { method: "PUT", body: "synthetic-bytes", headers: { origin: "https://attacker.invalid", "content-type": "application/octet-stream" } }))).status).toBe(403);
  expect(mocks.chunk).not.toHaveBeenCalled();
  expect((await PUT(new Request(url, { method: "PUT", body: "synthetic-bytes", headers: { origin: "https://example.invalid", "content-type": "application/octet-stream" } }))).status).toBe(200);
  expect(mocks.chunk).toHaveBeenCalledOnce();
});
it("protects upload initialization and rejects plaintext password confirmation", async () => {
  expect((await POST(request("POST", { action: "initialize", files: [] }, { "content-type": "text/plain" }))).status).toBe(403);
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://example.invalid");
  const response = await POST(request("POST", { action: "confirm_operation", operation: "publish", batchId, currentPassword: "synthetic-password" }, { origin: "http://example.invalid" }));
  expect(response.status).toBe(403);
  expect(mocks.verify).not.toHaveBeenCalled();
});
