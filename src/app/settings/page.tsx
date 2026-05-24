import { HeroPanel, PageContainer, TopNav } from "@/components/common/ui";
import { JungleScoutSetupCard } from "@/components/settings/junglescout-setup-card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <div className="flex min-h-screen flex-col pb-16">
      <TopNav />
      <main className="flex-1 py-8 sm:py-10">
        <PageContainer className="space-y-8">
          <HeroPanel
            eyebrow="Data Source Settings"
            title="数据源设置"
            description="统一管理 Jungle Scout 凭证和数据链路状态，搜索页与分析页直接复用这里的配置。"
          />
          <JungleScoutSetupCard />
        </PageContainer>
      </main>
    </div>
  );
}
