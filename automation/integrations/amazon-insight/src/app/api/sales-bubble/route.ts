import { z } from "zod";

import { requireApiAuth } from "@/lib/auth";
import { getSalesBubbleSnapshot, syncGerpGoData } from "@/lib/gerpgo/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const postSchema = z.object({
  action: z.enum(["sync"]).default("sync"),
});

export async function GET(request: Request) {
  const auth = await requireApiAuth();
  if ("response" in auth) return auth.response;

  try {
    const url = new URL(request.url);
    const since = url.searchParams.get("since");
    const triggerSync = url.searchParams.get("sync") === "1";
    const snapshot = await getSalesBubbleSnapshot({ since, triggerSync });
    return Response.json(snapshot);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "读取销售气泡数据失败。" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireApiAuth();
  if ("response" in auth) return auth.response;

  try {
    postSchema.parse(await request.json().catch(() => ({})));
    await syncGerpGoData();
    return Response.json(await getSalesBubbleSnapshot());
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "同步积加 ERP 销售数据失败。" },
      { status: 500 },
    );
  }
}
