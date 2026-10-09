import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { skuBackendContext } from "@/lib/inventory/operating-navigation";
import { SkuContextReturn } from "@/components/inventory/sku-context-return";

import { OpsPageHeader } from "@/components/inventory/ops-ui";
import { PurchasePlanWorkbench } from "@/components/inventory/purchase-plan-workbench";
import { loadInventoryDashboardData, loadPurchasePlanData } from "@/lib/inventory/data";
import { buildSeasonalInventoryPlan } from "@/lib/inventory/seasonal-clearance";
import { buildSeasonalPurchaseActions } from "@/lib/inventory/seasonal-plan-integration";

export const metadata: Metadata = { title: "采购计划", description: "按月中和月末节奏制定美加共享采购计划，并核对采购数量与供应商订单。" };
export const dynamic = "force-dynamic";

export default async function PurchasingPage({ searchParams }: { searchParams: Promise<{ market?: string; query?: string; returnTo?: string }> }) {
  const search = skuBackendContext(await searchParams);
  if (search.invalidMarket) notFound();
  const [data, us, ca] = await Promise.all([loadPurchasePlanData(), loadInventoryDashboardData("US"), loadInventoryDashboardData("CA")]);
  const seasonalPlan = buildSeasonalInventoryPlan(us, ca);
  return <><SkuContextReturn {...search} /><p className="mb-3 text-xs text-slate-500">采购计划为 US + CA 共享需求，不能视为所选站点的独占库存。MX 尚未纳入采购需求。</p><OpsPageHeader eyebrow="US + CA · Purchase Planning" title="采购计划" description="采购建议同步季节清货与旺季缺口：清货 SKU 停止新增采购，补货 SKU 扣减国内现货和未完工订单后再确定采购底线。" /><PurchasePlanWorkbench initialQuery={search.query?.slice(0, 100)} data={data} seasonalActions={buildSeasonalPurchaseActions(seasonalPlan)} /></>;
}
