import { z } from "zod";

import { requireCrawlerOrUserAuth } from "@/lib/crawlers/auth";
import { supplier1688BatchSchema } from "@/lib/crawlers/contracts";
import { ingest1688Quotes, list1688Quotes } from "@/lib/crawlers/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireCrawlerOrUserAuth(request);
  if ("response" in auth) return auth.response;

  const url = new URL(request.url);
  const limitParam = Number(url.searchParams.get("limit") ?? 50);
  const items = await list1688Quotes({
    asin: url.searchParams.get("asin"),
    sku: url.searchParams.get("sku"),
    limit: Number.isFinite(limitParam) ? limitParam : 50,
  });
  return Response.json({ items });
}

export async function POST(request: Request) {
  const auth = await requireCrawlerOrUserAuth(request);
  if ("response" in auth) return auth.response;

  try {
    const payload = supplier1688BatchSchema.parse(await request.json());
    const result = await ingest1688Quotes(payload);
    return Response.json({ status: "completed", actor: auth.actor, ...result }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "1688 采集报价格式不正确。", details: error.flatten() }, { status: 400 });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "1688 报价数据写入失败。" },
      { status: 500 },
    );
  }
}
