import type { InventoryAction, InventoryParameters, InventoryRisk, InventoryRow } from "@/lib/inventory/contracts";

export type InventoryDecision = Pick<
  InventoryRow,
  | "eligibleInventoryPosition"
  | "daysCoverFba"
  | "daysCoverNetwork"
  | "suggestedShipmentQty"
  | "suggestedAwdTransferQty"
  | "reason"
> & {
  action: InventoryAction;
  riskLevel: InventoryRisk;
};

export function roundUpToPack(quantity: number, cartonQuantity: number | null) {
  if (quantity <= 0) return 0;
  const pack = cartonQuantity && cartonQuantity > 0 ? cartonQuantity : 1;
  return Math.ceil(quantity / pack) * pack;
}

export function calculateInventoryDecision(
  row: Pick<
    InventoryRow,
    "dailySales" | "fbaSellable" | "awdAvailable" | "awdOutboundToFba" | "cartonQty"
  >,
  parameters: InventoryParameters,
): InventoryDecision {
  const eligibleInventoryPosition = row.fbaSellable + row.awdAvailable + row.awdOutboundToFba;
  const daysCoverFba = row.dailySales > 0 ? row.fbaSellable / row.dailySales : null;
  const daysCoverNetwork = row.dailySales > 0 ? eligibleInventoryPosition / row.dailySales : null;
  const horizonDays =
    parameters.leadTimeDays +
    parameters.reviewCycleDays +
    parameters.targetCoverDays +
    parameters.safetyStockDays;
  const grossNeed = Math.max(0, row.dailySales * horizonDays - eligibleInventoryPosition);
  const suggestedShipmentQty = roundUpToPack(grossNeed, row.cartonQty);
  const transferNeed = Math.max(
    0,
    row.dailySales * parameters.fbaTransferTriggerDays - row.fbaSellable - row.awdOutboundToFba,
  );
  const suggestedAwdTransferQty = Math.min(
    row.awdAvailable,
    roundUpToPack(transferNeed, row.cartonQty),
  );

  let action: InventoryAction;
  let reason: string;
  if (row.dailySales <= 0) {
    action = "REVIEW_DATA";
    reason = "缺少可用日销，无法计算补货节奏。";
  } else if (!row.cartonQty || row.cartonQty <= 0) {
    action = "REVIEW_DATA";
    reason = "缺少有效装箱量，建议数量不能按整箱取整。";
  } else if (daysCoverNetwork !== null && daysCoverNetwork > parameters.excessCoverDays) {
    action = "HOLD_EXCESS";
    reason = `可计入库存覆盖约 ${Math.round(daysCoverNetwork)} 天，超过 ${parameters.excessCoverDays} 天上限。`;
  } else if (daysCoverNetwork !== null && daysCoverNetwork < parameters.leadTimeDays) {
    action = "URGENT_AIR_OR_TRANSFER";
    reason = `可计入库存仅覆盖约 ${Math.round(daysCoverNetwork)} 天，早于 ${parameters.leadTimeDays} 天海运到货。`;
  } else if (
    daysCoverFba !== null &&
    daysCoverFba < parameters.fbaTransferTriggerDays &&
    suggestedAwdTransferQty > 0
  ) {
    action = "AWD_TRANSFER";
    reason = `FBA 仅覆盖约 ${Math.round(daysCoverFba)} 天，可先从 AWD 调拨。`;
  } else if (suggestedShipmentQty > 0) {
    action = "SEA_SHIP";
    reason = `按 ${horizonDays} 天补货视窗计算，建议安排海运补货。`;
  } else {
    action = "NO_ACTION";
    reason = "当前可计入库存可覆盖补货视窗，暂不新增发货。";
  }

  let riskLevel: InventoryRisk;
  if (row.dailySales <= 0) riskLevel = "data";
  else if (daysCoverNetwork !== null && daysCoverNetwork < parameters.leadTimeDays) riskLevel = "critical";
  else if (
    daysCoverNetwork !== null &&
    daysCoverNetwork < parameters.leadTimeDays + parameters.targetCoverDays
  ) riskLevel = "watch";
  else if (daysCoverNetwork !== null && daysCoverNetwork > parameters.excessCoverDays) riskLevel = "excess";
  else riskLevel = "healthy";

  return {
    eligibleInventoryPosition,
    daysCoverFba: daysCoverFba === null ? null : Number(daysCoverFba.toFixed(1)),
    daysCoverNetwork: daysCoverNetwork === null ? null : Number(daysCoverNetwork.toFixed(1)),
    suggestedShipmentQty,
    suggestedAwdTransferQty,
    action,
    riskLevel,
    reason,
  };
}
