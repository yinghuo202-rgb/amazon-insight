import { getCache, pruneExpiredCache, setCache } from "@/lib/cache/store";
import {
  briefReportResponseSchema,
  type BriefReportRequest,
} from "@/lib/contracts";
import { getLlmAdapter } from "@/lib/llm/client";
import { hashString } from "@/lib/utils";
import { getAnalysisPageData } from "@/lib/workbench";

const BRIEF_REPORT_TTL_HOURS = 24;

function makeCacheKey(input: BriefReportRequest) {
  return [input.analysisId, input.asin, input.notes.trim()].join("::");
}

export async function executeBriefReport(input: BriefReportRequest) {
  await pruneExpiredCache();

  const normalizedInput = {
    ...input,
    notes: input.notes.trim(),
  };
  const cacheKey = makeCacheKey(normalizedInput);
  const cached = normalizedInput.forceRefresh
    ? null
    : await getCache<ReturnType<typeof briefReportResponseSchema.parse>>("brief_report", cacheKey);

  if (cached) {
    return briefReportResponseSchema.parse(cached);
  }

  const pageData = await getAnalysisPageData(normalizedInput.analysisId, normalizedInput.asin);
  if (!pageData) {
    throw new Error("没有找到对应的分析页数据，请重新生成分析。");
  }

  const adapter = getLlmAdapter();
  const generated = await adapter.generateBriefReport({
    product: pageData.product,
    compareProducts: pageData.compareProducts,
    analysis: pageData.analysis,
    notes: normalizedInput.notes,
  });

  const response = briefReportResponseSchema.parse({
    reportId: `brief:${hashString(cacheKey)}`,
    ...generated,
  });

  await setCache("brief_report", cacheKey, response, BRIEF_REPORT_TTL_HOURS);

  return response;
}
