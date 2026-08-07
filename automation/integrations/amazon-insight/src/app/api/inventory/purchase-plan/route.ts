import { z } from "zod";

import { getPurchasePlanCycle, listPurchasePlanDraft, replacePurchasePlanDraft, transitionPurchasePlanCycle } from "@/lib/inventory/purchase-plan-store";

export const runtime = "nodejs";

const itemSchema = z.object({
  sku: z.string().trim().regex(/^[A-Z]{2}\d{3}$/),
  quantity: z.number().int().nonnegative(),
  suggestedQuantity: z.number().int().nonnegative(),
  note: z.string().max(300).default(""),
});
const requestSchema = z.object({
  cycleDate: z.iso.date(),
  action: z.enum(["save", "review", "lock", "reopen", "ordered"]).default("save"),
  mode: z.enum(["replace", "merge"]).default("replace"),
  items: z.array(itemSchema).default([]),
});

export async function GET(request: Request) {
  const cycleDate = new URL(request.url).searchParams.get("cycle") ?? "";
  const parsed = z.iso.date().safeParse(cycleDate);
  if (!parsed.success) return Response.json({ error: "采购周期日期格式不正确。" }, { status: 400 });
  return Response.json({ cycleDate, cycle: getPurchasePlanCycle(cycleDate), items: listPurchasePlanDraft(cycleDate) });
}

export async function POST(request: Request) {
  try {
    const payload = requestSchema.parse(await request.json());
    if (payload.action !== "save") return Response.json({ status: "completed", cycle: transitionPurchasePlanCycle(payload.cycleDate, payload.action) });
    const items = payload.mode === "merge"
      ? mergeDraftItems(listPurchasePlanDraft(payload.cycleDate), payload.items)
      : payload.items;
    const savedItems = replacePurchasePlanDraft(payload.cycleDate, items);
    return Response.json({ status: "completed", cycleDate: payload.cycleDate, mode: payload.mode, cycle: getPurchasePlanCycle(payload.cycleDate), items: savedItems });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "采购计划参数不完整或格式不正确。", details: error.flatten() }, { status: 400 });
    return Response.json({ error: error instanceof Error ? error.message : "采购计划保存失败。" }, { status: 500 });
  }
}

function mergeDraftItems(existing: ReturnType<typeof listPurchasePlanDraft>, incoming: z.infer<typeof itemSchema>[]) {
  const merged = new Map(existing.map((item) => [item.sku, {
    sku: item.sku,
    quantity: item.quantity,
    suggestedQuantity: item.suggestedQuantity,
    note: item.note,
  }]));
  for (const item of incoming) merged.set(item.sku, item);
  return [...merged.values()];
}
