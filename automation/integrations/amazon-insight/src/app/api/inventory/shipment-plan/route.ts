import { z } from "zod";

import { loadInventoryDashboardData, normalizeOperationsMarket } from "@/lib/inventory/data";
import {
  autoSplitShipmentBatches,
  createShipmentBatch,
  deleteShipmentBatch,
  listShipmentBatchItems,
  listShipmentBatches,
  listShipmentPlanItems,
  nextShipmentBatchNumber,
  removeShipmentBatchItem,
  replaceShipmentBatchItems,
  setShipmentBatchStatus,
  updateShipmentBatch,
  upsertShipmentBatchItem,
} from "@/lib/inventory/shipment-plan";

export const runtime = "nodejs";

const marketSchema = z.enum(["US", "CA"]);
const itemSchema = z.object({
  sku: z.string().trim().regex(/^[A-Z]{2}\d{3}$/),
  quantity: z.number().int().positive(),
  suggestedQuantity: z.number().int().nonnegative(),
  note: z.string().max(300).default(""),
  reason: z.string().max(1000).default(""),
  snapshotDate: z.string().max(20).default(""),
});
const batchPatchSchema = z.object({
  batchNumber: z.string().trim().regex(/^CM\d{3,4}$/).optional(),
  shipmentDate: z.union([z.literal(""), z.iso.date()]).optional(),
  invoiceNumber: z.string().max(64).optional(),
  freightReference: z.string().max(120).optional(),
  shipmentId: z.string().max(120).optional(),
  trackingId: z.string().max(120).optional(),
  consignee: z.string().max(500).optional(),
  note: z.string().max(500).optional(),
});
const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("createBatch"), market: marketSchema, batch: batchPatchSchema.optional() }),
  z.object({ action: z.literal("updateBatch"), market: marketSchema, batchId: z.uuid(), batch: batchPatchSchema }),
  z.object({ action: z.literal("setStatus"), market: marketSchema, batchId: z.uuid(), status: z.enum(["DRAFT", "EXPORTED", "ARCHIVED"]) }),
  z.object({ action: z.literal("deleteBatch"), market: marketSchema, batchId: z.uuid() }),
  z.object({ action: z.literal("upsert"), market: marketSchema, batchId: z.uuid().optional(), item: itemSchema }),
  z.object({ action: z.literal("remove"), market: marketSchema, batchId: z.uuid(), sku: z.string().trim().regex(/^[A-Z]{2}\d{3}$/) }),
  z.object({ action: z.literal("replace"), market: marketSchema, batchId: z.uuid(), items: z.array(itemSchema) }),
  z.object({ action: z.literal("clear"), market: marketSchema, batchId: z.uuid() }),
  z.object({ action: z.literal("autoSplit"), market: marketSchema, items: z.array(itemSchema).min(1), firstBatchNumber: z.string().regex(/^CM\d{3,4}$/).optional(), shipmentDate: z.union([z.literal(""), z.iso.date()]).default("") }),
]);

function responseFor(market: "US" | "CA", requestedBatchId?: string) {
  const batches = listShipmentBatches(market);
  const activeBatch = batches.find((batch) => batch.id === requestedBatchId)
    ?? batches.find((batch) => batch.status === "DRAFT")
    ?? batches[0]
    ?? null;
  return {
    market,
    batches,
    activeBatch,
    activeBatchItems: activeBatch ? listShipmentBatchItems(activeBatch.id) : [],
    items: listShipmentPlanItems(market),
    allMarketItems: listShipmentPlanItems(),
    nextBatchNumber: nextShipmentBatchNumber(market),
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const market = normalizeOperationsMarket(url.searchParams.get("market"));
  return Response.json(responseFor(market, url.searchParams.get("batchId") ?? undefined));
}

export async function POST(request: Request) {
  try {
    const payload = requestSchema.parse(await request.json());
    const data = await loadInventoryDashboardData(payload.market);
    const knownSkus = new Set(data.rows.map((row) => row.sku));
    const inventoryBySku = new Map(data.rows.map((row) => [row.sku, row] as const));
    const candidateItems = payload.action === "upsert" ? [payload.item]
      : payload.action === "replace" || payload.action === "autoSplit" ? payload.items
      : [];
    for (const item of candidateItems) {
      const row = inventoryBySku.get(item.sku);
      if (row && row.localInventory <= 0) {
        return Response.json({ error: `${item.sku} 当前没有国内现货，不能加入发货批次。` }, { status: 422 });
      }
      if (row && item.quantity > row.localInventory) {
        return Response.json({ error: `${item.sku} 计划 ${item.quantity} 件，超过国内现货 ${row.localInventory} 件。` }, { status: 422 });
      }
      const carton = Math.max(1, row?.cartonQty ?? 1);
      if (item.quantity % carton !== 0) {
        return Response.json({ error: `${item.sku} 每箱 ${carton} 件，发货数量必须为整箱。` }, { status: 422 });
      }
    }
    let selectedBatchId: string | undefined = "batchId" in payload ? payload.batchId : undefined;

    if (payload.action === "createBatch") {
      selectedBatchId = createShipmentBatch(payload.market, payload.batch).id;
    } else if (payload.action === "updateBatch") {
      updateShipmentBatch(payload.batchId, payload.batch);
    } else if (payload.action === "setStatus") {
      setShipmentBatchStatus(payload.batchId, payload.status);
    } else if (payload.action === "deleteBatch") {
      deleteShipmentBatch(payload.batchId);
      selectedBatchId = undefined;
    } else if (payload.action === "upsert") {
      if (!knownSkus.has(payload.item.sku)) return Response.json({ error: "库存表中未找到该 SKU。" }, { status: 404 });
      const batchId = payload.batchId ?? listShipmentBatches(payload.market, false).find((batch) => batch.status === "DRAFT")?.id
        ?? createShipmentBatch(payload.market).id;
      selectedBatchId = batchId;
      upsertShipmentBatchItem(batchId, { market: payload.market, ...payload.item });
    } else if (payload.action === "remove") {
      removeShipmentBatchItem(payload.batchId, payload.sku);
    } else if (payload.action === "replace" || payload.action === "clear") {
      const items = payload.action === "replace" ? payload.items : [];
      const unknown = items.find((item) => !knownSkus.has(item.sku));
      if (unknown) return Response.json({ error: `库存表中未找到 ${unknown.sku}。` }, { status: 404 });
      replaceShipmentBatchItems(payload.batchId, items.map((item) => ({ market: payload.market, ...item })));
    } else {
      const unknown = payload.items.find((item) => !knownSkus.has(item.sku));
      if (unknown) return Response.json({ error: `库存表中未找到 ${unknown.sku}。` }, { status: 404 });
      const created = autoSplitShipmentBatches(
        payload.market,
        payload.items.map((item) => ({ market: payload.market, ...item })),
        payload.firstBatchNumber,
        payload.shipmentDate,
      );
      selectedBatchId = created[0]?.id;
    }

    return Response.json({ status: "completed", ...responseFor(payload.market, selectedBatchId) });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "发货计划参数不完整或格式不正确。", details: error.flatten() }, { status: 400 });
    return Response.json({ error: error instanceof Error ? error.message : "发货计划更新失败。" }, { status: 500 });
  }
}
