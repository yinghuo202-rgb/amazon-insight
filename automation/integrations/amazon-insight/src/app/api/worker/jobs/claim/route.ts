import { z } from "zod";

import { requireWorkerOrUserAuth } from "@/lib/worker/auth";
import { workerClaimSchema } from "@/lib/worker/contracts";
import { claimNextCrawlJob } from "@/lib/worker/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireWorkerOrUserAuth(request);
  if ("response" in auth) return auth.response;

  try {
    const payload = workerClaimSchema.parse(await request.json().catch(() => ({})));
    const job = await claimNextCrawlJob(payload);
    return Response.json({ ok: true, actor: auth.actor, job });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "领取任务参数无效。", details: error.flatten() }, { status: 400 });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "领取爬虫任务失败。" },
      { status: 500 },
    );
  }
}
