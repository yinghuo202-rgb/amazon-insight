import { calculateAdvertisingDecision } from "@/lib/inventory/advertising-calculator";
import { calculateInventoryDecision } from "@/lib/inventory/calculator";
import type {
  AdvertisingAction,
  AdvertisingParameters,
  InventoryAction,
  InventoryDashboardData,
  InventoryParameters,
  VariantCatalogData,
} from "@/lib/inventory/contracts";

export type CalculatedInventoryRow = InventoryDashboardData["rows"][number] & ReturnType<typeof calculateInventoryDecision>;
export type CalculatedCampaign = InventoryDashboardData["advertising"]["campaigns"][number] & ReturnType<typeof calculateAdvertisingDecision>;

export const inventoryActionLabels: Record<InventoryAction, string> = {
  AWD_TRANSFER: "AWD 调拨",
  SEA_SHIP: "安排海运",
  URGENT_AIR_OR_TRANSFER: "紧急空运/调拨",
  HOLD_EXCESS: "库存过量",
  REVIEW_DATA: "检查数据",
  NO_ACTION: "暂不处理",
};

export const advertisingActionLabels: Record<AdvertisingAction, string> = {
  PAUSE_STOCK_RISK: "库存风险控量",
  NO_ORDER_REVIEW: "无订单复核",
  REDUCE_BID_OR_BUDGET: "降低竞价/预算",
  INCREASE_BID: "提高竞价测试",
  INCREASE_BUDGET: "提高广告预算",
  EXPAND_WINNER: "优质活动扩量",
  NO_CHANGE_LOW_DATA: "继续积累数据",
  MONITOR: "继续观察",
};

export const toneByInventoryAction: Record<InventoryAction, "blue" | "emerald" | "amber" | "rose" | "slate"> = {
  AWD_TRANSFER: "emerald",
  SEA_SHIP: "blue",
  URGENT_AIR_OR_TRANSFER: "rose",
  HOLD_EXCESS: "slate",
  REVIEW_DATA: "amber",
  NO_ACTION: "slate",
};

export const toneByAdvertisingAction: Record<AdvertisingAction, "blue" | "emerald" | "amber" | "rose" | "slate"> = {
  PAUSE_STOCK_RISK: "rose",
  NO_ORDER_REVIEW: "amber",
  REDUCE_BID_OR_BUDGET: "amber",
  INCREASE_BID: "blue",
  INCREASE_BUDGET: "emerald",
  EXPAND_WINNER: "emerald",
  NO_CHANGE_LOW_DATA: "slate",
  MONITOR: "blue",
};

export function calculateInventoryRows(
  data: InventoryDashboardData,
  parameters: InventoryParameters = data.parameters,
  demandPercent = 100,
): CalculatedInventoryRow[] {
  return data.rows.map((row) => {
    const dailySales = row.dailySales * (demandPercent / 100);
    const decision = calculateInventoryDecision({ ...row, dailySales }, parameters);
    return {
      ...row,
      dailySales,
      ...decision,
      readyToShipQty: Math.min(row.localInventory, decision.suggestedShipmentQty),
      suggestedProductionQty: Math.max(0, decision.suggestedShipmentQty - row.domesticSupplyTotal),
    };
  });
}

export function calculateCampaignRows(
  data: InventoryDashboardData,
  rows: CalculatedInventoryRow[],
  parameters: AdvertisingParameters = data.advertising.parameters,
): CalculatedCampaign[] {
  const inventoryBySku = new Map(rows.map((row) => [row.sku, row] as const));
  return data.advertising.campaigns.map((campaign) => {
    const inventory = campaign.sku ? inventoryBySku.get(campaign.sku) ?? null : null;
    const inventoryRisk = inventory?.riskLevel ?? null;
    return {
      ...campaign,
      inventoryRisk,
      inventoryDaysCover: inventory?.daysCoverNetwork ?? null,
      ...calculateAdvertisingDecision(campaign, parameters, inventoryRisk),
    };
  });
}

export function buildVariantGroupMetrics(
  market: string,
  variants: VariantCatalogData | null,
  rows: CalculatedInventoryRow[],
) {
  const inventoryBySku = new Map(rows.map((row) => [row.sku, row] as const));
  return (variants?.groups.filter((group) => group.market === market) ?? []).map((group) => {
    const childSkus = variants?.items
      .filter((item) => item.market === group.market && item.parentSku === group.parentSku && item.role === "Child")
      .map((item) => item.sku) ?? [];
    const groupRows = childSkus.map((sku) => inventoryBySku.get(sku)).filter((row): row is CalculatedInventoryRow => Boolean(row));
    return {
      ...group,
      mappedSkuCount: groupRows.length,
      networkInventory: groupRows.reduce((sum, row) => sum + row.eligibleInventoryPosition, 0),
      dailySales: groupRows.reduce((sum, row) => sum + row.dailySales, 0),
      shipment: groupRows.reduce((sum, row) => sum + row.suggestedShipmentQty, 0),
      critical: groupRows.filter((row) => row.riskLevel === "critical").length,
    };
  });
}

export function integer(value: number) {
  return new Intl.NumberFormat("zh-CN").format(Math.round(value));
}

export function compact(value: number) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function currency(value: number, currencyCode = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currencyCode, notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function fullCurrency(value: number, currencyCode = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currencyCode, maximumFractionDigits: 0 }).format(value);
}

export function marketHref(href: string, market: string) {
  if (market !== "CA") return href;
  const hashIndex = href.indexOf("#");
  const pathAndQuery = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
  const hash = hashIndex >= 0 ? href.slice(hashIndex) : "";
  return `${pathAndQuery}${pathAndQuery.includes("?") ? "&" : "?"}market=CA${hash}`;
}

export function days(value: number | null) {
  return value === null ? "—" : `${Math.round(value)} 天`;
}
