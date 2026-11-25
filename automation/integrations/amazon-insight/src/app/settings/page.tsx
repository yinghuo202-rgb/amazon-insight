import { HeroPanel, PageContainer, SectionCard, TopNav } from "@/components/common/ui";
import { GerpGoSetupCard } from "@/components/settings/gerpgo-setup-card";
import { JungleScoutSetupCard } from "@/components/settings/junglescout-setup-card";
import { requirePageUser } from "@/lib/auth";
import { getWorkerOverview } from "@/lib/worker/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requirePageUser("/settings");
  const workerOverview = await getWorkerOverview().catch(() => ({
    online: false,
    workers: [],
    queueCounts: { pending: 0, running: 0, succeeded: 0, failed: 0, canceled: 0 },
  }));

  return (
    <div className="flex min-h-screen flex-col pb-16">
      <TopNav />
      <main className="flex-1 py-8 sm:py-10">
        <PageContainer className="space-y-8">
          <HeroPanel
            eyebrow="Data Source Settings"
            title="数据源设置"
            description="集中管理积加 ERP 销售同步、Jungle Scout 凭证及外部爬虫接入接口。"
          />
          <GerpGoSetupCard />
          <JungleScoutSetupCard />
          <SectionCard
            eyebrow="Crawler & Worker"
            title="后台 Worker 与 Amazon / 1688 爬虫接入"
            description="支持外部爬虫直传快照，或通过任务队列交由后台 Worker 定时同步积加 ERP 与调度采集任务。"
            action={
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
                  workerOverview.online
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-slate-200 bg-slate-100 text-slate-600"
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${workerOverview.online ? "bg-emerald-500" : "bg-slate-400"}`} />
                {workerOverview.online ? "后台 Worker 在线" : "未检测到后台 Worker"}
              </span>
            }
          >
            <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-slate-600">
              <span>待处理任务：{workerOverview.queueCounts.pending}</span>
              <span>运行中：{workerOverview.queueCounts.running}</span>
              <span>已完成：{workerOverview.queueCounts.succeeded}</span>
              <span>失败：{workerOverview.queueCounts.failed}</span>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-[var(--border)] bg-white/70 px-4 py-3 text-sm">
                <p className="font-mono font-semibold text-slate-900">POST /api/crawlers/ingest/amazon</p>
                <p className="mt-1 text-slate-600">写入亚马逊 ASIN 快照（可选同步进入选品池），支持 GET 按 ASIN/站点查询。</p>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-white/70 px-4 py-3 text-sm">
                <p className="font-mono font-semibold text-slate-900">POST /api/crawlers/ingest/1688</p>
                <p className="mt-1 text-slate-600">按 offerId 写入/更新 1688 供应商报价、MOQ 与交期，支持按 ASIN/SKU 关联查询。</p>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-white/70 px-4 py-3 text-sm">
                <p className="font-mono font-semibold text-slate-900">POST /api/crawlers/jobs</p>
                <p className="mt-1 text-slate-600">提交或重试 Amazon / 1688 采集任务，由后台 Worker 领取并执行。</p>
              </div>
            </div>
          </SectionCard>
        </PageContainer>
      </main>
    </div>
  );
}
