import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), workspace: vi.fn(), warehouses: vi.fn(), documents: vi.fn(), cursor: vi.fn(), lots: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireCurrentUser: mocks.user, workspaceForUser: mocks.workspace }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { warehouse: { findMany: mocks.warehouses }, stockDocument: { findMany: mocks.documents, findFirst: mocks.cursor }, inventoryLot: { findMany: mocks.lots } } }));
import { supplyChainSnapshot } from "@/lib/inventory/warehouse-store";
import { GET } from "@/app/api/inventory/supply-chain/route";

const id = "cm000000000000000000000001";
const document = (index: number) => ({ id: "doc-" + index, documentNo: "CK-" + index, type: "OUTBOUND", reference: null, approvedAt: new Date("2026-10-13T00:00:00Z"), warehouse: { code: "CN", name: "国内仓" }, targetWarehouse: null, lines: [{ sku: "SKU-A", quantity: 2, lotCode: "LOT-A", poNumber: null, allocations: [{ quantity: 2, method: "FIFO", lot: { lotCode: "LOT-A", poNumber: "PO-A", receivedAt: new Date("2026-09-01T00:00:00Z") } }] }] });
beforeEach(() => {
  vi.resetAllMocks(); mocks.user.mockResolvedValue({ id: "shared" }); mocks.workspace.mockResolvedValue({ id: "workspace" });
  mocks.warehouses.mockResolvedValue([]); mocks.documents.mockResolvedValue([]); mocks.lots.mockResolvedValue([]); mocks.cursor.mockResolvedValue({ id });
});

it("filters the complete workspace history by document and allocated batch before taking a page", async () => {
  mocks.documents.mockResolvedValue([document(250)]);
  const page = await supplyChainSnapshot("workspace", { query: " LOT-A ", view: "outbound" });
  const args = mocks.documents.mock.calls[0][0];
  expect(args.where).toMatchObject({ workspaceId: "workspace", status: "APPROVED", type: { in: ["OUTBOUND", "TRANSFER"] } });
  expect(args.where.OR).toContainEqual({ lines: { some: { OR: [
    { sku: { contains: "LOT-A" } }, { poNumber: { contains: "LOT-A" } }, { lotCode: { contains: "LOT-A" } },
    { allocations: { some: { lot: { OR: [{ lotCode: { contains: "LOT-A" } }, { poNumber: { contains: "LOT-A" } }] } } } },
  ] } } });
  expect(args.take).toBe(201);
  expect(page.documents[0].documentNo).toBe("CK-250");
  expect(page.documents[0].lines[0].allocations[0].method).toBe("FIFO");
  expect(page.nextCursor).toBeNull();
});

it("provides a stable cursor after 200 matches and continuously loads older history", async () => {
  mocks.documents.mockResolvedValueOnce(Array.from({ length: 201 }, (_, i) => document(i))).mockResolvedValueOnce([document(200), document(201)]);
  const first = await supplyChainSnapshot("workspace", { view: "timeline" });
  expect(first.documents).toHaveLength(200); expect(first.nextCursor).toBe("doc-199");
  const next = await supplyChainSnapshot("workspace", { view: "timeline", cursor: first.nextCursor! });
  expect(next.documents.map(item => item.id)).toEqual(["doc-200", "doc-201"]); expect(next.nextCursor).toBeNull();
  expect(mocks.documents.mock.calls[1][0]).toMatchObject({ cursor: { id: "doc-199" }, skip: 1, orderBy: [{ approvedAt: "desc" }, { id: "desc" }] });
  expect(mocks.cursor.mock.calls[0][0].where.AND[0]).toMatchObject({ workspaceId: "workspace", status: "APPROVED" });
});

it("keeps the query endpoint authenticated, validates parameters and disables caching", async () => {
  const response = await GET(new Request("https://measureman.invalid/api/inventory/supply-chain?query=LOT-A&view=timeline&cursor=" + id));
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(mocks.documents.mock.calls[0][0].where.workspaceId).toBe("workspace");
  expect((await GET(new Request("https://measureman.invalid/api/inventory/supply-chain?cursor=invalid"))).status).toBe(422);
  mocks.cursor.mockResolvedValue(null);
  expect((await GET(new Request("https://measureman.invalid/api/inventory/supply-chain?cursor=" + id))).status).toBe(409);
  mocks.user.mockRejectedValue(new Error("UNAUTHENTICATED"));
  const calls = mocks.documents.mock.calls.length;
  expect((await GET(new Request("https://measureman.invalid/api/inventory/supply-chain"))).status).toBe(401);
  expect(mocks.documents).toHaveBeenCalledTimes(calls);
});

it("distinguishes backend failures from authentication failures without exposing storage details", async () => {
  mocks.documents.mockRejectedValue(new Error("private-database-path"));
  const response = await GET(new Request("https://measureman.invalid/api/inventory/supply-chain"));
  expect(response.status).toBe(500); expect(await response.text()).not.toContain("private-database-path");
});
