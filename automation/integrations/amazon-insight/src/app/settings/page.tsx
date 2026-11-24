import { HeroPanel, PageContainer, SectionCard, TopNav } from "@/components/common/ui";
import { GerpGoSetupCard } from "@/components/settings/gerpgo-setup-card";
import { JungleScoutSetupCard } from "@/components/settings/junglescout-setup-card";
import { requirePageUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requirePageUser("/settings");

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
            eyebrow="Crawler Ingestion"
            title="Amazon & 1688 爬虫数据接收端点"
            description="外部采集脚本可通过环境变量 CRAWLER_INGEST_TOKEN（Authorization: Bearer）或已登录会话直接写入采集快照。"
          >
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-[var(--border)] bg-white/70 px-4 py-3 text-sm">
                <p className="font-mono font-semibold text-slate-900">POST /api/crawlers/ingest/amazon</p>
                <p className="mt-1 text-slate-600">写入亚马逊 ASIN 快照（可选同步进入选品池），支持 GET 按 ASIN/站点查询。</p>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-white/70 px-4 py-3 text-sm">
                <p className="font-mono font-semibold text-slate-900">POST /api/crawlers/ingest/1688</p>
                <p className="mt-1 text-slate-600">按 offerId 写入/更新 1688 供应商报价、MOQ 与交期，支持按 ASIN/SKU 关联查询。</p>
              </div>
            </div>
          </SectionCard>
        </PageContainer>
      </main>
    </div>
  );
}
