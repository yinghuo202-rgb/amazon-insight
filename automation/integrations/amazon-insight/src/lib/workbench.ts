import {
  analysisContextSchema,
  analysisPageDataSchema,
  analysisResponseSchema,
  type AnalyzeRequest,
  candidateProductSchema,
  cacheStatusSchema,
  type CandidateProduct,
  explanationMetaSchema,
  type InspirationRequest,
  inspirationResponseSchema,
  manualInputsSchema,
  searchResponseSchema,
  type SearchRequest,
} from "@/lib/contracts";
import { analyzeCompetition, analyzeLifecycle, buildMarketOverview } from "@/lib/analysis";
import { getSpApiStatus } from "@/lib/amazon-spapi/client";
import { getCache, pruneExpiredCache, setCache } from "@/lib/cache/store";
import { prisma } from "@/lib/db/prisma";
import { getDemoCasePageData, isDemoAnalysisId } from "@/lib/demo/cases";
import {
  buildJungleScoutDataSource,
  discoverFromSeedKeyword,
  getMarketSignals,
  JungleScoutError,
} from "@/lib/junglescout/client";
import { getLlmAdapter } from "@/lib/llm/client";
import { buildListingAnalysis, buildReviewAnalysis, extractProductSnapshot } from "@/lib/product-signals";
import { buildFreshness, normalizeKeyword, parseJsonValue } from "@/lib/utils";

const SEARCH_TTL_HOURS = 24;
const ANALYSIS_TTL_HOURS = 24;

function mapApiError(error: unknown) {
  if (error instanceof JungleScoutError) {
    return {
      message: error.message,
      code: error.code,
      status: error.status ?? 500,
    };
  }

  if (error instanceof Error) {
    return {
      message: error.message,
      code: "internal_error",
      status: 500,
    };
  }

  return {
    message: "未知错误",
    code: "unknown_error",
    status: 500,
  };
}

function makeCacheKey(parts: Array<string | string[]>) {
  return parts
    .flatMap((part) => (Array.isArray(part) ? [...part].sort() : part))
    .join("::");
}

async function persistSearchResult(input: {
  keyword: string;
  normalizedKeyword: string;
  mode: string;
  keywords: Array<{
    keyword: string;
    searchVolume: number | null;
    trend: string | null;
    difficulty: string | null;
    relevance: number | null;
    cpc: number | null;
    rawJson?: unknown;
  }>;
  products: CandidateProduct[];
}) {
  return prisma.seedSearch.create({
    data: {
      keyword: input.keyword,
      normalizedKeyword: input.normalizedKeyword,
      sourceMode: input.mode,
      candidateKeywords: {
        create: input.keywords.map((keyword) => ({
          keyword: keyword.keyword,
          searchVolume: keyword.searchVolume,
          trend: keyword.trend,
          difficulty: keyword.difficulty,
          relevance: keyword.relevance,
          cpc: keyword.cpc,
          rawJson: keyword.rawJson ? JSON.stringify(keyword.rawJson) : null,
        })),
      },
      candidateProducts: {
        create: input.products.map((product) => ({
          asin: product.asin,
          title: product.title,
          brand: product.brand,
          imageUrl: product.imageUrl,
          price: product.price,
          rating: product.rating,
          reviews: product.reviews,
          category: product.category,
          monthlyUnits: product.monthlyUnits,
          monthlyRevenue: product.monthlyRevenue,
          sourceKeyword: product.sourceKeyword,
          relevanceHint: product.relevanceHint,
          rawJson: product.rawJson ? JSON.stringify(product.rawJson) : null,
        })),
      },
    },
    include: {
      candidateKeywords: true,
      candidateProducts: true,
    },
  });
}

function buildAnalysisDataSources(
  mode: "live" | "mock",
  sourceStatus: "configured" | "partial" | "missing" | "error",
  diagnostics: string[],
) {
  return [buildJungleScoutDataSource(mode, sourceStatus, diagnostics), getSpApiStatus()];
}

function parseStoredProducts(
  products: Array<{
    asin: string;
    title: string;
    brand: string | null;
    imageUrl: string | null;
    price: number | null;
    rating: number | null;
    reviews: number | null;
    category: string | null;
    monthlyUnits: number | null;
    monthlyRevenue: number | null;
    sourceKeyword: string | null;
    relevanceHint: string | null;
    rawJson: string | null;
  }>,
) {
  return products.map((product) =>
    candidateProductSchema.parse({
      asin: product.asin,
      title: product.title,
      brand: product.brand,
      imageUrl: product.imageUrl,
      price: product.price,
      rating: product.rating,
      reviews: product.reviews,
      category: product.category,
      monthlyUnits: product.monthlyUnits,
      monthlyRevenue: product.monthlyRevenue,
      sourceKeyword: product.sourceKeyword,
      relevanceHint: product.relevanceHint,
      rawJson: parseJsonValue(product.rawJson, null),
    }),
  );
}

export async function executeSearch(input: SearchRequest) {
  await pruneExpiredCache();

  const normalizedKeyword = normalizeKeyword(input.keyword);
  const cacheKey = makeCacheKey([normalizedKeyword]);
  const cached = input.forceRefresh
    ? null
    : await getCache<ReturnType<typeof searchResponseSchema.parse>>("search", cacheKey);

  if (cached) {
    const parsed = searchResponseSchema.parse(cached);
    return {
      ...parsed,
      freshness: {
        ...parsed.freshness,
        label: "命中 24 小时缓存",
      },
    };
  }

  const discovery = await discoverFromSeedKeyword(normalizedKeyword);
  const search = await persistSearchResult({
    keyword: input.keyword,
    normalizedKeyword,
    mode: discovery.mode,
    keywords: discovery.keywords,
    products: discovery.products,
  });

  const response = searchResponseSchema.parse({
    searchId: search.id,
    normalizedKeyword,
    keywords: discovery.keywords,
    products: discovery.products,
    freshness: buildFreshness(SEARCH_TTL_HOURS, "实时结果"),
    sourceStatus: discovery.sourceStatus,
    mode: discovery.mode,
    dataSources: [buildJungleScoutDataSource(discovery.mode, discovery.sourceStatus, discovery.diagnostics)],
  });

  await setCache("search", cacheKey, response, SEARCH_TTL_HOURS);

  return response;
}

export async function executeAnalysis(input: AnalyzeRequest) {
  await pruneExpiredCache();

  const cacheKey = makeCacheKey([
    input.searchId,
    normalizeKeyword(input.primaryKeyword),
    input.primaryAsin,
    input.compareAsins,
  ]);
  const cached = input.forceRefresh
    ? null
    : await getCache<ReturnType<typeof analysisResponseSchema.parse>>("analysis", cacheKey);

  if (cached) {
    const parsed = analysisResponseSchema.parse(cached);
    return {
      ...parsed,
      cacheStatus: cacheStatusSchema.parse({
        state: "hit",
        key: cacheKey,
        expiresAt: parsed.cacheStatus.expiresAt,
      }),
    };
  }

  const search = await prisma.seedSearch.findUnique({
    where: { id: input.searchId },
    include: { candidateProducts: true },
  });

  if (!search) {
    throw new Error("没有找到对应的搜索结果，请重新搜索。");
  }

  const products = parseStoredProducts(search.candidateProducts);
  const primaryProduct = products.find((product) => product.asin === input.primaryAsin);
  if (!primaryProduct) {
    throw new Error("主商品不在当前搜索结果里，请重新选择。");
  }

  const compareProducts = products.filter((product) => input.compareAsins.includes(product.asin));

  const marketSignals = await getMarketSignals({
    primaryKeyword: input.primaryKeyword,
    primaryProduct,
    compareProducts,
  });

  const lifecycle = analyzeLifecycle({
    trendSeries: marketSignals.searchTrendSeries,
    salesSeries: marketSignals.salesTrendSeries,
    primaryProduct,
    compareProducts,
    shareOfVoice: marketSignals.shareOfVoice,
  });
  const competition = analyzeCompetition({
    primaryProduct,
    compareProducts,
    shareOfVoice: marketSignals.shareOfVoice,
  });
  const marketOverview = buildMarketOverview({
    lifecycle,
    competition,
    trendSeries: marketSignals.searchTrendSeries,
    salesSeries: marketSignals.salesTrendSeries,
    shareOfVoice: marketSignals.shareOfVoice,
    primaryProduct,
    compareProducts,
  });
  const productSnapshot = extractProductSnapshot({
    product: primaryProduct,
    compareProducts,
  });
  const listingAnalysis = buildListingAnalysis({
    product: primaryProduct,
    compareProducts,
    snapshot: productSnapshot,
  });
  const reviewAnalysis = buildReviewAnalysis({
    product: primaryProduct,
    compareProducts,
  });

  const explanationMeta = explanationMetaSchema.parse({
    ruleBased: true,
    llmAssisted: false,
    manualInputsUsed: [],
    generatedAt: new Date().toISOString(),
    notes: [
      "生命周期、竞争结构和市场建议来自规则层。",
      "Listing 分析优先使用商品字段；评论分析目前仍以启发式信号为主。",
      "LLM 适配层已经保留，但当前没有调用外部模型。",
    ],
  });

  const dataSources = buildAnalysisDataSources(
    marketSignals.mode as "live" | "mock",
    marketSignals.sourceStatus,
    marketSignals.diagnostics,
  );

  const missingData = Array.from(
    new Set([
      ...lifecycle.missingData,
      ...(reviewAnalysis.coverage === "heuristic_only" ? ["暂无直接评论文本。"] : []),
      ...(listingAnalysis.source === "rule_based" ? ["Listing 字段覆盖有限。"] : []),
    ]),
  );

  const draftResponse = {
    analysisId: "",
    lifecycle,
    competition,
    marketOverview,
    recommendation: marketOverview.recommendation,
    summary: marketOverview.summary,
    trendSeries: marketSignals.searchTrendSeries,
    productSnapshot,
    listingAnalysis,
    reviewAnalysis,
    demoCase: null,
    explanationMeta,
    dataSources,
    cacheStatus: {
      state: input.forceRefresh ? "refresh" : "miss",
      key: cacheKey,
      expiresAt: new Date(Date.now() + ANALYSIS_TTL_HOURS * 60 * 60 * 1000).toISOString(),
    },
    missingData,
    mode: marketSignals.mode,
  };

  const created = await prisma.productAnalysis.create({
    data: {
      asin: input.primaryAsin,
      searchId: input.searchId,
      primaryKeyword: normalizeKeyword(input.primaryKeyword),
      compareAsinsJson: JSON.stringify(input.compareAsins),
      lifecycleStage: lifecycle.stage,
      lifecycleConfidence: lifecycle.confidence,
      competitionLevel: competition.level,
      opportunityLevel: marketOverview.opportunityLevel,
      summary: marketOverview.summary,
      recommendation: marketOverview.recommendation,
      responseJson: JSON.stringify(draftResponse),
      contextJson: JSON.stringify({
        searchId: input.searchId,
        primaryKeyword: normalizeKeyword(input.primaryKeyword),
        primaryAsin: input.primaryAsin,
        compareAsins: input.compareAsins,
      }),
      rawMetricsJson: JSON.stringify({
        shareOfVoice: marketSignals.shareOfVoice,
        salesTrendSeries: marketSignals.salesTrendSeries,
        keywordAssociations: marketSignals.keywordAssociations,
      }),
    },
  });

  const response = analysisResponseSchema.parse({
    ...draftResponse,
    analysisId: created.id,
  });

  await prisma.productAnalysis.update({
    where: { id: created.id },
    data: {
      responseJson: JSON.stringify(response),
    },
  });

  await setCache("analysis", cacheKey, response, ANALYSIS_TTL_HOURS);

  return response;
}

export async function executeInspiration(input: InspirationRequest) {
  const manualInputs = manualInputsSchema.parse(input);

  if (isDemoAnalysisId(input.analysisId)) {
    const demoData = getDemoCasePageData(input.analysisId, input.asin);
    if (!demoData) {
      throw new Error("没有找到对应的 demo 案例。");
    }

    const adapter = getLlmAdapter();
    return inspirationResponseSchema.parse({
      inspirationId: `${input.analysisId}:${Date.now()}`,
      ...(await adapter.generateInspiration({
        product: demoData.product,
        analysis: demoData.analysis,
        manualInputs,
      })),
    });
  }

  const analysisRecord = await prisma.productAnalysis.findUnique({
    where: { id: input.analysisId },
    include: {
      search: {
        include: {
          candidateProducts: true,
        },
      },
      inspirations: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  if (!analysisRecord) {
    throw new Error("没有找到分析记录，请重新生成分析。");
  }

  const productRecord = analysisRecord.search.candidateProducts.find((product) => product.asin === input.asin);

  if (!productRecord) {
    throw new Error("没有找到对应商品，请回到搜索页重新选择。");
  }

  const analysis = analysisResponseSchema.parse(parseJsonValue(analysisRecord.responseJson, {}));
  const product = candidateProductSchema.parse({
    asin: productRecord.asin,
    title: productRecord.title,
    brand: productRecord.brand,
    imageUrl: productRecord.imageUrl,
    price: productRecord.price,
    rating: productRecord.rating,
    reviews: productRecord.reviews,
    category: productRecord.category,
    monthlyUnits: productRecord.monthlyUnits,
    monthlyRevenue: productRecord.monthlyRevenue,
    sourceKeyword: productRecord.sourceKeyword,
    relevanceHint: productRecord.relevanceHint,
    rawJson: parseJsonValue(productRecord.rawJson, null),
  });

  const adapter = getLlmAdapter();
  const generated = await adapter.generateInspiration({
    product,
    analysis,
    manualInputs,
  });

  const created = await prisma.productInspiration.create({
    data: {
      asin: input.asin,
      analysisId: input.analysisId,
      audience: generated.audience,
      purchaseDriversJson: JSON.stringify(generated.purchaseDrivers),
      valuePropsJson: JSON.stringify(generated.valueProps),
      painPointsJson: JSON.stringify(generated.painPoints),
      differentiationIdeasJson: JSON.stringify(generated.differentiationIdeas),
      listingAnglesJson: JSON.stringify(generated.listingAngles),
      visualAnglesJson: JSON.stringify(generated.visualAngles),
      generationMetaJson: JSON.stringify(generated.generationMeta),
      manualInputsJson: JSON.stringify(manualInputs),
      responseJson: JSON.stringify(generated),
    },
  });

  return inspirationResponseSchema.parse({
    inspirationId: created.id,
    ...generated,
  });
}

export async function getAnalysisPageData(analysisId: string, asin: string) {
  if (isDemoAnalysisId(analysisId)) {
    return getDemoCasePageData(analysisId, asin);
  }

  const record = await prisma.productAnalysis.findUnique({
    where: { id: analysisId },
    include: {
      search: {
        include: {
          candidateProducts: true,
        },
      },
      inspirations: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  if (!record) {
    return null;
  }

  const context = analysisContextSchema.parse(parseJsonValue(record.contextJson, {}));
  const products = parseStoredProducts(record.search.candidateProducts);
  const product = products.find((entry) => entry.asin === asin);
  if (!product) {
    return null;
  }

  const compareProducts = products.filter((entry) => context.compareAsins.includes(entry.asin));
  const latestInspiration = record.inspirations[0]
    ? inspirationResponseSchema.parse(parseJsonValue(record.inspirations[0].responseJson, {}))
    : null;

  const analysis = analysisResponseSchema.parse(parseJsonValue(record.responseJson, {}));

  return analysisPageDataSchema.parse({
    analysis,
    product,
    compareProducts,
    analysisContext: context,
    latestInspiration,
    spApiStatus: getSpApiStatus(),
    demoCase: analysis.demoCase ?? null,
  });
}

export function getErrorResponse(error: unknown) {
  return mapApiError(error);
}
