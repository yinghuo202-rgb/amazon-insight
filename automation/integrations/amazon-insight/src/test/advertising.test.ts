import { describe, expect, it } from "vitest";

import { calculateAdvertisingDecision } from "@/lib/inventory/advertising-calculator";
import type { AdvertisingParameters } from "@/lib/inventory/contracts";

const parameters: AdvertisingParameters = {
  targetAcosPercent: 30,
  minimumEvidenceSpend: 20,
  noOrderSpend: 20,
  winnerMinOrders: 5,
  scaleMinOrders: 1,
  lowVolumeMaxClicks: 30,
  budgetUtilizationThresholdPercent: 80,
  scaleMaxAcosRatio: 0.9,
};

describe("advertising decision calculator", () => {
  it("prioritizes inventory risk", () => {
    const result = calculateAdvertisingDecision(
      { spend: 25, advertisingSales: 200, orders: 8, clicks: 40, impressions: 2000, budget: 20, periodDays: 30 },
      parameters,
      "critical",
    );
    expect(result.action).toBe("PAUSE_STOCK_RISK");
  });

  it("reduces campaigns above target ACOS", () => {
    const result = calculateAdvertisingDecision(
      { spend: 60, advertisingSales: 100, orders: 3, clicks: 50, impressions: 3000, budget: 20, periodDays: 30 },
      parameters,
      "healthy",
    );
    expect(result.action).toBe("REDUCE_BID_OR_BUDGET");
    expect(result.acos).toBe(60);
  });

  it("raises bids for efficient campaigns that have not gained volume", () => {
    const result = calculateAdvertisingDecision(
      { spend: 15, advertisingSales: 100, orders: 1, clicks: 15, impressions: 2000, budget: 10, periodDays: 30 },
      parameters,
      "healthy",
    );
    expect(result.action).toBe("INCREASE_BID");
    expect(result.conversionRate).toBe(6.67);
  });

  it("raises budget only when an efficient campaign is budget constrained", () => {
    const result = calculateAdvertisingDecision(
      { spend: 270, advertisingSales: 2000, orders: 20, clicks: 120, impressions: 8000, budget: 10, periodDays: 30 },
      parameters,
      "healthy",
    );
    expect(result.action).toBe("INCREASE_BUDGET");
    expect(result.budgetUtilizationPercent).toBe(90);
  });
});
