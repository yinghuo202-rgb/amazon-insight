import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildOperatingModel } from "@/lib/inventory/dashboard-view-model";
import { profitabilityRowSchema } from "@/lib/inventory/contracts";
const mocks = vi.hoisted(() => ({ user: vi.fn(), workspace: vi.fn(), load: vi.fn(), members: vi.fn(), list: vi.fn(), find: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireCurrentUser: mocks.user, workspaceForUser: mocks.workspace }));
vi.mock("@/lib/inventory/data", () => ({ loadOperatingModel: mocks.load }));
vi.mock("@/lib/db/prisma", () => ({ prisma: {
  workspaceMember: { findMany: mocks.members }, collaborationTask: { findMany: mocks.list, create: mocks.create },
  $transaction: (callback: (tx: unknown) => unknown) => callback({ collaborationTask: { findUnique: mocks.find, findFirst: mocks.find, create: mocks.create, update: mocks.update, updateMany: mocks.updateMany } }),
} }));
import { GET, PATCH, POST } from "@/app/api/team/route";
const origin = "https://measureman.invalid", at = "2026-10-09T00:00:00.000Z", id = "cm000000000000000000000001";
const request = (body: unknown, method = "POST", requestOrigin = origin) => new Request(origin + "/api/team", { method, headers: { "content-type": "application/json", origin: requestOrigin }, body: JSON.stringify(body) });
const payload = { kind: "review", sku: "SKU-A", market: "US", period: "2026-08", issue: "利润费用待对账", version: "legacy" };
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("NEXT_PUBLIC_APP_URL", origin);
  mocks.user.mockResolvedValue({ id: "shared" }); mocks.workspace.mockResolvedValue({ id: "workspace", name: "shared" });
  mocks.members.mockResolvedValue([]); mocks.list.mockResolvedValue([]); mocks.find.mockResolvedValue(null); mocks.create.mockResolvedValue({ id }); mocks.update.mockResolvedValue({ id }); mocks.updateMany.mockResolvedValue({ count: 1 });
  const row = profitabilityRowSchema.parse({ sku: "SKU-A", market: "US", currency: "USD", reportMonth: "2026-08", units: 100, returns: 4, netUnits: 96, productSales: 1000, settlementPayout: 400, landedCost: 500, grossProfit: -100, advertisingCost: 250, storageCost: 10, actualProfit: -100, currentPrice: 10, grossMargin: -.1, actualMargin: -.1, conservativeMargin: -.1 });
  mocks.load.mockResolvedValue(buildOperatingModel([], { schemaVersion: 1, generatedAt: at, method: "fixture", sources: [], rows: [row] }));
});
afterEach(() => vi.unstubAllEnvs());
it("requires authentication before reading or writing evidence", async () => {
  mocks.user.mockRejectedValue(new Error("UNAUTHENTICATED"));
  expect((await GET(new Request(origin + "/api/team"))).status).toBe(401);
  expect((await POST(request(payload))).status).toBe(401);
  expect(mocks.load).not.toHaveBeenCalled();
});
it("rejects cross-origin writes and malformed JSON before report access", async () => {
  expect((await POST(request(payload, "POST", "https://evil.invalid"))).status).toBe(403);
  expect((await POST(request(null))).status).toBe(422);
  expect(mocks.load).not.toHaveBeenCalled();
});
it("scopes tasks by both SKU and market without including historical unscoped tasks", async () => {
  const response = await GET(new Request(origin + "/api/team?sku=sku-a&market=MX"));
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(mocks.list.mock.calls[0][0].where).toEqual({ workspaceId: "workspace", sku: "SKU-A", market: "MX" });
  expect((await GET(new Request(origin + "/api/team?market=AU"))).status).toBe(422);
});
it("rejects stale versions and fabricated new issues", async () => {
  expect((await POST(request({ ...payload, version: "stale" }))).status).toBe(409);
  expect((await POST(request({ ...payload, issue: "invented" }))).status).toBe(409);
  expect(mocks.create).not.toHaveBeenCalled();
});
it("refreshes existing evidence without overwriting conclusions", async () => {
  const first = await POST(request(payload)); expect(first.status).toBe(200);
  const created = mocks.create.mock.calls[0][0].data;
  mocks.find.mockResolvedValue({ id, ...created, status: "DONE", note: "人工结论保留", updatedAt: new Date(at) });
  expect((await POST(request(payload))).status).toBe(200);
  const update = mocks.update.mock.calls[0][0].data;
  expect(update.status).toBeUndefined(); expect(update.note).toBeUndefined();
  expect(JSON.parse(update.contextJson).baseline).toEqual(JSON.parse(created.contextJson).baseline);
  expect(JSON.parse(update.historyJson)).toHaveLength(2);
});
it("detects concurrent updates and requires a written review conclusion", async () => {
  mocks.find.mockResolvedValue({ id, status: "OPEN", note: null, contextJson: "{}", historyJson: "[]", updatedAt: new Date(at) });
  expect((await PATCH(request({ id, expectedUpdatedAt: "2026-10-08T00:00:00.000Z", status: "REVIEW" }, "PATCH"))).status).toBe(409);
  expect((await PATCH(request({ id, expectedUpdatedAt: at, status: "DONE" }, "PATCH"))).status).toBe(422);
  mocks.updateMany.mockResolvedValue({ count: 0 });
  expect((await PATCH(request({ id, expectedUpdatedAt: at, status: "DONE", note: "已核对" }, "PATCH"))).status).toBe(409);
});
it("does not disclose storage errors or reset corrupt audit history", async () => {
  mocks.find.mockResolvedValue({ id, contextJson: null, historyJson: "{}", status: "OPEN", note: null, updatedAt: new Date(at) });
  expect((await PATCH(request({ id, expectedUpdatedAt: at, status: "REVIEW" }, "PATCH"))).status).toBe(422);
  expect(mocks.updateMany).not.toHaveBeenCalled();
  mocks.list.mockRejectedValue(new Error("private-file-and-secret-key"));
  const response = await GET(new Request(origin + "/api/team"));
  expect(response.status).toBe(500); expect(await response.text()).not.toContain("secret-key");
});
