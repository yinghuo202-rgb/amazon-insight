import type { Metadata } from "next";

import { OpsPageHeader } from "@/components/inventory/ops-ui";
import { PurchasePlanWorkbench } from "@/components/inventory/purchase-plan-workbench";
import { loadInventoryDashboardData, loadPurchasePlanData } from "@/lib/inventory/data";
import { buildSeasonalInventoryPlan } from "@/lib/inventory/seasonal-clearance";
import { buildSeasonalPurchaseActions } from "@/lib/inventory/seasonal-plan-integration";

export const metadata: Metadata = { title: "采购计划", description: "按月中和月末节奏制定美加共享采购计划，并核对采购数量与供应商订单。" };
export const dynamic = "force-dynamic";

export default async function PurchasingPage() {
  const [data, us, ca] = await Promise.all([loadPurchasePlanData(), loadInventoryDashboardData("US"), loadInventoryDashboardData("CA")]);
  const seasonalPlan = buildSeasonalInventoryPlan(us, ca);
  return <><OpsPageHeader eyebrow="US + CA · Purchase Planning" title="采购计划" description="采购建议同步季节清货与旺季缺口：清货 SKU 停止新增采购，补货 SKU 扣减国内现货和未完工订单后再确定采购底线。" /><PurchasePlanWorkbench data={data} seasonalActions={buildSeasonalPurchaseActions(seasonalPlan)} /></>;
}
