import type { SeasonalInventoryCandidate, SeasonalInventoryPlanResult } from "@/lib/inventory/seasonal-clearance";

export type SeasonalPlanMarket = "US" | "CA";

export type SeasonalShipmentAction = {
  sku: string;
  productName: string;
  market: SeasonalPlanMarket;
  kind: "clearance" | "replenishment" | "combined" | "monitor";
  transferQty: number;
  clearanceQty: number;
  shipmentQty: number;
  overseasClearanceQty: number;
  shipByDate: string;
  sellByDate: string;
  reason: string;
};

export type SeasonalPurchaseAction = {
  sku: string;
  productName: string;
  kind: "stop_purchase" | "urgent_purchase" | "transfer_first" | "monitor";
  blockPurchase: boolean;
  urgentPurchaseQty: number;
  domesticTransferQty: number;
  pendingMitigationQty: number;
  deadline: string;
  reason: string;
};

export function buildSeasonalShipmentActions(plan: SeasonalInventoryPlanResult): SeasonalShipmentAction[] {
  const clearanceSkus = new Set(plan.clearanceCandidates.map((candidate) => candidate.sku));
  const replenishmentSkus = new Set(plan.replenishmentCandidates.map((candidate) => candidate.sku));
  const candidates = candidateUnion(plan);
  return candidates.flatMap((candidate) => {
    const isClearance = clearanceSkus.has(candidate.sku);
    const isReplenishment = replenishmentSkus.has(candidate.sku);
    const transfer = { US: candidate.usDomesticTransferQty, CA: candidate.caDomesticTransferQty };
    const clearance = isClearance ? allocateWeighted(candidate.domesticClearanceQty, candidate.usReserveUnits, candidate.caReserveUnits) : { US: 0, CA: 0 };
    const shipByDate = shipmentDeadline(candidate, plan);
    return (["US", "CA"] as const).map((market) => {
      const transferQty = market === "US" ? transfer.US : transfer.CA;
      const clearanceQty = market === "US" ? clearance.US : clearance.CA;
      const overseasClearanceQty = isClearance ? market === "US" ? candidate.usClearanceQty : candidate.caClearanceQty : 0;
      const kind = isClearance && isReplenishment ? "combined" : isClearance ? "clearance" : transferQty > 0 || candidate.urgentReplenishmentQty > 0 ? "replenishment" : "monitor";
      const parts = [];
      if (transferQty) parts.push(`旺季补货从国内调拨 ${transferQty} 件`);
      if (clearanceQty) parts.push(`国内清货 ${clearanceQty} 件须发往 ${market}`);
      if (overseasClearanceQty) parts.push(`${market} 海外现货 ${overseasClearanceQty} 件须在 ${plan.seasonEndDate} 前售罄`);
      if (!parts.length && isReplenishment) parts.push(candidate.replenishmentRecommendation || "旺季销量关注");
      return {
        sku: candidate.sku,
        productName: candidate.productName,
        market,
        kind,
        transferQty,
        clearanceQty,
        shipmentQty: transferQty + clearanceQty,
        overseasClearanceQty,
        shipByDate,
        sellByDate: isClearance ? plan.seasonEndDate : candidate.replenishmentHorizonEnd,
        reason: parts.join("；"),
      } satisfies SeasonalShipmentAction;
    });
  });
}

export function buildSeasonalPurchaseActions(plan: SeasonalInventoryPlanResult): SeasonalPurchaseAction[] {
  const clearanceBySku = new Map(plan.clearanceCandidates.map((candidate) => [candidate.sku, candidate] as const));
  const replenishmentBySku = new Map(plan.replenishmentCandidates.map((candidate) => [candidate.sku, candidate] as const));
  return candidateUnion(plan).map((candidate) => {
    const clearance = clearanceBySku.get(candidate.sku);
    const replenishment = replenishmentBySku.get(candidate.sku);
    const blockPurchase = Boolean(clearance);
    const urgentPurchaseQty = blockPurchase ? 0 : candidate.urgentReplenishmentQty;
    const pendingMitigationQty = blockPurchase ? candidate.pendingMitigationQty : 0;
    const kind = blockPurchase ? "stop_purchase" : urgentPurchaseQty > 0 ? "urgent_purchase" : candidate.domesticTransferQty > 0 ? "transfer_first" : "monitor";
    const parts = [];
    if (blockPurchase) parts.push(candidate.currentClearanceQty > 0 ? `季末清货期间停止新增采购，现货 ${candidate.currentClearanceQty} 件优先售罄` : "季末清货期间停止新增采购");
    if (pendingMitigationQty) parts.push(`未完工订单 ${pendingMitigationQty} 件需停单、转款或改用途`);
    if (!blockPurchase && candidate.domesticTransferQty) parts.push(`先从国内调拨 ${candidate.domesticTransferQty} 件`);
    if (urgentPurchaseQty) parts.push(`扣减国内现货和未完工订单后仍缺 ${urgentPurchaseQty} 件`);
    if (!parts.length && replenishment) parts.push("旺季销量关注，当前无需新增采购");
    return {
      sku: candidate.sku,
      productName: candidate.productName,
      kind,
      blockPurchase,
      urgentPurchaseQty,
      domesticTransferQty: candidate.domesticTransferQty,
      pendingMitigationQty,
      deadline: clearance ? plan.seasonEndDate : candidate.replenishmentHorizonEnd,
      reason: parts.join("；"),
    };
  });
}

export function adjustedSeasonalPurchaseQuantity(baseQuantity: number, cartonQty: number, action?: SeasonalPurchaseAction) {
  if (action?.blockPurchase) return 0;
  const target = Math.max(0, baseQuantity, action?.urgentPurchaseQty ?? 0);
  const carton = Math.max(1, cartonQty);
  return Math.ceil(target / carton) * carton;
}

function candidateUnion(plan: SeasonalInventoryPlanResult) {
  const candidates = new Map<string, SeasonalInventoryCandidate>();
  for (const candidate of [...plan.clearanceCandidates, ...plan.replenishmentCandidates]) candidates.set(candidate.sku, candidate);
  return [...candidates.values()].sort((left, right) => left.sku.localeCompare(right.sku));
}

function allocateWeighted(total: number, usWeight: number, caWeight: number) {
  const quantity = Math.max(0, Math.round(total));
  if (!quantity) return { US: 0, CA: 0 };
  const weight = Math.max(0, usWeight) + Math.max(0, caWeight);
  if (!weight) return { US: quantity, CA: 0 };
  const US = Math.round(quantity * Math.max(0, usWeight) / weight);
  return { US, CA: quantity - US };
}

function shipmentDeadline(candidate: SeasonalInventoryCandidate, plan: SeasonalInventoryPlanResult) {
  if (plan.clearanceCandidates.some((row) => row.sku === candidate.sku)) return monthEndBefore(plan.seasonEndDate);
  const peakMonth = candidate.upcomingPeakMonths[0];
  if (!peakMonth) return monthEndBefore(candidate.replenishmentHorizonEnd);
  const snapshotYear = Number(plan.snapshotDate.slice(0, 4));
  const snapshotMonth = Number(plan.snapshotDate.slice(5, 7));
  const peakYear = peakMonth < snapshotMonth ? snapshotYear + 1 : snapshotYear;
  return monthEndBefore(`${peakYear}-${String(peakMonth).padStart(2, "0")}-01`);
}

function monthEndBefore(date: string) {
  const [year, month] = date.slice(0, 7).split("-").map(Number);
  const previous = new Date(Date.UTC(year, month - 1, 0));
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}-${String(previous.getUTCDate()).padStart(2, "0")}`;
}
