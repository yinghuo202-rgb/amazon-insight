import { randomUUID } from "node:crypto";

import { z } from "zod";

import { generateCreativeHandoff } from "@/lib/inventory/creative-handoff";
import { loadContentWorkflowData } from "@/lib/inventory/data";

export const runtime = "nodejs";

const requestSchema = z.object({ sku: z.string().trim().regex(/^[A-Z]{2}\d{3}$/) });

export async function POST(request: Request) {
  try {
    const payload = requestSchema.parse(await request.json());
    const content = await loadContentWorkflowData();
    if (!content.tasks.some((task) => task.sku === payload.sku)) return Response.json({ error: "未找到该 SKU 的内容任务。" }, { status: 404 });
    const exportId = randomUUID();
    const generated = await generateCreativeHandoff({ sku: payload.sku, exportId });
    return Response.json({
      status: "completed",
      exportId,
      filename: generated.filename,
      downloadUrl: `/api/inventory/content/creative-handoff/${exportId}/${encodeURIComponent(generated.filename)}`,
      referenceSku: generated.referenceSku,
      parentSku: generated.parentSku,
      sheets: generated.sheets,
    });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "SKU 格式不正确。" }, { status: 400 });
    return Response.json({ error: error instanceof Error ? error.message : "美工对接表生成失败。" }, { status: 500 });
  }
}
