import type { NewProductResearchData } from "@/lib/inventory/contracts";

export type ResearchCandidate = NewProductResearchData["candidates"][number];
export type ResearchCandidateInput = Omit<ResearchCandidate, "grossProfit" | "grossMargin" | "totalCostUsd" | "untaxedPriceUsd"> & { untaxedPriceUsd?: number | null };

export const RESEARCH_RMB_PER_USD = 7.2;
export const RESEARCH_UNTAXED_FACTOR = 0.885;

export function calculateResearchCostBreakdown(input: ResearchCandidateInput) {
  const purchaseCostUsd = input.purchaseCostRmb === null ? null : input.purchaseCostRmb / RESEARCH_RMB_PER_USD;
  const untaxedPriceUsd = input.untaxedPriceUsd === undefined || input.untaxedPriceUsd === null
    ? purchaseCostUsd === null ? null : purchaseCostUsd * RESEARCH_UNTAXED_FACTOR
    : input.untaxedPriceUsd;
  const costs = [input.firstMile, input.storageFee, input.commission, input.orderFee, input.importDutyRate, purchaseCostUsd, untaxedPriceUsd];
  if (input.amazonPrice === null || input.amazonPrice <= 0 || costs.some((value) => value === null)) {
    return { purchaseCostUsd, untaxedPriceUsd, totalCostUsd: null, grossProfit: null, grossMargin: null };
  }
  const totalCostUsd = costs.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const grossProfit = input.amazonPrice - totalCostUsd;
  return { purchaseCostUsd, untaxedPriceUsd, totalCostUsd, grossProfit, grossMargin: grossProfit / input.amazonPrice };
}

export function calculateResearchCandidate(input: ResearchCandidateInput): ResearchCandidate {
  const breakdown = calculateResearchCostBreakdown(input);
  return { ...input, untaxedPriceUsd: breakdown.untaxedPriceUsd, totalCostUsd: breakdown.totalCostUsd, grossProfit: breakdown.grossProfit, grossMargin: breakdown.grossMargin };
}

export function applyResearchCandidateOverrides(data: NewProductResearchData, overrides: ResearchCandidate[]) {
  if (!overrides.length) return data;
  const bySku = new Map(data.candidates.map((item) => [item.sku, item] as const));
  for (const item of overrides) bySku.set(item.sku, item);
  const candidates = [...bySku.values()];
  const margins = candidates.flatMap((item) => item.grossMargin === null ? [] : [item.grossMargin]);
  return {
    ...data,
    summary: {
      ...data.summary,
      candidateCount: candidates.length,
      viableCandidateCount: margins.filter((margin) => margin >= 0.3).length,
      averageGrossMargin: margins.length ? margins.reduce((sum, margin) => sum + margin, 0) / margins.length : 0,
    },
    candidates,
  };
}
