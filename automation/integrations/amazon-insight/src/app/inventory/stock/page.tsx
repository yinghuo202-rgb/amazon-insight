import { SunMedium } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { OpsPageHeader } from "@/components/inventory/ops-ui";
import { StockBrowser } from "@/components/inventory/stock-browser";
import { buildInventoryPlanningViewModel, buildStockPurchasePlanViewModel } from "@/lib/inventory/client-view-models";
import { loadInventoryDashboardData, loadPurchasePlanData, normalizeOperationsMarket } from "@/lib/inventory/data";

export const metadata: Metadata = { title: "库存视图", description: "筛选、排序并可视化查看 SKU 库存、月销量和季节性。" };
export const dynamic = "force-dynamic";

export default async function StockPage({ searchParams }: { searchParams: Promise<{ market?: string }> }) {
  const market = normalizeOperationsMarket((await searchParams).market);
  const [data, purchasePlan] = await Promise.all([loadInventoryDashboardData(market), loadPurchasePlanData()]);
  return <><OpsPageHeader eyebrow={`${market} · Inventory`} title="库存视图" description="把月销量、季节性、本站海外库存与美加共享国内库存池放到同一视图中，自行筛选和排序 SKU，并直接生成采购表。" action={<Link href="/inventory/stock/seasonal-clearance" className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 hover:border-amber-500"><SunMedium className="h-4 w-4" />季节库存分析</Link>} /><StockBrowser data={buildInventoryPlanningViewModel(data)} purchasePlan={buildStockPurchasePlanViewModel(purchasePlan)} /></>;
}
