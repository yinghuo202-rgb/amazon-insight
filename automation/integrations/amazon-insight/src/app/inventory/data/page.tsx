import type { Metadata } from "next";

import { DataRefreshCenter, GerpgoConnectionCheck } from "@/components/inventory/data-refresh-center";
import { OpsPageHeader } from "@/components/inventory/ops-ui";
import { listDataVersions, listImportBatches } from "@/lib/inventory/data-import";
import { getDataRefreshStatus, getOnlineSourceConfiguration } from "@/lib/inventory/data-refresh";
import { getGerpgoSettingsStatus } from "@/lib/inventory/gerpgo";
import { OperatingRulesEditor } from "@/components/inventory/operating-rules-editor";
import { listOperatingRuleOverrides } from "@/lib/inventory/operating-rules-store";

export const metadata: Metadata = { title: "数据更新", description: "检查源文件、重建运营数据并查看自动化运行记录。" };
export const dynamic = "force-dynamic";

export default async function DataRefreshPage() {
  const [status, batches, versions] = await Promise.all([getDataRefreshStatus(), listImportBatches(), listDataVersions()]);
  const onlineSources = getOnlineSourceConfiguration();
  return <><OpsPageHeader title="数据更新" description="积加负责经营事实，WPS 负责库存规划和新品资料。上传文件仍可作为更新入口。" />
    <section aria-label="在线数据来源" className="mb-6 rounded-2xl border border-black/5 bg-white p-5">
      <h2 className="text-lg font-semibold tracking-tight">在线数据来源</h2>
      <div className="mt-4 divide-y divide-slate-100">
        <GerpgoConnectionCheck initialConfiguration={getGerpgoSettingsStatus()} />
        {onlineSources.map(source => <div key={source.key} className="flex flex-wrap items-center justify-between gap-3 py-4"><div><h3 className="text-sm font-medium">{source.label}</h3><p className="mt-1 text-xs leading-6 text-slate-500">{source.owns}</p><p role="status" className="text-xs leading-6 text-slate-500">{source.status}</p></div>{source.url && <a href={source.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-full bg-[#f5f5f7] px-4 text-sm text-[#0071e3]">打开源文档</a>}</div>)}
      </div><p className="mt-4 text-xs leading-6 text-slate-500">在线文档仅为源文件入口，打开不等于同步。下载后沿用下方上传、预览和发布流程；失败时保留上次成功数据，不将缺失库存或费用当作零。</p>
    </section><OperatingRulesEditor initialRules={listOperatingRuleOverrides()} /><DataRefreshCenter initialStatus={status} initialBatches={batches} initialVersions={versions} isAdmin /></>;
}
