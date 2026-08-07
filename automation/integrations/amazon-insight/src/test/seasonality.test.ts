import { describe, expect, it } from "vitest";

import { aggregateCalendarSeasonality, buildSeasonalityProfile, salesTrendPercent } from "@/lib/inventory/seasonality";

describe("inventory seasonality", () => {
  const history = Array.from({ length: 24 }, (_, index) => {
    const month = index % 12 + 1;
    return { month: `${2024 + Math.floor(index / 12)}-${String(month).padStart(2, "0")}`, units: month === 7 ? 200 : 100 };
  });

  it("identifies a repeat peak month across years", () => {
    const result = buildSeasonalityProfile(history, 7);
    expect(result.band).toBe("peak");
    expect(result.currentFactor).toBeGreaterThan(1.2);
    expect(result.peakMonths[0]).toBe(7);
  });

  it("aggregates multiple SKU histories by period", () => {
    expect(aggregateCalendarSeasonality([
      [{ month: "2025-01", units: 10 }],
      [{ month: "2025-01", units: 20 }, { month: "2025-02", units: 5 }],
    ])).toEqual([{ month: "2025-01", units: 30 }, { month: "2025-02", units: 5 }]);
  });

  it("compares the latest three months with the previous three", () => {
    expect(salesTrendPercent([
      { month: "2025-01", units: 100 }, { month: "2025-02", units: 100 }, { month: "2025-03", units: 100 },
      { month: "2025-04", units: 150 }, { month: "2025-05", units: 150 }, { month: "2025-06", units: 150 },
    ])).toBe(50);
  });
});
