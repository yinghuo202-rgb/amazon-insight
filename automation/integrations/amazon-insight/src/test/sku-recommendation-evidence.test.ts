import { expect, it } from "vitest";
import { buildSkuRecommendationEvidence } from "@/components/inventory/sku-recommendation-evidence";
import type { OperatingSku } from "@/lib/inventory/dashboard-view-model";

const now = new Date("2026-10-15T00:00:00Z");

function fixture(): OperatingSku {
  return {
    currency: "USD",
    history: [
      { reportMonth: "2026-06", currency: "USD", units: 10, productSales: 100, averagePrice: null, quality: { completePeriod: true } },
      { reportMonth: "2026-07", currency: "CAD", units: 10, productSales: 200, averagePrice: 20, quality: { completePeriod: true } },
      { reportMonth: "2026-08", currency: "USD", units: 10, productSales: 300, averagePrice: 30, quality: { completePeriod: false } },
      { reportMonth: "2026-09", currency: "USD", units: 20, productSales: 400, averagePrice: 20, quality: { completePeriod: true } },
      { reportMonth: "2026-10", currency: "USD", units: 30, productSales: 600, averagePrice: 20, quality: { completePeriod: false } },
    ],
    advertisingHistory: [
      { reportMonth: "2026-06", currency: "USD", startDate: "2026-06-01", businessAsOf: "2026-06-30", cost: 20, sales: 100 },
      { reportMonth: "2026-07", currency: "CAD", startDate: "2026-07-01", businessAsOf: "2026-07-31", cost: 30, sales: 120 },
      { reportMonth: "2026-08", currency: "USD", startDate: "2026-08-01", businessAsOf: "2026-08-15", cost: 40, sales: 160 },
      { reportMonth: "2026-09", currency: "USD", startDate: "2026-09-01", businessAsOf: "2026-09-30", cost: 50, sales: 250 },
      { reportMonth: "2026-10", currency: "USD", startDate: "2026-10-01", businessAsOf: "2026-10-15", cost: 60, sales: 300 },
    ],
  } as OperatingSku;
}

it("aligns six complete calendar months and leaves missing, mixed-currency, and partial data blank", () => {
  const points = buildSkuRecommendationEvidence(fixture(), "2026-10", now);
  expect(points.map(point => point.month)).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
  expect(points[2]).toMatchObject({ revenue: 100, averagePrice: 10, advertisingCost: 20, advertisingSales: 100, acos: 0.2 });
  expect(points[3]).toMatchObject({ revenue: null, averagePrice: null, advertisingCost: null, advertisingSales: null, acos: null });
  expect(points[4]).toMatchObject({ revenue: null, averagePrice: null, advertisingCost: null, advertisingSales: null, acos: null });
  expect(points[5]).toMatchObject({ revenue: 400, averagePrice: 20, advertisingCost: 50, advertisingSales: 250, acos: 0.2 });
});

it("ends at the selected complete month and never borrows a later advertising month", () => {
  const points = buildSkuRecommendationEvidence(fixture(), "2026-07", now);
  expect(points.at(-1)?.month).toBe("2026-07");
  expect(points.at(-1)?.advertisingCost).toBeNull();
  expect(points.at(-2)?.advertisingCost).toBe(20);
});

it("requires advertising coverage from the first through the last day of a month", () => {
  const row = fixture();
  row.advertisingHistory[0] = { ...row.advertisingHistory[0], startDate: "2026-06-02" };
  expect(buildSkuRecommendationEvidence(row, "2026-06", now).at(-1)?.advertisingCost).toBeNull();
});
