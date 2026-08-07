import { ContentWorkbench } from "@/components/inventory/content-workbench";
import { OpsPageHeader } from "@/components/inventory/ops-ui";
import { buildContentListViewModel } from "@/lib/inventory/client-view-models";
import { loadContentWorkflowData, loadInventoryDashboardData, loadProfitabilityData, loadVariantCatalogData } from "@/lib/inventory/data";
import { buildSeasonalInventoryPlan } from "@/lib/inventory/seasonal-clearance";

export const dynamic = "force-dynamic";

export default async function ContentPage() {
  const [data, variants, us, ca, profitability] = await Promise.all([
    loadContentWorkflowData(),
    loadVariantCatalogData(),
    loadInventoryDashboardData("US"),
    loadInventoryDashboardData("CA"),
    loadProfitabilityData(),
  ]);
  const seasonalPlan = buildSeasonalInventoryPlan(us, ca, profitability);
  return <><OpsPageHeader eyebrow="Product · Growth" title="产品待办" description="把历史销量、广告效率、季节性、库存和毛利合并判断；优先拉动仍有需求、毛利为正且库存可承接的慢销 SKU，零销与超长覆盖库存保留在清货观察。" /><ContentWorkbench data={buildContentListViewModel(data, variants, us, ca, profitability, seasonalPlan)} /></>;
}
