import { describe, expect, it } from "vitest";
import { buildOperatingModel } from "@/lib/inventory/dashboard-view-model";
import { profitabilityRowSchema } from "@/lib/inventory/contracts";
import { appendTaskHistory, buildReviewEvidence, preserveReviewBaseline } from "@/lib/inventory/operating-review";
import { safeSkuReturnHref, skuOperatingHref } from "@/lib/inventory/operating-navigation";
import { queryOperatingModel } from "@/lib/inventory/operating-query";
const now = new Date("2026-10-09T00:00:00Z");
function model() {
  const base = profitabilityRowSchema.parse({ sku: "SKU-A", market: "US", currency: "USD", reportMonth: "2026-09", units: 100, returns: 4, netUnits: 96, productSales: 1000, settlementPayout: 400, landedCost: 500, grossProfit: -100, advertisingCost: 250, storageCost: 10, actualProfit: -100, currentPrice: 10, grossMargin: -.1, actualMargin: -.1, conservativeMargin: -.1, quality: { profitVerified: true, returnsVerified: true, completePeriod: true } });
  return buildOperatingModel([], { schemaVersion: 1, generatedAt: now.toISOString(), method: "fixture", sources: [], rows: [base, { ...base, market: "MX", currency: "MXN" }] }, undefined, [], now);
}
const request = { kind: "review" as const, sku: "SKU-A", market: "US" as const, period: "2026-09", issue: "利润为负", version: "legacy" };
describe("SKU review evidence", () => {
  it("uses stable scoped identity across periods and keeps markets separate", () => {
    const data = model(), a = buildReviewEvidence(data, request, now);
    data.rows[0].history.push({ ...data.rows[0].history[0], reportMonth: "2026-08" });
    const earlier = buildReviewEvidence(data, { ...request, period: "2026-08" }, now);
    expect(a.issueKey).toBe(earlier.issueKey);
    expect(a.issueKey).not.toBe(buildReviewEvidence(data, { ...request, market: "MX" }, now).issueKey);
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
