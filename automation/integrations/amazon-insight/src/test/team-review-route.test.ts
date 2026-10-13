import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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
  const changedModel = await mocks.load(); changedModel.rows[0].history[0].productSales = 900;
  mocks.load.mockResolvedValue({ ...changedModel, dataVersion: "v2", publishedVersion: "new-publication-v2" });
  mocks.updateMany.mockResolvedValue({ count: 1 });
  expect((await POST(request({ ...payload, version: "v2" }))).status).toBe(200);
  const update = mocks.updateMany.mock.calls[0][0].data;
  expect(update.status).toBe("REVIEW"); expect(update.note).toBeUndefined();
  expect(JSON.parse(update.contextJson).baseline).toEqual(JSON.parse(created.contextJson).baseline);
  expect(JSON.parse(update.historyJson)).toHaveLength(2);
  expect(JSON.parse(update.historyJson).at(-1)).toMatchObject({ evidence: { version: "v2", period: "2026-08" }, triggered: true, note: "人工结论保留" });
});
it("does not duplicate same-version evidence and refuses evidence refresh CAS conflicts", async () => {
  await POST(request(payload));
  const created = mocks.create.mock.calls[0][0].data;
  mocks.find.mockResolvedValue({ id, ...created, status: "DONE", note: "人工结论", updatedAt: new Date(at) });
  expect((await POST(request(payload))).status).toBe(200);
  expect(mocks.updateMany).not.toHaveBeenCalled();
  mocks.load.mockResolvedValue({ ...await mocks.load(), dataVersion: "v2" });
  mocks.updateMany.mockResolvedValue({ count: 0 });
  expect((await POST(request({ ...payload, version: "v2" }))).status).toBe(409);
});
it("offers a stable creation-time cursor reaching the 101st task and rejects altered filters", async () => {
  const tasks = Array.from({ length: 101 }, (_, index) => ({ id: `cm${String(101 - index).padStart(23, "0")}`, sku: "SKU-A", market: null, title: `task-${index}`, note: null, status: "OPEN", assignee: null, contextJson: null, historyJson: "[]", createdAt: new Date(at), updatedAt: new Date(at) }));
  mocks.list.mockResolvedValueOnce(tasks).mockResolvedValueOnce([tasks[100]]);
  const first = await GET(new Request(origin + "/api/team?market=legacy&sku=SKU-A"));
  expect(first.status).toBe(200);
  const page = await first.json();
  expect(page.tasks).toHaveLength(100); expect(page.nextCursor).toBeTypeOf("string");
  expect(page.order).toBe("created_desc");
  const second = await GET(new Request(origin + "/api/team?market=legacy&sku=SKU-A&cursor=" + encodeURIComponent(page.nextCursor)));
  expect(second.status).toBe(200); expect((await second.json()).tasks[0].id).toBe(tasks[100].id);
  const where = mocks.list.mock.calls[1][0];
  expect(where.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]); expect(where.take).toBe(101);
  expect((await GET(new Request(origin + "/api/team?market=US&sku=SKU-A&cursor=" + page.nextCursor))).status).toBe(422);
  expect((await GET(new Request(origin + "/api/team?cursor=not-json"))).status).toBe(422);
});
it("the actual SQLite query reaches an older task despite intervening edits and new records", async () => {
  const folder = mkdtempSync(path.join(tmpdir(), "measureman-team-cursor-")), file = path.join(folder, "accounts.db");
  const db = new DatabaseSync(file);
  db.exec("CREATE TABLE CollaborationTask(id TEXT PRIMARY KEY,workspaceId TEXT,sku TEXT,title TEXT,note TEXT,market TEXT,issueKey TEXT,contextJson TEXT,historyJson TEXT DEFAULT '[]',status TEXT DEFAULT 'OPEN',assigneeId TEXT,createdById TEXT,updatedById TEXT,createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP)"); db.close();
  const client = new PrismaClient({ datasources: { db: { url: "file:" + file } } });
  const oldest = "cm" + String(1).padStart(23, "0");
  try {
    await client.collaborationTask.createMany({ data: Array.from({ length: 101 }, (_, i) => ({ id: "cm" + String(i + 1).padStart(23, "0"), workspaceId: "workspace", sku: "SKU-A", title: "历史任务", status: "OPEN", historyJson: "[]", createdById: "shared", updatedById: "shared", createdAt: new Date(at) })) });
    mocks.list.mockImplementation(async query => (await client.collaborationTask.findMany({ ...query, include: undefined })).map(record => ({ ...record, assignee: null })));
    const first = await (await GET(new Request(origin + "/api/team?market=legacy"))).json();
    expect(first.tasks).toHaveLength(100);
    await client.collaborationTask.update({ where: { id: oldest }, data: { status: "DONE", note: "后续人工结论" } });
    await client.collaborationTask.create({ data: { id: "cm000000000000000000000102", workspaceId: "workspace", sku: "SKU-A", title: "刚创建的任务", historyJson: "[]", createdById: "shared", updatedById: "shared", createdAt: new Date("2026-10-13T00:00:00Z") } });
    const next = await (await GET(new Request(origin + "/api/team?market=legacy&cursor=" + first.nextCursor))).json();
    expect(next.tasks).toHaveLength(1);
    expect(next.tasks[0]).toMatchObject({ id: oldest, status: "DONE", note: "后续人工结论", market: null });
    expect(next.nextCursor).toBeNull();
  } finally { await client.$disconnect(); rmSync(folder, { recursive: true, force: true }); }
});
it("detects concurrent updates and requires a written review conclusion", async () => {
  mocks.find.mockResolvedValue({ id, status: "OPEN", note: null, contextJson: "{}", historyJson: "[]", updatedAt: new Date(at) });
  expect((await PATCH(request({ id, expectedUpdatedAt: "2026-10-08T00:00:00.000Z", status: "REVIEW" }, "PATCH"))).status).toBe(409);
  expect((await PATCH(request({ id, expectedUpdatedAt: at, status: "DONE" }, "PATCH"))).status).toBe(422);
  mocks.find.mockResolvedValue({ id, status: "OPEN", note: null, contextJson: null, historyJson: "[]", updatedAt: new Date(at) });
  mocks.updateMany.mockResolvedValue({ count: 0 });
  expect((await PATCH(request({ id, expectedUpdatedAt: at, status: "DONE", note: "已核对" }, "PATCH"))).status).toBe(409);
});
it("binds a written human conclusion to the evidence version without discarding its prior state", async () => {
  await POST(request(payload));
  const created = mocks.create.mock.calls[0][0].data;
  mocks.find.mockResolvedValue({ id, ...created, status: "REVIEW", note: "旧备注", updatedAt: new Date(at) });
  mocks.updateMany.mockResolvedValue({ count: 1 });
  expect((await PATCH(request({ id, expectedUpdatedAt: at, status: "DONE", note: "核对了这版成本" }, "PATCH"))).status).toBe(200);
  const event = JSON.parse(mocks.updateMany.mock.calls[0][0].data.historyJson).at(-1);
  expect(event).toMatchObject({ previousStatus: "REVIEW", status: "DONE", note: "核对了这版成本", evidence: { version: "legacy", period: "2026-08" } });
});
it("does not disclose storage errors or reset corrupt audit history", async () => {
  mocks.find.mockResolvedValue({ id, contextJson: null, historyJson: "{}", status: "OPEN", note: null, updatedAt: new Date(at) });
  expect((await PATCH(request({ id, expectedUpdatedAt: at, status: "REVIEW" }, "PATCH"))).status).toBe(422);
  expect(mocks.updateMany).not.toHaveBeenCalled();
  mocks.list.mockRejectedValue(new Error("private-file-and-secret-key"));
  const response = await GET(new Request(origin + "/api/team"));
  expect(response.status).toBe(500); expect(await response.text()).not.toContain("secret-key");
});
