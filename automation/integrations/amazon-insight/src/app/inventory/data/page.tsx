import type { Metadata } from "next";

import { DataRefreshCenter } from "@/components/inventory/data-refresh-center";
import { OpsPageHeader } from "@/components/inventory/ops-ui";
import { getCurrentUser } from "@/lib/auth";
import { listDataVersions, listImportBatches } from "@/lib/inventory/data-import";
import { getDataRefreshStatus } from "@/lib/inventory/data-refresh";

export const metadata: Metadata = { title: "数据更新", description: "检查源文件、重建运营数据并查看自动化运行记录。" };
export const dynamic = "force-dynamic";

export default async function DataRefreshPage() {
  const user = await getCurrentUser();
  const [status, batches, versions] = await Promise.all([getDataRefreshStatus(), user?.role === "ADMIN" ? listImportBatches() : Promise.resolve([]), user?.role === "ADMIN" ? listDataVersions() : Promise.resolve([])]);
  return <><OpsPageHeader eyebrow="Local · Data Pipeline" title="数据更新" description="上传最新 Excel，自动识别和校验内容；管理员确认后生成可回滚的数据版本并立即更新网站。" /><DataRefreshCenter initialStatus={status} initialBatches={batches} initialVersions={versions} isAdmin={user?.role === "ADMIN"} /></>;
}
