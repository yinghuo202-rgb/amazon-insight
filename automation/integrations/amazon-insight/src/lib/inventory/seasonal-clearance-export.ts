import type { SeasonalInventoryCandidate, SeasonalInventoryPlanResult } from "@/lib/inventory/seasonal-clearance";

export type SeasonalInventoryExportKind = "replenishment" | "clearance";
export type SeasonalInventoryExportMarket = "ALL" | "US" | "CA";

export function buildSeasonalInventoryCsv(result: SeasonalInventoryPlanResult, kind: SeasonalInventoryExportKind, market: SeasonalInventoryExportMarket = "ALL") {
  const rows = kind === "replenishment" ? replenishmentRows(result, market) : clearanceRows(result, market);
  const marketLabel = market === "ALL" ? "美加合计" : market;
  return {
    filename: `${result.snapshotDate}-${marketLabel}-${kind === "replenishment" ? "夏季补货与国内调拨" : "夏季季末清货"}.csv`,
    content: `\ufeff${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`,
  };
}

function replenishmentRows(result: SeasonalInventoryPlanResult, market: SeasonalInventoryExportMarket): ExportCell[][] {
  return [
    [
      "库存快照", "预测截止", "动作", "关注类型", "SKU", "产品", "最新销量月份", "最新美加合并销量", "稳健销量节奏", "节奏证据月数", "未来三个月指数", "历史旺季月",
      ...calendarHeaders(),
      "US最新销量", "US预测需求", "US海外库存", "US季末保留", "US站点缺口", "US国内调拨分配", "US未完工分配", "US需采购数量",
      "CA最新销量", "CA预测需求", "CA海外库存", "CA季末保留", "CA站点缺口", "CA国内调拨分配", "CA未完工分配", "CA需采购数量",
      "国内共享库存", "国内调拨合计", "未完工共享订单", "保留加急订单合计", "扣减国内与未完工后需采购", "处理总量", "补货建议",
    ],
    ...result.replenishmentCandidates.filter((candidate) => replenishmentRelevant(candidate, market)).map((candidate) => [
      result.snapshotDate,
      candidate.replenishmentHorizonEnd,
      replenishmentAction(candidate),
      candidate.upcomingPeak ? "旺季将至" : "当前旺季",
      candidate.sku,
      candidate.productName,
      candidate.latestSalesMonth,
      candidate.latestMonthlySales,
      `${Math.round(candidate.paceFactor * 100)}%`,
      candidate.paceEvidenceMonths,
      candidate.upcomingPeak ? `${Math.round(candidate.upcomingIndex * 100)}%` : "—",
      (candidate.upcomingPeak ? candidate.upcomingPeakMonths : candidate.summerPeakMonths).map((month) => `${month}月`).join("/"),
      ...calendarValues(candidate),
      candidate.usLatestMonthlySales,
      candidate.usProjectedDemandUnits,
      candidate.usOverseasInventory,
      candidate.usReserveUnits,
      candidate.usReplenishmentGap,
      candidate.usDomesticTransferQty,
      candidate.usPendingCoverageQty,
      candidate.usUrgentReplenishmentQty,
      candidate.caLatestMonthlySales,
      candidate.caProjectedDemandUnits,
      candidate.caOverseasInventory,
      candidate.caReserveUnits,
      candidate.caReplenishmentGap,
      candidate.caDomesticTransferQty,
      candidate.caPendingCoverageQty,
      candidate.caUrgentReplenishmentQty,
      candidate.domesticInventory,
      candidate.domesticTransferQty,
      candidate.pendingOrderQty,
      candidate.pendingCoverageQty,
      candidate.urgentReplenishmentQty,
      candidate.replenishmentActionQty,
      candidate.replenishmentRecommendation,
    ]),
  ];
}

function clearanceRows(result: SeasonalInventoryPlanResult, market: SeasonalInventoryExportMarket): ExportCell[][] {
  return [
    [
      "库存快照", "季末日期", "优先级", "SKU", "产品", "原表口径状态", "原表合计库存", "近12月平均月销", "有记录月份数", "可售月数",
      "夏季平均月销", "夏季指数", "秋季平均月销", "入秋降幅", "历史旺季月", ...calendarHeaders(),
      "US毛利月份", "US当前均价", "US建议清货价", "US调价幅度", "US当前毛利率", "US广告动作", "US保本价", "US调后毛利率", "US调后单件毛利", "US预计清货毛利",
      "CA毛利月份", "CA当前均价", "CA建议清货价", "CA调价幅度", "CA当前毛利率", "CA广告动作", "CA保本价", "CA调后毛利率", "CA调后单件毛利", "CA预计清货毛利",
      "US最新销量", "US预测需求", "US海外库存", "US季末保留", "US清货", "CA最新销量", "CA预测需求", "CA海外库存", "CA季末保留", "CA清货", "国内共享库存", "国内清货", "季末保留", "季末前需清现货",
      "未完工订单", "未完工需处置", "总风险供应", "风险占比", "清货建议",
    ],
    ...result.clearanceCandidates.filter((candidate) => market === "ALL" ? true : market === "US" ? candidate.usClearanceQty > 0 : candidate.caClearanceQty > 0).map((candidate) => [
      result.snapshotDate,
      result.seasonEndDate,
      priorityLabel(candidate),
      candidate.sku,
      candidate.productName,
      candidate.isTwelveMonthSlowMover ? "12个月以上滞销" : "季末风险",
      candidate.benchmarkTotalInventory,
      candidate.benchmarkAverageMonthlySales,
      candidate.benchmarkObservedMonths,
      candidate.benchmarkMonthsOfSupply ?? "无销量",
      candidate.summerAverage,
      candidate.summerIndex,
      candidate.autumnAverage,
      `${candidate.autumnDropPercent.toFixed(0)}%`,
      candidate.summerPeakMonths.map((month) => `${month}月`).join("/"),
      ...calendarValues(candidate),
      ...pricingValues(candidate.usPricing),
      ...pricingValues(candidate.caPricing),
      candidate.usLatestMonthlySales,
      candidate.usProjectedDemandUnits,
      candidate.usOverseasInventory,
      candidate.usReserveUnits,
      candidate.usClearanceQty,
      candidate.caLatestMonthlySales,
      candidate.caProjectedDemandUnits,
      candidate.caOverseasInventory,
      candidate.caReserveUnits,
      candidate.caClearanceQty,
      candidate.domesticInventory,
      candidate.domesticClearanceQty,
      candidate.reserveUnits,
      candidate.currentClearanceQty,
      candidate.pendingOrderQty,
      candidate.pendingMitigationQty,
      candidate.atRiskSupplyQty,
      `${Math.round(candidate.riskRatio * 100)}%`,
      candidate.clearanceRecommendation,
    ]),
  ];
}

function replenishmentRelevant(candidate: SeasonalInventoryCandidate, market: SeasonalInventoryExportMarket) {
  if (market === "ALL") return true;
  const gap = market === "US" ? candidate.usReplenishmentGap : candidate.caReplenishmentGap;
  const projectedDemand = market === "US" ? candidate.usProjectedDemandUnits : candidate.caProjectedDemandUnits;
  return gap > 0 || candidate.upcomingPeak && projectedDemand > 0;
}

function pricingValues(pricing: SeasonalInventoryCandidate["usPricing"]): ExportCell[] {
  if (!pricing) return ["无毛利记录", "—", "—", "—", "—", "—", "—", "—", "—", "—"];
  return [
    pricing.reportMonth,
    pricing.currentPrice,
    pricing.suggestedPrice,
    `${pricing.adjustmentPercent > 0 ? "+" : ""}${pricing.adjustmentPercent.toFixed(1)}%`,
    `${(pricing.currentMargin * 100).toFixed(1)}%`,
    pricing.pauseAdvertising ? "清货期暂停广告" : "无需停广告",
    pricing.breakEvenPrice,
    `${(pricing.projectedMargin * 100).toFixed(1)}%`,
    pricing.projectedUnitProfit,
    pricing.projectedClearanceProfit,
  ];
}

type ExportCell = string | number;

function calendarHeaders() {
  return Array.from({ length: 12 }, (_, index) => `${index + 1}月历史均销`);
}

function calendarValues(candidate: SeasonalInventoryCandidate) {
  return candidate.calendarAverage.map((point) => point.units);
}

function replenishmentAction(candidate: SeasonalInventoryCandidate) {
  if (candidate.urgentReplenishmentQty > 0) return "紧急补货";
  if (candidate.domesticTransferQty > 0) return "国内调拨";
  if (candidate.pendingCoverageQty > 0) return "加急在途";
  return "旺季关注";
}

function priorityLabel(candidate: SeasonalInventoryCandidate) {
  if (candidate.priority === "clear_now") return "立即清理";
  if (candidate.priority === "promote") return "重点促销";
  return "人工复核";
}

function csvCell(value: ExportCell) {
  const text = String(value);
  const safeText = typeof value === "string" && /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}
