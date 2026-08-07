import { z } from "zod";

import { loadBaseProductCatalogData } from "@/lib/inventory/data";
import { deleteProductCostOverrides, listProductCostOverrides, saveProductCostOverrides } from "@/lib/inventory/product-cost-store";

export const runtime = "nodejs";

const nullableCost = z.number().finite().nonnegative().max(1_000_000).nullable();
const skuSchema = z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,32}$/);
const itemSchema = z.object({
  sku: skuSchema,
  purchaseCostRmbTaxIncluded: nullableCost,
  purchaseCostRmbTaxExcluded: nullableCost,
  purchaseCostUsd: nullableCost,
});
const saveSchema = z.object({ items: z.array(itemSchema).min(1).max(1000) });
const deleteSchema = z.object({ skus: z.array(skuSchema).min(1).max(1000) });

export async function GET() {
  return Response.json({ items: listProductCostOverrides() });
}

export async function POST(request: Request) {
  try {
    const payload = saveSchema.parse(await request.json());
    await assertKnownSkus(payload.items.map((item) => item.sku));
    return Response.json({ status: "completed", items: saveProductCostOverrides(payload.items) });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "成本参数不完整或格式不正确。", details: error.flatten() }, { status: 400 });
    return Response.json({ error: error instanceof Error ? error.message : "产品成本保存失败。" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const payload = deleteSchema.parse(await request.json());
    await assertKnownSkus(payload.skus);
    return Response.json({ status: "completed", items: deleteProductCostOverrides(payload.skus) });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "需要恢复的 SKU 格式不正确。", details: error.flatten() }, { status: 400 });
    return Response.json({ error: error instanceof Error ? error.message : "源成本恢复失败。" }, { status: 500 });
  }
}

async function assertKnownSkus(skus: string[]) {
  const products = await loadBaseProductCatalogData();
  const known = new Set(products.items.map((item) => item.sku));
  const unknown = skus.filter((sku) => !known.has(sku));
  if (unknown.length) throw new Error(`产品目录中不存在：${unknown.slice(0, 10).join("、")}`);
}
