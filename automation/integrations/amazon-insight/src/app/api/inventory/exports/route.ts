import { z } from "zod";

import { getDocumentExportMeta, runDocumentExport } from "@/lib/inventory/document-exports";

export const runtime = "nodejs";

const requestSchema = z.object({
  market: z.enum(["US", "CA"]),
  documentTypes: z.array(z.enum(["shipment", "declaration"])).min(1),
  batchNumber: z.string().regex(/^CM\d{3,4}$/),
  shipmentDate: z.iso.date(),
  invoiceNumber: z.string().max(64).optional(),
  freightReference: z.string().max(120).optional(),
  shipmentId: z.string().max(120).optional(),
  trackingId: z.string().max(120).optional(),
  consignee: z.string().max(500).optional(),
  originPort: z.string().max(80).optional(),
  skuSort: z.enum(["asc", "desc"]).default("asc"),
  entries: z.array(z.object({
    sku: z.string().regex(/^[A-Z]{2}\d{3}$/),
    quantity: z.number().int().positive(),
  })).min(1),
});

export async function GET(request: Request) {
  const market = new URL(request.url).searchParams.get("market") === "CA" ? "CA" : "US";
  try {
    return Response.json(await getDocumentExportMeta(market));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "读取导出配置失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "导出参数不完整或格式不正确", details: parsed.error.flatten() }, { status: 400 });
  }
  try {
    return Response.json(await runDocumentExport(parsed.data));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "单据生成失败" }, { status: 422 });
  }
}
