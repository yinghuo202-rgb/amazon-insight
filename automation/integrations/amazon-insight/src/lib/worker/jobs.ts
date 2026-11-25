import "server-only";

import { amazonCrawlBatchSchema, supplier1688BatchSchema } from "@/lib/crawlers/contracts";
import { ingest1688Quotes, ingestAmazonSnapshots } from "@/lib/crawlers/store";
import { prisma } from "@/lib/db/prisma";

import {
  computeRetryDelaySec,
  type CrawlJobCreateItem,
  type WorkerClaimInput,
  type WorkerCompleteInput,
  type WorkerHeartbeatInput,
} from "./contracts";

function parseJsonObject<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function serializeCrawlJob(row: {
  id: string;
  target: string;
  action: string;
  marketplace: string;
  query: string;
  linkedAsin: string | null;
  linkedSku: string | null;
  syncToPool: boolean;
  payloadJson: string | null;
  status: string;
  priority: number;
  attempts: number;
  maxAttempts: number;
  scheduledAt: Date;
  lockedBy: string | null;
  lockedAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  resultJson: string | null;
  lastError: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    target: row.target,
    action: row.action,
    marketplace: row.marketplace,
    query: row.query,
    linkedAsin: row.linkedAsin,
    linkedSku: row.linkedSku,
    syncToPool: row.syncToPool,
    payload: parseJsonObject<Record<string, unknown>>(row.payloadJson, {}),
    status: row.status,
    priority: row.priority,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    scheduledAt: row.scheduledAt.toISOString(),
    lockedBy: row.lockedBy,
    lockedAt: row.lockedAt?.toISOString() ?? null,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    result: row.resultJson ? parseJsonObject<Record<string, unknown> | null>(row.resultJson, null) : null,
    lastError: row.lastError,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function enqueueCrawlJobs(items: CrawlJobCreateItem[], createdBy?: string) {
  const created = await Promise.all(
    items.map((item) =>
      prisma.crawlJob.create({
        data: {
          target: item.target,
          action: item.action,
          marketplace: item.marketplace,
          query: item.query,
          linkedAsin: item.linkedAsin ?? null,
          linkedSku: item.linkedSku ?? null,
          syncToPool: item.syncToPool,
          payloadJson: item.payload ? JSON.stringify(item.payload) : null,
          priority: item.priority,
          maxAttempts: item.maxAttempts,
          scheduledAt: item.scheduledAt ? new Date(item.scheduledAt) : new Date(),
          createdBy: createdBy ?? null,
        },
      }),
    ),
  );

  return {
    count: created.length,
    jobs: created.map(serializeCrawlJob),
  };
}

export async function getCrawlQueueCounts() {
  const grouped = await prisma.crawlJob.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  const counts = {
    pending: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    canceled: 0,
  };
  for (const row of grouped) {
    const key = row.status.toLowerCase();
    if (key === "pending") counts.pending = row._count._all;
    else if (key === "running") counts.running = row._count._all;
    else if (key === "succeeded") counts.succeeded = row._count._all;
    else if (key === "failed") counts.failed = row._count._all;
    else if (key === "canceled") counts.canceled = row._count._all;
  }
  return counts;
}

export async function listCrawlJobs({
  status,
  target,
  limit = 50,
}: {
  status?: string | null;
  target?: string | null;
  limit?: number;
} = {}) {
  const [rows, counts] = await Promise.all([
    prisma.crawlJob.findMany({
      where: {
        ...(status ? { status: status.trim().toUpperCase() } : {}),
        ...(target ? { target: target.trim().toLowerCase() } : {}),
      },
      orderBy: [{ createdAt: "desc" }],
      take: Math.max(1, Math.min(limit, 200)),
    }),
    getCrawlQueueCounts(),
  ]);

  return {
    jobs: rows.map(serializeCrawlJob),
    counts,
  };
}

export async function claimNextCrawlJob(input: WorkerClaimInput) {
  const now = new Date();
  const staleCutoff = new Date(now.getTime() - input.staleLockSec * 1000);

  const staleJobs = await prisma.crawlJob.findMany({
    where: {
      status: "RUNNING",
      lockedAt: { lt: staleCutoff },
    },
    take: 20,
  });

  for (const stale of staleJobs) {
    const exhausted = stale.attempts >= stale.maxAttempts;
    await prisma.crawlJob.updateMany({
      where: { id: stale.id, status: "RUNNING", lockedAt: stale.lockedAt },
      data: exhausted
        ? {
            status: "FAILED",
            finishedAt: now,
            lockedBy: null,
            lockedAt: null,
            lastError: "Worker 锁超时且已达到最大重试次数。",
          }
        : {
            status: "PENDING",
            lockedBy: null,
            lockedAt: null,
            scheduledAt: now,
            lastError: "Worker 锁超时，任务已重新入队。",
          },
    });
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const candidate = await prisma.crawlJob.findFirst({
      where: {
        status: "PENDING",
        scheduledAt: { lte: now },
        ...(input.targets?.length ? { target: { in: input.targets } } : {}),
      },
      orderBy: [{ priority: "desc" }, { scheduledAt: "asc" }, { createdAt: "asc" }],
    });
    if (!candidate) return null;

    const claimed = await prisma.crawlJob.updateMany({
      where: { id: candidate.id, status: "PENDING" },
      data: {
        status: "RUNNING",
        lockedBy: input.workerId,
        lockedAt: now,
        startedAt: candidate.startedAt ?? now,
        attempts: { increment: 1 },
      },
    });
    if (claimed.count === 1) {
      const updated = await prisma.crawlJob.findUnique({ where: { id: candidate.id } });
      return updated ? serializeCrawlJob(updated) : null;
    }
  }

  return null;
}

export async function completeCrawlJob(input: WorkerCompleteInput) {
  const job = await prisma.crawlJob.findUnique({ where: { id: input.jobId } });
  if (!job) {
    throw new Error("未找到对应的爬虫任务。");
  }

  if (job.status !== "RUNNING" && job.lockedBy !== input.workerId) {
    throw new Error(`任务当前状态为 ${job.status}，无法重复提交完成状态。`);
  }

  const now = new Date();
  if (input.ok) {
    let ingestSummary: Record<string, unknown> | null = null;
    if (input.items && input.items.length > 0) {
      if (job.target === "amazon") {
        const batch = amazonCrawlBatchSchema.parse({
          syncToPool: job.syncToPool,
          items: input.items,
        });
        ingestSummary = await ingestAmazonSnapshots(batch);
      } else if (job.target === "1688") {
        const batch = supplier1688BatchSchema.parse({
          items: input.items,
        });
        ingestSummary = await ingest1688Quotes(batch);
      }
    }

    const combinedResult = {
      ...(input.result ?? {}),
      ...(ingestSummary ? { ingest: ingestSummary } : {}),
    };

    const updated = await prisma.crawlJob.update({
      where: { id: job.id },
      data: {
        status: "SUCCEEDED",
        finishedAt: now,
        lockedBy: null,
        lockedAt: null,
        lastError: null,
        resultJson: Object.keys(combinedResult).length > 0 ? JSON.stringify(combinedResult) : null,
      },
    });
    return serializeCrawlJob(updated);
  }

  const message = input.error?.trim() || "爬虫任务执行失败。";
  const shouldRetry = input.retryable && job.attempts < job.maxAttempts;
  const retryDelaySec = shouldRetry ? computeRetryDelaySec(job.attempts, input.retryDelaySec) : 0;

  const updated = await prisma.crawlJob.update({
    where: { id: job.id },
    data: shouldRetry
      ? {
          status: "PENDING",
          scheduledAt: new Date(now.getTime() + retryDelaySec * 1000),
          lockedBy: null,
          lockedAt: null,
          lastError: message,
        }
      : {
          status: "FAILED",
          finishedAt: now,
          lockedBy: null,
          lockedAt: null,
          lastError: message,
        },
  });
  return serializeCrawlJob(updated);
}

export async function retryCrawlJob(jobId: string) {
  const job = await prisma.crawlJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error("未找到对应的爬虫任务。");
  if (job.status === "RUNNING") throw new Error("运行中的任务无法手动重试。");

  const updated = await prisma.crawlJob.update({
    where: { id: jobId },
    data: {
      status: "PENDING",
      attempts: 0,
      scheduledAt: new Date(),
      lockedBy: null,
      lockedAt: null,
      finishedAt: null,
      lastError: null,
    },
  });
  return serializeCrawlJob(updated);
}

export async function cancelCrawlJob(jobId: string) {
  const job = await prisma.crawlJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error("未找到对应的爬虫任务。");
  if (job.status !== "PENDING") throw new Error("仅待执行的任务可以取消。");

  const updated = await prisma.crawlJob.update({
    where: { id: jobId },
    data: {
      status: "CANCELED",
      finishedAt: new Date(),
    },
  });
  return serializeCrawlJob(updated);
}

export async function recordWorkerHeartbeat(input: WorkerHeartbeatInput) {
  const now = new Date();
  const state = await prisma.workerState.upsert({
    where: { workerId: input.workerId },
    create: {
      workerId: input.workerId,
      status: input.status,
      lastHeartbeatAt: now,
      lastErpSyncAt: input.lastErpSyncAt ? new Date(input.lastErpSyncAt) : null,
      lastErpError: input.lastErpError ?? null,
      lastCrawlJobId: input.lastCrawlJobId ?? null,
      lastCrawlAt: input.lastCrawlAt ? new Date(input.lastCrawlAt) : null,
      metaJson: input.meta ? JSON.stringify(input.meta) : null,
    },
    update: {
      status: input.status,
      lastHeartbeatAt: now,
      ...(input.lastErpSyncAt !== undefined
        ? { lastErpSyncAt: input.lastErpSyncAt ? new Date(input.lastErpSyncAt) : null }
        : {}),
      ...(input.lastErpError !== undefined ? { lastErpError: input.lastErpError } : {}),
      ...(input.lastCrawlJobId !== undefined ? { lastCrawlJobId: input.lastCrawlJobId } : {}),
      ...(input.lastCrawlAt !== undefined
        ? { lastCrawlAt: input.lastCrawlAt ? new Date(input.lastCrawlAt) : null }
        : {}),
      ...(input.meta !== undefined ? { metaJson: JSON.stringify(input.meta) } : {}),
    },
  });

  return {
    workerId: state.workerId,
    status: state.status,
    lastHeartbeatAt: state.lastHeartbeatAt.toISOString(),
    lastErpSyncAt: state.lastErpSyncAt?.toISOString() ?? null,
    lastErpError: state.lastErpError,
    lastCrawlJobId: state.lastCrawlJobId,
    lastCrawlAt: state.lastCrawlAt?.toISOString() ?? null,
  };
}

export async function getWorkerOverview(onlineWindowSec = 180) {
  const [workers, queueCounts] = await Promise.all([
    prisma.workerState.findMany({ orderBy: { lastHeartbeatAt: "desc" }, take: 10 }),
    getCrawlQueueCounts(),
  ]);

  const cutoffMs = Date.now() - onlineWindowSec * 1000;
  const serialized = workers.map((worker) => ({
    workerId: worker.workerId,
    status: worker.status,
    online: worker.status !== "STOPPED" && worker.lastHeartbeatAt.getTime() >= cutoffMs,
    lastHeartbeatAt: worker.lastHeartbeatAt.toISOString(),
    lastErpSyncAt: worker.lastErpSyncAt?.toISOString() ?? null,
    lastErpError: worker.lastErpError,
    lastCrawlJobId: worker.lastCrawlJobId,
    lastCrawlAt: worker.lastCrawlAt?.toISOString() ?? null,
    meta: parseJsonObject<Record<string, unknown>>(worker.metaJson, {}),
  }));

  return {
    online: serialized.some((worker) => worker.online),
    workers: serialized,
    queueCounts,
  };
}
