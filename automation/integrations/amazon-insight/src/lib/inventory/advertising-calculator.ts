import type {
  AdvertisingAction,
  AdvertisingCampaign,
  AdvertisingParameters,
  InventoryRisk,
} from "@/lib/inventory/contracts";

export type AdvertisingDecision = Pick<AdvertisingCampaign, "acos" | "roas" | "ctr" | "conversionRate" | "averageDailySpend" | "budgetUtilizationPercent" | "reason"> & {
  action: AdvertisingAction;
};

export function calculateAdvertisingDecision(
  campaign: Pick<AdvertisingCampaign, "spend" | "advertisingSales" | "orders" | "clicks" | "impressions" | "budget" | "periodDays">,
  parameters: AdvertisingParameters,
  inventoryRisk: InventoryRisk | null,
): AdvertisingDecision {
  const acos = campaign.advertisingSales > 0
    ? (campaign.spend / campaign.advertisingSales) * 100
    : null;
  const roas = campaign.spend > 0 ? campaign.advertisingSales / campaign.spend : null;
  const ctr = campaign.impressions > 0 ? (campaign.clicks / campaign.impressions) * 100 : null;
  const conversionRate = campaign.clicks > 0 ? (campaign.orders / campaign.clicks) * 100 : null;
  const averageDailySpend = campaign.spend / Math.max(1, campaign.periodDays);
  const budgetUtilizationPercent = campaign.budget > 0 ? (averageDailySpend / campaign.budget) * 100 : null;
  const inventorySupportsScale = inventoryRisk === "healthy" || inventoryRisk === "excess";
  const efficientEnoughToScale = acos !== null
    && acos <= parameters.targetAcosPercent * parameters.scaleMaxAcosRatio
    && campaign.orders >= parameters.scaleMinOrders
    && inventorySupportsScale;

  let action: AdvertisingAction;
  let reason: string;
  if (inventoryRisk === "critical" && campaign.spend >= 1) {
    action = "PAUSE_STOCK_RISK";
    reason = "关联 SKU 存在断货风险，先控制广告消耗。";
  } else if (campaign.orders <= 0 && campaign.spend >= parameters.noOrderSpend) {
    action = "NO_ORDER_REVIEW";
    reason = `花费已达 $${Math.round(campaign.spend)} 但没有广告订单，先检查搜索词、主图和转化，不建议盲目加价。`;
  } else if (
    acos !== null &&
    campaign.spend >= parameters.minimumEvidenceSpend &&
    acos > parameters.targetAcosPercent
  ) {
    action = "REDUCE_BID_OR_BUDGET";
    reason = `ACOS ${acos.toFixed(1)}% 高于目标 ${parameters.targetAcosPercent.toFixed(0)}%。`;
  } else if (
    efficientEnoughToScale
    && budgetUtilizationPercent !== null
    && budgetUtilizationPercent >= parameters.budgetUtilizationThresholdPercent
  ) {
    action = "INCREASE_BUDGET";
    reason = `ACOS ${acos!.toFixed(1)}%，日均花费占预算 ${budgetUtilizationPercent.toFixed(0)}%，预算可能限制流量，建议先提高 10%–20% 并观察 7 天。`;
  } else if (
    efficientEnoughToScale
    && campaign.orders < parameters.winnerMinOrders
    && campaign.clicks <= parameters.lowVolumeMaxClicks
  ) {
    action = "INCREASE_BID";
    reason = `已有 ${campaign.orders} 单、ACOS ${acos!.toFixed(1)}%，但仅 ${campaign.clicks} 次点击；预算尚未跑满，建议核心词竞价提高 5%–10% 测试起量。`;
  } else if (
    acos !== null &&
    campaign.orders >= parameters.winnerMinOrders &&
    acos <= parameters.targetAcosPercent * 0.75 &&
    inventorySupportsScale
  ) {
    action = "EXPAND_WINNER";
    reason = `ACOS ${acos.toFixed(1)}% 且订单量充足，预算未形成限制，优先扩关键词和投放范围。`;
  } else if (campaign.clicks < 10 && campaign.spend < parameters.minimumEvidenceSpend) {
    action = "NO_CHANGE_LOW_DATA";
    reason = "尚无足够转化证据，继续积累数据，不直接提高竞价或预算。";
  } else {
    action = "MONITOR";
    reason = "当前没有触发调整阈值，继续观察。";
  }

  return {
    acos: acos === null ? null : Number(acos.toFixed(2)),
    roas: roas === null ? null : Number(roas.toFixed(2)),
    ctr: ctr === null ? null : Number(ctr.toFixed(2)),
    conversionRate: conversionRate === null ? null : Number(conversionRate.toFixed(2)),
    averageDailySpend: Number(averageDailySpend.toFixed(2)),
    budgetUtilizationPercent: budgetUtilizationPercent === null ? null : Number(budgetUtilizationPercent.toFixed(2)),
    action,
    reason,
  };
}
