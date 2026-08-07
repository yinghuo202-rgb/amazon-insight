import { describe, expect, it } from "vitest";

import { classifyMarketOpportunity } from "@/lib/inventory/client-view-models";

describe("slow-moving product growth decisions", () => {
  it("prioritizes a profitable slow mover with usable inventory", () => {
    const result = classifyMarketOpportunity({
      market: "US",
      latestUnits: 12,
      previousUnits: 30,
      networkInventory: 80,
      localInventory: 25,
      dailySales: 0.5,
      actualMargin: 0.18,
      actualProfit: 42,
    });

    expect(result.status).toBe("SCALE");
    expect(result.trendPercent).toBe(-60);
    expect(result.coverDays).toBe(160);
  });

  it("keeps zero-sales long-cover stock out of the growth queue", () => {
    const result = classifyMarketOpportunity({
      market: "CA",
      latestUnits: 0,
      previousUnits: 0,
      networkInventory: 50,
      localInventory: 0,
      dailySales: 0,
      actualMargin: null,
      actualProfit: null,
    });

    expect(result.status).toBe("CLEARANCE");
  });

  it("does not recommend scaling a loss-making SKU", () => {
    const result = classifyMarketOpportunity({
      market: "US",
      latestUnits: 9,
      previousUnits: 18,
      networkInventory: 60,
      localInventory: 10,
      dailySales: 0.4,
      actualMargin: -0.05,
      actualProfit: -12,
    });

    expect(result.status).toBe("HEALTHY");
  });

  it("rejects an impossible margin as low-confidence data", () => {
    const result = classifyMarketOpportunity({
      market: "CA",
      latestUnits: 4,
      previousUnits: 12,
      networkInventory: 50,
      localInventory: 0,
      dailySales: 0.3,
      actualMargin: 1.2,
      actualProfit: 80,
    });

    expect(result.status).toBe("HEALTHY");
  });

  it("uses seasonal tailwind and ad efficiency in the decision", () => {
    const result = classifyMarketOpportunity({
      market: "US",
      latestUnits: 18,
      previousUnits: 20,
      networkInventory: 90,
      localInventory: 20,
      dailySales: 0.4,
      actualMargin: 0.25,
      actualProfit: 60,
      advertising: {
        spend: 100,
        sales: 200,
        orders: 8,
        acos: 50,
        action: "NO_ORDER_REVIEW",
        confidence: "medium",
        targetAcosPercent: 30,
      },
      season: { upcomingPeak: true, upcomingRisePercent: 45, clearance: false },
    });

    expect(result.status).toBe("WATCH");
    expect(result.seasonalTailwind).toBe(true);
    expect(result.advertisingOpportunity).toBe(-12);
  });

  it("keeps seasonal clearance stock out of the growth queue", () => {
    const result = classifyMarketOpportunity({
      market: "US",
      latestUnits: 12,
      previousUnits: 20,
      networkInventory: 100,
      localInventory: 0,
      dailySales: 0.5,
      actualMargin: 0.2,
      actualProfit: 40,
      season: { upcomingPeak: false, upcomingRisePercent: 0, clearance: true },
    });

    expect(result.status).toBe("CLEARANCE");
  });
});
