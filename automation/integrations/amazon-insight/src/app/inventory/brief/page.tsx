import type { Metadata } from "next";
import { RevenueOverviewDashboard } from "@/components/inventory/revenue-overview-dashboard";
import { OpsPageHeader } from "@/components/inventory/ops-ui";
import { loadOperatingModel } from "@/lib/inventory/data";
export const metadata: Metadata = { title: "SKU 经营简报", description: "一张卡片看销售、利润、广告、退货、仓储和季节性。" };
export const dynamic = "force-dynamic";
export default async function BriefPage() {
  return <><OpsPageHeader title="SKU 经营简报" description="先看简短建议，再展开证据。默认聚焦少量 SKU，也可搜索 SKU、产品或 ASIN。" /><RevenueOverviewDashboard model={await loadOperatingModel()} brief /></>;
}
