import { describe, expect, it } from "vitest";
import { buildOperatingModel } from "@/lib/inventory/dashboard-view-model";
import { profitabilityRowSchema } from "@/lib/inventory/contracts";
import { appendTaskHistory, buildReviewEvidence, preserveReviewBaseline, reviewEvidenceUpdate, taskHistorySchema } from "@/lib/inventory/operating-review";
import { safeSkuReturnHref, skuOperatingHref } from "@/lib/inventory/operating-navigation";
import { queryOperatingModel } from "@/lib/inventory/operating-query";
const now = new Date("2026-10-09T00:00:00Z");
function model() {
  const base = profitabilityRowSchema.parse({ sku: "SKU-A", market: "US", currency: "USD", reportMonth: "2026-09", units: 100, returns: 4, netUnits: 96, productSales: 1000, settlementPayout: 400, landedCost: 500, grossProfit: -100, advertisingCost: 250, storageCost: 10, actualProfit: -100, currentPrice: 10, grossMargin: -.1, actualMargin: -.1, conservativeMargin: -.1, quality: { profitVerified: true, returnsVerified: true, completePeriod: true } });
  return buildOperatingModel([], { schemaVersion: 1, generatedAt: now.toISOString(), method: "fixture", sources: [], rows: [base, { ...base, market: "CA", currency: "CAD" }] }, undefined, [], now);
}
const request = { kind: "review" as const, sku: "SKU-A", market: "US" as const, period: "2026-09", issue: "利润为负", version: "legacy" };
describe("SKU review evidence", () => {
  it("uses stable scoped identity across periods and keeps markets separate", () => {
    const data = model(), a = buildReviewEvidence(data, request, now);
    data.rows[0].history.push({ ...data.rows[0].history[0], reportMonth: "2026-08" });
    const earlier = buildReviewEvidence(data, { ...request, period: "2026-08" }, now);
    expect(a.issueKey).toBe(earlier.issueKey);
    expect(a.issueKey).not.toBe(buildReviewEvidence(data, { ...request, market: "CA" }, now).issueKey);
  });
  it("keeps first baseline when a new report is reviewed, including rollback", () => {
    const data = model(), first = buildReviewEvidence(data, request, now);
    data.rows[0].history[0].productSales = 900; data.dataVersion = "new";
    const next = buildReviewEvidence(data, { ...request, version: "new" }, now);
    const retained = preserveReviewBaseline(JSON.stringify(first.context), next.context);
    expect(retained.baseline.sales).toBe(1000); expect(retained.latest.sales).toBe(900);
    expect(preserveReviewBaseline(JSON.stringify(retained), first.context).baseline.version).toBe("legacy");
  });
  it("rejects stale, missing and non-triggered review requests", () => {
    expect(() => buildReviewEvidence(model(), { ...request, version: "stale" }, now)).toThrow("VERSION_CHANGED");
    expect(() => buildReviewEvidence(model(), { ...request, sku: "missing" }, now)).toThrow("NOT_FOUND");
    expect(() => buildReviewEvidence(model(), { ...request, issue: "invented" }, now)).toThrow("NOT_TRIGGERED");
  });
  it("allows existing reviews to capture resolved evidence without manufacturing a new alert", () => {
    const data = model(); data.rows[0].history[0].actualProfit = 300; data.rows[0].history[0].actualMargin = .3;
    const resolved = buildReviewEvidence(data, request, now, true);
    expect(resolved.triggered).toBe(false);
    expect(resolved.context.latest.issues).not.toContain("利润为负");
  });
  it("retains all explicit shared-account audit events and rejects corrupted storage", () => {
    const event = { at: now.toISOString(), actor: "shared-account" as const, userId: "fixture-user", action: "update-task", status: "DONE", note: "核对成本" };
    expect(JSON.parse(appendTaskHistory(appendTaskHistory("[]", event), event))).toHaveLength(2);
    expect(() => appendTaskHistory("{}", event)).toThrow();
    expect(() => preserveReviewBaseline("{}", buildReviewEvidence(model(), request, now).context)).toThrow();
  });
  it("reopens handled reviews only for a new triggered version while retaining the written conclusion", () => {
    const data = model(), initial = buildReviewEvidence(data, request, now);
    const record = { contextJson: JSON.stringify(initial.context), historyJson: JSON.stringify([{ at: now.toISOString(), actor: "shared-account", userId: "shared", action: "update-task", status: "DONE", note: "已核对成本" }]), status: "DONE", note: "已核对成本" };
    expect(reviewEvidenceUpdate(record, initial, { actor: "system", userId: "system", now })).toBeNull();
    data.dataVersion = "v2"; data.publishedVersion = "new-publication-v2"; data.rows[0].history[0].productSales = 900;
    const next = buildReviewEvidence(data, { ...request, version: "v2" }, now);
    const update = reviewEvidenceUpdate(record, next, { actor: "system", userId: "system", now })!;
    expect(update.status).toBe("REVIEW");
    expect(JSON.parse(update.contextJson).baseline.version).toBe("legacy");
    expect(JSON.parse(update.historyJson).at(-1)).toMatchObject({ actor: "system", previousStatus: "DONE", status: "REVIEW", note: "已核对成本", evidence: { version: "v2", period: "2026-09", sales: 900 }, triggered: true });
    expect(update).not.toHaveProperty("note");
  });
  it("preserves every intermediate evidence snapshot and compatible legacy history", () => {
    const data = model(), initial = buildReviewEvidence(data, request, now);
    let record = { contextJson: JSON.stringify(initial.context), historyJson: "[]", status: "DISMISSED", note: "先观察" };
    data.dataVersion = "v2"; data.publishedVersion = "new-publication-v2"; data.rows[0].history[0].productSales = 900;
    const a = reviewEvidenceUpdate(record, buildReviewEvidence(data, { ...request, version: "v2" }, now), { actor: "system", userId: "system", now })!;
    record = { ...record, ...a }; data.dataVersion = "v3"; data.rows[0].history[0].productSales = 800;
    const b = reviewEvidenceUpdate(record, buildReviewEvidence(data, { ...request, version: "v3" }, now), { actor: "system", userId: "system", now })!;
    const history = taskHistorySchema.parse(JSON.parse(b.historyJson));
    expect(history.map(event => event.evidence?.sales)).toEqual([1000, 900, 800]);
    expect(history.map(event => event.evidence?.version)).toEqual(["legacy", "v2", "v3"]);
    expect(history[0].action).toBe("preserve-legacy-evidence");
  });
  it("does not automatically close a resolved problem or repeat a handled evidence version", () => {
    const data = model(), initial = buildReviewEvidence(data, request, now);
    const record = { contextJson: JSON.stringify(initial.context), historyJson: "[]", status: "IN_PROGRESS", note: "继续核查" };
    data.dataVersion = "resolved"; data.rows[0].history[0].actualProfit = 300; data.rows[0].history[0].actualMargin = .3;
    const review = buildReviewEvidence(data, { ...request, version: "resolved" }, now, true);
    const update = reviewEvidenceUpdate(record, review, { actor: "system", userId: "system", now })!;
    expect(update.status).toBe("IN_PROGRESS"); expect(JSON.parse(update.historyJson).at(-1).triggered).toBe(false);
    expect(reviewEvidenceUpdate({ ...record, ...update, status: "DONE" }, review, { actor: "system", userId: "system", now })).toBeNull();
    expect(taskHistorySchema.parse(JSON.parse(appendTaskHistory("[]", { at: now.toISOString(), actor: "shared-account", userId: "shared", action: "update-task", status: "DONE", note: "旧事件" })))[0].evidence).toBeUndefined();
  });
  it("a report rollback updates the current evidence without duplicating old snapshots or reopening a handled issue", () => {
    const data = model(), first = buildReviewEvidence(data, request, now);
    const base = { contextJson: JSON.stringify(first.context), historyJson: "[]", status: "DONE", note: "原结论" };
    data.dataVersion = "v2"; data.rows[0].history[0].productSales = 900;
    const next = reviewEvidenceUpdate(base, buildReviewEvidence(data, { ...request, version: "v2" }, now), { actor: "system", userId: "", now })!;
    const rolledBack = reviewEvidenceUpdate({ ...base, ...next, status: "DONE" }, first, { actor: "system", userId: "", now })!;
    expect(JSON.parse(rolledBack.contextJson).latest.version).toBe("legacy");
    expect(rolledBack.status).toBe("DONE"); expect(JSON.parse(rolledBack.historyJson)).toHaveLength(2);
  });
  it("daily or other-SKU model hash changes do not reopen handled issues with unchanged published evidence", () => {
    const data = model(); data.publishedVersion = "data-published-1";
    const first = buildReviewEvidence(data, request, now);
    const record = { contextJson: JSON.stringify(first.context), historyJson: "[]", status: "DISMISSED", note: "人工无需处理" };
    data.dataVersion = "next-day-global-hash";
    const identical = buildReviewEvidence(data, { ...request, version: data.dataVersion }, new Date("2026-10-10T00:00:00Z"));
    expect(reviewEvidenceUpdate(record, identical, { actor: "system", userId: "", now })!.status).toBe("DISMISSED");
    data.rows[0].history[0].productSales = 900;
    expect(reviewEvidenceUpdate(record, buildReviewEvidence(data, { ...request, version: data.dataVersion }, now), { actor: "system", userId: "", now })!.status).toBe("REVIEW");
    data.rows[0].history[0].productSales = 1000; data.publishedVersion = "data-published-2";
    const republished = reviewEvidenceUpdate(record, buildReviewEvidence(data, { ...request, version: data.dataVersion }, now), { actor: "system", userId: "", now })!;
    expect(republished.status).toBe("DISMISSED"); expect(republished.historyJson).toBe(record.historyJson);
    expect(JSON.parse(republished.contextJson).latest.publishedVersion).toBe("data-published-2");
  });
  it.each(["period", "rules", "inventoryDate", "awdDate"])("real %s business evidence changes still retrigger a handled issue", change => {
    const data = model(), first = buildReviewEvidence(data, request, now);
    const record = { contextJson: JSON.stringify(first.context), historyJson: "[]", status: "DONE", note: "人工结论" };
    data.dataVersion = "real-business-change";
    let period = request.period;
    if (change === "period") { period = "2026-08"; data.rows[0].history.push({ ...data.rows[0].history[0], reportMonth: period }); }
    if (change === "rules") data.ruleOverrides = [{ market: "US", sku: "SKU-A", values: { profitMarginMinPercent: 30 } }];
    if (change === "inventoryDate") data.rows[0].inventoryDate = "2026-10-08";
    if (change === "awdDate") data.rows[0].awdDate = "2026-10-08";
    const update = reviewEvidenceUpdate(record, buildReviewEvidence(data, { ...request, period, version: data.dataVersion }, now), { actor: "system", userId: "", now })!;
    expect(update.status).toBe("REVIEW"); expect(update).not.toHaveProperty("note");
  });
});
describe("navigation and financial ranking", () => {
  it("round-trips site, period, query, filter, origin and sort without external return links", () => {
    const href = skuOperatingHref("SKU/A", "CA", "2026-07", { query: "A&B", sort: "margin", filter: "loss", origin: "overview" });
    const url = new URL(href, "https://test.invalid");
    expect(url.pathname).toBe("/inventory/sku/SKU%2FA"); expect(url.searchParams.get("query")).toBe("A&B");
    expect(url.searchParams.get("period")).toBe("2026-07"); expect(url.searchParams.get("market")).toBe("CA");
    expect(safeSkuReturnHref(href)).toBe(href);
    expect(safeSkuReturnHref("https://evil.invalid")).toBeNull(); expect(safeSkuReturnHref("//evil.invalid")).toBeNull();
    expect(safeSkuReturnHref("/inventory/sku/../../login")).toBeNull();
  });
  it("keeps the originating month separate from the alert evidence month", () => {
    const url = new URL(skuOperatingHref("SKU-A", "US", "2026-09", { origin: "overview", returnPeriod: "2026-10" }), "https://test.invalid");
    expect(url.searchParams.get("period")).toBe("2026-09");
    expect(url.searchParams.get("returnPeriod")).toBe("2026-10");
  });
  it("does not substitute a later month for missing facts", () => {
    const page = queryOperatingModel(model(), { brief: true, market: "US", period: "2026-07", filter: "all" }, now);
    expect(page.summary.revenue).toBeNull(); expect(page.model.rows[0].history).toEqual([]);
    expect(page.model.rows[0].analysis.current).toBeNull(); expect(page.priorities).toEqual([]);
  });
  it("sorts known revenue and margin without placing unknown profit first", () => {
    const data = model(), a = data.rows[0];
    data.rows.push({ ...a, sku: "SKU-B", listingId: "B", history: [{ ...a.history[0], productSales: 2000, actualProfit: null }] });
    expect(queryOperatingModel(data, { brief: true, sort: "revenue" }, now).model.rows.map(row => row.sku)).toEqual(["SKU-B", "SKU-A"]);
    expect(queryOperatingModel(data, { brief: true, sort: "margin" }, now).model.rows.map(row => row.sku)).toEqual(["SKU-A", "SKU-B"]);
    expect(queryOperatingModel(data, { brief: true, sort: "revenue" }, now).priorities[0].sku).toBe("SKU-A");
    expect(queryOperatingModel(data, { brief: true }, now).priorities[0].impactBasis).toBe("销售额");
  });
});
