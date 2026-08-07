import type { Metadata } from "next";

import { OpsPageHeader } from "@/components/inventory/ops-ui";
import { ReplenishmentWorkbench } from "@/components/inventory/replenishment-workbench";
import { buildInventoryPlanningViewModel } from "@/lib/inventory/client-view-models";
import { loadInventoryDashboardData, normalizeOperationsMarket } from "@/lib/inventory/data";
import { buildSeasonalInventoryPlan } from "@/lib/inventory/seasonal-clearance";
import { buildSeasonalShipmentActions } from "@/lib/inventory/seasonal-plan-integration";

export const metadata: Metadata = { title: "发货计划", description: "从库存补货候选中建立独立、可保存和可导出的发货计划。" };
export const dynamic = "force-dynamic";

export default async function ReplenishmentPage({ searchParams }: { searchParams: Promise<{ market?: string }> }) {
  const market = normalizeOperationsMarket((await searchParams).market);
  const [us, ca] = await Promise.all([loadInventoryDashboardData("US"), loadInventoryDashboardData("CA")]);
  const data = market === "CA" ? ca : us;
  const seasonalPlan = buildSeasonalInventoryPlan(us, ca);
  return <><OpsPageHeader eyebrow={`${market} · Shipment Plan`} title="发货计划" description="补货调拨与季节清货共用发货批次：国内清货库存按最晚发出日期安排，海外现货按季末售罄目标跟踪。" /><ReplenishmentWorkbench data={buildInventoryPlanningViewModel(data)} seasonalActions={buildSeasonalShipmentActions(seasonalPlan)} /></>;
}
