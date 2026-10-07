import type { Metadata } from "next";
import { RevenueOverviewDashboard } from "@/components/inventory/revenue-overview-dashboard";
import { OpsPageHeader } from "@/components/inventory/ops-ui";
import { loadOperatingModel } from "@/lib/inventory/data";
export const metadata: Metadata = { title: "运营总览", description: "按站点和月份查看销售额、利润与经营证据。" };
export const dynamic = "force-dynamic";
export default async function InventoryPage() {
  const model = await loadOperatingModel();
  return <><OpsPageHeader title="运营总览" description="先看经营变化，再找到需要关注的产品。金额按站点原币种展示。" /><RevenueOverviewDashboard model={model} /></>;
}
