import { z } from "zod";
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(value + "T00:00:00Z"); return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "日期无效");
const referralFields = z.object({
  referralPercent: z.number().min(0).max(100),
  minimumReferralFee: z.number().nonnegative().optional(),
  referralTiers: z.array(z.object({ maxPrice: z.number().positive(), percent: z.number().min(0).max(100) })).optional(),
}).refine(value => !value.referralTiers || value.referralTiers.every((tier, i, all) => i === 0 || tier.maxPrice > all[i - 1].maxPrice), "佣金档位须递增");
export const profitFeeRulesSchema = z.array(z.object({
  market: z.enum(["US", "CA", "MX"]), category: z.string().min(1), effectiveDate: calendarDate, validUntil: calendarDate.optional(),
  referralPercent: z.number().min(0).max(100), minimumReferralFee: z.number().nonnegative().optional(),
  referralTiers: z.array(z.object({ maxPrice: z.number().positive(), percent: z.number().min(0).max(100) })).optional(),
  freightPerM3: z.number().nonnegative(),
  fbaTiers: z.array(z.object({ maxWeightG: z.number().positive(), maxLengthCm: z.number().positive(), maxWidthCm: z.number().positive(), maxHeightCm: z.number().positive(), fee: z.number().nonnegative() })),
}).refine(value => (!value.validUntil || value.validUntil >= value.effectiveDate) && referralFields.safeParse(value).success, "费率有效期或档位无效"));
export type ProfitFeeRule = z.infer<typeof profitFeeRulesSchema>[number];
type ReferralRule = z.infer<typeof referralFields>;
export function matchProfitFeeRule(rules: ProfitFeeRule[], market: string, category: string, date = new Date().toISOString().slice(0, 10)) {
  return rules.filter(rule => rule.market === market && rule.category === category && rule.effectiveDate <= date && (!rule.validUntil || date <= rule.validUntil)).sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0] ?? null;
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
export function referralFee(price: number, rule: ReferralRule) {
  let total = 0, lower = 0;
  for (const tier of rule.referralTiers || []) {
    total += Math.max(0, Math.min(price, tier.maxPrice) - lower) * tier.percent / 100;
    lower = tier.maxPrice;
  }
  total += Math.max(0, price - lower) * rule.referralPercent / 100;
  return Math.max(rule.minimumReferralFee || 0, total);
}
// Solve each affine commission segment and its minimum-fee branch. A blended
// percentage at today's price is not valid at the break-even price.
function breakEven(fixed: number, budgetPercent: number, rule: ReferralRule) {
  let lower = 0, accrued = 0;
  const candidates: number[] = [];
  const segments = [...(rule.referralTiers || []), { maxPrice: Infinity, percent: rule.referralPercent }];
  for (const segment of segments) {
    const slope = segment.percent / 100, intercept = accrued - slope * lower;
    const contribution = 1 - budgetPercent / 100;
    for (const [rate, constant] of [[slope, intercept], [0, rule.minimumReferralFee || 0]]) {
      const denominator = contribution - rate;
      if (denominator <= 0) continue;
      const price = (fixed + constant) / denominator;
      if (Number.isFinite(price) && price >= lower - 1e-9 && price <= segment.maxPrice + 1e-9 && price >= 0 &&
        Math.abs(price * contribution - fixed - referralFee(price, rule)) < 1e-7) candidates.push(price);
    }
    accrued += (segment.maxPrice - lower) * slope; lower = segment.maxPrice;
  }
  return candidates.length ? Math.min(...candidates) : null;
}
export function calculateProfitScenario(input: { price: number; cost: number; referralPercent: number; fba: number; freight: number; adPercent: number; returnPercent: number; referralRule?: ReferralRule }) {
  const { price, cost, fba, freight, referralPercent, adPercent, returnPercent } = input;
  if ([price, cost, fba, freight, referralPercent, adPercent, returnPercent].some(value => !Number.isFinite(value) || value < 0) || price <= 0 || [referralPercent, adPercent, returnPercent].some(value => value > 100)) return null;
  const parsed = referralFields.safeParse(input.referralRule || { referralPercent });
  if (!parsed.success) return null;
  const rule = parsed.data, referral = referralFee(price, rule), ad = price * adPercent / 100, returns = price * returnPercent / 100;
  const profit = price - cost - fba - freight - referral - ad - returns;
  if (![profit, referral, ad, returns].every(Number.isFinite)) return null;
  return { price, cost, fba, freight, referral, ad, returns, profit, margin: profit / price,
    breakeven: breakEven(cost + fba + freight, adPercent + returnPercent, rule),
    maxAdPercent: Math.max(0, (price - cost - fba - freight - referral - returns) / price * 100) };
}
