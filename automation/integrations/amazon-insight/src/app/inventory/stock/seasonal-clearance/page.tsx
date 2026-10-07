import type { Metadata } from "next";

import { OpsPageHeader } from "@/components/inventory/ops-ui";
import { SeasonalClearanceView } from "@/components/inventory/seasonal-clearance-view";
import { StockViewTabs } from "@/components/inventory/stock-view-tabs";
import { loadInventoryDashboardData, loadProfitabilityData } from "@/lib/inventory/data";
import { buildSeasonalInventoryPlan } from "@/lib/inventory/seasonal-clearance";

export const metadata: Metadata = { title: "季节库存分析", description: "统一分析应季补货、国内调拨、季末清货和未完工订单处置。" };
export const dynamic = "force-dynamic";

export default async function SeasonalClearancePage({ searchParams }: { searchParams: Promise<{ market?: string }> }) {
  const params = await searchParams;
  const initialMarket = params.market?.toUpperCase() === "US" || params.market?.toUpperCase() === "CA" ? params.market.toUpperCase() as "US" | "CA" : "ALL";
  const [us, ca, profitability] = await Promise.all([loadInventoryDashboardData("US"), loadInventoryDashboardData("CA"), loadProfitabilityData()]);
  const result = buildSeasonalInventoryPlan(us, ca, profitability);
  return <>
    <OpsPageHeader eyebrow="US + CA · Inventory · Seasonal Planning" title="库存视图 · 季节库存" description="把应季补货、国内调拨、季末清货和未完工订单处置放在一起，使用同一套历史销量和站点库存口径判断。" />
    <StockViewTabs />
    <SeasonalClearanceView result={result} initialMarket={initialMarket} />
  </>;
}
