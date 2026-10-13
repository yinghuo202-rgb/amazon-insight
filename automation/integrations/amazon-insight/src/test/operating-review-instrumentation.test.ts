import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildOperatingModel } from "@/lib/inventory/dashboard-view-model";
import { profitabilityRowSchema } from "@/lib/inventory/contracts";
import { buildReviewEvidence } from "@/lib/inventory/operating-review";
const state = vi.hoisted(() => ({ client: null as unknown as PrismaClient, model: null as unknown as ReturnType<typeof buildOperatingModel>, loads: 0 }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { get collaborationTask() { return state.client.collaborationTask; } } }));
vi.mock("@/lib/inventory/data", () => ({ loadOperatingModel: async () => { state.loads++; return state.model; } }));
import { register } from "@/instrumentation";
import { startOperatingReviewReconciliation } from "@/lib/inventory/operating-review-reconcile";
let folder: string;
beforeEach(async () => {
  folder = mkdtempSync(path.join(tmpdir(), "measureman-review-register-"));
  const db = new DatabaseSync(path.join(folder, "accounts.db"));
  db.exec("CREATE TABLE CollaborationTask(id TEXT PRIMARY KEY,workspaceId TEXT,sku TEXT,title TEXT,note TEXT,market TEXT,issueKey TEXT,contextJson TEXT,historyJson TEXT DEFAULT '[]',status TEXT DEFAULT 'OPEN',assigneeId TEXT,createdById TEXT,updatedById TEXT,createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP)"); db.close();
  const operations = new DatabaseSync(path.join(folder, "operations.db"));
  operations.exec("CREATE TABLE runs(id INTEGER PRIMARY KEY,job_name TEXT,status TEXT,started_at TEXT,finished_at TEXT,summary_json TEXT,error_text TEXT)"); operations.close();
  state.client = new PrismaClient({ datasources: { db: { url: "file:" + path.join(folder, "accounts.db") } } });
  const point = profitabilityRowSchema.parse({ sku: "SKU-A", market: "US", currency: "USD", reportMonth: "2026-09", units: 100, returns: 0, netUnits: 100, productSales: 1000, settlementPayout: 400, landedCost: 500, grossProfit: -100, advertisingCost: 20, storageCost: 1, actualProfit: -100, currentPrice: 10, grossMargin: -.1, actualMargin: -.1, conservativeMargin: -.1, quality: { profitVerified: true, returnsVerified: true, completePeriod: true } });
  state.model = buildOperatingModel([], { schemaVersion: 1, generatedAt: "2026-10-13T00:00:00Z", method: "fixture", sources: [], rows: [point] }); state.model.dataVersion = "v1"; state.loads = 0;
  const initial = buildReviewEvidence(state.model, { kind: "review", sku: "SKU-A", market: "US", period: "2026-09", version: "v1", issue: "利润为负" });
  await state.client.collaborationTask.create({ data: { id: "cm000000000000000000000001", workspaceId: "workspace", sku: "SKU-A", market: "US", title: "利润为负", issueKey: initial.issueKey, contextJson: JSON.stringify(initial.context), historyJson: "[]", status: "DONE", note: "原结论", createdById: "shared", updatedById: "shared" } });
  state.model.dataVersion = "v2"; state.model.publishedVersion = "new-publication-v2"; state.model.rows[0].history[0].productSales = 900;
  vi.stubEnv("NEXT_RUNTIME", "nodejs"); vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("NEXT_PHASE", "phase-production-server"); vi.stubEnv("STORE_OPS_STATE_DB", path.join(folder, "operations.db"));
  vi.stubGlobal("measuremanReviewHookStarted", undefined); vi.useFakeTimers();
});
afterEach(async () => { startOperatingReviewReconciliation()(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); await state.client.$disconnect(); rmSync(folder, { recursive: true, force: true }); });

it("register schedules the actual account reconciliation once without blocking server readiness", async () => {
  expect(register()).toBeUndefined(); register();
  expect(state.loads).toBe(0);
  await vi.advanceTimersByTimeAsync(0);
  await vi.waitFor(async () => expect((await state.client.collaborationTask.findFirstOrThrow()).status).toBe("REVIEW"));
  expect(state.loads).toBe(1);
  expect((await state.client.collaborationTask.findFirstOrThrow()).note).toBe("原结论");
  const db = new DatabaseSync(path.join(folder, "operations.db"));
  expect(db.prepare("SELECT job_name,status FROM runs").all()).toEqual([{ job_name: "operating-review-reconcile", status: "completed" }]); db.close();
});

it.each(["phase-production-build", "phase-export"])("register never coordinates during %s", async phase => {
  vi.stubEnv("NEXT_PHASE", phase); register();
  await vi.advanceTimersByTimeAsync(60000);
  expect(state.loads).toBe(0); expect((await state.client.collaborationTask.findFirstOrThrow()).status).toBe("DONE");
});

it("does not start the node database coordinator in edge or test runtimes", async () => {
  vi.stubEnv("NEXT_RUNTIME", "edge"); register();
  await vi.advanceTimersByTimeAsync(60000);
  expect(state.loads).toBe(0);
});
