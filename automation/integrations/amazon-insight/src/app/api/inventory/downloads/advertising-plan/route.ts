import { z } from "zod";

import { saveAdvertisingPlanCsv } from "@/lib/inventory/download-center";

export const runtime = "nodejs";
const schema = z.object({ market: z.enum(["US", "CA"]), period: z.string().regex(/^\d{4}-\d{2}$/), status: z.enum(["DRAFT", "CONFIRMED"]), rows: z.array(z.array(z.union([z.string(), z.number()]))).min(1) });

export async function POST(request: Request) {
  try { return Response.json(await saveAdvertisingPlanCsv(schema.parse(await request.json()))); }
  catch (error) { if (error instanceof z.ZodError) return Response.json({ error: "广告调整表参数格式不正确。" }, { status: 400 }); return Response.json({ error: error instanceof Error ? error.message : "广告调整表生成失败。" }, { status: 500 }); }
}
