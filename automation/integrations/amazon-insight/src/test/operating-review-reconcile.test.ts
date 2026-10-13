import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildOperatingModel } from "@/lib/inventory/dashboard-view-model";
import { profitabilityDataSchema, profitabilityRowSchema } from "@/lib/inventory/contracts";
import { buildReviewEvidence, appendTaskHistory } from "@/lib/inventory/operating-review";
import { publishedReportPath } from "@/lib/inventory/report-version";
import { reconcileOperatingReviews, startOperatingReviewReconciliation, recordReconciliationAudit } from "@/lib/inventory/operating-review-reconcile";

let folder: string, client: PrismaClient;
const now = new Date("2026-10-13T00:00:00Z");
const review = { kind: "review" as const, sku: "SKU-A", market: "US" as const, period: "2026-09", issue: "利润为负", version: "v1" };
const row = profitabilityRowSchema.parse({ sku: "SKU-A", market: "US", currency: "USD", reportMonth: "2026-09", units: 100, returns: 0, netUnits: 100, productSales: 1000, settlementPayout: 500, landedCost: 600, grossProfit: -100, advertisingCost: 50, storageCost: 1, actualProfit: -100, currentPrice: 10, grossMargin: -.1, actualMargin: -.1, conservativeMargin: -.1, quality: { profitVerified: true, returnsVerified: true, completePeriod: true } });
function model(version: string, resolved = false) {
  const data = buildOperatingModel([], { schemaVersion: 1, generatedAt: now.toISOString(), method: "fixture", sources: [], rows: [{ ...row, productSales: version === "v1" ? 1000 : 900, actualProfit: resolved ? 100 : -100, actualMargin: resolved ? .1 : -.1 }] }, undefined, [], now);
  return { ...data, dataVersion: version, publishedVersion: "publication-" + version };
}
async function seed(status = "DONE", id = "cm000000000000000000000001") {
  const evidence = buildReviewEvidence(model("v1"), review, now);
  return client.collaborationTask.create({ data: { id, workspaceId: "workspace", sku: "SKU-A", market: "US", title: "利润为负", issueKey: evidence.issueKey + (id.endsWith("1") ? "" : id), contextJson: JSON.stringify(evidence.context), historyJson: "[]", status, note: "人工结论", createdById: "shared", updatedById: "shared" } });
}
beforeEach(() => {
  folder = mkdtempSync(path.join(tmpdir(), "measureman-review-reconcile-"));
  const db = new DatabaseSync(path.join(folder, "accounts.db"));
  db.exec(`CREATE TABLE CollaborationTask(id TEXT PRIMARY KEY,workspaceId TEXT,sku TEXT,title TEXT,note TEXT,market TEXT,issueKey TEXT,contextJson TEXT,historyJson TEXT DEFAULT '[]',status TEXT DEFAULT 'OPEN',assigneeId TEXT,createdById TEXT,updatedById TEXT,createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP);`);
  db.close();
  client = new PrismaClient({ datasources: { db: { url: "file:" + path.join(folder, "accounts.db") } } });
});
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); await client.$disconnect(); rmSync(folder, { recursive: true, force: true }); });

it("reconciles published evidence through the real account store and preserves human conclusions", async () => {
  await seed(); const audits: unknown[] = [];
  const options = { store: client.collaborationTask, loadModel: async () => model("v2"), now, audit: (event: unknown) => { audits.push(event); } };
  const result = await reconcileOperatingReviews(options);
  expect(result.updated).toBe(1);
  const record = await client.collaborationTask.findFirstOrThrow();
  expect(record).toMatchObject({ status: "REVIEW", note: "人工结论", updatedById: "shared" });
  expect(JSON.parse(record.contextJson!).baseline.version).toBe("v1");
  expect(JSON.parse(record.historyJson).at(-1)).toMatchObject({ actor: "system", previousStatus: "DONE", note: "人工结论", evidence: { version: "v2" }, triggered: true });
  expect((await reconcileOperatingReviews(options)).updated).toBe(0);
  expect(JSON.parse((await client.collaborationTask.findFirstOrThrow()).historyJson)).toHaveLength(2);
  expect(audits).toHaveLength(1);
});

it("does not close a resolved issue or fabricate evidence for a removed SKU", async () => {
  await seed("IN_PROGRESS");
  await reconcileOperatingReviews({ store: client.collaborationTask, loadModel: async () => model("v2", true), now, audit: () => {} });
  expect((await client.collaborationTask.findFirstOrThrow()).status).toBe("IN_PROGRESS");
  const before = await client.collaborationTask.findFirstOrThrow();
  const empty = { ...model("v3"), rows: [] };
  const result = await reconcileOperatingReviews({ store: client.collaborationTask, loadModel: async () => empty, now, audit: () => {} });
  expect(result.skipped).toBe(1); expect((await client.collaborationTask.findFirstOrThrow()).historyJson).toBe(before.historyJson);
});

it("uses CAS to retain an intervening human edit and retries on a later pass", async () => {
  await seed();
  const loadModel = async () => {
    await client.collaborationTask.updateMany({ data: { note: "并发人工新结论", status: "DISMISSED" } });
    return model("v2");
  };
  const result = await reconcileOperatingReviews({ store: client.collaborationTask, loadModel, now, audit: () => {} });
  expect(result.conflicts).toBe(1);
  expect(await client.collaborationTask.findFirstOrThrow()).toMatchObject({ note: "并发人工新结论", status: "DISMISSED", historyJson: "[]" });
  expect((await reconcileOperatingReviews({ store: client.collaborationTask, loadModel: async () => model("v2"), now, audit: () => {} })).updated).toBe(1);
  expect((await client.collaborationTask.findFirstOrThrow()).note).toBe("并发人工新结论");
});

it("skips loading reports without managed reviews and bounds each scan", async () => {
  let loads = 0;
  const empty = await reconcileOperatingReviews({ store: client.collaborationTask, loadModel: async () => { loads++; return model("v2"); }, now, audit: () => {} });
  expect(empty.scanned).toBe(0); expect(loads).toBe(0);
  await seed();
  for (let i = 2; i <= 102; i++) await seed("DONE", "cm" + String(i).padStart(23, "0"));
  const first = await reconcileOperatingReviews({ store: client.collaborationTask, loadModel: async () => model("v2"), now, audit: () => {} });
  expect(first.scanned).toBe(100); expect(first.nextCursor).toBeTypeOf("string");
  const second = await reconcileOperatingReviews({ store: client.collaborationTask, loadModel: async () => model("v2"), now, cursor: first.nextCursor!, audit: () => {} });
  expect(second.scanned).toBe(2); expect(second.nextCursor).toBeNull();
});

it("the real scheduled runner updates reviews without a web action and serializes slow passes", async () => {
  await seed(); vi.useFakeTimers();
  let loads = 0;
  const stop = startOperatingReviewReconciliation({ store: client.collaborationTask, loadModel: async () => { loads++; return model("v2"); }, now, audit: () => {} });
  try {
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(async () => expect((await client.collaborationTask.findFirstOrThrow()).status).toBe("REVIEW"));
    await vi.advanceTimersByTimeAsync(30000);
    await vi.waitFor(() => expect(loads).toBe(2));
    expect(JSON.parse((await client.collaborationTask.findFirstOrThrow()).historyJson)).toHaveLength(2);
  } finally { stop(); }
});

it("failed coordination has an independent audit and never changes existing evidence", async () => {
  await seed(); const audits: Array<{ status: string; errorCode?: string }> = [];
  const result = await reconcileOperatingReviews({ store: client.collaborationTask, loadModel: async () => { throw new Error("private-path-secret"); }, now, audit: event => { audits.push(event); } });
  expect(result.status).toBe("failed"); expect(audits[0].status).toBe("failed");
  expect(JSON.stringify(audits)).not.toContain("private-path-secret");
  expect((await client.collaborationTask.findFirstOrThrow()).historyJson).toBe("[]");
});

it("parallel coordinators create only one version event using the real CAS store", async () => {
  await seed();
  const options = { store: client.collaborationTask, loadModel: async () => model("v2"), now, audit: () => {} };
  const results = await Promise.all([reconcileOperatingReviews(options), reconcileOperatingReviews(options)]);
  expect(results.reduce((total, result) => total + result.updated, 0)).toBe(1);
  expect(JSON.parse((await client.collaborationTask.findFirstOrThrow()).historyJson).filter((event: { evidence?: { version: string } }) => event.evidence?.version === "v2")).toHaveLength(1);
});

it("a day-only logical model change preserves a dismissed conclusion in the real account store", async () => {
  await seed("DISMISSED");
  const unchanged = { ...model("v1"), dataVersion: "next-day-or-other-sku-hash" };
  await reconcileOperatingReviews({ store: client.collaborationTask, loadModel: async () => unchanged, now, audit: () => {} });
  const record = await client.collaborationTask.findFirstOrThrow();
  expect(record).toMatchObject({ status: "DISMISSED", note: "人工结论" });
  expect(JSON.parse(record.contextJson!).latest.version).toBe("next-day-or-other-sku-hash");
  expect(record.historyJson).toBe("[]");
});

it("newly published resolved evidence keeps a handled conclusion closed", async () => {
  await seed("DONE");
  await reconcileOperatingReviews({ store: client.collaborationTask, loadModel: async () => model("v2", true), now, audit: () => {} });
  expect(await client.collaborationTask.findFirstOrThrow()).toMatchObject({ status: "DONE", note: "人工结论" });
});

it("a real restore creates a new publication pointer but does not reopen already reviewed business evidence", async () => {
  const root = path.join(folder, "reports"), snapshots = path.join(folder, "snapshots");
  const pythonRoot = process.env.MEASUREMAN_TEST_AUTOMATION_ROOT || path.resolve(process.cwd(), "../..");
  const python = process.env.MEASUREMAN_TEST_PYTHON || "/usr/bin/python3";
  const script = `import json,sys
from pathlib import Path
from store_ops.report_versions import report_transaction, restore_reports
root,snapshots=Path(sys.argv[1]),Path(sys.argv[2])
if sys.argv[3] == 'restore':
 print(json.dumps(restore_reports(sys.argv[4],root,snapshots)))
else:
 with report_transaction(root,snapshots) as (stage,version):
  (stage/'profitability.json').write_text(sys.argv[4],encoding='utf-8')
 print(json.dumps({'publishedVersion':version}))`;
  const publish = (sales: number) => JSON.parse(execFileSync(python, ["-c", script, root, snapshots, "publish", JSON.stringify({ schemaVersion: 1, generatedAt: now.toISOString(), method: "synthetic-restore-fixture", sources: [], rows: [{ ...row, productSales: sales }] })], { env: { ...process.env, PYTHONPATH: path.join(pythonRoot, "src") }, encoding: "utf8" })) as { publishedVersion: string };
  const loadModel = async () => {
    const file = await publishedReportPath(path.join(root, "profitability.json"));
    const report = profitabilityDataSchema.parse(JSON.parse(await readFile(file, "utf8")));
    const data = buildOperatingModel([], report, undefined, [], now);
    data.publishedVersion = path.basename(path.dirname(path.dirname(file)));
    data.dataVersion = createHash("sha256").update(JSON.stringify([data.publishedVersion, data.rows])).digest("hex");
    return data;
  };
  const first = publish(1000), initial = await loadModel();
  const evidence = buildReviewEvidence(initial, { ...review, version: initial.dataVersion }, now);
  await client.collaborationTask.create({ data: { id: "cm000000000000000000000001", workspaceId: "workspace", sku: "SKU-A", market: "US", title: "利润为负", issueKey: evidence.issueKey, contextJson: JSON.stringify(evidence.context), historyJson: "[]", status: "DONE", note: "第一次人工结论", createdById: "shared", updatedById: "shared" } });
  const second = publish(900);
  await reconcileOperatingReviews({ store: client.collaborationTask, loadModel, now, audit: () => {} });
  const reviewed = await client.collaborationTask.findFirstOrThrow();
  const latest = JSON.parse(reviewed.contextJson!).latest;
  await client.collaborationTask.update({ where: { id: reviewed.id }, data: { status: "DONE", note: "第二次人工结论", historyJson: appendTaskHistory(reviewed.historyJson, { at: now.toISOString(), actor: "shared-account", userId: "shared", action: "update-task", previousStatus: "REVIEW", status: "DONE", note: "第二次人工结论", evidence: latest, triggered: true }) } });
  const beforeRestore = await client.collaborationTask.findFirstOrThrow();
  const restored = JSON.parse(execFileSync(python, ["-c", script, root, snapshots, "restore", second.publishedVersion], { env: { ...process.env, PYTHONPATH: path.join(pythonRoot, "src") }, encoding: "utf8" })) as { publishedVersion: string };
  expect(restored.publishedVersion).not.toBe(first.publishedVersion); expect(restored.publishedVersion).not.toBe(second.publishedVersion);
  await reconcileOperatingReviews({ store: client.collaborationTask, loadModel, now, audit: () => {} });
  const restoredTask = await client.collaborationTask.findFirstOrThrow();
  expect(restoredTask).toMatchObject({ status: "DONE", note: "第二次人工结论" });
  expect(JSON.parse(restoredTask.contextJson!).latest).toMatchObject({ publishedVersion: restored.publishedVersion, period: "2026-09", sales: 1000 });
  expect(restoredTask.historyJson).toBe(beforeRestore.historyJson);
  publish(800);
  await reconcileOperatingReviews({ store: client.collaborationTask, loadModel, now, audit: () => {} });
  expect(await client.collaborationTask.findFirstOrThrow()).toMatchObject({ status: "REVIEW", note: "第二次人工结论" });
});

it("the singleton timer cannot overlap a slow pass or register duplicate timers", async () => {
  await seed(); vi.useFakeTimers();
  let release!: () => void, loads = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const options = { store: client.collaborationTask, loadModel: async () => { loads++; await gate; return model("v2"); }, now, audit: () => {} };
  const stop = startOperatingReviewReconciliation(options);
  expect(startOperatingReviewReconciliation(options)).toBe(stop);
  try {
    await vi.advanceTimersByTimeAsync(0); await vi.waitFor(() => expect(loads).toBe(1));
    await vi.advanceTimersByTimeAsync(90000); expect(loads).toBe(1);
    release(); await vi.waitFor(async () => expect((await client.collaborationTask.findFirstOrThrow()).status).toBe("REVIEW"));
  } finally { stop(); }
});

it("repeated identical failures update one audit incident and recovery is separately visible", () => {
  const file = path.join(folder, "operations.db"), db = new DatabaseSync(file);
  db.exec("CREATE TABLE runs(id INTEGER PRIMARY KEY,job_name TEXT,status TEXT,started_at TEXT,finished_at TEXT,summary_json TEXT,error_text TEXT)");
  vi.stubEnv("STORE_OPS_STATE_DB", file);
  try {
    const failed = { status: "failed" as const, scanned: 1, updated: 0, conflicts: 0, skipped: 0, failed: 0, nextCursor: null, errorCode: "RECONCILE_UNAVAILABLE" };
    recordReconciliationAudit(failed); recordReconciliationAudit({ ...failed, scanned: 2 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM runs").get()!.n).toBe(1);
    recordReconciliationAudit({ ...failed, status: "completed", errorCode: undefined });
    expect(db.prepare("SELECT status FROM runs ORDER BY id").all()).toEqual([{ status: "failed" }, { status: "completed" }]);
  } finally { db.close(); vi.unstubAllEnvs(); }
});
