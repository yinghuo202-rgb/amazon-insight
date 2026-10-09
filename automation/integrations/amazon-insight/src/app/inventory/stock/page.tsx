import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { skuBackendContext } from "@/lib/inventory/operating-navigation";
import { SkuContextReturn } from "@/components/inventory/sku-context-return";

import { OpsPageHeader } from "@/components/inventory/ops-ui";
import { StockBrowser } from "@/components/inventory/stock-browser";
import { StockViewTabs } from "@/components/inventory/stock-view-tabs";
import { buildInventoryPlanningViewModel, buildStockPurchasePlanViewModel } from "@/lib/inventory/client-view-models";
import { loadInventoryDashboardData, loadPurchasePlanData, normalizeOperationsMarket } from "@/lib/inventory/data";

export const metadata: Metadata = { title: "库存视图", description: "筛选、排序并可视化查看 FBA、AWD、在途、国内库存、订单与 90 天需求。" };
export const dynamic = "force-dynamic";

export default async function StockPage({ searchParams }: { searchParams: Promise<{ market?: string; query?: string; returnTo?: string }> }) {
  const search = skuBackendContext(await searchParams);
  if (search.invalidMarket) notFound();
  if (search.market?.toUpperCase() === "MX") return <><SkuContextReturn {...search} /><OpsPageHeader title="MX 库存待接入" description="暂无已核验 MX 库存，不展示 US 或 CA 库存作为替代。" /></>;
  const market = normalizeOperationsMarket(search.market);
  const [data, purchasePlan] = await Promise.all([loadInventoryDashboardData(market), loadPurchasePlanData()]);
  return <><SkuContextReturn {...search} /><OpsPageHeader eyebrow={`${market} · Inventory`} title="库存视图" description="把 FBA、AWD、在途、共享国内现货和未完工订单放到同一张供应链图中，并对照 90 天需求、覆盖天数和采购建议。" /><StockViewTabs /><StockBrowser initialQuery={search.query?.slice(0, 100)} data={buildInventoryPlanningViewModel(data)} purchasePlan={buildStockPurchasePlanViewModel(purchasePlan)} /></>;
}
