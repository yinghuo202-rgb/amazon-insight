import type {
  AdvertisingParameters,
  ContentWorkflowData,
  InventoryDashboardData,
  InventoryParameters,
  ProfitabilityData,
  PurchasePlanData,
  VariantCatalogData,
} from "@/lib/inventory/contracts";
import { calculateInventoryDecision } from "@/lib/inventory/calculator";
import { calculateCampaignRows, calculateInventoryRows } from "@/lib/inventory/presentation";
import type { SeasonalInventoryPlanResult } from "@/lib/inventory/seasonal-clearance";

export type InventoryPlanningViewModel = ReturnType<typeof buildInventoryPlanningViewModel>;
export type InventoryPlanningRow = InventoryPlanningViewModel["rows"][number];
export type CalculatedPlanningRow = ReturnType<typeof calculatePlanningRows>[number];
export type StockPurchasePlanViewModel = ReturnType<typeof buildStockPurchasePlanViewModel>;
export type AdvertisingViewModel = ReturnType<typeof buildAdvertisingViewModel>;
export type ContentListViewModel = ReturnType<typeof buildContentListViewModel>;

export function buildInventoryPlanningViewModel(data: InventoryDashboardData) {
  return {
    market: data.market === "CA" ? "CA" as const : "US" as const,
    generatedAt: data.generatedAt,
    parameters: data.parameters,
    snapshots: { fbaDate: data.snapshots.fbaDate },
    domesticPool: { id: data.domesticPool.id },
    summary: { localInventory: data.summary.localInventory },
    sales: {
      historyMonths: data.sales.historyMonths,
      windowMonths: data.sales.windowMonths,
    },
    rows: data.rows.map((row) => ({
      sku: row.sku,
      productName: row.productName,
      cartonQty: row.cartonQty,
      dailySales: row.dailySales,
      fbaSellable: row.fbaSellable,
      awdAvailable: row.awdAvailable,
      awdOutboundToFba: row.awdOutboundToFba,
      localInventory: row.localInventory,
      pendingOrderQty: row.pendingOrderQty,
      salesByMonth: row.salesByMonth,
      salesHistoryByMonth: row.salesHistoryByMonth,
    })),
  };
}

export function calculatePlanningRows(
  data: InventoryPlanningViewModel,
  parameters: InventoryParameters = data.parameters,
  demandPercent = 100,
) {
  return data.rows.map((row) => {
    const dailySales = row.dailySales * demandPercent / 100;
    const decision = calculateInventoryDecision({ ...row, dailySales }, parameters);
    return {
      ...row,
      dailySales,
      ...decision,
      readyToShipQty: Math.min(row.localInventory, decision.suggestedShipmentQty),
      suggestedProductionQty: Math.max(0, decision.suggestedShipmentQty - row.localInventory - row.pendingOrderQty),
    };
  });
}

export function buildStockPurchasePlanViewModel(data: PurchasePlanData) {
  return {
    cycle: { nextReviewDate: data.cycle.nextReviewDate },
    rows: data.rows.map((row) => ({ sku: row.sku, suggestedPurchaseQty: row.suggestedPurchaseQty })),
  };
}

export function buildAdvertisingViewModel(data: InventoryDashboardData) {
  const rows = calculateInventoryRows(data);
  return {
    market: data.market === "CA" ? "CA" as const : "US" as const,
    currency: data.currency,
    parameters: data.advertising.parameters,
    latestMonth: data.advertising.latestMonth,
    ageDaysAtSnapshot: data.advertising.ageDaysAtSnapshot,
    monthlySeries: data.advertising.monthlySeries,
    campaigns: data.advertising.campaigns,
    inventory: rows.map((row) => ({
      sku: row.sku,
      riskLevel: row.riskLevel,
      daysCoverNetwork: row.daysCoverNetwork,
    })),
  };
}

type GrowthStatus = "SCALE" | "WATCH" | "CLEARANCE" | "HEALTHY" | "NO_DATA";

type MarketOpportunityInput = {
  market: "US" | "CA";
  latestUnits: number;
  previousUnits: number;
  networkInventory: number;
  localInventory: number;
  dailySales: number;
  actualMargin: number | null;
  actualProfit: number | null;
  advertising?: {
    spend: number;
    sales: number;
    orders: number;
    acos: number | null;
    action: string | null;
    confidence: "low" | "medium" | "high";
    targetAcosPercent: number;
  };
  season?: {
    upcomingPeak: boolean;
    upcomingRisePercent: number;
    clearance: boolean;
  };
};

export function classifyMarketOpportunity(input: MarketOpportunityInput) {
  const advertising = input.advertising ?? {
    spend: 0, sales: 0, orders: 0, acos: null, action: null,
    confidence: "low" as const, targetAcosPercent: 30,
  };
  const season = input.season ?? { upcomingPeak: false, upcomingRisePercent: 0, clearance: false };
  const trendPercent = input.previousUnits > 0
    ? Math.round((input.latestUnits - input.previousUnits) / input.previousUnits * 1000) / 10
    : null;
  const coverDays = input.dailySales > 0 ? Math.round(input.networkInventory / input.dailySales) : null;
  const hasStock = input.networkInventory > 0;
  const profitable = (input.actualProfit ?? 0) > 0
    && (input.actualMargin ?? 0) > 0
    && (input.actualMargin ?? 0) <= 1;
  const slowButMoving = input.latestUnits > 0
    && input.latestUnits <= 60
    && (input.latestUnits <= 30 || (trendPercent ?? 0) <= -20);
  const inventoryFit = input.networkInventory >= 10 && coverDays !== null && coverDays >= 45 && coverDays <= 300;
  const seasonalTailwind = season.upcomingPeak || season.upcomingRisePercent >= 20;
  const advertisingBlock = ["NO_ORDER_REVIEW", "REDUCE_BID_OR_BUDGET", "PAUSE_STOCK_RISK"].includes(advertising.action ?? "");
  const efficientAdvertising = advertising.spend > 0
    && advertising.acos !== null
    && advertising.acos <= advertising.targetAcosPercent;
  const advertisingOpportunity = advertising.spend <= 0
    ? (input.latestUnits > 0 ? 12 : 0)
    : advertisingBlock ? -12 : efficientAdvertising ? 12 : -4;
  const demandSignal = slowButMoving || seasonalTailwind;

  let status: GrowthStatus = "HEALTHY";
  if (!hasStock && input.latestUnits === 0) status = "NO_DATA";
  else if (hasStock && (input.latestUnits === 0 || (coverDays ?? 0) > 365)) status = "CLEARANCE";
  else if (season.clearance) status = "CLEARANCE";
  else if (demandSignal && profitable && inventoryFit) {
    status = (input.latestUnits <= 15 || (trendPercent ?? 0) <= -35 || seasonalTailwind)
      && !advertisingBlock ? "SCALE" : "WATCH";
  }

  const score = Math.round(
    Math.max(0, 60 - input.latestUnits) * 0.8
    + Math.max(0, -(trendPercent ?? 0)) * 0.45
    + Math.max(0, (input.actualMargin ?? 0) * 100) * 0.35
    + Math.min(30, input.networkInventory / 10)
    + advertisingOpportunity
    + (seasonalTailwind ? 18 : 0),
  );
  return { ...input, advertising, season, status, trendPercent, coverDays, score, seasonalTailwind, advertisingOpportunity };
}

export function buildContentListViewModel(
  data: ContentWorkflowData,
  variants: VariantCatalogData,
  us: InventoryDashboardData,
  ca: InventoryDashboardData,
  profitability: ProfitabilityData,
  seasonalPlan?: SeasonalInventoryPlanResult,
) {
  const taskSkus = new Set(data.tasks.map((task) => task.sku));
  const profitByMarketSku = new Map(profitability.rows.map((row) => [`${row.market}:${row.sku}`, row]));
  const inventoryByMarketSku = {
    US: new Map(us.rows.map((row) => [row.sku, row])),
    CA: new Map(ca.rows.map((row) => [row.sku, row])),
  } as const;
  const latestMonth = profitability.sources.map((source) => source.reportMonth).sort().at(-1) ?? "";
  const advertisingByMarketSku = new Map<string, ReturnType<typeof summarizeAdvertising>[number]>();
  for (const [market, dashboard] of [["US", us], ["CA", ca]] as const) {
    for (const signal of summarizeAdvertising(dashboard)) advertisingByMarketSku.set(`${market}:${signal.sku}`, signal);
  }
  const seasonalBySku = new Map<string, SeasonalInventoryPlanResult["clearanceCandidates"][number]>();
  for (const candidate of [...(seasonalPlan?.clearanceCandidates ?? []), ...(seasonalPlan?.replenishmentCandidates ?? [])]) {
    seasonalBySku.set(candidate.sku, candidate);
  }
  const tasks = data.tasks.map((task) => {
    const opportunities = (["US", "CA"] as const).map((market) => {
      const inventory = inventoryByMarketSku[market].get(task.sku);
      const history = inventory?.salesHistoryByMonth ?? [];
      const latestHistory = history.at(-1)?.units ?? 0;
      const previousHistory = history.at(-2)?.units ?? 0;
      const profit = profitByMarketSku.get(`${market}:${task.sku}`);
      const advertising = advertisingByMarketSku.get(`${market}:${task.sku}`) ?? {
        sku: task.sku, spend: 0, sales: 0, orders: 0, acos: null, action: null,
        confidence: (market === "US" ? us : ca).advertising.confidence,
        targetAcosPercent: (market === "US" ? us : ca).advertising.parameters.targetAcosPercent,
      };
      const seasonal = seasonalBySku.get(task.sku);
      return classifyMarketOpportunity({
        market,
        latestUnits: profit?.reportMonth === latestMonth ? profit.units : latestHistory,
        previousUnits: previousHistory,
        networkInventory: inventory?.eligibleInventoryPosition ?? 0,
        localInventory: inventory?.localInventory ?? 0,
        dailySales: inventory?.dailySales ?? 0,
        actualMargin: profit?.actualMargin ?? null,
        actualProfit: profit?.actualProfit ?? null,
        advertising,
        season: {
          upcomingPeak: seasonal?.upcomingPeak ?? false,
          upcomingRisePercent: seasonal?.upcomingRisePercent ?? 0,
          clearance: Boolean(seasonal && seasonal.priority === "clear_now"),
        },
      });
    });
    const rank: Record<GrowthStatus, number> = { SCALE: 5, WATCH: 4, CLEARANCE: 3, HEALTHY: 2, NO_DATA: 1 };
    const primary = [...opportunities].sort((left, right) =>
      rank[right.status] - rank[left.status] || right.score - left.score)[0];
    const marketUnits = {
      US: profitByMarketSku.get(`US:${task.sku}`)?.units ?? opportunities[0].latestUnits,
      CA: profitByMarketSku.get(`CA:${task.sku}`)?.units ?? opportunities[1].latestUnits,
      MX: profitByMarketSku.get(`MX:${task.sku}`)?.units ?? 0,
    };
    const availableMarkets = opportunities.filter((item) => ["SCALE", "WATCH"].includes(item.status)).map((item) => item.market);
    const advertising = primary.advertising;
    const seasonal = primary.season;
    const action = primary.status === "SCALE"
      ? "先优化主图与关键词，再用小预算精准广告拉量"
      : primary.status === "WATCH"
        ? "检查转化与搜索词，验证后再逐步加预算"
        : primary.status === "CLEARANCE"
          ? "不追加广告预算，转入清货与价格策略"
          : primary.status === "HEALTHY"
            ? "保持当前节奏，避免过度投放"
            : "补齐销量或库存数据后再判断";
    return {
      sku: task.sku,
      productName: task.productName,
      category: task.category,
      copy: {
        source: task.copy.source,
        title: task.copy.title,
        bulletCount: task.copy.bullets.length,
        descriptionLength: task.copy.description.length,
        qualityFlagCount: task.copy.qualityFlags.length,
      },
      mainImageBrief: {
        source: task.mainImageBrief.source,
        sectionCount: task.mainImageBrief.sections.length,
      },
      aPlusBrief: {
        source: task.aPlusBrief.source,
        sectionCount: task.aPlusBrief.sections.length,
      },
      growth: {
        status: primary.status,
        priorityScore: primary.score,
        targetMarket: primary.market,
        latestMonth,
        latestUnits: primary.latestUnits,
        marketUnits,
        networkInventory: opportunities.reduce((sum, item) => sum + item.networkInventory, 0),
        localInventory: Math.max(...opportunities.map((item) => item.localInventory)),
        coverDays: primary.coverDays,
        trendPercent: primary.trendPercent,
        actualMargin: primary.actualMargin,
        availableMarkets,
        markets: opportunities.map((item) => item.market),
        advertising: {
          spend: advertising.spend,
          sales: advertising.sales,
          orders: advertising.orders,
          acos: advertising.acos,
          action: advertising.action,
          confidence: advertising.confidence,
          opportunity: primary.advertisingOpportunity,
        },
        season: {
          upcomingPeak: seasonal.upcomingPeak,
          upcomingRisePercent: seasonal.upcomingRisePercent,
          clearance: seasonal.clearance,
        },
        marketOpportunities: opportunities.map((opportunity) => ({
          ...opportunity,
          action: opportunity.status === "SCALE"
            ? "先优化主图与关键词，再用小预算精准广告拉量"
            : opportunity.status === "WATCH"
              ? "检查转化与搜索词，验证后再逐步加预算"
              : opportunity.status === "CLEARANCE"
                ? "不追加广告预算，转入清货与价格策略"
                : opportunity.status === "HEALTHY"
                  ? "保持当前节奏，避免过度投放"
                  : "补齐销量或库存数据后再判断",
        })),
        action,
      },
    };
  }).sort((left, right) => right.growth.priorityScore - left.growth.priorityScore || left.sku.localeCompare(right.sku));
  return {
    summary: {
      ...data.summary,
      latestMonth,
      scaleCount: tasks.filter((task) => task.growth.status === "SCALE").length,
      watchCount: tasks.filter((task) => task.growth.status === "WATCH").length,
      clearanceCount: tasks.filter((task) => task.growth.status === "CLEARANCE").length,
      growthInventory: tasks.filter((task) => ["SCALE", "WATCH"].includes(task.growth.status)).reduce((sum, task) => sum + task.growth.networkInventory, 0),
      latestUnits: tasks.reduce((sum, task) => sum + task.growth.marketUnits.US + task.growth.marketUnits.CA + task.growth.marketUnits.MX, 0),
    },
    tasks,
    groups: variants.groups.filter((group) => variants.items.some((item) =>
      item.market === group.market && item.parentSku === group.parentSku && item.role === "Child" && taskSkus.has(item.sku))),
    variants: variants.items.filter((item) => item.role === "Child" && taskSkus.has(item.sku)).map((item) => ({
      market: item.market,
      parentSku: item.parentSku,
      role: item.role,
      sku: item.sku,
      variantValue: item.variantValue,
    })),
  };
}

function summarizeAdvertising(data: InventoryDashboardData) {
  const rows = calculateInventoryRows(data);
  const campaigns = calculateCampaignRows(data, rows);
  const bySku = new Map<string, {
    sku: string; spend: number; sales: number; orders: number; acos: number | null; action: string | null;
    confidence: "low" | "medium" | "high"; targetAcosPercent: number;
  }>();
  for (const campaign of campaigns) {
    if (!campaign.sku) continue;
    const current = bySku.get(campaign.sku) ?? {
      sku: campaign.sku, spend: 0, sales: 0, orders: 0, acos: null, action: null,
      confidence: data.advertising.confidence,
      targetAcosPercent: data.advertising.parameters.targetAcosPercent,
    };
    current.spend += campaign.spend;
    current.sales += campaign.advertisingSales;
    current.orders += campaign.orders;
    current.acos = current.sales > 0 ? current.spend / current.sales * 100 : null;
    if (campaign.action === "NO_ORDER_REVIEW" || campaign.action === "REDUCE_BID_OR_BUDGET" || campaign.action === "PAUSE_STOCK_RISK") current.action = campaign.action;
    else if (!current.action && ["INCREASE_BID", "INCREASE_BUDGET", "EXPAND_WINNER"].includes(campaign.action)) current.action = campaign.action;
    bySku.set(campaign.sku, current);
  }
  return [...bySku.values()];
}

export function withTargetAcos(parameters: AdvertisingParameters, targetAcosPercent: number): AdvertisingParameters {
  return { ...parameters, targetAcosPercent };
}
