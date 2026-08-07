import { cache } from "react";
import type { Metadata } from "next";

import { ProductAnalysisWorkbench } from "@/components/analysis/product-analysis-workbench";
import { HeroPanel, PageContainer, TopNav } from "@/components/common/ui";
import { getAnalysisPageData } from "@/lib/workbench";
import { absoluteAppUrl, stageLabel } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProductPageProps = {
  params: Promise<{ asin: string }>;
  searchParams: Promise<{ analysisId?: string }>;
};

const getPageData = cache(async (analysisId: string, asin: string) => {
  if (!analysisId) {
    return null;
  }

  return getAnalysisPageData(analysisId, asin);
});

function resolveImageUrl(value?: string | null) {
  if (!value || value.startsWith("data:image")) {
    return "/favicon.ico";
  }

  return value;
}

export async function generateMetadata({ params, searchParams }: ProductPageProps): Promise<Metadata> {
  const resolvedParams = await params;
  const resolvedSearch = await searchParams;
  const analysisId = resolvedSearch.analysisId || "";
  const data = await getPageData(analysisId, resolvedParams.asin);

  if (!data) {
    return {
      title: "商品分析",
      description: "Amazon 选品分析页。",
      robots: {
        index: false,
        follow: false,
      },
    };
  }

  const title = `${data.product.title} · ${stageLabel(data.analysis.lifecycle.stage)}`;
  const description = `${data.analysis.summary} ${data.analysis.recommendation}`.trim();

  return {
    title,
    description,
    robots: {
      index: false,
      follow: false,
    },
    alternates: {
      canonical: `/product/${resolvedParams.asin}?analysisId=${analysisId}`,
    },
    openGraph: {
      title,
      description,
      type: "article",
      url: `${absoluteAppUrl()}/product/${resolvedParams.asin}?analysisId=${analysisId}`,
      images: [resolveImageUrl(data.product.imageUrl)],
    },
  };
}

export default async function ProductPage({ params, searchParams }: ProductPageProps) {
  const resolvedParams = await params;
  const resolvedSearch = await searchParams;
  const analysisId = resolvedSearch.analysisId || "";
  const data = await getPageData(analysisId, resolvedParams.asin);
  const isDemo = Boolean(data?.demoCase);

  return (
    <div className="flex min-h-screen flex-col pb-16">
      <TopNav />
      <main className="flex-1 py-8 sm:py-10">
        <PageContainer className="space-y-8">
          <HeroPanel
            eyebrow={isDemo ? "Sample Analysis" : "Market Report"}
            title={isDemo ? "示例分析报告" : "Amazon US 市场分析报告"}
            description={
              data
                ? `${data.product.title} · ${data.product.category ?? "未分类"} · ASIN ${data.product.asin}`
                : "Amazon US 产品研究"
            }
          />
          <ProductAnalysisWorkbench key={analysisId || resolvedParams.asin} initialData={data} />
        </PageContainer>
      </main>
    </div>
  );
}
