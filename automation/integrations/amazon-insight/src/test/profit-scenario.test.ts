import { describe, expect, it } from "vitest";
import { calculateProfitScenario, cartonFreight, matchFbaFee, matchProfitFeeRule, type ProfitFeeRule } from "@/lib/inventory/profit-scenario";
const input = { price: 20, cost: 4, referralPercent: 15, fba: 3, freight: 1, adPercent: 15, returnPercent: 1 };
const rule: ProfitFeeRule = { market: "US", category: "test-category", effectiveDate: "2026-01-01", referralPercent: 15, freightPerM3: 100, fbaTiers: [{ maxWeightG: 500, maxLengthCm: 30, maxWidthCm: 20, maxHeightCm: 10, fee: 3 }] };
describe("profit calculator", () => {
  it("calculates profit, margin, breakeven and ad tolerance", () => {
    const result = calculateProfitScenario(input)!;
    expect(result.profit).toBeCloseTo(5.8);
    expect(result.margin).toBeCloseTo(.29);
    expect(result.breakeven).toBeCloseTo(8 / .69);
    expect(result.maxAdPercent).toBeCloseTo(44);
  });
  it("rejects negative fees and invalid percentages", () => {
    expect(calculateProfitScenario({ ...input, fba: -1 })).toBeNull();
    expect(calculateProfitScenario({ ...input, adPercent: 101 })).toBeNull();
    expect(calculateProfitScenario({ ...input, cost: NaN })).toBeNull();
    expect(calculateProfitScenario({ ...input, referralPercent: 90 })).toMatchObject({ breakeven: null });
  });
  it("calculates carton volume freight and validates pack quantity", () => {
    expect(cartonFreight(50, 40, 30, 10, 100)).toBeCloseTo(.6);
    expect(cartonFreight(50, 40, 30, 0, 100)).toBeNull();
    expect(cartonFreight(50, 40, 30, 1.5, 100)).toBeNull();
  });
  it("never carries fees across markets, categories or future dates", () => {
    expect(matchProfitFeeRule([rule], "CA", rule.category)).toBeNull();
    expect(matchProfitFeeRule([rule], "US", "other")).toBeNull();
    expect(matchProfitFeeRule([rule], "US", rule.category, "2025-12-31")).toBeNull();
    expect(matchProfitFeeRule([rule], "US", rule.category, "2026-01-01")).toEqual(rule);
  });
  it("requires matching unit dimensions and packaged weight", () => {
    expect(matchFbaFee(rule, [10, 30, 20], 500)).toBe(3);
    expect(matchFbaFee(rule, [10, 30, 20], 501)).toBeNull();
    expect(matchFbaFee(rule, [0, 30, 20], 500)).toBeNull();
  });
});
