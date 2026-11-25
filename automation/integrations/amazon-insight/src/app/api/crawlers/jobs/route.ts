import { z } from "zod";

import { requireCrawlerOrUserAuth } from "@/lib/crawlers/auth";
import { crawlJobCreateBatchSchema, crawlJobManageActionSchema } from "@/lib/worker/contracts";
import { cancelCrawlJob, enqueueCrawlJobs, getWorkerOverview, listCrawlJobs, retryCrawlJob } from "@/lib/worker/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireCrawlerOrUserAuth(request);
  if ("response" in auth) return auth.response;

  const url = new URL(request.url);
  const limitParam = Number(url.searchParams.get("limit") ?? 50);
  const [queue, overview] = await Promise.all([
    listCrawlJobs({
      status: url.searchParams.get("status"),
      target: url.searchParams.get("target"),
      limit: Number.isFinite(limitParam) ? limitParam : 50,
    }),
    getWorkerOverview(),
  ]);

  return Response.json({
    ...queue,
    workerOnline: overview.online,
    workers: overview.workers,
  });
}

export async function POST(request: Request) {
  const auth = await requireCrawlerOrUserAuth(request);
  if ("response" in auth) return auth.response;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (body && typeof body === "object" && "action" in body && (body.action === "retry" || body.action === "cancel")) {
      const command = crawlJobManageActionSchema.parse(body);
      const job = command.action === "retry"
        ? await retryCrawlJob(command.jobId)
        : await cancelCrawlJob(command.jobId);
      return Response.json({ status: "updated", actor: auth.actor, job });
    }

    const batch = crawlJobCreateBatchSchema.parse(body);
    const result = await enqueueCrawlJobs(batch.jobs, auth.actor);
    return Response.json({ status: "queued", actor: auth.actor, ...result }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "爬虫任务参数不正确。", details: error.flatten() }, { status: 400 });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "提交爬虫任务失败。" },
      { status: 400 },
    );
  }
}
