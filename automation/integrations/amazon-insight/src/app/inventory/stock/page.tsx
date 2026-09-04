import type { Metadata } from "next";

import { OpsPageHeader } from "@/components/inventory/ops-ui";
import { StockBrowser } from "@/components/inventory/stock-browser";
import { StockViewTabs } from "@/components/inventory/stock-view-tabs";
import { buildInventoryPlanningViewModel, buildStockPurchasePlanViewModel } from "@/lib/inventory/client-view-models";
import { loadInventoryDashboardData, loadPurchasePlanData, normalizeOperationsMarket } from "@/lib/inventory/data";

export const metadata: Metadata = { title: "库存视图", description: "筛选、排序并可视化查看 FBA、AWD、在途、国内库存、订单与 90 天需求。" };
export const dynamic = "force-dynamic";

export default async function StockPage({ searchParams }: { searchParams: Promise<{ market?: string }> }) {
  const market = normalizeOperationsMarket((await searchParams).market);
  const [data, purchasePlan] = await Promise.all([loadInventoryDashboardData(market), loadPurchasePlanData()]);
  return <><OpsPageHeader eyebrow={`${market} · Inventory`} title="库存视图" description="把 FBA、AWD、在途、共享国内现货和未完工订单放到同一张供应链图中，并对照 90 天需求、覆盖天数和采购建议。" /><StockViewTabs /><StockBrowser data={buildInventoryPlanningViewModel(data)} purchasePlan={buildStockPurchasePlanViewModel(purchasePlan)} /></>;
}
