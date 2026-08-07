import type { SeasonalInventoryCandidate, SeasonalInventoryPlanResult } from "@/lib/inventory/seasonal-clearance";

export type SeasonalDecisionKind = "cross_market" | "clearance" | "urgent_replenishment" | "domestic_transfer" | "expedite_pending" | "monitor";

export type SeasonalDecisionRow = {
  candidate: SeasonalInventoryCandidate;
  kind: SeasonalDecisionKind;
  clearance: boolean;
  replenishment: boolean;
  crossMarketMismatch: boolean;
  actionQuantity: number;
  confidence: "high" | "medium" | "low";
};

export function buildSeasonalDecisionRows(plan: SeasonalInventoryPlanResult): SeasonalDecisionRow[] {
  const clearanceSkus = new Set(plan.clearanceCandidates.map((candidate) => candidate.sku));
  const replenishmentSkus = new Set(plan.replenishmentCandidates.map((candidate) => candidate.sku));
  const candidates = new Map<string, SeasonalInventoryCandidate>();
  for (const candidate of [...plan.clearanceCandidates, ...plan.replenishmentCandidates]) candidates.set(candidate.sku, candidate);

  return [...candidates.values()].map((candidate) => {
    const clearance = clearanceSkus.has(candidate.sku);
    const replenishment = replenishmentSkus.has(candidate.sku);
    const crossMarketMismatch = clearance && replenishment && ((candidate.usReplenishmentGap > 0 && candidate.caClearanceQty > 0) || (candidate.caReplenishmentGap > 0 && candidate.usClearanceQty > 0));
    const kind: SeasonalDecisionKind = crossMarketMismatch ? "cross_market"
      : clearance ? "clearance"
      : candidate.urgentReplenishmentQty > 0 ? "urgent_replenishment"
      : candidate.domesticTransferQty > 0 ? "domestic_transfer"
      : candidate.pendingCoverageQty > 0 ? "expedite_pending"
      : "monitor";
    const actionQuantity = candidate.usClearanceQty + candidate.caClearanceQty + candidate.domesticClearanceQty + candidate.pendingMitigationQty
      + candidate.domesticTransferQty + candidate.pendingCoverageQty + candidate.urgentReplenishmentQty;
    const confidence: SeasonalDecisionRow["confidence"] = candidate.baselineYears.length >= 2 && candidate.paceEvidenceMonths >= 2 ? "high" : candidate.baselineYears.length >= 2 && candidate.paceEvidenceMonths >= 1 ? "medium" : "low";
    return { candidate, kind, clearance, replenishment, crossMarketMismatch, actionQuantity, confidence };
  }).sort((left, right) => decisionRank(left.kind) - decisionRank(right.kind) || right.actionQuantity - left.actionQuantity || left.candidate.sku.localeCompare(right.candidate.sku));
}

export function buildSeasonalDecisionSummary(plan: SeasonalInventoryPlanResult) {
  const rows = buildSeasonalDecisionRows(plan);
  return {
    actionSkuCount: rows.length,
    overlapCount: rows.filter((row) => row.clearance && row.replenishment).length,
    crossMarketMismatchCount: rows.filter((row) => row.crossMarketMismatch).length,
    lowConfidenceCount: rows.filter((row) => row.confidence === "low").length,
    replenishmentGapQty: plan.replenishmentCandidates.reduce((total, candidate) => total + candidate.usReplenishmentGap + candidate.caReplenishmentGap, 0),
    clearanceStockQty: plan.clearanceCandidates.reduce((total, candidate) => total + candidate.currentClearanceQty, 0),
    pendingMitigationQty: plan.clearanceCandidates.reduce((total, candidate) => total + candidate.pendingMitigationQty, 0),
    markets: {
      US: marketSummary(plan, "US"),
      CA: marketSummary(plan, "CA"),
    },
  };
}

function marketSummary(plan: SeasonalInventoryPlanResult, market: "US" | "CA") {
  return {
    replenishmentGapQty: plan.replenishmentCandidates.reduce((total, candidate) => total + (market === "US" ? candidate.usReplenishmentGap : candidate.caReplenishmentGap), 0),
    clearanceQty: plan.clearanceCandidates.reduce((total, candidate) => total + (market === "US" ? candidate.usClearanceQty : candidate.caClearanceQty), 0),
    transferQty: plan.replenishmentCandidates.reduce((total, candidate) => total + (market === "US" ? candidate.usDomesticTransferQty : candidate.caDomesticTransferQty), 0),
    pendingCoverageQty: plan.replenishmentCandidates.reduce((total, candidate) => total + (market === "US" ? candidate.usPendingCoverageQty : candidate.caPendingCoverageQty), 0),
    urgentQty: plan.replenishmentCandidates.reduce((total, candidate) => total + (market === "US" ? candidate.usUrgentReplenishmentQty : candidate.caUrgentReplenishmentQty), 0),
  };
}

function decisionRank(kind: SeasonalDecisionKind) {
  return kind === "cross_market" ? 0 : kind === "clearance" ? 1 : kind === "urgent_replenishment" ? 2 : kind === "domestic_transfer" ? 3 : kind === "expedite_pending" ? 4 : 5;
}
