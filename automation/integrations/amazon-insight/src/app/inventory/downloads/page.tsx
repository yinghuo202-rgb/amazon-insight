import type { Metadata } from "next";

import { DownloadCenter } from "@/components/inventory/download-center";
import { OpsPageHeader } from "@/components/inventory/ops-ui";
import { listDownloadHistory } from "@/lib/inventory/download-center";

export const metadata: Metadata = { title: "下载中心", description: "查看并重新下载历史发货、报运、采购、广告和美工文件。" };
export const dynamic = "force-dynamic";

export default async function DownloadsPage() {
  const items = await listDownloadHistory();
  return <><OpsPageHeader eyebrow="Local · Download Archive" title="下载中心" description="集中查看发货、报运、采购、广告与美工历史文件，按类型、站点和文件名筛选并支持重新下载。" /><DownloadCenter items={items} /></>;
}
