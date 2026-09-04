import type { Metadata } from "next";

import { OperationsBriefPanel } from "@/components/inventory/combined-overview-dashboard";
import { OpsPageHeader } from "@/components/inventory/ops-ui";
import { buildCombinedOverviewViewModel } from "@/lib/inventory/dashboard-view-model";
import { loadInventoryDashboardData, loadProfitabilityData, loadVariantCatalogData } from "@/lib/inventory/data";

export const metadata: Metadata = { title: "经营简报", description: "基于历史销量、销售毛利和库存覆盖的父体、子 SKU 与未来三个月增收机会分析。" };
export const dynamic = "force-dynamic";

export default async function OperationsBriefPage() {
  const [us, ca, profitability, variants] = await Promise.all([
    loadInventoryDashboardData("US"),
    loadInventoryDashboardData("CA"),
    loadProfitabilityData().catch(() => undefined),
    loadVariantCatalogData().catch(() => undefined),
  ]);
  const dashboard = buildCombinedOverviewViewModel(us, ca, profitability, variants);
  return <>
    <OpsPageHeader eyebrow="OPERATIONS BRIEF · 90-DAY OUTLOOK" title="经营简报" description="按父体展开每个子 SKU 的销量、销售额、利润、库存覆盖和经营问题，并用历史销量趋势筛选未来三个月值得优先扩量的 SKU。" />
    <OperationsBriefPanel brief={dashboard.operationsBrief} />
  </>;
}
