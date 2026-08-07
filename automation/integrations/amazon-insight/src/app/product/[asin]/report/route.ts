import { NextResponse } from "next/server";

import { renderAnalysisHtmlReport } from "@/lib/report-html";
import { getAnalysisPageData } from "@/lib/workbench";
import { absoluteAppUrl } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ asin: string }> },
) {
  const resolvedParams = await params;
  const { searchParams } = new URL(request.url);
  const analysisId = searchParams.get("analysisId") || "";

  if (!analysisId) {
    return NextResponse.json({ error: "缺少 analysisId 参数。" }, { status: 400 });
  }

  const data = await getAnalysisPageData(analysisId, resolvedParams.asin);
  if (!data) {
    return NextResponse.json({ error: "没有找到对应的分析结果。" }, { status: 404 });
  }

  const pageUrl = `${absoluteAppUrl()}/product/${resolvedParams.asin}?analysisId=${encodeURIComponent(analysisId)}`;
  const html = renderAnalysisHtmlReport({
    data,
    pageUrl,
    exportedAt: new Date(),
  });

  const shouldDownload = searchParams.get("download") === "1";
  const filename = `analysis-${resolvedParams.asin}.html`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": shouldDownload ? `attachment; filename="${filename}"` : `inline; filename="${filename}"`,
    },
  });
}
