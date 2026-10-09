import { describe, expect, it } from "vitest";
import { calculateProfitScenario, cartonFreight, matchFbaFee, matchProfitFeeRule, profitFeeRulesSchema, type ProfitFeeRule } from "@/lib/inventory/profit-scenario";
const input = { price: 20, cost: 4, referralPercent: 15, fba: 3, freight: 1, adPercent: 15, returnPercent: 1 };
const rule: ProfitFeeRule = { market: "US", category: "test-category", effectiveDate: "2026-01-01", referralPercent: 15, freightPerM3: 100, fbaTiers: [{ maxWeightG: 500, maxLengthCm: 30, maxWidthCm: 20, maxHeightCm: 10, fee: 3 }] };
describe("profit calculator", () => {
  it("calculates minimum commission using the same function at break-even", () => {
    const result = calculateProfitScenario({ ...input, referralRule: { referralPercent: 15, minimumReferralFee: 3 } })!;
    expect(result.referral).toBe(3);
    expect(result.breakeven).toBeCloseTo(11 / .84);
    expect(calculateProfitScenario({ ...input, price: result.breakeven!, referralRule: { referralPercent: 15, minimumReferralFee: 3 } })!.profit).toBeCloseTo(0);
  });
  it("solves progressive referral brackets rather than a blended-price approximation", () => {
    const referralRule = { referralPercent: 8, referralTiers: [{ maxPrice: 10, percent: 20 }] };
    const result = calculateProfitScenario({ ...input, referralRule })!;
    expect(result.referral).toBeCloseTo(2.8);
    expect(result.breakeven).toBeCloseTo(9.2 / .76);
    expect(calculateProfitScenario({ ...input, price: result.breakeven!, referralRule })!.profit).toBeCloseTo(0);
    expect(calculateProfitScenario({ ...input, cost: 1, fba: 0, freight: 0, referralRule })!.breakeven).toBeCloseTo(1 / .64);
  });
  it("rejects bad calendars, reversed brackets and expired configurations", () => {
    expect(profitFeeRulesSchema.safeParse([{ ...rule, effectiveDate: "2026-02-30" }]).success).toBe(false);
    expect(profitFeeRulesSchema.safeParse([{ ...rule, validUntil: "2025-12-01" }]).success).toBe(false);
    expect(calculateProfitScenario({ ...input, referralRule: { referralPercent: 8, referralTiers: [{ maxPrice: 10, percent: 20 }, { maxPrice: 5, percent: 10 }] } })).toBeNull();
    expect(matchProfitFeeRule([{ ...rule, validUntil: "2026-02-01" }], "US", rule.category, "2026-02-02")).toBeNull();
    expect(matchProfitFeeRule([{ ...rule, validUntil: "2026-02-01" }], "US", rule.category, "2026-02-01")).not.toBeNull();
  });
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
