import { ProductPoolWorkbench } from "@/components/pool/product-pool-workbench";
import { HeroPanel, PageContainer, TopNav } from "@/components/common/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function PoolPage() {
  return (
    <div className="flex min-h-screen flex-col pb-16">
      <TopNav />
      <main className="flex-1 py-5 sm:py-10">
        <PageContainer className="space-y-5 sm:space-y-8">
          <HeroPanel
            eyebrow="Selection Pool"
            title="选品池"
            description="集中管理已保留的候选商品，方便持续跟踪、追加分析和后续复盘。"
          />
          <ProductPoolWorkbench />
        </PageContainer>
      </main>
    </div>
  );
}
