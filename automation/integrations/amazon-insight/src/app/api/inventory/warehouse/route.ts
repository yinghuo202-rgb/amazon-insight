import { z } from "zod";

import { requireCurrentUser, workspaceForUser } from "@/lib/auth";
import { approveStockDocument, createStockDocument, createWarehouse, createWarehouseLocation, createWarehouseProduct, voidDraftDocument, warehouseSnapshot } from "@/lib/inventory/warehouse-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const code = z.string().trim().min(1).max(80);
const sku = z.string().trim().min(1).max(80).transform((value) => value.toUpperCase());
const createSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("warehouse"), code, name: z.string().trim().min(1).max(120), kind: z.enum(["DOMESTIC", "TRANSIT", "OVERSEAS"]).optional() }),
  z.object({ action: z.literal("location"), warehouseId: z.string().cuid(), code, name: z.string().trim().min(1).max(120) }),
  z.object({ action: z.literal("product"), warehouseId: z.string().cuid(), productCode: code, sku, barcode: z.string().trim().max(120).optional(), name: z.string().trim().min(1).max(200), unit: z.string().trim().max(20).optional(), cartonQty: z.number().int().positive().max(1_000_000).optional() }),
  z.object({
    action: z.literal("document"),
    type: z.enum(["RECEIPT", "OUTBOUND", "ADJUSTMENT", "TRANSFER"]),
    warehouseId: z.string().cuid(), targetWarehouseId: z.string().cuid().optional(),
    supplier: z.string().trim().max(160).optional(), reference: z.string().trim().max(160).optional(), note: z.string().trim().max(1000).optional(),
    lines: z.array(z.object({ sku, productCode: z.string().trim().max(80).optional(), lotCode: z.string().trim().max(120).optional(), poNumber: z.string().trim().max(120).optional(), locationId: z.string().cuid().optional(), quantity: z.number().int().positive().max(1_000_000), direction: z.enum(["IN", "OUT"]).optional(), unitCost: z.number().finite().nonnegative().max(100_000_000).optional() })).min(1).max(500),
  }),
]);
const updateSchema = z.object({ action: z.enum(["approve", "void"]), documentId: z.string().cuid() });

async function context(requireAdmin = false) {
  const user = await requireCurrentUser();
  if (requireAdmin && user.role !== "ADMIN") throw new Error("FORBIDDEN");
  const workspace = await workspaceForUser(user.id);
  return { user, workspace };
}

export async function GET() {
  try {
    const { workspace } = await context(true);
    return Response.json(await warehouseSnapshot(workspace.id));
  } catch (error) {
    return Response.json({ error: error instanceof Error && error.message === "UNAUTHENTICATED" ? "请先登录。" : "仓库数据读取失败。" }, { status: 401 });
  }
}

export async function POST(request: Request) {
  try {
    const { user, workspace } = await context(true);
    const payload = createSchema.parse(await request.json());
    if (payload.action === "warehouse") return Response.json({ warehouse: await createWarehouse(workspace.id, user.id, payload) }, { status: 201 });
    if (payload.action === "location") return Response.json({ location: await createWarehouseLocation(workspace.id, user.id, payload) }, { status: 201 });
    if (payload.action === "product") return Response.json({ product: await createWarehouseProduct(workspace.id, user.id, payload) }, { status: 201 });
    const input = { type: payload.type, warehouseId: payload.warehouseId, targetWarehouseId: payload.targetWarehouseId, supplier: payload.supplier, reference: payload.reference, note: payload.note, lines: payload.lines };
    return Response.json({ document: await createStockDocument(workspace.id, user.id, input) }, { status: 201 });
  } catch (error) {
    const status = error instanceof Error && error.message === "FORBIDDEN" ? 403 : error instanceof z.ZodError ? 400 : 400;
    return Response.json({ error: error instanceof z.ZodError ? "仓库信息或单据明细格式不正确。" : error instanceof Error ? error.message : "仓库操作失败。" }, { status });
  }
}

export async function PATCH(request: Request) {
  try {
    const { user, workspace } = await context(true);
    const payload = updateSchema.parse(await request.json());
    const document = payload.action === "approve"
      ? await approveStockDocument(workspace.id, user.id, payload.documentId)
      : await voidDraftDocument(workspace.id, user.id, payload.documentId);
    return Response.json({ document });
  } catch (error) {
    const status = error instanceof Error && error.message === "FORBIDDEN" ? 403 : error instanceof z.ZodError ? 400 : 400;
    return Response.json({ error: error instanceof z.ZodError ? "单据操作参数不正确。" : error instanceof Error ? error.message : "单据操作失败。" }, { status });
  }
}
