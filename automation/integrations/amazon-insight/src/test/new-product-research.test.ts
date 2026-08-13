import { describe, expect, it } from "vitest";

import { applyResearchCandidateOverrides, calculateResearchCandidate } from "@/lib/inventory/new-product-research";
import type { NewProductResearchData } from "@/lib/inventory/contracts";

const input = {
  sku: "NP001",
  name: "新品",
  amazonPrice: 39.99,
  firstMile: 2,
  storageFee: 0.5,
  commission: 6,
  orderFee: 8,
  importDutyRate: 1,
  purchaseCostRmb: 72,
  competitorUrl: "https://www.amazon.com/dp/example",
};

describe("new product research editing", () => {
  it("calculates gross profit and margin from editable costs", () => {
    const result = calculateResearchCandidate(input);
    expect(result.grossProfit).toBeCloseTo(12.49, 2);
    expect(result.grossMargin).toBeCloseTo(0.3123, 3);
  });

  it("keeps profitability empty until every cost is present", () => {
    const result = calculateResearchCandidate({ ...input, storageFee: null });
    expect(result.grossProfit).toBeNull();
    expect(result.grossMargin).toBeNull();
  });

  it("merges stored edits with source candidates and recalculates the summary", () => {
    const source: NewProductResearchData = {
      schemaVersion: 1,
      generatedAt: "2026-08-13T00:00:00Z",
      source: { path: "research.xlsx", modifiedAt: "2026-08-13T00:00:00Z", sha256: "hash", sheet: "Sheet1" },
      summary: { candidateCount: 1, viableCandidateCount: 0, averageGrossMargin: 0.1, latestOrderMonth: null, orderedSkuCount: 0, plannedUnits: 0, monthCount: 0 },
      candidates: [{ ...calculateResearchCandidate(input), grossMargin: 0.1 }],
      monthlyOrders: [],
    };
    const edited = calculateResearchCandidate({ ...input, amazonPrice: 50 });
    const added = calculateResearchCandidate({ ...input, sku: "NP002", amazonPrice: 60 });
    const result = applyResearchCandidateOverrides(source, [edited, added]);
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.find((item) => item.sku === "NP001")?.amazonPrice).toBe(50);
    expect(result.summary.candidateCount).toBe(2);
    expect(result.summary.viableCandidateCount).toBe(2);
  });
});
