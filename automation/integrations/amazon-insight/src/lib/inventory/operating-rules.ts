import { z } from "zod";

export const operatingRulesSchema = z.object({
  profitMarginMinPercent: z.number().min(-100).max(100),
  adSpendMaxPercent: z.number().min(0).max(100),
  returnRateMaxPercent: z.number().min(0).max(100),
  revenueDeclinePercent: z.number().min(0).max(100),
  minSalesUnits: z.number().int().min(1).max(1000000),
  minReturnSalesUnits: z.number().int().min(1).max(1000000),
  minReturnUnits: z.number().int().min(1).max(1000000),
  fbaCoverDays: z.number().int().min(1).max(730),
  supplyCoverDays: z.number().int().min(1).max(730),
  inventoryStaleDays: z.number().int().min(1).max(365),
}).strict();
export type OperatingRules = z.infer<typeof operatingRulesSchema>;
export const defaultOperatingRules: OperatingRules = {
  profitMarginMinPercent: 10, adSpendMaxPercent: 20, returnRateMaxPercent: 3,
  revenueDeclinePercent: 20, minSalesUnits: 30, minReturnSalesUnits: 50, minReturnUnits: 3,
  fbaCoverDays: 30, supplyCoverDays: 90, inventoryStaleDays: 14,
};
export type OperatingRuleOverride = { market: string; sku: string; values: Partial<OperatingRules> };
export function resolveOperatingRules(market: string, sku: string, overrides: OperatingRuleOverride[] = []): OperatingRules {
  const site = overrides.find(item => item.market === market && !item.sku)?.values ?? {};
  const product = overrides.find(item => item.market === market && item.sku === sku)?.values ?? {};
  return operatingRulesSchema.parse({ ...defaultOperatingRules, ...site, ...product });
}
