import { z } from "zod";

import { savePurchasePlanCsv } from "@/lib/inventory/download-center";

export const runtime = "nodejs";

const cellSchema = z.union([z.string().max(1500), z.number().finite()]);
const requestSchema = z.object({
  cycleDate: z.iso.date(),
  view: z.enum(["next", "reconcile"]),
  rows: z.array(z.array(cellSchema).max(40)).min(1).max(2000),
});

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "采购表导出数据不完整或格式不正确", details: parsed.error.flatten() }, { status: 400 });
  try {
    return Response.json({ status: "completed", ...(await savePurchasePlanCsv(parsed.data)) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "采购表导出失败" }, { status: 500 });
  }
}
