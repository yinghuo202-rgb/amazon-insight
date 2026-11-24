import { z } from "zod";

import { requireCrawlerOrUserAuth } from "@/lib/crawlers/auth";
import { amazonCrawlBatchSchema } from "@/lib/crawlers/contracts";
import { ingestAmazonSnapshots, listAmazonSnapshots } from "@/lib/crawlers/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireCrawlerOrUserAuth(request);
  if ("response" in auth) return auth.response;

  const url = new URL(request.url);
  const limitParam = Number(url.searchParams.get("limit") ?? 50);
  const items = await listAmazonSnapshots({
    asin: url.searchParams.get("asin"),
    marketplace: url.searchParams.get("marketplace"),
    limit: Number.isFinite(limitParam) ? limitParam : 50,
  });
  return Response.json({ items });
}

export async function POST(request: Request) {
  const auth = await requireCrawlerOrUserAuth(request);
  if ("response" in auth) return auth.response;

  try {
    const payload = amazonCrawlBatchSchema.parse(await request.json());
    const result = await ingestAmazonSnapshots(payload);
    return Response.json({ status: "completed", actor: auth.actor, ...result }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "亚马逊采集数据格式不正确。", details: error.flatten() }, { status: 400 });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "亚马逊采集数据写入失败。" },
      { status: 500 },
    );
  }
}
