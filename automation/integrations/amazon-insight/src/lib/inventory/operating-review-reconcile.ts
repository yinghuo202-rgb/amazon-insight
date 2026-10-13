import type { PrismaClient } from "@prisma/client";
import { statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { OperatingModel } from "@/lib/inventory/dashboard-view-model";
import { buildReviewEvidence, reviewContextSchema, reviewEvidenceUpdate } from "@/lib/inventory/operating-review";
import { runtimePath } from "@/lib/inventory/paths";

type Result = { status: "completed" | "degraded" | "failed"; scanned: number; updated: number; conflicts: number; skipped: number; failed: number; nextCursor: string | null; version?: string; errorCode?: string };
type Options = { store?: Pick<PrismaClient["collaborationTask"], "findMany" | "updateMany">; loadModel?: () => Promise<OperatingModel>; now?: Date; cursor?: string; audit?: (event: Result) => void };

export async function reconcileOperatingReviews(options: Options = {}): Promise<Result> {
  const result: Result = { status: "completed", scanned: 0, updated: 0, conflicts: 0, skipped: 0, failed: 0, nextCursor: null };
  const now = options.now ?? new Date();
  try {
    const store = options.store ?? (await import("@/lib/db/prisma")).prisma.collaborationTask;
    const records = await store.findMany({ where: { issueKey: { not: null }, contextJson: { not: null }, ...(options.cursor ? { id: { gt: options.cursor } } : {}) }, orderBy: { id: "asc" }, take: 101 });
    const page = records.slice(0, 100);
    result.scanned = page.length;
    result.nextCursor = records.length > 100 ? page.at(-1)!.id : null;
    if (!page.length) return result;
    const model = await (options.loadModel ?? (await import("@/lib/inventory/data")).loadOperatingModel)();
    result.version = model.dataVersion;
    for (const record of page) {
      try {
        const context = reviewContextSchema.parse(JSON.parse(record.contextJson!));
        const row = model.rows.find(row => row.listingId === context.listingId && row.sku === record.sku && row.market === record.market);
        if (!row || !["US", "CA"].includes(row.market)) { result.skipped++; continue; }
        const completed = row.history.filter(point => point.reportMonth < now.toISOString().slice(0, 7) && point.quality?.completePeriod !== false);
        const period = completed.at(-1)?.reportMonth ?? row.history.at(-1)?.reportMonth ?? context.latest.period;
        const review = buildReviewEvidence(model, { kind: "review", sku: record.sku, market: row.market as "US" | "CA", period, issue: context.issue, version: model.dataVersion }, now, true);
        if (review.issueKey !== record.issueKey) { result.skipped++; continue; }
        const update = reviewEvidenceUpdate(record, review, { actor: "system", userId: "", now });
        if (!update) continue;
        const changed = await store.updateMany({ where: { id: record.id, updatedAt: record.updatedAt, status: record.status, note: record.note, contextJson: record.contextJson, historyJson: record.historyJson }, data: update });
        if (changed.count === 1) result.updated++;
        else result.conflicts++;
      } catch { result.failed++; }
    }
    if (result.failed || result.conflicts || result.skipped) result.status = "degraded";
  } catch { result.status = "failed"; result.errorCode = "RECONCILE_UNAVAILABLE"; }
  if (result.updated || result.failed || result.conflicts || result.skipped || result.status === "failed") {
    try { (options.audit ?? recordReconciliationAudit)(result); }
    catch { warnOnce("AUDIT_UNAVAILABLE"); }
  }
  return result;
}

let lastWarning = "";
function warnOnce(code: string) {
  if (lastWarning !== code) console.warn("经营复核自动协调诊断：" + code + "；已发布报告与人工记录保持原状态。");
  lastWarning = code;
}

// Reuse the operational audit, never bootstrap an account or replace a data root.
export function recordReconciliationAudit(result: Result) {
  const file = process.env.STORE_OPS_STATE_DB?.trim() || runtimePath("db", "operations.sqlite3");
  if (!statSync(file).isFile()) throw new Error("AUDIT_UNAVAILABLE");
  const db = new DatabaseSync(file);
  try {
    db.exec("PRAGMA busy_timeout=1000; BEGIN IMMEDIATE");
    const detail = JSON.stringify(result);
    const previous = db.prepare("SELECT id,status,summary_json,error_text FROM runs WHERE job_name='operating-review-reconcile' ORDER BY id DESC LIMIT 1").get();
    const stamp = new Date().toISOString();
    if (previous && previous.status === result.status && (result.status !== "completed" && previous.error_text === (result.errorCode ?? null) || previous.summary_json === detail)) {
      // Repeated same failure updates a bounded incident rather than flooding runs.
      db.prepare("UPDATE runs SET finished_at=?,summary_json=? WHERE id=?").run(stamp, detail, previous.id as number);
    } else {
      db.prepare("INSERT INTO runs(job_name,status,started_at,finished_at,summary_json,error_text) VALUES('operating-review-reconcile',?,?,?,?,?)")
        .run(result.status, stamp, stamp, detail, result.errorCode ?? null);
    }
    db.exec("COMMIT"); lastWarning = "";
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  finally { db.close(); }
}

const runtime = globalThis as typeof globalThis & { measuremanReviewReconciliation?: { stop: () => void } };
export function startOperatingReviewReconciliation(options: Options = {}) {
  if (runtime.measuremanReviewReconciliation) return runtime.measuremanReviewReconciliation.stop;
  let running = false, stopped = false, cursor: string | undefined;
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      const result = await reconcileOperatingReviews({ ...options, cursor });
      if (result.status !== "failed") cursor = result.nextCursor ?? undefined;
    } finally { running = false; }
  };
  const initial = setTimeout(() => { void tick(); }, 0);
  const interval = setInterval(() => { void tick(); }, 30000);
  initial.unref?.(); interval.unref?.();
  const stop = () => { stopped = true; clearTimeout(initial); clearInterval(interval); delete runtime.measuremanReviewReconciliation; };
  runtime.measuremanReviewReconciliation = { stop };
  return stop;
}
