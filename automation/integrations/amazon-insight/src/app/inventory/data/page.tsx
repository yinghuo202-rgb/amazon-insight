import type { Metadata } from "next";

import { DataRefreshCenter } from "@/components/inventory/data-refresh-center";
import { OpsPageHeader } from "@/components/inventory/ops-ui";
import { getDataRefreshStatus } from "@/lib/inventory/data-refresh";

export const metadata: Metadata = { title: "数据更新", description: "检查源文件、重建运营数据并查看自动化运行记录。" };
export const dynamic = "force-dynamic";

export default async function DataRefreshPage() {
  return <><OpsPageHeader eyebrow="Local · Data Pipeline" title="数据更新" description="集中检查最新库存、销量、采购、订单、广告和产品文件，并安全重建网页使用的标准数据。" /><DataRefreshCenter initialStatus={await getDataRefreshStatus()} /></>;
}
