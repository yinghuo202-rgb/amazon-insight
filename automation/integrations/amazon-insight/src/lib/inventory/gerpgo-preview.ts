import { readFile } from "node:fs/promises";
import { z } from "zod";
import { runtimePath } from "@/lib/inventory/paths";
import { operatingPerformanceRowSchema } from "@/lib/inventory/operating-performance";

export const gerpgoReviewRequestSchema = z.object({
  sourceTaskId: z.uuid(), previewHash: z.string().regex(/^[a-f0-9]{64}$/), confirmed: z.literal(true),
}).strict();
export const gerpgoPreviewSchema = z.object({
  schemaVersion: z.literal(1), taskId: z.uuid(), baseline: z.string(), previewHash: z.string().regex(/^[a-f0-9]{64}$/),
  capturedAt: z.string(), recordCount: z.number().int().nonnegative(), blocked: z.boolean(), issueCount: z.number().int().nonnegative(),
  ignoredParentRows: z.number().int().nonnegative(),
  issues: z.array(z.object({ source: z.string(), row: z.number().int(), reason: z.string() })),
  reviewReasons: z.array(z.string()), withheld: z.array(z.string()),
  differences: z.array(z.object({ market: z.enum(["US", "CA", "MX", "AU"]), reportMonth: z.string(), currency: z.string(),
    previousRevenue: z.number().nullable(), candidateRevenue: z.number(), revenueChangePercent: z.number().nullable(),
    previousSkuCount: z.number().int(), candidateSkuCount: z.number().int(), skuChangePercent: z.number().nullable(),
    completePeriod: z.boolean(), protected: z.boolean() })),
});
export type GerpgoPreview = z.infer<typeof gerpgoPreviewSchema>;
export async function readGerpgoCollectionSummary(taskId: string) {
  if (!z.uuid().safeParse(taskId).success) throw new Error("同步任务编号无效。");
  const manifest = z.object({ taskId: z.uuid(), capturedAt: z.string(), sources: z.array(z.object({
    name: z.string(), pages: z.number().int().nonnegative(), total: z.number().int().nonnegative().nullable(),
    status: z.enum(["completed", "failed", "skipped"]).default("completed"), error: z.string().optional(),
  })) }).parse(JSON.parse(await readFile(runtimePath("incoming", "gerpgo", taskId, "manifest.json"), "utf8")));
  if (manifest.taskId !== taskId) throw new Error("采集来源不一致。");
  const domains = new Map<string, { name: string; completed: number; failed: number; skipped: number; records: number; pages: number; errors: string[] }>();
  for (const source of manifest.sources) {
    const name = source.name.split("-")[0];
    const item = domains.get(name) ?? { name, completed: 0, failed: 0, skipped: 0, records: 0, pages: 0, errors: [] };
    item[source.status]++;
    if (source.status === "completed") { item.records += source.total ?? 0; item.pages += source.pages; }
    if (source.error && !item.errors.includes(source.error)) item.errors.push(source.error);
    domains.set(name, item);
  }
  return { taskId, capturedAt: manifest.capturedAt, domains: [...domains.values()] };
}
export type GerpgoCollectionSummary = Awaited<ReturnType<typeof readGerpgoCollectionSummary>>;
export async function readGerpgoPreview(taskId: string) {
  if (!z.uuid().safeParse(taskId).success) throw new Error("同步任务编号无效。");
  const parsed = gerpgoPreviewSchema.parse(JSON.parse(await readFile(runtimePath("incoming", "gerpgo", taskId, "preview.json"), "utf8")));
  if (parsed.taskId !== taskId) throw new Error("同步任务预览不匹配。");
  return parsed;
}
export async function readGerpgoCandidatePage(taskId: string, offset = 0) {
  if (!z.uuid().safeParse(taskId).success || !Number.isSafeInteger(offset) || offset < 0) throw new Error("预览参数无效。");
  const candidate = z.object({ sourceTaskId: z.uuid(), rows: z.array(operatingPerformanceRowSchema) }).parse(JSON.parse(await readFile(runtimePath("incoming", "gerpgo", taskId, "candidate.json"), "utf8")));
  if (candidate.sourceTaskId !== taskId) throw new Error("预览来源不一致。");
  return { records: candidate.rows.slice(offset, offset + 20), nextOffset: offset + 20 < candidate.rows.length ? offset + 20 : null };
}
