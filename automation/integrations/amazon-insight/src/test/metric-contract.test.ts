import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildOperatingModel } from "@/lib/inventory/dashboard-view-model";
import { profitabilityRowSchema } from "@/lib/inventory/contracts";
import { buildReviewEvidence, evidenceSchema, reviewEvidenceUpdate } from "@/lib/inventory/operating-review";
import { defaultOperatingRules } from "@/lib/inventory/operating-rules";
import { loadOperatingModel } from "@/lib/inventory/data";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RevenueOverviewDashboard } from "@/components/inventory/revenue-overview-dashboard";
import { queryOperatingModel } from "@/lib/inventory/operating-query";

const now = new Date("2026-10-09T00:00:00Z");
function model() {
  const row = profitabilityRowSchema.parse({ sku: "SKU-A", market: "US", currency: "USD", reportMonth: "2026-09", units: 100, returns: 4, netUnits: 96, productSales: 1000, settlementPayout: 400, landedCost: 500, grossProfit: -100, advertisingCost: 250, storageCost: 10, actualProfit: -100, currentPrice: 10, grossMargin: -.1, actualMargin: -.1, conservativeMargin: -.1, quality: { profitVerified: true, returnsVerified: true, completePeriod: true } });
  return buildOperatingModel([], { schemaVersion: 1, generatedAt: now.toISOString(), method: "fixture", sources: [], rows: [row] }, undefined, [], now);
}
const request = { kind: "review" as const, sku: "SKU-A", market: "US" as const, period: "2026-09", issue: "利润为负", version: "legacy" };
const actor = { actor: "system" as const, userId: "system", now };
function record(context: ReturnType<typeof buildReviewEvidence>["context"]) {
  return { contextJson: JSON.stringify(context), historyJson: "[]", status: "DONE", note: "已核对成本" };
}

describe("metric version evidence", () => {
  it("renders definitions and separate current/source versions in the existing source disclosure", () => {
    const data = model();
    const html = renderToStaticMarkup(createElement(RevenueOverviewDashboard, { initial: queryOperatingModel(data, {}, now) }));
    const disclosure = html.match(/<details[^>]*>([\s\S]*?)<\/details>/g)!.find(section => section.includes("数据状态"))!;
    expect(disclosure).toContain("当前解释：定义 operating-metrics-v1");
    expect(disclosure).toContain("发布来源：定义 未知（旧报告无记录）");
    expect(disclosure).toContain("广告归因比");
    expect(disclosure).toContain("广告归因窗口待核验");
    expect(disclosure).toContain("国内库存和采购订单不计海外覆盖");
  });
  it("captures current definition and calculation versions without assigning them to legacy source", () => {
    const data = model();
    expect(data).toHaveProperty("metricContract.definitions");
    expect(data).toHaveProperty("publishedMetricContract", null);
    const evidence = buildReviewEvidence(data, request, now).context.latest;
    expect(evidence).toMatchObject({ metricDefinitionVersion: "operating-metrics-v1", calculationRuleVersion: "operating-calculations-v1", publishedMetricDefinitionVersion: null, publishedCalculationRuleVersion: null, sales: 1000, profit: -100 });
    const legacy = { ...evidence };
    delete legacy.metricDefinitionVersion; delete legacy.calculationRuleVersion;
    delete legacy.publishedMetricDefinitionVersion; delete legacy.publishedCalculationRuleVersion;
    expect(evidenceSchema.parse(legacy)).not.toHaveProperty("metricDefinitionVersion");
  });
  it.each(["metricDefinitionVersion", "calculationRuleVersion"] as const)("known %s change is reviewable even for identical numbers and request version", field => {
    const data = model(), first = buildReviewEvidence(data, request, now);
    const next = buildReviewEvidence(data, request, now);
    Object.assign(next.context.latest, { [field]: "changed-v2" });
    const update = reviewEvidenceUpdate(record(first.context), next, actor);
    expect(update?.status).toBe("REVIEW");
    expect(JSON.parse(update!.historyJson).at(-1)).toMatchObject({ note: "已核对成本", evidence: { [field]: "changed-v2", sales: 1000 } });
    expect(JSON.parse(update!.contextJson).baseline).toEqual(first.context.baseline);
  });
  it("first unknown-to-known metadata retains new evidence but does not reopen a same-facts conclusion", () => {
    const data = model(), next = buildReviewEvidence(data, request, now);
    const legacy = JSON.parse(JSON.stringify(next.context));
    for (const evidence of [legacy.baseline, legacy.latest]) {
      delete evidence.metricDefinitionVersion; delete evidence.calculationRuleVersion;
      delete evidence.publishedMetricDefinitionVersion; delete evidence.publishedCalculationRuleVersion;
    }
    const update = reviewEvidenceUpdate(record(legacy), next, actor);
    expect(update?.status).toBe("DONE");
    const saved = JSON.parse(update!.contextJson);
    expect(saved.baseline).not.toHaveProperty("calculationRuleVersion");
    expect(saved.latest.calculationRuleVersion).toBe("operating-calculations-v1");
    expect(JSON.parse(update!.historyJson).at(-1)).toMatchObject({ action: "attach-metric-contract", previousStatus: "DONE", status: "DONE", note: "已核对成本", evidence: { calculationRuleVersion: "operating-calculations-v1" } });
    expect(reviewEvidenceUpdate({ ...record(legacy), ...update! }, next, actor)).toBeNull();
  });
  it("same-contract publication and clock changes neither reopen nor duplicate history", () => {
    const data = model(), first = buildReviewEvidence(data, request, now);
    data.dataVersion = "republish"; data.publishedVersion = "data-other";
    const next = buildReviewEvidence(data, { ...request, version: "republish" }, new Date("2026-10-10"));
    const update = reviewEvidenceUpdate(record(first.context), next, actor)!;
    expect(update.status).toBe("DONE"); expect(update.historyJson).toBe("[]");
  });
  it("an intervening legacy restore cannot hide a later known source-rule change", () => {
    const data = model();
    data.publishedMetricContract = { metricDefinitionVersion: "source-definitions-v1", calculationRuleVersion: "source-rules-v1" };
    const first = buildReviewEvidence(data, request, now), original = record(first.context);
    data.publishedMetricContract = null; data.dataVersion = "legacy-restore";
    const legacy = reviewEvidenceUpdate(original, buildReviewEvidence(data, { ...request, version: data.dataVersion }, now), actor)!;
    expect(legacy.status).toBe("DONE");
    data.publishedMetricContract = { metricDefinitionVersion: "source-definitions-v1", calculationRuleVersion: "source-rules-v2" }; data.dataVersion = "known-source-v2";
    const changed = reviewEvidenceUpdate({ ...original, ...legacy }, buildReviewEvidence(data, { ...request, version: data.dataVersion }, now), actor)!;
    expect(changed.status).toBe("REVIEW");
    expect(JSON.parse(changed.contextJson).baseline.publishedCalculationRuleVersion).toBe("source-rules-v1");
  });
});

describe("published contract selection and request identity", () => {
  const folders: string[] = [];
  afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true }))); });
  async function fixture() {
    const folder = await mkdtemp(path.join(os.tmpdir(), "metric-contract-")); folders.push(folder);
    vi.stubEnv("STORE_OPS_RUNTIME_ROOT", folder); vi.stubEnv("STORE_OPS_STATE_DB", path.join(folder, "state.sqlite3"));
    await mkdir(path.join(folder, "reports"));
    return folder;
  }
  it("loads a published source contract separately from the current explanation and keeps legacy unknown", async () => {
    const folder = await fixture();
    const legacy = await loadOperatingModel();
    expect(legacy).toHaveProperty("publishedMetricContract", null);
    const version = "data-20261009-000000-test", reports = path.join(folder, "reports", ".versions", version, "reports");
    await mkdir(reports, { recursive: true });
    const current = (legacy as unknown as { metricContract: object }).metricContract;
    await writeFile(path.join(reports, "metric-contract.json"), JSON.stringify({ ...current, calculationRuleVersion: "archived-rules-v0" }));
    await writeFile(path.join(folder, "reports", "current.json"), JSON.stringify({ version }));
    const published = await loadOperatingModel();
    expect(published).toHaveProperty("metricContract.calculationRuleVersion", "operating-calculations-v1");
    expect(published).toHaveProperty("publishedMetricContract.calculationRuleVersion", "archived-rules-v0");
  });
  it("hashes actual default rules even without threshold overrides", async () => {
    await fixture();
    const before = await loadOperatingModel(), initial = defaultOperatingRules.profitMarginMinPercent;
    try {
      defaultOperatingRules.profitMarginMinPercent = initial + 1;
      const after = await loadOperatingModel();
      expect(after.dataVersion).not.toBe(before.dataVersion);
    } finally { defaultOperatingRules.profitMarginMinPercent = initial; }
  });
});
