import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SkuContextReturn } from "@/components/inventory/sku-context-return";
import { skuBackendContext } from "@/lib/inventory/operating-navigation";

import { AdvertisingWorkbench } from "@/components/inventory/advertising-workbench";
import { OpsPageHeader } from "@/components/inventory/ops-ui";
import { buildAdvertisingViewModel } from "@/lib/inventory/client-view-models";
import { loadInventoryDashboardData, normalizeOperationsMarket } from "@/lib/inventory/data";

export const metadata: Metadata = { title: "广告管理", description: "广告趋势、活动效率和库存联动建议。" };
export const dynamic = "force-dynamic";

export default async function AdvertisingPage({ searchParams }: { searchParams: Promise<{ market?: string; query?: string; returnTo?: string }> }) {
  const search = skuBackendContext(await searchParams);
  if (search.invalidMarket) notFound();
  if (search.market === "MX") return <><SkuContextReturn {...search} /><OpsPageHeader title="MX 广告明细待接入" description="暂无已核验 MX 广告活动报告，不展示 US 或 CA 活动作为替代。" /></>;
  const market = normalizeOperationsMarket(search.market), data = await loadInventoryDashboardData(market);
  return <><SkuContextReturn {...search} /><OpsPageHeader eyebrow={`${market} · Advertising`} title="广告管理" description="历史广告活动与可售状态用于辅助核查，不自动调整预算或竞价。" />{search.query && <p className="mb-4 text-xs text-slate-500">活动列表已带入 SKU 搜索；上方趋势及汇总仍为站点整体，不是单 SKU 经营事实。后台采用当前已导入的活动期间，不代替所选经营月。</p>}<AdvertisingWorkbench initialQuery={search.query} data={buildAdvertisingViewModel(data)} /></>;
}
