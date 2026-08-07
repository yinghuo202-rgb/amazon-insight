import type { InventoryDashboardData, ProfitabilityData } from "@/lib/inventory/contracts";

const summerMonths = [5, 6, 7, 8] as const;
const autumnMonths = [9, 10, 11] as const;

export type SeasonalClearancePriority = "clear_now" | "promote" | "review";
export type ClearancePricingGuard = "discount" | "hold" | "cost_risk";
export type MarketProfitability = ProfitabilityData["rows"][number];

export type ClearancePricingSuggestion = {
  market: "US" | "CA";
  currency: "USD" | "CAD";
  reportMonth: string;
  currentPrice: number;
  suggestedPrice: number;
  adjustmentPercent: number;
  currentMargin: number;
  projectedMargin: number;
  projectedUnitProfit: number;
  projectedClearanceProfit: number;
  breakEvenPrice: number;
  clearanceQty: number;
  guard: ClearancePricingGuard;
  lowConfidence: boolean;
  pauseAdvertising: boolean;
  advertisingSavingsPerUnit: number;
};

export type CombinedSeasonalInventoryRowInput = {
  sku: string;
  productName: string;
  detailMarket: "US" | "CA";
  cartonQty: number | null;
  usOverseasInventory: number;
  caOverseasInventory: number;
  domesticInventory: number;
  pendingOrderQty: number;
  usSalesHistoryByMonth: Array<{ month: string; units: number }>;
  caSalesHistoryByMonth: Array<{ month: string; units: number }>;
  usProfitability?: MarketProfitability;
  caProfitability?: MarketProfitability;
};

export type SeasonalInventoryCandidate = {
  sku: string;
  productName: string;
  detailMarket: "US" | "CA";
  minimumActionQty: number;
  priority: SeasonalClearancePriority;
  clearanceRecommendation: string;
  replenishmentRecommendation: string;
  baselineYears: number[];
  calendarAverage: Array<{ month: number; units: number }>;
  usBaselineYears: number[];
  caBaselineYears: number[];
  usCalendarAverage: Array<{ month: number; units: number }>;
  caCalendarAverage: Array<{ month: number; units: number }>;
  isSummerSeasonal: boolean;
  upcomingPeak: boolean;
  summerPeakMonths: number[];
  upcomingPeakMonths: number[];
  replenishmentMonths: number[];
  replenishmentHorizonEnd: string;
  upcomingAverage: number;
  upcomingIndex: number;
  upcomingRisePercent: number;
  summerAverage: number;
  summerIndex: number;
  autumnAverage: number;
  autumnDropPercent: number;
  latestSalesMonth: string;
  latestMonthlySales: number;
  usLatestMonthlySales: number;
  caLatestMonthlySales: number;
  benchmarkAverageMonthlySales: number;
  benchmarkObservedMonths: number;
  benchmarkTotalInventory: number;
  benchmarkMonthsOfSupply: number | null;
  isTwelveMonthSlowMover: boolean;
  paceFactor: number;
  usPaceFactor: number;
  caPaceFactor: number;
  paceEvidenceMonths: number;
  usPaceEvidenceMonths: number;
  caPaceEvidenceMonths: number;
  usOverseasInventory: number;
  caOverseasInventory: number;
  domesticInventory: number;
  pendingOrderQty: number;
  projectedRemainingSummerSales: number;
  projectedDemandUnits: number;
  usProjectedDemandUnits: number;
  caProjectedDemandUnits: number;
  usReserveUnits: number;
  caReserveUnits: number;
  reserveUnits: number;
  usClearanceQty: number;
  caClearanceQty: number;
  overseasClearanceQty: number;
  domesticClearanceQty: number;
  currentClearanceQty: number;
  pendingMitigationQty: number;
  atRiskSupplyQty: number;
  riskRatio: number;
  usReplenishmentGap: number;
  caReplenishmentGap: number;
  usDomesticTransferQty: number;
  caDomesticTransferQty: number;
  usPendingCoverageQty: number;
  caPendingCoverageQty: number;
  usUrgentReplenishmentQty: number;
  caUrgentReplenishmentQty: number;
  domesticTransferQty: number;
  pendingCoverageQty: number;
  urgentReplenishmentQty: number;
  replenishmentActionQty: number;
  usPricing: ClearancePricingSuggestion | null;
  caPricing: ClearancePricingSuggestion | null;
};

export type SeasonalInventoryPlanResult = {
  snapshots: { US: string; CA: string };
  snapshotDate: string;
  latestSalesMonth: string;
  seasonEndDate: string;
  clearanceCandidates: SeasonalInventoryCandidate[];
  replenishmentCandidates: SeasonalInventoryCandidate[];
  summary: {
    seasonalSkuCount: number;
    summerSkuCount: number;
    upcomingPeakSkuCount: number;
    clearanceCandidateCount: number;
    replenishmentCandidateCount: number;
    overlapCount: number;
    benchmarkSlowMoverCount: number;
    benchmarkNoSalesCount: number;
    benchmarkSlowMoverInventoryQty: number;
    currentClearanceQty: number;
    overseasClearanceQty: number;
    domesticClearanceQty: number;
    pendingMitigationQty: number;
    replenishmentActionQty: number;
    domesticTransferQty: number;
    pendingCoverageQty: number;
    urgentReplenishmentQty: number;
    pricedClearanceSkuCount: number;
    pricingMissingSkuCount: number;
    pricingCostRiskSkuCount: number;
  };
};

type PlanningContext = { snapshotDate: string; latestSalesMonth: string };
type CalendarProfile = { baselineYears: number[]; calendarAverage: Array<{ month: number; units: number }> };

export function buildSeasonalInventoryPlan(us: InventoryDashboardData, ca: InventoryDashboardData, profitability?: ProfitabilityData): SeasonalInventoryPlanResult {
  const latestSalesMonth = [...us.sales.historyMonths, ...ca.sales.historyMonths, ...us.sales.windowMonths, ...ca.sales.windowMonths].sort().at(-1) ?? "";
  const snapshotDate = [us.snapshots.fbaDate, ca.snapshots.fbaDate].sort().at(-1) ?? us.snapshots.fbaDate;
  const context = { snapshotDate, latestSalesMonth };
  const usBySku = new Map(us.rows.map((row) => [row.sku, row] as const));
  const caBySku = new Map(ca.rows.map((row) => [row.sku, row] as const));
  const skus = [...new Set([...usBySku.keys(), ...caBySku.keys()])].sort();
  const profitabilityByMarketSku = new Map((profitability?.rows ?? []).map((row) => [`${row.market}:${row.sku}`, row] as const));
  const seasonalRows = skus.map((sku) => {
    const usRow = usBySku.get(sku);
    const caRow = caBySku.get(sku);
    return analyzeSeasonalInventoryRow({
      sku,
      productName: usRow?.productName || caRow?.productName || sku,
      detailMarket: usRow ? "US" : "CA",
      cartonQty: Math.max(usRow?.cartonQty ?? 1, caRow?.cartonQty ?? 1),
      usOverseasInventory: usRow ? usRow.fbaSellable + usRow.awdAvailable + usRow.awdOutboundToFba : 0,
      caOverseasInventory: caRow ? caRow.fbaSellable + caRow.awdAvailable + caRow.awdOutboundToFba : 0,
      domesticInventory: Math.max(usRow?.localInventory ?? 0, caRow?.localInventory ?? 0),
      pendingOrderQty: Math.max(usRow?.pendingOrderQty ?? 0, caRow?.pendingOrderQty ?? 0),
      usSalesHistoryByMonth: preferredHistory(usRow),
      caSalesHistoryByMonth: preferredHistory(caRow),
      usProfitability: profitabilityByMarketSku.get(`US:${sku}`),
      caProfitability: profitabilityByMarketSku.get(`CA:${sku}`),
    }, context);
  }).filter((row): row is SeasonalInventoryCandidate => Boolean(row));
  const summerRows = seasonalRows.filter((row) => row.isSummerSeasonal);
  const upcomingPeakRows = seasonalRows.filter((row) => row.upcomingPeak);

  const clearanceCandidates = summerRows
    .filter(isClearanceCandidate)
    .sort((left, right) => Number(right.isTwelveMonthSlowMover) - Number(left.isTwelveMonthSlowMover) || priorityRank(left.priority) - priorityRank(right.priority) || right.atRiskSupplyQty - left.atRiskSupplyQty || left.sku.localeCompare(right.sku));
  const replenishmentCandidates = seasonalRows
    .filter((row) => row.upcomingPeak || row.replenishmentActionQty >= row.minimumActionQty)
    .sort((left, right) => right.urgentReplenishmentQty - left.urgentReplenishmentQty || right.replenishmentActionQty - left.replenishmentActionQty || Number(right.upcomingPeak) - Number(left.upcomingPeak) || left.sku.localeCompare(right.sku));
  const replenishmentSkus = new Set(replenishmentCandidates.map((row) => row.sku));
  const benchmarkSlowMovers = summerRows.filter((row) => row.isTwelveMonthSlowMover);

  return {
    snapshots: { US: us.snapshots.fbaDate, CA: ca.snapshots.fbaDate },
    snapshotDate,
    latestSalesMonth,
    seasonEndDate: `${snapshotDate.slice(0, 4)}-08-31`,
    clearanceCandidates,
    replenishmentCandidates,
    summary: {
      seasonalSkuCount: seasonalRows.length,
      summerSkuCount: summerRows.length,
      upcomingPeakSkuCount: upcomingPeakRows.length,
      clearanceCandidateCount: clearanceCandidates.length,
      replenishmentCandidateCount: replenishmentCandidates.length,
      overlapCount: clearanceCandidates.filter((row) => replenishmentSkus.has(row.sku)).length,
      benchmarkSlowMoverCount: benchmarkSlowMovers.length,
      benchmarkNoSalesCount: benchmarkSlowMovers.filter((row) => row.benchmarkAverageMonthlySales === 0).length,
      benchmarkSlowMoverInventoryQty: benchmarkSlowMovers.reduce((total, row) => total + row.benchmarkTotalInventory, 0),
      currentClearanceQty: sum(clearanceCandidates, "currentClearanceQty"),
      overseasClearanceQty: sum(clearanceCandidates, "overseasClearanceQty"),
      domesticClearanceQty: sum(clearanceCandidates, "domesticClearanceQty"),
      pendingMitigationQty: sum(clearanceCandidates, "pendingMitigationQty"),
      replenishmentActionQty: sum(replenishmentCandidates, "replenishmentActionQty"),
      domesticTransferQty: sum(replenishmentCandidates, "domesticTransferQty"),
      pendingCoverageQty: sum(replenishmentCandidates, "pendingCoverageQty"),
      urgentReplenishmentQty: sum(replenishmentCandidates, "urgentReplenishmentQty"),
      pricedClearanceSkuCount: clearanceCandidates.filter((row) => row.usPricing || row.caPricing).length,
      pricingMissingSkuCount: clearanceCandidates.filter((row) => !row.usPricing && !row.caPricing).length,
      pricingCostRiskSkuCount: clearanceCandidates.filter((row) => row.usPricing?.guard === "cost_risk" || row.caPricing?.guard === "cost_risk").length,
    },
  };
}

export function analyzeSeasonalInventoryRow(row: CombinedSeasonalInventoryRowInput, context: PlanningContext): SeasonalInventoryCandidate | null {
  const combinedHistory = mergeHistory(row.usSalesHistoryByMonth, row.caSalesHistoryByMonth);
  const combinedProfile = calendarProfile(combinedHistory, context.snapshotDate);
  if (!combinedProfile) return null;
  const usProfile = calendarProfile(row.usSalesHistoryByMonth, context.snapshotDate);
  const caProfile = calendarProfile(row.caSalesHistoryByMonth, context.snapshotDate);
  const monthAverage = (month: number) => combinedProfile.calendarAverage[month - 1]?.units ?? 0;
  const annualAverage = average(combinedProfile.calendarAverage.map((point) => point.units));
  const summerAverage = average(summerMonths.map(monthAverage));
  const autumnAverage = average(autumnMonths.map(monthAverage));
  if (annualAverage <= 0) return null;
  const summerIndex = summerAverage / annualAverage;
  const topMonths = [...combinedProfile.calendarAverage].sort((left, right) => right.units - left.units).slice(0, 4).map((point) => point.month);
  const summerPeakMonths = topMonths.filter((month) => summerMonths.includes(month as typeof summerMonths[number]));
  const isSummerSeasonal = summerAverage >= 10 && summerIndex >= 1.2 && summerPeakMonths.length > 0 && autumnAverage <= summerAverage * 0.8;
  const snapshotMonth = Number(context.snapshotDate.slice(5, 7));
  const upcomingWindowMonths = nextMonths(snapshotMonth, 3);
  const currentAverage = monthAverage(snapshotMonth);
  const upcomingAverage = average(upcomingWindowMonths.map(monthAverage));
  const upcomingIndex = upcomingAverage / annualAverage;
  const upcomingRise = currentAverage > 0 ? upcomingAverage / currentAverage - 1 : upcomingAverage > 0 ? 1 : 0;
  const upcomingPeakMonths = upcomingWindowMonths.filter((month) => monthAverage(month) >= annualAverage * 1.15);
  const currentIndex = currentAverage / annualAverage;
  const upcomingPeak = !isSummerSeasonal && currentIndex < 1.2 && upcomingAverage >= 10 && upcomingIndex >= 1.15 && upcomingRise >= 0.15 && upcomingPeakMonths.length > 0;
  if (!isSummerSeasonal && !upcomingPeak) return null;

  const replenishmentMonths = upcomingPeak ? upcomingWindowMonths : [...summerMonths];
  const replenishmentHorizonEnd = upcomingPeak ? monthEndAfter(context.snapshotDate, 3) : `${context.snapshotDate.slice(0, 4)}-08-31`;
  const combinedProjection = projectDemand(combinedHistory, context, replenishmentMonths, !upcomingPeak, upcomingPeak);
  const benchmark = twelveMonthBenchmark(combinedHistory, context.latestSalesMonth);
  const usProjection = projectDemand(row.usSalesHistoryByMonth, context, replenishmentMonths, !upcomingPeak, upcomingPeak);
  const caProjection = projectDemand(row.caSalesHistoryByMonth, context, replenishmentMonths, !upcomingPeak, upcomingPeak);
  const usReplenishmentGap = Math.max(0, usProjection.reserveUnits - row.usOverseasInventory);
  const caReplenishmentGap = Math.max(0, caProjection.reserveUnits - row.caOverseasInventory);
  const totalMarketGap = usReplenishmentGap + caReplenishmentGap;
  const domesticTransferQty = Math.min(row.domesticInventory, totalMarketGap);
  const domesticAllocation = allocateCapped(domesticTransferQty, usReplenishmentGap, caReplenishmentGap);
  const usGapAfterDomestic = Math.max(0, usReplenishmentGap - domesticAllocation.US);
  const caGapAfterDomestic = Math.max(0, caReplenishmentGap - domesticAllocation.CA);
  const gapAfterDomestic = Math.max(0, totalMarketGap - domesticTransferQty);
  const pendingCoverageQty = Math.min(row.pendingOrderQty, gapAfterDomestic);
  const pendingAllocation = allocateCapped(pendingCoverageQty, usGapAfterDomestic, caGapAfterDomestic);
  const usUrgentReplenishmentQty = Math.max(0, usGapAfterDomestic - pendingAllocation.US);
  const caUrgentReplenishmentQty = Math.max(0, caGapAfterDomestic - pendingAllocation.CA);
  const urgentReplenishmentQty = Math.max(0, gapAfterDomestic - pendingCoverageQty);
  const replenishmentActionQty = domesticTransferQty + pendingCoverageQty + urgentReplenishmentQty;

  const usClearanceQty = isSummerSeasonal ? Math.max(0, row.usOverseasInventory - usProjection.reserveUnits) : 0;
  const caClearanceQty = isSummerSeasonal ? Math.max(0, row.caOverseasInventory - caProjection.reserveUnits) : 0;
  const overseasClearanceQty = usClearanceQty + caClearanceQty;
  const domesticClearanceQty = isSummerSeasonal ? Math.max(0, row.domesticInventory - domesticTransferQty) : 0;
  const currentClearanceQty = overseasClearanceQty + domesticClearanceQty;
  const pendingMitigationQty = isSummerSeasonal ? Math.max(0, row.pendingOrderQty - pendingCoverageQty) : 0;
  const atRiskSupplyQty = currentClearanceQty + pendingMitigationQty;
  const totalSupply = row.usOverseasInventory + row.caOverseasInventory + row.domesticInventory + row.pendingOrderQty;
  const benchmarkTotalInventory = row.usOverseasInventory + row.caOverseasInventory + row.domesticInventory;
  const benchmarkMonthsOfSupply = benchmark.averageMonthlySales > 0 ? benchmarkTotalInventory / benchmark.averageMonthlySales : null;
  const isTwelveMonthSlowMover = benchmarkTotalInventory > 0 && (benchmarkMonthsOfSupply === null || benchmarkMonthsOfSupply >= 12);
  const riskRatio = totalSupply > 0 ? atRiskSupplyQty / totalSupply : 0;
  const minimumActionQty = Math.max(20, row.cartonQty ?? 1);
  const priority = isTwelveMonthSlowMover && isSummerSeasonal ? "clear_now" : clearancePriority(atRiskSupplyQty, riskRatio);
  const usPricing = buildClearancePricingSuggestion(row.usProfitability, priority, usClearanceQty);
  const caPricing = buildClearancePricingSuggestion(row.caProfitability, priority, caClearanceQty);

  return {
    sku: row.sku,
    productName: row.productName,
    detailMarket: row.detailMarket,
    minimumActionQty,
    priority,
    clearanceRecommendation: clearanceRecommendation(priority, isTwelveMonthSlowMover, benchmarkMonthsOfSupply, usClearanceQty, caClearanceQty, domesticClearanceQty, pendingMitigationQty),
    replenishmentRecommendation: replenishmentRecommendation(upcomingPeak, upcomingPeakMonths, upcomingIndex, replenishmentHorizonEnd, usReplenishmentGap, caReplenishmentGap, domesticTransferQty, pendingCoverageQty, urgentReplenishmentQty),
    baselineYears: combinedProfile.baselineYears,
    calendarAverage: combinedProfile.calendarAverage,
    usBaselineYears: usProfile?.baselineYears ?? [],
    caBaselineYears: caProfile?.baselineYears ?? [],
    usCalendarAverage: usProfile?.calendarAverage ?? emptyCalendar(),
    caCalendarAverage: caProfile?.calendarAverage ?? emptyCalendar(),
    isSummerSeasonal,
    upcomingPeak,
    summerPeakMonths,
    upcomingPeakMonths,
    replenishmentMonths,
    replenishmentHorizonEnd,
    upcomingAverage: round(upcomingAverage, 1),
    upcomingIndex: round(upcomingIndex, 2),
    upcomingRisePercent: round(upcomingRise * 100, 0),
    summerAverage: round(summerAverage, 1),
    summerIndex: round(summerIndex, 2),
    autumnAverage: round(autumnAverage, 1),
    autumnDropPercent: summerAverage > 0 ? round((1 - autumnAverage / summerAverage) * 100, 0) : 0,
    latestSalesMonth: context.latestSalesMonth,
    latestMonthlySales: combinedProjection.latestMonthlySales,
    usLatestMonthlySales: usProjection.latestMonthlySales,
    caLatestMonthlySales: caProjection.latestMonthlySales,
    benchmarkAverageMonthlySales: benchmark.averageMonthlySales,
    benchmarkObservedMonths: benchmark.observedMonths,
    benchmarkTotalInventory,
    benchmarkMonthsOfSupply: benchmarkMonthsOfSupply === null ? null : round(benchmarkMonthsOfSupply, 2),
    isTwelveMonthSlowMover,
    paceFactor: combinedProjection.paceFactor,
    usPaceFactor: usProjection.paceFactor,
    caPaceFactor: caProjection.paceFactor,
    paceEvidenceMonths: combinedProjection.evidenceMonths,
    usPaceEvidenceMonths: usProjection.evidenceMonths,
    caPaceEvidenceMonths: caProjection.evidenceMonths,
    usOverseasInventory: row.usOverseasInventory,
    caOverseasInventory: row.caOverseasInventory,
    domesticInventory: row.domesticInventory,
    pendingOrderQty: row.pendingOrderQty,
    projectedRemainingSummerSales: round(usProjection.projectedUnits + caProjection.projectedUnits, 1),
    projectedDemandUnits: round(usProjection.projectedUnits + caProjection.projectedUnits, 1),
    usProjectedDemandUnits: round(usProjection.projectedUnits, 1),
    caProjectedDemandUnits: round(caProjection.projectedUnits, 1),
    usReserveUnits: usProjection.reserveUnits,
    caReserveUnits: caProjection.reserveUnits,
    reserveUnits: usProjection.reserveUnits + caProjection.reserveUnits,
    usClearanceQty,
    caClearanceQty,
    overseasClearanceQty,
    domesticClearanceQty,
    currentClearanceQty,
    pendingMitigationQty,
    atRiskSupplyQty,
    riskRatio: round(riskRatio, 3),
    usReplenishmentGap,
    caReplenishmentGap,
    usDomesticTransferQty: domesticAllocation.US,
    caDomesticTransferQty: domesticAllocation.CA,
    usPendingCoverageQty: pendingAllocation.US,
    caPendingCoverageQty: pendingAllocation.CA,
    usUrgentReplenishmentQty,
    caUrgentReplenishmentQty,
    domesticTransferQty,
    pendingCoverageQty,
    urgentReplenishmentQty,
    replenishmentActionQty,
    usPricing,
    caPricing,
  };
}

export function buildClearancePricingSuggestion(profitability: MarketProfitability | undefined, priority: SeasonalClearancePriority, clearanceQty: number): ClearancePricingSuggestion | null {
  if (!profitability || profitability.market === "MX" || profitability.currency === "MXN" || profitability.netUnits <= 0 || !profitability.currentPrice || profitability.productSales <= 0) return null;
  const netUnits = profitability.netUnits;
  const platformCostPerUnit = Math.max(0, profitability.productSales - profitability.settlementPayout) / netUnits;
  const landedCostPerUnit = profitability.landedCost / netUnits;
  const advertisingCostPerUnit = profitability.advertisingCost / netUnits;
  const storageCostPerUnit = profitability.storageCost / netUnits;
  const conservativeUnitCost = platformCostPerUnit + landedCostPerUnit + storageCostPerUnit;
  const targetMargin = 0.05;
  const breakEvenPrice = conservativeUnitCost;
  const minimumProtectedPrice = conservativeUnitCost / (1 - targetMargin);
  const discountRate = priority === "clear_now" ? 0.2 : priority === "promote" ? 0.12 : 0.05;
  const suggestedPrice = retailCeiling(Math.max(minimumProtectedPrice, profitability.currentPrice * (1 - discountRate)));
  const projectedUnitProfit = suggestedPrice - conservativeUnitCost;
  const adjustmentPercent = (suggestedPrice / profitability.currentPrice - 1) * 100;
  const guard: ClearancePricingGuard = minimumProtectedPrice > profitability.currentPrice * 1.01 ? "cost_risk" : adjustmentPercent <= -1 ? "discount" : "hold";
  return {
    market: profitability.market,
    currency: profitability.currency,
    reportMonth: profitability.reportMonth,
    currentPrice: round(profitability.currentPrice, 2),
    suggestedPrice,
    adjustmentPercent: round(adjustmentPercent, 1),
    currentMargin: round((profitability.actualProfit - profitability.storageCost) / profitability.productSales, 4),
    projectedMargin: round(projectedUnitProfit / suggestedPrice, 4),
    projectedUnitProfit: round(projectedUnitProfit, 2),
    projectedClearanceProfit: round(projectedUnitProfit * clearanceQty, 2),
    breakEvenPrice: round(breakEvenPrice, 2),
    clearanceQty,
    guard,
    lowConfidence: profitability.netUnits < 10 || profitability.returns / Math.max(1, profitability.units) >= 0.2 || profitability.settlementPayout <= 0,
    pauseAdvertising: profitability.advertisingCost > 0,
    advertisingSavingsPerUnit: round(advertisingCostPerUnit, 2),
  };
}

function preferredHistory(row: InventoryDashboardData["rows"][number] | undefined) {
  if (!row) return [];
  return row.salesHistoryByMonth.length ? row.salesHistoryByMonth : row.salesByMonth;
}

function calendarProfile(history: Array<{ month: string; units: number }>, snapshotDate: string): CalendarProfile | null {
  const snapshotYear = Number(snapshotDate.slice(0, 4));
  const historyByYear = new Map<number, Map<number, number>>();
  for (const point of history) {
    const year = Number(point.month.slice(0, 4));
    const month = Number(point.month.slice(5, 7));
    if (!historyByYear.has(year)) historyByYear.set(year, new Map());
    historyByYear.get(year)?.set(month, Math.max(0, point.units));
  }
  const years = [...historyByYear.entries()].filter(([year, months]) => year < snapshotYear && months.size === 12).sort(([left], [right]) => left - right).slice(-3);
  if (!years.length) return null;
  return {
    baselineYears: years.map(([year]) => year),
    calendarAverage: Array.from({ length: 12 }, (_, index) => {
      const month = index + 1;
      return { month, units: round(years.reduce((total, [, values]) => total + (values.get(month) ?? 0), 0) / years.length, 1) };
    }),
  };
}

function projectDemand(history: Array<{ month: string; units: number }>, context: PlanningContext, targetMonths: readonly number[], includeCurrentRemainder: boolean, applyLatestPace: boolean) {
  const profile = calendarProfile(history, context.snapshotDate);
  if (!profile) return { latestMonthlySales: 0, paceFactor: 1, projectedUnits: 0, reserveUnits: 0, evidenceMonths: 0 };
  const [year, snapshotMonth, snapshotDay] = context.snapshotDate.split("-").map(Number);
  const monthAverage = (month: number) => profile.calendarAverage[month - 1]?.units ?? 0;
  const recentStart = shiftMonth(context.latestSalesMonth, -2);
  const recentPoints = history.filter((point) => point.month >= recentStart && point.month <= context.latestSalesMonth).sort((left, right) => left.month.localeCompare(right.month));
  const latestPoint = recentPoints.at(-1);
  const latestMonthNumber = Number((latestPoint?.month ?? context.latestSalesMonth).slice(5, 7));
  const latestMonthlySales = latestPoint?.units ?? 0;
  const paceRatios = recentPoints.flatMap((point) => {
    const baseline = monthAverage(Number(point.month.slice(5, 7)));
    return baseline > 0 ? [Math.max(0, point.units) / baseline] : [];
  });
  const rawPace = paceRatios.length ? median(paceRatios) : 1;
  const paceFactor = applyLatestPace || summerMonths.includes(latestMonthNumber as typeof summerMonths[number]) ? clamp(rawPace, 0.6, 1.4) : 1;
  const projectedUnits = targetMonths.reduce((total, month) => total + monthAverage(month) * (includeCurrentRemainder ? remainingMonthShare(year, snapshotMonth, snapshotDay, month) : 1), 0) * paceFactor;
  return { latestMonthlySales, paceFactor: round(paceFactor, 2), projectedUnits, reserveUnits: Math.ceil(projectedUnits * 1.15), evidenceMonths: paceRatios.length };
}

function twelveMonthBenchmark(history: Array<{ month: string; units: number }>, latestSalesMonth: string) {
  const latestMonth = latestSalesMonth || history.at(-1)?.month || "";
  if (!latestMonth) return { averageMonthlySales: 0, observedMonths: 0 };
  const windowStart = shiftMonth(latestMonth, -11);
  const values = history.filter((point) => point.month >= windowStart && point.month <= latestMonth).map((point) => Math.max(0, point.units));
  return { averageMonthlySales: round(average(values), 2), observedMonths: values.length };
}

function shiftMonth(month: string, offset: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

function nextMonths(currentMonth: number, count: number) { return Array.from({ length: count }, (_, index) => (currentMonth + index) % 12 + 1); }
function emptyCalendar() { return Array.from({ length: 12 }, (_, index) => ({ month: index + 1, units: 0 })); }
function allocateCapped(total: number, usCapacity: number, caCapacity: number) {
  const quantity = Math.max(0, Math.round(total));
  const capacity = Math.max(0, usCapacity) + Math.max(0, caCapacity);
  if (!quantity || !capacity) return { US: 0, CA: 0 };
  let US = Math.min(Math.max(0, usCapacity), Math.round(quantity * Math.max(0, usCapacity) / capacity));
  let CA = Math.min(Math.max(0, caCapacity), quantity - US);
  let remaining = quantity - US - CA;
  const usExtra = Math.min(remaining, Math.max(0, usCapacity - US));
  US += usExtra;
  remaining -= usExtra;
  CA += Math.min(remaining, Math.max(0, caCapacity - CA));
  return { US, CA };
}
function monthEndAfter(snapshotDate: string, offset: number) { const target = shiftMonth(snapshotDate.slice(0, 7), offset); const [year, month] = target.split("-").map(Number); const day = new Date(Date.UTC(year, month, 0)).getUTCDate(); return `${target}-${String(day).padStart(2, "0")}`; }
function isClearanceCandidate(row: SeasonalInventoryCandidate) { if (!row.isSummerSeasonal) return false; return row.isTwelveMonthSlowMover ? row.currentClearanceQty > 0 : row.atRiskSupplyQty >= row.minimumActionQty && row.riskRatio >= 0.25; }
function mergeHistory(...histories: Array<Array<{ month: string; units: number }>>) { const totals = new Map<string, number>(); for (const history of histories) for (const point of history) totals.set(point.month, (totals.get(point.month) ?? 0) + point.units); return [...totals.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([month, units]) => ({ month, units })); }
function remainingMonthShare(year: number, snapshotMonth: number, snapshotDay: number, month: number) { if (month < snapshotMonth) return 0; if (month > snapshotMonth) return 1; const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate(); return clamp((daysInMonth - snapshotDay) / daysInMonth, 0, 1); }
function clearancePriority(quantity: number, ratio: number): SeasonalClearancePriority { if (quantity >= 500 || (quantity >= 200 && ratio >= 0.65)) return "clear_now"; if (quantity >= 100 || (quantity >= 50 && ratio >= 0.5)) return "promote"; return "review"; }
function clearanceRecommendation(priority: SeasonalClearancePriority, isTwelveMonthSlowMover: boolean, monthsOfSupply: number | null, us: number, ca: number, domestic: number, pending: number) { const parts = [isTwelveMonthSlowMover ? `按原表口径已达 ${monthsOfSupply === null ? "无销量" : `${round(monthsOfSupply, 1)} 个月`}，立即执行季末清货。` : priority === "clear_now" ? "立即执行季末清货。" : priority === "promote" ? "进入重点促销池，两周复盘一次。" : "先复核毛利和价格，再做小批量促销。"]; if (us) parts.push(`US 清 ${us} 件。`); if (ca) parts.push(`CA 清 ${ca} 件。`); if (domestic) parts.push(`国内消化 ${domestic} 件。`); if (pending) parts.push(`未完工停单、转款或改用途 ${pending} 件。`); return parts.join(""); }
function replenishmentRecommendation(upcomingPeak: boolean, peakMonths: number[], upcomingIndex: number, horizonEnd: string, usGap: number, caGap: number, domestic: number, pending: number, urgent: number) { const parts = []; if (upcomingPeak) parts.push(`旺季将至：${peakMonths.map((month) => `${month}月`).join("/")}，未来三个月销量指数 ${Math.round(upcomingIndex * 100)}%。`); if (usGap) parts.push(`US 需求缺口 ${usGap} 件。`); if (caGap) parts.push(`CA 需求缺口 ${caGap} 件。`); if (domestic) parts.push(`优先从国内调拨 ${domestic} 件。`); if (pending) parts.push(`加急保留未完工订单 ${pending} 件。`); if (urgent) parts.push(`仍缺 ${urgent} 件，评估空运、跨站调拨或控广告。`); if (upcomingPeak && !usGap && !caGap) parts.push(`当前供应可覆盖至 ${horizonEnd}，暂不加单，按周复核销量。`); return parts.join(""); }
function priorityRank(priority: SeasonalClearancePriority) { return priority === "clear_now" ? 0 : priority === "promote" ? 1 : 2; }
function average(values: readonly number[]) { return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0; }
function median(values: readonly number[]) { if (!values.length) return 0; const sorted = [...values].sort((left, right) => left - right); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; }
function round(value: number, digits: number) { const factor = 10 ** digits; return Math.round(value * factor) / factor; }
function retailCeiling(value: number) { const whole = Math.floor(Math.max(0, value)); const candidates = [whole + 0.49, whole + 0.99, whole + 1.49]; return round(candidates.find((candidate) => candidate + 1e-9 >= value) ?? value, 2); }
function clamp(value: number, minimum: number, maximum: number) { return Math.min(maximum, Math.max(minimum, value)); }
function sum(candidates: SeasonalInventoryCandidate[], key: "currentClearanceQty" | "overseasClearanceQty" | "domesticClearanceQty" | "pendingMitigationQty" | "replenishmentActionQty" | "domesticTransferQty" | "pendingCoverageQty" | "urgentReplenishmentQty") { return candidates.reduce((total, candidate) => total + candidate[key], 0); }
