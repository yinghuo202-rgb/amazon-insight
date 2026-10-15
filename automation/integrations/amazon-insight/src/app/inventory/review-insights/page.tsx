import type { Metadata } from "next";

import { OpsPageHeader } from "@/components/inventory/ops-ui";
import { ReviewInsightsBoard } from "@/components/inventory/review-insights-board";

export const metadata: Metadata = { title: "评论调研", description: "查看亚马逊授权评论主题与趋势。" };
export const dynamic = "force-dynamic";

export default async function ReviewInsightsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const search = await searchParams;
  const asin = typeof search.asin === "string" ? search.asin.trim().toUpperCase() : "";
  return <>
    <OpsPageHeader eyebrow="PRODUCT RESEARCH" title="评论调研" description="按 ASIN 查看买家反馈主题，结合经营数据判断需要验证的产品问题。" />
    <ReviewInsightsBoard initialAsin={/^[A-Z0-9]{10}$/.test(asin) ? asin : ""} />
  </>;
}
