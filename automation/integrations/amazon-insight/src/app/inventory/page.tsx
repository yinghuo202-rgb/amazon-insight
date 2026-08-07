import type { Metadata } from "next";

import { CombinedOverviewDashboard } from "@/components/inventory/combined-overview-dashboard";
import { OpsPageHeader } from "@/components/inventory/ops-ui";
import { buildCombinedOverviewViewModel } from "@/lib/inventory/dashboard-view-model";
import { loadInventoryDashboardData } from "@/lib/inventory/data";

export const metadata: Metadata = { title: "双站运营总览", description: "同时查看美国站和加拿大站的库存、销售、补货和广告异常。" };
export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const [us, ca] = await Promise.all([loadInventoryDashboardData("US"), loadInventoryDashboardData("CA")]);
  const dashboard = buildCombinedOverviewViewModel(us, ca);
  return <><OpsPageHeader eyebrow="US + CA · Command Center" title="双站运营驾驶舱" description="以销量、库存、季节供需和执行风险为主线，统一查看美国站与加拿大站的经营状态，再进入各业务页面完成动作。" /><CombinedOverviewDashboard dashboard={dashboard} /></>;
}
