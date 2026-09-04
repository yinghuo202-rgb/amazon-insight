import type { Metadata } from "next";

import { RevenueOverviewDashboard } from "@/components/inventory/revenue-overview-dashboard";
import { OpsPageHeader } from "@/components/inventory/ops-ui";
import { buildCombinedOverviewViewModel } from "@/lib/inventory/dashboard-view-model";
import { loadInventoryDashboardData, loadProfitabilityData, loadVariantCatalogData } from "@/lib/inventory/data";

export const metadata: Metadata = { title: "销售额运营总览", description: "以销售额为主口径查看美国站和加拿大站的经营变化，并通过搜索打开单个 SKU 综合工作台。" };
export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const [us, ca, profitability, variants] = await Promise.all([
    loadInventoryDashboardData("US"),
    loadInventoryDashboardData("CA"),
    loadProfitabilityData().catch(() => undefined),
    loadVariantCatalogData().catch(() => undefined),
  ]);
  const dashboard = buildCombinedOverviewViewModel(us, ca, profitability, variants);
  return <><OpsPageHeader eyebrow="US + CA · REVENUE COMMAND CENTER" title="销售额运营总览" description="以产品销售额、利润、库存覆盖和重点变化为主线；总览不铺开全部 SKU，输入任意 SKU 即可进入综合证据工作台。" /><RevenueOverviewDashboard dashboard={dashboard} /></>;
}
