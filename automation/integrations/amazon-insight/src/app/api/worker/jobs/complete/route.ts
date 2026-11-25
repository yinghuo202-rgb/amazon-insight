import { z } from "zod";

import { requireWorkerOrUserAuth } from "@/lib/worker/auth";
import { workerCompleteSchema } from "@/lib/worker/contracts";
import { completeCrawlJob } from "@/lib/worker/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireWorkerOrUserAuth(request);
  if ("response" in auth) return auth.response;

  try {
    const payload = workerCompleteSchema.parse(await request.json());
    const job = await completeCrawlJob(payload);
    return Response.json({ ok: true, actor: auth.actor, job });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "回传任务结果参数无效。", details: error.flatten() }, { status: 400 });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "提交爬虫任务结果失败。" },
      { status: 400 },
    );
  }
}
