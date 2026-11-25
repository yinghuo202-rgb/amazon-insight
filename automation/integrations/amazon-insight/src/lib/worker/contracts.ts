import { z } from "zod";

export const crawlJobTargetSchema = z.enum(["amazon", "1688"]);
export const crawlJobActionSchema = z.enum(["product", "search", "supplier"]);
export const crawlJobStatusSchema = z.enum(["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED"]);
export const workerStatusSchema = z.enum(["IDLE", "RUNNING", "ERROR", "STOPPED"]);

export const crawlJobCreateItemSchema = z.object({
  target: crawlJobTargetSchema,
  action: crawlJobActionSchema.default("product"),
  marketplace: z.string().trim().toUpperCase().min(2).max(12).default("US"),
  query: z.string().trim().min(1).max(500),
  linkedAsin: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{10}$/, "关联 ASIN 必须为 10 位字母或数字").nullable().optional(),
  linkedSku: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,32}$/, "关联 SKU 格式不正确").nullable().optional(),
  syncToPool: z.boolean().default(false),
  priority: z.number().int().min(-100).max(100).default(0),
  maxAttempts: z.number().int().min(1).max(10).default(3),
  scheduledAt: z.string().datetime({ offset: true }).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export const crawlJobCreateBatchSchema = z.union([
  z.object({
    jobs: z.array(crawlJobCreateItemSchema).min(1).max(100),
  }),
  crawlJobCreateItemSchema.transform((job) => ({ jobs: [job] })),
]);

export const crawlJobManageActionSchema = z.object({
  action: z.enum(["retry", "cancel"]),
  jobId: z.string().trim().min(1).max(120),
});

export const workerHeartbeatSchema = z.object({
  workerId: z.string().trim().min(1).max(80).default("default-worker"),
  status: workerStatusSchema.default("IDLE"),
  lastErpSyncAt: z.string().datetime({ offset: true }).nullable().optional(),
  lastErpError: z.string().trim().max(1000).nullable().optional(),
  lastCrawlJobId: z.string().trim().max(120).nullable().optional(),
  lastCrawlAt: z.string().datetime({ offset: true }).nullable().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export const workerClaimSchema = z.object({
  workerId: z.string().trim().min(1).max(80).default("default-worker"),
  targets: z.array(crawlJobTargetSchema).min(1).max(4).optional(),
  staleLockSec: z.number().int().min(30).max(3600).default(300),
});

export const workerCompleteSchema = z.object({
  workerId: z.string().trim().min(1).max(80).default("default-worker"),
  jobId: z.string().trim().min(1).max(120),
  ok: z.boolean(),
  items: z.array(z.unknown()).max(200).optional(),
  result: z.record(z.string(), z.unknown()).optional(),
  error: z.string().trim().max(2000).optional(),
  retryable: z.boolean().default(true),
  retryDelaySec: z.number().int().min(5).max(3600).optional(),
});

export function computeRetryDelaySec(attempts: number, overrideSec?: number): number {
  if (typeof overrideSec === "number" && Number.isFinite(overrideSec)) {
    return Math.max(5, Math.min(3600, Math.round(overrideSec)));
  }
  const exponent = Math.max(0, Math.round(attempts) - 1);
  return Math.min(900, 30 * 2 ** exponent);
}

export type CrawlJobCreateItem = z.infer<typeof crawlJobCreateItemSchema>;
export type WorkerHeartbeatInput = z.infer<typeof workerHeartbeatSchema>;
export type WorkerClaimInput = z.infer<typeof workerClaimSchema>;
export type WorkerCompleteInput = z.infer<typeof workerCompleteSchema>;
