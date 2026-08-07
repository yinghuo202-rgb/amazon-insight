import type { Metadata } from "next";

import { AdvertisingWorkbench } from "@/components/inventory/advertising-workbench";
import { OpsPageHeader } from "@/components/inventory/ops-ui";
import { buildAdvertisingViewModel } from "@/lib/inventory/client-view-models";
import { loadInventoryDashboardData, normalizeOperationsMarket } from "@/lib/inventory/data";

export const metadata: Metadata = { title: "广告管理", description: "广告趋势、活动效率和库存联动建议。" };
export const dynamic = "force-dynamic";

export default async function AdvertisingPage({ searchParams }: { searchParams: Promise<{ market?: string }> }) { const market = normalizeOperationsMarket((await searchParams).market); const data = await loadInventoryDashboardData(market); return <><OpsPageHeader eyebrow={`${market} · Advertising`} title="广告管理" description="同时识别需要降量和没有跑起量的活动，结合 ACOS、转化、预算利用率与库存判断是否提高竞价或预算。" /><AdvertisingWorkbench data={buildAdvertisingViewModel(data)} /></>; }
