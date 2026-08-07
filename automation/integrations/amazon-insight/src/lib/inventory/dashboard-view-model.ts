import type { InventoryDashboardData } from "@/lib/inventory/contracts";
import { calculateCampaignRows, calculateInventoryRows } from "@/lib/inventory/presentation";

type MarketCode = "US" | "CA";

export type CombinedOverviewViewModel = ReturnType<typeof buildCombinedOverviewViewModel>;

export function buildCombinedOverviewViewModel(us: InventoryDashboardData, ca: InventoryDashboardData) {
  const markets = [buildMarketView(us), buildMarketView(ca)] as const;
  const [usView, caView] = markets;
  const salesTrend = mergeSalesHistory(usView.salesHistory, caView.salesHistory);
  const annualPerformance = Array.from({ length: 12 }, (_, index) => {
    const month = String(index + 1).padStart(2, "0");
    const usPoint = us.businessPerformance.series.find((point) => point.month === month);
    const caPoint = ca.businessPerformance.series.find((point) => point.month === month);
    return {
      month,
      实际销量: (usPoint?.actualUnits ?? 0) + (caPoint?.actualUnits ?? 0),
      计划销量: (usPoint?.forecastUnits ?? 0) + (caPoint?.forecastUnits ?? 0),
      美国站: usPoint?.actualUnits ?? 0,
      加拿大站: caPoint?.actualUnits ?? 0,
    };
  });
  const lastSales = salesTrend.at(-1)?.总销量 ?? 0;
  const previousSales = salesTrend.at(-2)?.总销量 ?? 0;
  const salesChangePercent = previousSales > 0 ? (lastSales - previousSales) / previousSales * 100 : null;
  const overdueOrders = mergeOverdueOrders(markets);
  const priorityRows = markets.flatMap((market) => market.criticalRows.map((row) => ({
    market: market.code,
    sku: row.sku,
    productName: row.productName,
    dailySales: row.dailySales,
    daysCover: row.daysCoverNetwork,
    suggestedShipmentQty: row.suggestedShipmentQty,
    action: row.action,
  }))).sort((left, right) => right.suggestedShipmentQty - left.suggestedShipmentQty).slice(0, 10);

  return {
    generatedAt: [us.generatedAt, ca.generatedAt].sort().at(-1) ?? us.generatedAt,
    actualYear: Math.max(us.businessPerformance.actualYear, ca.businessPerformance.actualYear),
    snapshots: markets.map((market) => ({
      code: market.code,
      label: market.label,
      date: market.snapshotDate,
      latestSalesMonth: market.latestSalesMonth,
      isStale: market.isStale,
      awdAvailable: market.awdSourceAvailable,
      confidence: market.salesConfidence,
    })),
    sharedSupply: {
      id: us.domesticPool.id,
      localInventory: us.summary.localInventory,
      pendingOrderQty: us.summary.pendingOrderQty,
      overdueOrderCount: us.summary.overdueOrderCount,
      readyToShipQty: us.summary.readyToShipQty,
    },
    kpis: {
      networkInventory: usView.networkInventory + caView.networkInventory,
      latestSalesUnits: lastSales,
      salesChangePercent,
      criticalSkuCount: usView.criticalRows.length + caView.criticalRows.length,
      suggestedShipmentQty: usView.shipment + caView.shipment,
      advertisingAdjustments: usView.adAdjustments + caView.adAdjustments,
      annualUnits: us.businessPerformance.summary.annualActualUnits + ca.businessPerformance.summary.annualActualUnits,
    },
    salesTrend,
    annualPerformance,
    riskDistribution: markets.map((market) => ({
      market: market.shortLabel,
      紧急: market.risk.critical,
      关注: market.risk.watch,
      健康: market.risk.healthy,
      过量: market.risk.excess,
      待补数据: market.risk.data,
    })),
    inventoryComposition: markets.map((market) => ({
      market: market.shortLabel,
      FBA: market.fbaSellable,
      AWD: market.awdAvailable,
      调拨中: market.awdOutboundToFba,
    })),
    advertisingEfficiency: markets.map((market) => ({
      market: market.shortLabel,
      ACOS: market.acos,
      目标ACOS: market.targetAcos,
      待调整: market.adAdjustments,
    })),
    markets: markets.map(toMarketSummary),
    overdueOrders,
    priorityRows,
  };
}

function toMarketSummary(market: ReturnType<typeof buildMarketView>) {
  const { rows, criticalRows, overdueOrders, salesHistory, ...summary } = market;
  void rows;
  void criticalRows;
  void overdueOrders;
  void salesHistory;
  return summary;
}

function buildMarketView(data: InventoryDashboardData) {
  const code: MarketCode = data.market === "CA" ? "CA" : "US";
  const rows = calculateInventoryRows(data);
  const campaigns = calculateCampaignRows(data, rows);
  const criticalRows = rows.filter((row) => row.riskLevel === "critical").sort((left, right) => right.suggestedShipmentQty - left.suggestedShipmentQty);
  const latestSalesMonth = data.sales.historyMonths.at(-1) ?? data.sales.windowMonths.at(-1) ?? "";
  const salesHistory = mergeCurrentYearPerformance(
    aggregateSalesHistory(rows),
    data.businessPerformance.actualYear,
    data.businessPerformance.series,
  );
  const latestAdvertising = data.advertising.monthlySeries.at(-1);
  return {
    code,
    label: code === "US" ? "美国站" : "加拿大站",
    shortLabel: code === "US" ? "美国" : "加拿大",
    currency: data.currency,
    snapshotDate: data.snapshots.fbaDate,
    latestSalesMonth,
    isStale: data.snapshots.isStale,
    awdSourceAvailable: data.snapshots.awdSourceAvailable,
    salesConfidence: data.sales.confidence,
    skuCount: rows.length,
    fbaSellable: data.summary.fbaSellable,
    awdAvailable: data.summary.awdAvailable,
    awdOutboundToFba: data.summary.awdOutboundToFba,
    networkInventory: data.summary.fbaSellable + data.summary.awdAvailable + data.summary.awdOutboundToFba,
    dailySales: rows.reduce((sum, row) => sum + row.dailySales, 0),
    latestMonthSales: salesHistory.find((point) => point.month === latestSalesMonth)?.units ?? 0,
    annualUnits: data.businessPerformance.summary.annualActualUnits,
    annualRevenue: data.businessPerformance.summary.annualActualRevenue,
    latestMonthRevenue: data.businessPerformance.summary.latestMonthRevenue,
    latestMonthUnitChangePercent: data.businessPerformance.summary.latestMonthUnitChangePercent,
    shipment: rows.reduce((sum, row) => sum + row.suggestedShipmentQty, 0),
    adAdjustments: campaigns.filter((campaign) => ["PAUSE_STOCK_RISK", "NO_ORDER_REVIEW", "REDUCE_BID_OR_BUDGET", "INCREASE_BID", "INCREASE_BUDGET"].includes(campaign.action)).length,
    acos: latestAdvertising?.acos ?? null,
    targetAcos: data.advertising.parameters.targetAcosPercent,
    risk: {
      critical: criticalRows.length,
      watch: rows.filter((row) => row.riskLevel === "watch").length,
      healthy: rows.filter((row) => row.riskLevel === "healthy").length,
      excess: rows.filter((row) => row.riskLevel === "excess").length,
      data: rows.filter((row) => row.riskLevel === "data").length,
    },
    rows,
    criticalRows,
    salesHistory,
    overdueOrders: rows.flatMap((row) => row.pendingOrders.filter((order) => order.overdue).map((order) => ({ ...order, sku: row.sku, market: code }))),
  };
}

function aggregateSalesHistory(rows: ReturnType<typeof calculateInventoryRows>) {
  const totals = new Map<string, number>();
  for (const row of rows) for (const point of row.salesHistoryByMonth) totals.set(point.month, (totals.get(point.month) ?? 0) + point.units);
  return [...totals.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([month, units]) => ({ month, units }));
}

function mergeCurrentYearPerformance(
  history: Array<{ month: string; units: number }>,
  actualYear: number,
  series: InventoryDashboardData["businessPerformance"]["series"],
) {
  const totals = new Map(history.map((point) => [point.month, point.units]));
  for (const point of series) {
    if (point.actualUnits > 0) totals.set(`${actualYear}-${point.month}`, point.actualUnits);
  }
  return [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([month, units]) => ({ month, units }));
}

function mergeSalesHistory(us: Array<{ month: string; units: number }>, ca: Array<{ month: string; units: number }>) {
  const months = [...new Set([...us.map((point) => point.month), ...ca.map((point) => point.month)])].sort().slice(-24);
  const usMap = new Map(us.map((point) => [point.month, point.units]));
  const caMap = new Map(ca.map((point) => [point.month, point.units]));
  return months.map((month) => {
    const usUnits = usMap.get(month) ?? 0;
    const caUnits = caMap.get(month) ?? 0;
    return { month, 美国站: usUnits, 加拿大站: caUnits, 总销量: usUnits + caUnits };
  });
}

function mergeOverdueOrders(markets: readonly ReturnType<typeof buildMarketView>[]) {
  const merged = new Map<string, { key: string; sku: string; poNumber: string; poDate: string; remainingQuantity: number; overdueDays: number; markets: MarketCode[] }>();
  for (const market of markets) for (const order of market.overdueOrders) {
    const key = `${order.sku}\u0000${order.poNumber}\u0000${order.poDate}`;
    const current = merged.get(key);
    if (current) {
      if (!current.markets.includes(order.market)) current.markets.push(order.market);
      current.remainingQuantity = Math.max(current.remainingQuantity, order.remainingQuantity);
      current.overdueDays = Math.max(current.overdueDays, order.overdueDays);
    } else merged.set(key, { key, sku: order.sku, poNumber: order.poNumber, poDate: order.poDate, remainingQuantity: order.remainingQuantity, overdueDays: order.overdueDays, markets: [order.market] });
  }
  return [...merged.values()].sort((left, right) => right.overdueDays - left.overdueDays);
}
