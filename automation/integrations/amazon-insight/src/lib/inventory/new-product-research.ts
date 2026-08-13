import type { NewProductResearchData } from "@/lib/inventory/contracts";

export type ResearchCandidate = NewProductResearchData["candidates"][number];
export type ResearchCandidateInput = Omit<ResearchCandidate, "grossProfit" | "grossMargin">;

export const RESEARCH_RMB_PER_USD = 7.2;

export function calculateResearchCandidate(input: ResearchCandidateInput): ResearchCandidate {
  const costs = [input.firstMile, input.storageFee, input.commission, input.orderFee, input.importDutyRate, input.purchaseCostRmb];
  if (input.amazonPrice === null || input.amazonPrice <= 0 || costs.some((value) => value === null)) {
    return { ...input, grossProfit: null, grossMargin: null };
  }
  const grossProfit = input.amazonPrice
    - (input.firstMile ?? 0)
    - (input.storageFee ?? 0)
    - (input.commission ?? 0)
    - (input.orderFee ?? 0)
    - (input.importDutyRate ?? 0)
    - (input.purchaseCostRmb ?? 0) / RESEARCH_RMB_PER_USD;
  return { ...input, grossProfit, grossMargin: grossProfit / input.amazonPrice };
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
