import { defaultOperatingRules, type OperatingRules, type OperatingRuleOverride } from "@/lib/inventory/operating-rules";
import type { InventoryDashboardData, ProfitabilityData, VariantCatalogData } from "@/lib/inventory/contracts";
import { calculateCampaignRows, calculateInventoryRows } from "@/lib/inventory/presentation";
import { buildSeasonalityProfile } from "@/lib/inventory/seasonality";
import { operatingMarkets, type OperatingPerformance, type OperatingPerformanceRow } from "@/lib/inventory/operating-performance";

export type OperatingModel = ReturnType<typeof buildOperatingModel>;
export type OperatingSku = OperatingModel["rows"][number];

// A period-aligned, currency-isolated presentation of the existing reports.
// Unknown facts stay null; historical units never masquerade as revenue.
export function buildOperatingModel(inventories: InventoryDashboardData[], profitability?: ProfitabilityData, variants?: VariantCatalogData, warnings: string[] = [], now = new Date(), performance?: OperatingPerformance) {
  const replaced = new Set(performance?.scopes.map(scope => `${scope.market}:${scope.reportMonth}`) ?? []);
  const profits: OperatingPerformanceRow[] = [...(profitability?.rows ?? []).filter(row => !replaced.has(`${row.market}:${row.reportMonth}`)), ...(performance?.rows ?? [])].filter(row => (operatingMarkets as readonly string[]).includes(row.market));
  const periods = [...new Set(profits.map((row) => row.reportMonth))].sort().reverse();
  const markets = [...new Set([...inventories.map((item) => item.market), ...profits.map((item) => item.market), ...(performance?.scopes.map(scope => scope.market) ?? [])])].filter((market) => (operatingMarkets as readonly string[]).includes(market));
  const inventoryMap = new Map(inventories.map((item) => [item.market, item]));
  const rows = markets.flatMap((market) => {
    const inventory = inventoryMap.get(market);
    const skus = new Set([...profits.filter((item) => item.market === market).map((item) => item.sku), ...(inventory?.rows ?? []).map((item) => item.sku)]);
    return [...skus].map((sku) => {
      const stock = inventory?.rows.find((item) => item.sku === sku);
      const supplyConfirmed = Boolean(stock && (stock.inTransitInventory === 0 || inventory?.snapshots.inTransitConfirmed === true) && (stock.awdAvailable === 0 || inventory?.snapshots.awdAvailableConfirmed === true));
      const variant = variants?.items.find((item) => item.market === market && item.sku === sku);
      const history = profits.filter((item) => item.market === market && item.sku === sku).sort((a, b) => a.reportMonth.localeCompare(b.reportMonth));
      const unitPoints = new Map((stock?.salesHistoryByMonth.length ? stock.salesHistoryByMonth : stock?.salesByMonth ?? []).filter(point => /^\d{4}-\d{2}$/.test(point.month)).map(point => [point.month, point]));
      for (const point of history) {
        if (point.reportMonth < now.toISOString().slice(0, 7) && point.quality?.completePeriod !== false) unitPoints.set(point.reportMonth, { month: point.reportMonth, units: point.units });
      }
      const unitHistory = [...unitPoints.values()].sort((a, b) => a.month.localeCompare(b.month));
      // Seasonality is anchored to today, not to an old import month.
      const seasonality = buildSeasonalityProfile(unitHistory, now.getUTCMonth() + 1);
      return {
        sku, market, listingId: JSON.stringify([performance?.storeScope?.storeName ?? "MEASUREMAN", market, sku]), parentSku: variant?.parentSku || "未匹配父体", productName: history.at(-1)?.productName || variant?.productName || stock?.productName || sku,
        currency: history.at(-1)?.currency || inventory?.currency || (market === "MX" ? "MXN" : market === "AU" ? "AUD" : market === "CA" ? "CAD" : "USD"),
        history, unitHistory, seasonality, inventoryDate: inventory?.snapshots.fbaDate ?? null,
        awdDate: inventory?.snapshots.awdSourceAvailable ? inventory.snapshots.awdDate : null,
        stock: stock ? { fba: stock.fbaSellable, awd: stock.awdAvailable, awdTransfer: stock.awdOutboundToFba, transit: stock.inTransitInventory, domestic: stock.localInventory, orders: stock.pendingOrderQty, dailySales: stock.dailySales,
          supplyConfirmed, cover: supplyConfirmed && stock.dailySales > 0 ? (stock.fbaSellable + stock.awdAvailable + stock.inTransitInventory) / stock.dailySales : null, target: inventory!.parameters.targetCoverDays } : null,
      };
    });
  });
  return { markets, periods, rows, warnings, storeName: performance?.storeScope?.storeName ?? null, ruleOverrides: [] as OperatingRuleOverride[], dataVersion: "legacy", publishedVersion: performance?.publication.version ?? null, rulesAvailable: true, generatedAt: performance?.generatedAt ?? profitability?.generatedAt ?? null,
    snapshots: inventories.map((item) => ({ market: item.market, date: item.snapshots.fbaDate, awdDate: item.snapshots.awdDate, awdAvailable: item.snapshots.awdSourceAvailable,
      stale: snapshotAgeDays(item.snapshots.fbaDate, now) === null || snapshotAgeDays(item.snapshots.fbaDate, now)! > item.snapshots.staleAfterDays })) };
}

export function snapshotAgeDays(value: string, now = new Date()) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.getTime() <= now.getTime() ? Math.floor((now.getTime() - date.getTime()) / 86400000) : null;
}

export function operatingFacts(row: OperatingSku, period: string, rules: OperatingRules = defaultOperatingRules, now = new Date(), rulesAvailable = true) {
  const current = row.history.find((item) => item.reportMonth === period) ?? null;
  const priorDate = /^\d{4}-\d{2}$/.test(period) ? new Date(`${period}-01T00:00:00Z`) : null;
  priorDate?.setUTCMonth(priorDate.getUTCMonth() - 1);
  const previous = row.history.find((item) => item.reportMonth === priorDate?.toISOString().slice(0, 7)) ?? null;
  const expectedCurrency = row.market === "CA" ? "CAD" : row.market === "MX" ? "MXN" : row.market === "AU" ? "AUD" : "USD";
  const currencyAligned = current?.currency === expectedCurrency && current.currency === row.currency;
  const complete = Boolean(current && period < now.toISOString().slice(0, 7) && current.quality?.completePeriod !== false);
  const comparable = complete && previous && previous.currency === current?.currency && previous.quality?.completePeriod !== false;
  const revenueChange = comparable && current && previous.productSales > 0 ? (current.productSales / previous.productSales - 1) * 100 : null;
  const averagePrice = current ? current.averagePrice ?? (current.units > 0 ? current.productSales / current.units : null) : null;
  const returnRate = current && current.units > 0 && current.returns !== null ? current.returns / current.units : null;
  const advertisingShare = current && current.productSales > 0 && current.advertisingSales != null ? current.advertisingSales / current.productSales : null;
  const advertisingSpendShare = current && current.productSales > 0 && current.advertisingCost !== null ? current.advertisingCost / current.productSales : null;
  const acos = current?.advertisingSales && current.advertisingSales > 0 && current.advertisingCost !== null ? current.advertisingCost / current.advertisingSales : null;
  const issues: string[] = [], suggestions: string[] = [], dataIssues: string[] = [];
  if (!current) dataIssues.push("经营数据缺失");
  if (current && !currencyAligned) dataIssues.push("币种不一致");
  if (current && !current.quality?.profitVerified) dataIssues.push("利润费用待对账");
  if (current && current.advertisingCost === null) dataIssues.push("广告花费未提供");
  if (current && current.storageCost === null) dataIssues.push("仓储费用未提供");
  if (current && !current.quality?.returnsVerified) dataIssues.push("退货口径待核验");
  if (current && !complete) dataIssues.push("当月尚未结束或期间不完整");
  if (current && current.units < rules.minSalesUnits) dataIssues.push("销售样本不足");
  if (!rulesAvailable) dataIssues.push("提醒配置不可用，暂不触发经营提醒");
  const enough = Boolean(rulesAvailable && current && complete && currencyAligned && current.units >= rules.minSalesUnits);
  if (enough && current?.quality?.profitVerified && current.actualMargin !== null && current.actualMargin * 100 < rules.profitMarginMinPercent) {
    issues.push(current.actualProfit !== null && current.actualProfit < 0 ? "利润为负" : "利润待核查");
    suggestions.push("结合已核验成本与费用，复核利润变化；不自动调价。");
  }
  if (enough && current?.quality?.profitVerified && advertisingSpendShare !== null && advertisingSpendShare * 100 > rules.adSpendMaxPercent) {
    issues.push("广告待核查"); suggestions.push("结合广告归因窗口与利润复核投入，不直接缩减预算。");
  }
  if (enough && current?.quality?.returnsVerified && current.units >= rules.minReturnSalesUnits && current.returns !== null && current.returns >= rules.minReturnUnits && returnRate !== null && returnRate * 100 > rules.returnRateMaxPercent) {
    issues.push("退货待核查"); suggestions.push("按已确认的退货统计口径核查原因。");
  }
  if (enough && previous && previous.units >= rules.minSalesUnits && revenueChange !== null && revenueChange < -rules.revenueDeclinePercent) {
    issues.push("销售额下降"); suggestions.push("对比成交均价、销量、流量和可售状态，核查销售下降。");
  }
  const inventoryAge = row.inventoryDate ? snapshotAgeDays(row.inventoryDate, now) : null;
  const awdAge = row.awdDate ? snapshotAgeDays(row.awdDate, now) : null;
  const stockFresh = inventoryAge !== null && inventoryAge <= rules.inventoryStaleDays;
  if (row.stock && !stockFresh) dataIssues.push("库存快照过期或日期缺失");
  const fbaCover = row.stock && row.stock.dailySales > 0 ? row.stock.fba / row.stock.dailySales : null;
  if (row.stock && !row.stock.supplyConfirmed) dataIssues.push("在途或 AWD 可用口径待确认，供应覆盖暂不可判定");
  const awdFresh = !row.stock?.awd || awdAge !== null && awdAge <= rules.inventoryStaleDays;
  const supplyFresh = stockFresh && Boolean(row.stock?.supplyConfirmed) && awdFresh;
  if (row.stock?.awd && !awdFresh) dataIssues.push("AWD 日期待核验或过期");
  if (rulesAvailable && stockFresh && fbaCover !== null && fbaCover < rules.fbaCoverDays) {
    issues.push("当前供货风险"); suggestions.push("先核查 FBA 可售与到货日期，AWD 不视为已上架。");
  }
  if (rulesAvailable && supplyFresh && row.stock?.cover !== null && row.stock?.cover !== undefined && row.stock.cover < rules.supplyCoverDays) {
    issues.push("供应覆盖不足"); suggestions.push("按三个月供应目标复核库存与在途，不将国内订单计入海外可售。");
  }
  if (!suggestions.length) suggestions.push(dataIssues.length ? "先补齐或核验标记的数据，再判断经营情况。" : "当前未触发已配置提醒；继续观察历史变化。");
  return { current, previous, revenueChange, averagePrice, returnRate, advertisingShare, advertisingSpendShare, acos, complete,
    fbaCover, stockFresh, supplyFresh, issues, dataIssues, suggestion: suggestions.slice(0, 2).join(" ") };
}

type MarketCode = "US" | "CA";

export type CombinedOverviewViewModel = ReturnType<typeof buildCombinedOverviewViewModel>;

export function buildCombinedOverviewViewModel(
  us: InventoryDashboardData,
  ca: InventoryDashboardData,
  profitability?: ProfitabilityData,
  variants?: VariantCatalogData,
) {
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
  const revenueTrend = mergeRevenueHistory(us, ca);
  const revenueFocusRows = buildRevenueFocusRows({ us, ca, profitability, variants });
  const revenueKpis = buildRevenueKpis({ us, ca, profitability });

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
    revenueTrend,
    revenueKpis,
    revenueFocusRows,
    operationsBrief: buildOperationsBrief({ us, ca, profitability, variants }),
  };
}

type RevenueMarket = "US" | "CA";

export type RevenueFocusRow = {
  market: RevenueMarket;
  currency: string;
  sku: string;
  parentSku: string;
  productName: string;
  productSales: number;
  actualProfit: number | null;
  actualMargin: number | null;
  recent3AvgUnits: number | null;
  previous3AvgUnits: number | null;
  trendPercent: number | null;
  daysCoverNetwork: number | null;
  signals: string[];
  href: string;
};

function mergeRevenueHistory(us: InventoryDashboardData, ca: InventoryDashboardData) {
  const year = Math.max(us.businessPerformance.actualYear, ca.businessPerformance.actualYear);
  const latestActualMonth = [...us.businessPerformance.series, ...ca.businessPerformance.series]
    .filter((point) => point.actualUnits > 0 || point.actualRevenue > 0)
    .map((point) => Number(point.month))
    .filter((month) => Number.isFinite(month))
    .sort((left, right) => right - left)[0] ?? 12;
  return Array.from({ length: latestActualMonth }, (_, index) => {
    const month = String(index + 1).padStart(2, "0");
    const usPoint = us.businessPerformance.series.find((point) => point.month === month);
    const caPoint = ca.businessPerformance.series.find((point) => point.month === month);
    return {
      month: `${year}-${month}`,
      美国站销售额: usPoint?.actualRevenue ?? 0,
      加拿大站销售额: caPoint?.actualRevenue ?? 0,
    };
  });
}

function buildRevenueKpis({ us, ca, profitability }: { us: InventoryDashboardData; ca: InventoryDashboardData; profitability?: ProfitabilityData }) {
  const latestReportMonth = [...(profitability?.sources ?? [])].sort((left, right) => right.reportMonth.localeCompare(left.reportMonth))[0]?.reportMonth ?? null;
  const latestProfit = (market: RevenueMarket) => (profitability?.rows ?? [])
    .filter((row) => row.market === market && (!latestReportMonth || row.reportMonth === latestReportMonth))
    .reduce((summary, row) => ({
      productSales: summary.productSales + row.productSales,
      actualProfit: summary.actualProfit + row.actualProfit,
      advertisingCost: summary.advertisingCost + row.advertisingCost,
    }), { productSales: 0, actualProfit: 0, advertisingCost: 0 });
  const usLatest = latestProfit("US");
  const caLatest = latestProfit("CA");
  return {
    reportMonth: latestReportMonth,
    latest: {
      US: { productSales: us.businessPerformance.summary.latestMonthRevenue, currency: us.currency, actualProfit: usLatest.actualProfit, advertisingCost: usLatest.advertisingCost },
      CA: { productSales: ca.businessPerformance.summary.latestMonthRevenue, currency: ca.currency, actualProfit: caLatest.actualProfit, advertisingCost: caLatest.advertisingCost },
    },
    annual: {
      US: { productSales: us.businessPerformance.summary.annualActualRevenue, currency: us.currency },
      CA: { productSales: ca.businessPerformance.summary.annualActualRevenue, currency: ca.currency },
    },
  };
}

function buildRevenueFocusRows({ us, ca, profitability, variants }: { us: InventoryDashboardData; ca: InventoryDashboardData; profitability?: ProfitabilityData; variants?: VariantCatalogData }): RevenueFocusRow[] {
  const latestReportMonth = [...(profitability?.sources ?? [])].sort((left, right) => right.reportMonth.localeCompare(left.reportMonth))[0]?.reportMonth ?? null;
  const profitMap = new Map<string, ProfitabilityData["rows"][number]>();
  for (const row of profitability?.rows ?? []) {
    if (latestReportMonth && row.reportMonth !== latestReportMonth) continue;
    profitMap.set(`${row.market}:${row.sku}`, row);
  }
  const variantMap = new Map<string, VariantCatalogData["items"][number]>();
  for (const item of variants?.items ?? []) variantMap.set(`${String(item.market).toUpperCase()}:${item.sku}`, item);
  const rows: RevenueFocusRow[] = [];
  for (const [market, data] of [["US", us], ["CA", ca]] as const) {
    for (const row of data.rows) {
      const profit = profitMap.get(`${market}:${row.sku}`);
      if (!profit) continue;
      const history = row.salesHistoryByMonth.slice().sort((left, right) => left.month.localeCompare(right.month));
      const recent = history.length >= 3 ? average(history.slice(-3).map((point) => point.units)) : null;
      const previous = history.length >= 6 ? average(history.slice(-6, -3).map((point) => point.units)) : null;
      const trend = recent !== null && previous !== null && previous > 0 ? (recent - previous) / previous * 100 : null;
      const signals: string[] = [];
      if (profit.productSales >= data.businessPerformance.summary.latestMonthRevenue * 0.02) signals.push("销售额贡献高");
      if (trend !== null && trend >= 20) signals.push("近3月销量上升");
      if (trend !== null && trend <= -20) signals.push("近3月销量下降");
      if (profit.actualMargin !== null && profit.actualMargin < 0.1) signals.push("利润率偏低");
      if (row.daysCoverNetwork !== null && row.daysCoverNetwork < 45) signals.push("库存覆盖不足45天");
      if (row.daysCoverNetwork !== null && row.daysCoverNetwork > 180) signals.push("库存覆盖超过180天");
      if (!signals.length) signals.push("销售额处于稳定区间");
      rows.push({
        market,
        currency: data.currency,
        sku: row.sku,
        parentSku: variantMap.get(`${market}:${row.sku}`)?.parentSku || "未识别父体",
        productName: row.productName,
        productSales: profit.productSales,
        actualProfit: profit.actualProfit,
        actualMargin: profit.actualMargin,
        recent3AvgUnits: recent,
        previous3AvgUnits: previous,
        trendPercent: trend,
        daysCoverNetwork: row.daysCoverNetwork,
        signals,
        href: `/inventory/sku/${encodeURIComponent(row.sku)}${market === "CA" ? "?market=CA" : ""}`,
      });
    }
  }
  return rows
    .sort((left, right) => focusRank(right) - focusRank(left) || right.productSales - left.productSales)
    .slice(0, 12);
}

function focusRank(row: RevenueFocusRow) {
  const signalWeight = row.signals.reduce((score, signal) => score + (signal === "销售额贡献高" ? 30 : signal.includes("上升") || signal.includes("下降") ? 20 : 15), 0);
  return signalWeight + Math.min(40, Math.log10(Math.max(1, row.productSales)) * 8) + Math.min(30, Math.abs(row.trendPercent ?? 0) * 0.3);
}

function average(values: number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }

type BriefMarket = "US" | "CA" | "MX";
type BriefIssueLevel = "critical" | "watch" | "healthy";

export type OperationsBrief = ReturnType<typeof buildOperationsBrief>;

function buildOperationsBrief({
  us,
  ca,
  profitability,
  variants,
}: {
  us: InventoryDashboardData;
  ca: InventoryDashboardData;
  profitability?: ProfitabilityData;
  variants?: VariantCatalogData;
}) {
  const inventoryByKey = new Map<string, ReturnType<typeof calculateInventoryRows>[number]>();
  for (const [market, data] of [["US", us], ["CA", ca]] as const) {
    for (const row of calculateInventoryRows(data)) inventoryByKey.set(`${market}:${row.sku}`, row);
  }

  const variantByKey = new Map<string, VariantCatalogData["items"][number]>();
  for (const item of variants?.items ?? []) variantByKey.set(`${String(item.market).toUpperCase()}:${item.sku}`, item);
  const groupByKey = new Map<string, VariantCatalogData["groups"][number]>();
  for (const group of variants?.groups ?? []) groupByKey.set(`${String(group.market).toUpperCase()}:${group.parentSku}`, group);

  const latestProfitByKey = new Map<string, ProfitabilityData["rows"][number]>();
  for (const row of profitability?.rows ?? []) {
    const key = `${row.market}:${row.sku}`;
    const prior = latestProfitByKey.get(key);
    if (!prior || row.reportMonth >= prior.reportMonth) latestProfitByKey.set(key, row);
  }

  const childByKey = new Map<string, BriefChild>();
  const addChild = (market: BriefMarket, sku: string, productName: string) => {
    const key = `${market}:${sku}`;
    if (childByKey.has(key)) return;
    const inventory = market === "US" || market === "CA" ? inventoryByKey.get(key) : undefined;
    const profit = latestProfitByKey.get(key);
    const variant = variantByKey.get(key);
    const parentSku = variant?.parentSku || "未识别父体";
    const group = variant ? groupByKey.get(`${market}:${parentSku}`) : undefined;
    const fallbackName = profit?.sku === sku ? "" : productName;
    const issues = briefIssues({ inventory, profit });
    childByKey.set(key, {
      market,
      sku,
      parentSku,
      familyName: group?.familyName || (variant?.familyName ?? (parentSku === "未识别父体" ? "需要补齐父子关系" : fallbackName || parentSku)),
      productName: productName || variant?.productName || profit?.sku || sku,
      role: variant?.role === "Parent" ? "Parent" : "Child",
      reportMonth: profit?.reportMonth ?? null,
      units: profit?.units ?? 0,
      netUnits: profit?.netUnits ?? 0,
      returns: profit?.returns ?? 0,
      productSales: profit?.productSales ?? 0,
      actualProfit: profit?.actualProfit ?? 0,
      actualMargin: profit?.actualMargin ?? null,
      grossMargin: profit?.grossMargin ?? null,
      advertisingCost: profit?.advertisingCost ?? 0,
      currentPrice: profit?.currentPrice ?? null,
      inventory: inventory ? {
        fbaSellable: inventory.fbaSellable,
        awdAvailable: inventory.awdAvailable,
        inTransitInventory: inventory.inTransitInventory,
        localInventory: inventory.localInventory,
        daysCoverNetwork: inventory.daysCoverNetwork,
        riskLevel: inventory.riskLevel,
        action: inventory.action,
      } : null,
      issues,
      issueLevel: issueLevel(issues),
    });
  };

  for (const row of profitability?.rows ?? []) addChild(row.market, row.sku, "");
  for (const [market, data] of [["US", us], ["CA", ca]] as const) {
    for (const row of data.rows) addChild(market, row.sku, row.productName);
  }
  for (const item of variants?.items ?? []) {
    if (item.role === "Child" && (item.market === "US" || item.market === "CA" || item.market === "MX")) addChild(item.market as BriefMarket, item.sku, item.productName);
  }

  const parentMap = new Map<string, BriefParent>();
  for (const child of childByKey.values()) {
    const key = `${child.market}:${child.parentSku}`;
    const existing = parentMap.get(key);
    if (existing) existing.children.push(child);
    else {
      const group = groupByKey.get(key);
      parentMap.set(key, {
        market: child.market,
        parentSku: child.parentSku,
        familyName: child.familyName,
        variationTheme: group?.variationTheme || "",
        recognized: child.parentSku !== "未识别父体",
        children: [child],
        childCount: 0,
        units: 0,
        netUnits: 0,
        productSales: 0,
        actualProfit: 0,
        actualMargin: null,
        inventoryUnits: 0,
        issueCount: 0,
        issues: [],
        issueLevel: "healthy",
      });
    }
  }

  const parents = [...parentMap.values()].map((parent) => {
    parent.children.sort((left, right) => right.units - left.units || left.sku.localeCompare(right.sku));
    parent.childCount = parent.children.length;
    parent.units = parent.children.reduce((sum, child) => sum + child.units, 0);
    parent.netUnits = parent.children.reduce((sum, child) => sum + child.netUnits, 0);
    parent.productSales = round(parent.children.reduce((sum, child) => sum + child.productSales, 0));
    parent.actualProfit = round(parent.children.reduce((sum, child) => sum + child.actualProfit, 0));
    parent.actualMargin = parent.productSales > 0 ? Math.round(parent.actualProfit / parent.productSales * 10000) / 10000 : null;
    parent.inventoryUnits = parent.children.reduce((sum, child) => sum + (child.inventory?.fbaSellable ?? 0) + (child.inventory?.awdAvailable ?? 0) + (child.inventory?.inTransitInventory ?? 0), 0);
    parent.issueCount = parent.children.reduce((sum, child) => sum + child.issues.length, 0);
    parent.issues = [...new Set(parent.children.flatMap((child) => child.issues))].slice(0, 5);
    parent.issueLevel = parent.children.some((child) => child.issueLevel === "critical") ? "critical" : parent.children.some((child) => child.issueLevel === "watch") ? "watch" : "healthy";
    return parent;
  }).sort((left, right) => issueRank(right.issueLevel) - issueRank(left.issueLevel) || right.actualProfit - left.actualProfit || left.parentSku.localeCompare(right.parentSku));

  const latestReportMonth = [...(profitability?.sources ?? [])]
    .sort((left, right) => right.reportMonth.localeCompare(left.reportMonth))[0]?.reportMonth
    ?? [us, ca].flatMap((data) => data.sales.historyMonths).sort().at(-1)
    ?? null;
  const growthCandidates = buildGrowthCandidates({ us, ca, inventoryByKey, latestProfitByKey, variantByKey, groupByKey, latestReportMonth });

  return {
    reportMonth: latestReportMonth,
    generatedAt: profitability?.generatedAt ?? null,
    parentCount: parents.length,
    childCount: childByKey.size,
    issueCount: parents.reduce((sum, parent) => sum + parent.issueCount, 0),
    criticalParentCount: parents.filter((parent) => parent.issueLevel === "critical").length,
    growthCandidates,
    parents,
  };
}

function buildGrowthCandidates({
  us,
  ca,
  inventoryByKey,
  latestProfitByKey,
  variantByKey,
  groupByKey,
  latestReportMonth,
}: {
  us: InventoryDashboardData;
  ca: InventoryDashboardData;
  inventoryByKey: Map<string, ReturnType<typeof calculateInventoryRows>[number]>;
  latestProfitByKey: Map<string, ProfitabilityData["rows"][number]>;
  variantByKey: Map<string, VariantCatalogData["items"][number]>;
  groupByKey: Map<string, VariantCatalogData["groups"][number]>;
  latestReportMonth: string | null;
}): GrowthCandidate[] {
  const candidates: GrowthCandidate[] = [];
  for (const [market, data] of [["US", us], ["CA", ca]] as const) {
    for (const row of calculateInventoryRows(data)) {
      const history = row.salesHistoryByMonth
        .filter((point) => !latestReportMonth || point.month <= latestReportMonth)
        .sort((left, right) => left.month.localeCompare(right.month));
      if (history.length < 6) continue;
      const recent = history.slice(-3).map((point) => point.units);
      const prior = history.slice(-6, -3).map((point) => point.units);
      const recentAvg = average(recent);
      const priorAvg = average(prior);
      const latestUnits = recent.at(-1) ?? 0;
      const trendPercent = priorAvg > 0 ? (recentAvg - priorAvg) / priorAvg * 100 : null;
      const trend = trendPercent ?? 0;
      const profit = latestProfitByKey.get(`${market}:${row.sku}`);
      const inventory = inventoryByKey.get(`${market}:${row.sku}`);
      const margin = profit?.actualMargin ?? null;
      const daysCover = inventory?.daysCoverNetwork ?? null;
      const adRatio = profit && profit.productSales > 0 ? profit.advertisingCost / profit.productSales : null;

      // Growth is deliberately conservative: a clear upward trend, positive unit economics,
      // and enough but not excessive network stock to actually capture the next 90 days.
      if (!profit || !inventory || recentAvg <= 0 || priorAvg <= 0 || trend < 8) continue;
      if (profit.actualProfit <= 0 || margin === null || margin < 0.1) continue;
      if (daysCover === null || daysCover < 45 || daysCover > 180) continue;
      if (adRatio !== null && adRatio > 0.35) continue;

      const variant = variantByKey.get(`${market}:${row.sku}`);
      const parentSku = variant?.parentSku || "未识别父体";
      const group = variant ? groupByKey.get(`${market}:${parentSku}`) : undefined;
      const price = profit.currentPrice ?? (profit.units > 0 ? profit.productSales / profit.units : null);
      const targetMonthlyUnits = Math.max(recentAvg, Math.round(recentAvg * 1.15));
      const incrementalUnits = Math.max(0, targetMonthlyUnits - recentAvg);
      const estimatedRevenue = price === null ? null : round(incrementalUnits * 3 * price);
      const reasons = [
        `近3月均销量 ${integerValue(recentAvg)} 件，高于前3月 ${integerValue(priorAvg)} 件（${trend.toFixed(1)}%）`,
        `实际利润率 ${(margin * 100).toFixed(1)}%，单件经济性可承接扩量`,
        `FBA+AWD+在途可售覆盖 ${Math.round(daysCover)} 天，处于可扩量区间`,
      ];
      if (adRatio !== null && adRatio <= 0.2) reasons.push(`广告成本占销售额 ${(adRatio * 100).toFixed(1)}%，扩量效率较好`);
      const score = Math.round(Math.min(100, 55 + Math.min(25, trend * 0.55) + Math.min(10, margin * 40) + (daysCover >= 60 && daysCover <= 120 ? 10 : 5)));
      candidates.push({
        market,
        sku: row.sku,
        parentSku,
        familyName: group?.familyName || variant?.familyName || row.productName || parentSku,
        productName: row.productName,
        latestUnits,
        recent3Avg: round(recentAvg),
        previous3Avg: round(priorAvg),
        trendPercent: round(trend),
        productSales: round(profit.productSales),
        actualProfit: round(profit.actualProfit),
        actualMargin: margin,
        daysCoverNetwork: daysCover,
        inventoryUnits: inventory.fbaSellable + inventory.awdAvailable + inventory.inTransitInventory,
        estimatedRevenue3M: estimatedRevenue,
        score,
        reasons,
        href: market === "US" || market === "CA" ? `/inventory/sku/${encodeURIComponent(row.sku)}?market=${market}` : null,
      });
    }
  }
  return candidates
    .sort((left, right) => right.score - left.score || (right.estimatedRevenue3M ?? 0) - (left.estimatedRevenue3M ?? 0) || right.trendPercent - left.trendPercent)
    .slice(0, 30);
}

function integerValue(value: number) { return Math.round(value).toLocaleString("en-US"); }

export type GrowthCandidate = {
  market: BriefMarket;
  sku: string;
  parentSku: string;
  familyName: string;
  productName: string;
  latestUnits: number;
  recent3Avg: number;
  previous3Avg: number;
  trendPercent: number;
  productSales: number;
  actualProfit: number;
  actualMargin: number;
  daysCoverNetwork: number;
  inventoryUnits: number;
  estimatedRevenue3M: number | null;
  score: number;
  reasons: string[];
  href: string | null;
};

type BriefChild = {
  market: BriefMarket;
  sku: string;
  parentSku: string;
  familyName: string;
  productName: string;
  role: "Parent" | "Child";
  reportMonth: string | null;
  units: number;
  netUnits: number;
  returns: number;
  productSales: number;
  actualProfit: number;
  actualMargin: number | null;
  grossMargin: number | null;
  advertisingCost: number;
  currentPrice: number | null;
  inventory: {
    fbaSellable: number;
    awdAvailable: number;
    inTransitInventory: number;
    localInventory: number;
    daysCoverNetwork: number | null;
    riskLevel: string;
    action: string;
  } | null;
  issues: string[];
  issueLevel: BriefIssueLevel;
};

type BriefParent = {
  market: BriefMarket;
  parentSku: string;
  familyName: string;
  variationTheme: string;
  recognized: boolean;
  children: BriefChild[];
  childCount: number;
  units: number;
  netUnits: number;
  productSales: number;
  actualProfit: number;
  actualMargin: number | null;
  inventoryUnits: number;
  issueCount: number;
  issues: string[];
  issueLevel: BriefIssueLevel;
};

function briefIssues({
  inventory,
  profit,
}: {
  inventory?: ReturnType<typeof calculateInventoryRows>[number];
  profit?: ProfitabilityData["rows"][number];
}) {
  const issues: string[] = [];
  if (!profit) issues.push("缺少当月毛利数据");
  else {
    if (profit.units === 0) issues.push("当月无销量");
    if (profit.actualProfit < 0) issues.push("实际利润为负");
    if (profit.productSales > 0 && (profit.actualMargin ?? 0) < 0.1) issues.push("利润率低于10%");
    if (profit.units > 0 && profit.returns / profit.units >= 0.15) issues.push("退货率偏高");
    if (profit.productSales > 0 && profit.advertisingCost / profit.productSales > 0.3) issues.push("广告成本占比高");
  }
  if (!inventory) issues.push("缺少库存快照");
  else {
    if (inventory.riskLevel === "critical") issues.push("库存紧急");
    else if (inventory.riskLevel === "watch") issues.push("库存需要关注");
    else if (inventory.riskLevel === "excess") issues.push("库存覆盖偏高");
    if (inventory.daysCoverNetwork !== null && inventory.daysCoverNetwork < 30) issues.push("海外库存不足30天");
    if (inventory.daysCoverNetwork !== null && inventory.daysCoverNetwork > 180) issues.push("海外库存覆盖超过180天");
  }
  return [...new Set(issues)];
}

function issueLevel(issues: string[]): BriefIssueLevel {
  if (issues.some((issue) => ["实际利润为负", "库存紧急", "海外库存不足30天"].includes(issue))) return "critical";
  if (issues.length) return "watch";
  return "healthy";
}

function issueRank(level: BriefIssueLevel) { return level === "critical" ? 3 : level === "watch" ? 2 : 1; }
function round(value: number) { return Math.round(value * 100) / 100; }

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
