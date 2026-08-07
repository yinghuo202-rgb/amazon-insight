import { z } from "zod";

import { loadBaseInventoryDashboardData, loadBaseProductCatalogData } from "@/lib/inventory/data";
import { deleteOperationalDataOverrides, listOperationalDataOverrides, saveInventoryOverrides, saveProductMasterOverrides } from "@/lib/inventory/operational-data-store";

export const runtime = "nodejs";

const sku = z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,32}$/);
const nullableNumber = z.number().finite().nonnegative().max(1_000_000).nullable();
const inventoryItem = z.object({
  market: z.enum(["US", "CA"]),
  sku,
  fbaSellable: z.number().int().nonnegative().max(10_000_000),
  awdAvailable: z.number().int().nonnegative().max(10_000_000),
  awdOutboundToFba: z.number().int().nonnegative().max(10_000_000),
  awdInbound: z.number().int().nonnegative().max(10_000_000),
  localInventory: z.number().int().nonnegative().max(10_000_000),
});
const productItem = z.object({
  sku,
  chineseName: z.string().trim().max(300),
  englishName: z.string().trim().max(300),
  category: z.string().trim().max(100),
  packaging: z.string().trim().max(200),
  cartonQty: z.number().int().positive().max(1_000_000).nullable(),
  productWeightG: nullableNumber,
  shippingSizeCm: z.string().trim().max(100),
  cartonGrossWeightKg: nullableNumber,
  cartonLengthCm: nullableNumber,
  cartonWidthCm: nullableNumber,
  cartonHeightCm: nullableNumber,
});
const saveSchema = z.discriminatedUnion("entity", [
  z.object({ entity: z.literal("inventory"), items: z.array(inventoryItem).min(1).max(1000) }),
  z.object({ entity: z.literal("product"), items: z.array(productItem).min(1).max(1000) }),
]);
const deleteSchema = z.object({
  entity: z.enum(["inventory", "product"]),
  keys: z.array(z.object({ sku, market: z.enum(["US", "CA"]).optional() })).min(1).max(1000),
});

export async function GET() {
  return Response.json(listOperationalDataOverrides());
}

export async function POST(request: Request) {
  try {
    const payload = saveSchema.parse(await request.json());
    await assertKnown(payload.entity, payload.items);
    const result = payload.entity === "product"
      ? saveProductMasterOverrides(payload.items)
      : saveInventoryOverrides(payload.items);
    return Response.json({ status: "completed", ...result });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "在线编辑参数不完整或格式不正确。", details: error.flatten() }, { status: 400 });
    return Response.json({ error: error instanceof Error ? error.message : "在线数据保存失败。" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const payload = deleteSchema.parse(await request.json());
    await assertKnown(payload.entity, payload.keys);
    return Response.json({ status: "completed", ...deleteOperationalDataOverrides(payload.entity, payload.keys) });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "恢复源数据参数格式不正确。", details: error.flatten() }, { status: 400 });
    return Response.json({ error: error instanceof Error ? error.message : "恢复源数据失败。" }, { status: 500 });
  }
}

async function assertKnown(entity: "inventory" | "product", items: Array<{ sku: string; market?: "US" | "CA" }>) {
  if (entity === "product") {
    const known = new Set((await loadBaseProductCatalogData()).items.map((item) => item.sku));
    const unknown = items.filter((item) => !known.has(item.sku));
    if (unknown.length) throw new Error(`产品目录中不存在：${unknown.slice(0, 10).map((item) => item.sku).join("、")}`);
    return;
  }
  const [us, ca] = await Promise.all([loadBaseInventoryDashboardData("US"), loadBaseInventoryDashboardData("CA")]);
  const known = { US: new Set(us.rows.map((item) => item.sku)), CA: new Set(ca.rows.map((item) => item.sku)) };
  const unknown = items.filter((item) => !known[item.market ?? "US"].has(item.sku));
  if (unknown.length) throw new Error(`库存目录中不存在：${unknown.slice(0, 10).map((item) => `${item.market}:${item.sku}`).join("、")}`);
}
