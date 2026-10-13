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

export type InventoryDemandBasis = {
  source: "wps_reference" | "historical";
  label: string;
  date: string | null;
  method: string;
  monthlySales: number | null;
  windowMonths: string[];
  dailySales: number;
  staleAfterDays: number;
  usable: boolean;
  reason: string | null;
};

export type InventorySupplyBasis = {
  fbaDate: string | null;
  awdDate: string | null;
  requiresAwd: boolean;
  confirmed: boolean;
  staleAfterDays: number;
  fbaFresh: boolean;
  awdFresh: boolean;
  usable: boolean;
  reason: string | null;
};

// The existing report builder marks sales evidence older than 62 days as low
// confidence (inventory_dashboard.py). This is a freshness gate, not a demand multiplier.
const historicalDemandStaleDays = 62;

function demandAgeDays(value: string | null, now: Date) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && date <= now
    ? Math.floor((now.getTime() - date.getTime()) / 86400000) : null;
}

export function resolveInventoryDemandBasis(row: InventoryDashboardData["rows"][number], data: Pick<InventoryDashboardData, "sales" | "snapshots">, now = new Date()): InventoryDemandBasis {
  if (row.referenceMonthlySales !== undefined) {
    // Old confirmed reports predate this explicit field. Their per-SKU business
    // date is retained as the compatibility source, never the download timestamp.
    const date = row.referenceMonthlySalesDate === undefined
      ? data.snapshots.businessDateUnknown ? null : row.inventorySnapshotDate ?? data.snapshots.fbaDate
      : row.referenceMonthlySalesDate;
    const staleAfterDays = data.snapshots.staleAfterDays ?? 14;
    const age = demandAgeDays(date, now);
    const usable = age !== null && age <= staleAfterDays;
    return { source: "wps_reference", label: "WPS 参考月销（人工计划）", date,
      method: "参考月销 / 30；不是历史实际销量", monthlySales: row.referenceMonthlySales, windowMonths: [],
      dailySales: row.referenceMonthlySales / 30, staleAfterDays, usable,
      reason: age === null ? "参考月销业务日期缺失或无效，补货建议暂停。"
        : !usable ? `参考月销已超过库存维护有效期 ${staleAfterDays} 天，补货建议暂停。`
        : row.referenceMonthlySales === 0 ? "参考月销为 0（明确计划值），覆盖天数无法计算。" : null };
  }
  const currentMonth = now.toISOString().slice(0, 7);
  const months = row.salesByMonth?.length ? row.salesByMonth.map(point => point.month)
    : data.sales?.sourceKind === "planning_workbook" ? [] : data.sales?.windowMonths ?? [];
  const windowMonths = [...new Set(months)].sort();
  const complete = windowMonths.length > 0 && windowMonths.every(month => /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && month < currentMonth);
  const latest = complete ? windowMonths.at(-1)! : null;
  const date = latest ? new Date(Date.UTC(Number(latest.slice(0, 4)), Number(latest.slice(5)), 0)).toISOString().slice(0, 10) : null;
  const age = demandAgeDays(date, now);
  const usable = age !== null && age <= historicalDemandStaleDays && !data.sales?.sourceKind?.includes("forecast");
  return { source: "historical", label: "历史销量日销（原报告）", date,
    method: "原报告已保存日销（未重新加权）；销量期间按 SKU 明细标识", monthlySales: null, windowMonths,
    dailySales: row.dailySales, staleAfterDays: historicalDemandStaleDays, usable,
    reason: age === null ? "历史日销缺少可核验的完整销量期间，补货建议暂停。"
      : !usable ? `历史需求基线超过既有销量低置信阈值 ${historicalDemandStaleDays} 天或为预测，补货建议暂停。` : null };
}

export function inventoryDemandUsable(basis: InventoryDemandBasis, now = new Date()) {
  const age = demandAgeDays(basis.date, now);
  return basis.usable && age !== null && age <= basis.staleAfterDays;
}

export function inventorySupplyStatus(basis: Pick<InventorySupplyBasis, "fbaDate" | "awdDate" | "requiresAwd" | "confirmed" | "staleAfterDays">, now = new Date()) {
  const fbaAge = demandAgeDays(basis.fbaDate, now);
  const awdAge = demandAgeDays(basis.awdDate, now);
  const fbaFresh = fbaAge !== null && fbaAge <= basis.staleAfterDays;
  const awdFresh = !basis.requiresAwd || awdAge !== null && awdAge <= basis.staleAfterDays;
  return { fbaFresh, awdFresh, usable: fbaFresh && awdFresh && basis.confirmed,
    reason: !fbaFresh ? "FBA 库存业务日期缺失或过期，补货建议暂停。"
      : !basis.confirmed ? "在途或 AWD 供应口径未确认，网络覆盖未知，补货建议暂停。"
      : !awdFresh ? "AWD 业务日期缺失或过期，网络覆盖未知，补货建议暂停。" : null };
}

export function resolveInventorySupplyBasis(row: InventoryDashboardData["rows"][number], data: Pick<InventoryDashboardData, "snapshots">, now = new Date()): InventorySupplyBasis {
  const requiresAwd = row.awdAvailable > 0 || row.awdOutboundToFba > 0;
  const basis = {
    fbaDate: row.inventorySnapshotDate ?? (data.snapshots.businessDateUnknown ? null : data.snapshots.fbaDate),
    awdDate: row.awdSnapshotDate ?? (data.snapshots.businessDateUnknown ? null : data.snapshots.awdDate),
    requiresAwd,
    confirmed: (row.inTransitInventory === 0 || data.snapshots.inTransitConfirmed === true)
      && (!requiresAwd || data.snapshots.awdSourceAvailable === true && data.snapshots.awdAvailableConfirmed === true),
    staleAfterDays: data.snapshots.staleAfterDays ?? 14,
  };
  return { ...basis, ...inventorySupplyStatus(basis, now) };
}

export function calculateInventoryDemandDecision(row: Parameters<typeof calculateInventoryDecision>[0], parameters: InventoryParameters, demandBasis: InventoryDemandBasis, demandPercent = 100, now = new Date(), supplyBasis: InventorySupplyBasis) {
  const dailySales = demandBasis.dailySales * demandPercent / 100;
  const calculated = calculateInventoryDecision({ ...row, dailySales }, parameters);
  const demandUsable = inventoryDemandUsable(demandBasis, now);
  const supply = inventorySupplyStatus(supplyBasis, now);
  if (demandUsable && supply.usable) return { dailySales, ...calculated };
  return { dailySales, ...calculated,
    // FBA coverage remains independently knowable even when the network is not.
    daysCoverFba: demandUsable && supply.fbaFresh ? calculated.daysCoverFba : null,
    daysCoverNetwork: null, suggestedShipmentQty: 0, suggestedAwdTransferQty: 0,
    action: "REVIEW_DATA" as const, riskLevel: "data" as const,
    reason: !demandUsable ? demandBasis.reason || "需求基线业务日期已过期，补货建议暂停。"
      : supply.reason! };
}

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
  now = new Date(),
): Array<CalculatedInventoryRow & { demandBasis: InventoryDemandBasis; supplyBasis: InventorySupplyBasis }> {
  return data.rows.map((row) => {
    const demandBasis = resolveInventoryDemandBasis(row, data, now);
    const supplyBasis = resolveInventorySupplyBasis(row, data, now);
    const decision = calculateInventoryDemandDecision(row, parameters, demandBasis, demandPercent, now, supplyBasis);
    return {
      ...row,
      demandBasis,
      supplyBasis,
      ...decision,
      readyToShipQty: row.domesticSupplyBreakdownVerified === false ? 0 : Math.min(row.localInventory, decision.suggestedShipmentQty),
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
