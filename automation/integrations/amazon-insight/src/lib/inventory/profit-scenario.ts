import { z } from "zod";

export const profitFeeRulesSchema = z.array(z.object({
  market: z.enum(["US", "CA", "MX"]), category: z.string().min(1), effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  referralPercent: z.number().min(0).max(100), freightPerM3: z.number().nonnegative(),
  fbaTiers: z.array(z.object({ maxWeightG: z.number().positive(), maxLengthCm: z.number().positive(), maxWidthCm: z.number().positive(), maxHeightCm: z.number().positive(), fee: z.number().nonnegative() })),
}));
export type ProfitFeeRule = z.infer<typeof profitFeeRulesSchema>[number];

export function matchProfitFeeRule(rules: ProfitFeeRule[], market: string, category: string, date = new Date().toISOString().slice(0, 10)) {
  return rules.filter(rule => rule.market === market && rule.category === category && rule.effectiveDate <= date).sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0] ?? null;
}

export function matchFbaFee(rule: ProfitFeeRule | null, dimensions: number[], weightG: number) {
  if (!rule || dimensions.length !== 3 || dimensions.some(value => !Number.isFinite(value) || value <= 0) || !Number.isFinite(weightG) || weightG <= 0) return null;
  const [length, width, height] = [...dimensions].sort((a, b) => b - a);
  return rule.fbaTiers.filter(tier => weightG <= tier.maxWeightG && length <= tier.maxLengthCm && width <= tier.maxWidthCm && height <= tier.maxHeightCm).sort((a, b) => a.maxWeightG - b.maxWeightG || a.fee - b.fee)[0]?.fee ?? null;
}

export function cartonFreight(lengthCm: number, widthCm: number, heightCm: number, quantity: number, ratePerM3: number) {
  if ([lengthCm, widthCm, heightCm, quantity].some(value => !Number.isFinite(value) || value <= 0) || !Number.isInteger(quantity) || !Number.isFinite(ratePerM3) || ratePerM3 < 0) return null;
  return lengthCm * widthCm * heightCm / 1_000_000 * ratePerM3 / quantity;
}

export function calculateProfitScenario(input: { price: number; cost: number; referralPercent: number; fba: number; freight: number; adPercent: number; returnPercent: number }) {
  if (Object.values(input).some(value => !Number.isFinite(value) || value < 0) || input.price <= 0 || [input.referralPercent, input.adPercent, input.returnPercent].some(value => value > 100)) return null;
  const { price, cost, fba, freight, referralPercent, adPercent, returnPercent } = input;
  const referral = price * referralPercent / 100, ad = price * adPercent / 100, returns = price * returnPercent / 100;
  const profit = price - cost - fba - freight - referral - ad - returns;
  const contributionRate = 1 - (referralPercent + adPercent + returnPercent) / 100;
  return { price, cost, fba, freight, referral, ad, returns, profit, margin: profit / price,
    breakeven: contributionRate > 0 ? (cost + fba + freight) / contributionRate : null,
    maxAdPercent: Math.max(0, (price - cost - fba - freight - referral - returns) / price * 100) };
}
