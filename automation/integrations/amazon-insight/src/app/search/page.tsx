import { HeroPanel, PageContainer, TopNav } from "@/components/common/ui";
import { SearchWorkbench } from "@/components/products/search-workbench";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const resolved = await searchParams;
  const query = resolved.q || "";

  return (
    <div className="flex min-h-screen flex-col pb-16">
      <TopNav />
      <main className="flex-1 py-5 sm:py-10">
        <PageContainer className="space-y-5 sm:space-y-8">
          <HeroPanel
            eyebrow="Candidate Discovery"
            title="候选商品筛选"
            description="围绕同一关键词比较候选商品，确定主商品与参考竞品，再进入分析页输出判断。"
          />
          <SearchWorkbench initialQuery={query} />
        </PageContainer>
      </main>
    </div>
  );
}
