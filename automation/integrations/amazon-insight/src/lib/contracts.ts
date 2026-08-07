import { z } from "zod";

export const modeSchema = z.enum(["live", "mock", "rule_based", "unavailable"]);
export const sourceStatusSchema = z.enum([
  "configured",
  "partial",
  "missing",
  "error",
]);
export const signalLevelSchema = z.enum(["low", "medium", "high"]);
export const lifecycleStageSchema = z.enum([
  "introduction",
  "growth",
  "maturity",
  "decline",
  "uncertain",
]);
export const cacheStateSchema = z.enum(["hit", "miss", "refresh"]);
export const listingSignalSourceSchema = z.enum(["live", "demo_seed", "rule_based"]);
export const reviewCoverageSchema = z.enum([
  "direct_reviews",
  "seeded_summary",
  "manual_summary",
  "heuristic_only",
  "none",
]);
export const reviewRetrievalModeSchema = z.enum([
  "live",
  "demo_seed",
  "manual",
  "heuristic",
  "unavailable",
]);
export const pricePositioningSchema = z.enum([
  "budget",
  "mid",
  "premium",
  "unknown",
]);

export const freshnessSchema = z.object({
  label: z.string(),
  generatedAt: z.string(),
  expiresAt: z.string().nullable(),
  isStale: z.boolean(),
});

export const dataSourceSchema = z.object({
  source: z.enum(["junglescout", "amazon-spapi", "manual", "template-llm"]),
  label: z.string(),
  mode: modeSchema,
  status: sourceStatusSchema,
  freshness: z.string(),
  details: z.array(z.string()),
});

export const cacheStatusSchema = z.object({
  state: cacheStateSchema,
  key: z.string(),
  expiresAt: z.string().nullable(),
});

export const candidateKeywordSchema = z.object({
  keyword: z.string(),
  searchVolume: z.number().nullable(),
  trend: z.string().nullable(),
  difficulty: z.string().nullable(),
  relevance: z.number().nullable(),
  cpc: z.number().nullable(),
  rawJson: z.unknown().optional(),
});

export const candidateProductSchema = z.object({
  asin: z.string(),
  title: z.string(),
  brand: z.string().nullable(),
  imageUrl: z.string().nullable(),
  price: z.number().nullable(),
  rating: z.number().nullable(),
  reviews: z.number().nullable(),
  category: z.string().nullable(),
  monthlyUnits: z.number().nullable(),
  monthlyRevenue: z.number().nullable(),
  sourceKeyword: z.string().nullable(),
  relevanceHint: z.string().nullable(),
  rawJson: z.unknown().optional(),
});

export const trendPointSchema = z.object({
  date: z.string(),
  value: z.number(),
  label: z.string(),
});

export const lifecycleSchema = z.object({
  stage: lifecycleStageSchema,
  confidence: signalLevelSchema,
  evidence: z.array(z.string()),
  missingData: z.array(z.string()),
});

export const competitionSchema = z.object({
  level: signalLevelSchema,
  entryDifficulty: signalLevelSchema,
  differentiationRoom: signalLevelSchema,
  evidence: z.array(z.string()),
});

export const marketOverviewSchema = z.object({
  marketHeat: signalLevelSchema,
  entryBarrier: signalLevelSchema,
  differentiationRoom: signalLevelSchema,
  opportunityLevel: signalLevelSchema,
  summary: z.string(),
  recommendation: z.string(),
  metrics: z.object({
    searchTrendDelta: z.number().nullable(),
    salesTrendDelta: z.number().nullable(),
    brandConcentration: z.number().nullable(),
    reviewBarrier: z.number().nullable(),
    priceSpread: z.number().nullable(),
  }),
});

export const productSnapshotSchema = z.object({
  sellerType: z.string().nullable(),
  sellerCount: z.number().nullable(),
  variantCount: z.number().nullable(),
  listingQualityScore: z.number().nullable(),
  productRank: z.number().nullable(),
  sizeTier: z.string().nullable(),
  pricePositioning: pricePositioningSchema,
  ageMonths: z.number().nullable(),
  firstAvailable: z.string().nullable(),
  dimensionsSummary: z.string().nullable(),
  flags: z.array(z.string()),
});

export const listingAnalysisSchema = z.object({
  source: listingSignalSourceSchema,
  confidence: signalLevelSchema,
  summary: z.string(),
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
  warnings: z.array(z.string()),
});

export const reviewAnalysisSchema = z.object({
  retrievalMode: reviewRetrievalModeSchema,
  coverage: reviewCoverageSchema,
  confidence: signalLevelSchema,
  summary: z.string(),
  painPoints: z.array(z.string()),
  purchaseDrivers: z.array(z.string()),
  risks: z.array(z.string()),
  notes: z.array(z.string()),
});

export const demoCaseSchema = z.object({
  id: z.string(),
  label: z.string(),
  asin: z.string(),
  title: z.string(),
  category: z.string(),
  explanation: z.string(),
  whyUseful: z.string(),
});

export const explanationMetaSchema = z.object({
  ruleBased: z.boolean(),
  llmAssisted: z.boolean(),
  manualInputsUsed: z.array(z.string()),
  generatedAt: z.string(),
  notes: z.array(z.string()),
});

export const manualInputsSchema = z.object({
  manualListingText: z.string().optional().default(""),
  manualAPlusText: z.string().optional().default(""),
  manualReviewText: z.string().optional().default(""),
  notes: z.string().optional().default(""),
});

export const searchRequestSchema = z.object({
  keyword: z.string().min(2).max(120),
  forceRefresh: z.boolean().optional().default(false),
});

export const analyzeRequestSchema = z.object({
  searchId: z.string().min(1),
  primaryKeyword: z.string().min(2).max(120),
  primaryAsin: z.string().min(1),
  compareAsins: z.array(z.string().min(1)).max(2).optional().default([]),
  forceRefresh: z.boolean().optional().default(false),
});

export const inspirationRequestSchema = z.object({
  analysisId: z.string().min(1),
  asin: z.string().min(1),
  manualListingText: z.string().optional().default(""),
  manualAPlusText: z.string().optional().default(""),
  manualReviewText: z.string().optional().default(""),
  notes: z.string().optional().default(""),
});

export const briefReportRequestSchema = z.object({
  analysisId: z.string().min(1),
  asin: z.string().min(1),
  notes: z.string().optional().default(""),
  forceRefresh: z.boolean().optional().default(false),
});

export const productPoolItemSchema = z.object({
  id: z.string(),
  asin: z.string(),
  title: z.string(),
  brand: z.string().nullable(),
  imageUrl: z.string().nullable(),
  price: z.number().nullable(),
  rating: z.number().nullable(),
  reviews: z.number().nullable(),
  category: z.string().nullable(),
  monthlyUnits: z.number().nullable(),
  monthlyRevenue: z.number().nullable(),
  sourceKeyword: z.string().nullable(),
  relevanceHint: z.string().nullable(),
  sourceSearchId: z.string().nullable(),
  sourceMode: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const poolUpsertRequestSchema = z.object({
  searchId: z.string().optional(),
  sourceMode: modeSchema.optional(),
  product: candidateProductSchema,
});

export const poolListResponseSchema = z.object({
  items: z.array(productPoolItemSchema),
});

export const searchResponseSchema = z.object({
  searchId: z.string(),
  normalizedKeyword: z.string(),
  keywords: z.array(candidateKeywordSchema),
  products: z.array(candidateProductSchema),
  freshness: freshnessSchema,
  sourceStatus: sourceStatusSchema,
  mode: modeSchema,
  dataSources: z.array(dataSourceSchema),
});

export const analysisResponseSchema = z.object({
  analysisId: z.string(),
  lifecycle: lifecycleSchema,
  competition: competitionSchema,
  marketOverview: marketOverviewSchema,
  recommendation: z.string(),
  summary: z.string(),
  trendSeries: z.array(trendPointSchema),
  productSnapshot: productSnapshotSchema.nullable().optional(),
  listingAnalysis: listingAnalysisSchema.nullable().optional(),
  reviewAnalysis: reviewAnalysisSchema.nullable().optional(),
  demoCase: demoCaseSchema.nullable().optional(),
  explanationMeta: explanationMetaSchema,
  dataSources: z.array(dataSourceSchema),
  cacheStatus: cacheStatusSchema,
  missingData: z.array(z.string()),
  mode: modeSchema,
});

export const inspirationResponseSchema = z.object({
  inspirationId: z.string(),
  audience: z.string(),
  purchaseDrivers: z.array(z.string()),
  valueProps: z.array(z.string()),
  painPoints: z.array(z.string()),
  differentiationIdeas: z.array(z.string()),
  listingAngles: z.array(z.string()),
  visualAngles: z.array(z.string()),
  generationMeta: z.object({
    provider: z.string(),
    mode: modeSchema.or(z.literal("rule_based")),
    manualInputsUsed: z.array(z.string()),
    notes: z.array(z.string()),
    generatedAt: z.string(),
  }),
  mode: modeSchema.or(z.literal("rule_based")),
});

export const briefReportResponseSchema = z.object({
  reportId: z.string(),
  headline: z.string(),
  verdict: z.string(),
  summary: z.string(),
  keySignals: z.array(z.string()),
  risks: z.array(z.string()),
  nextSteps: z.array(z.string()),
  generationMeta: z.object({
    provider: z.string(),
    model: z.string().nullable().optional(),
    mode: modeSchema.or(z.literal("rule_based")),
    manualInputsUsed: z.array(z.string()),
    notes: z.array(z.string()),
    generatedAt: z.string(),
  }),
  mode: modeSchema.or(z.literal("rule_based")),
});

export const briefReportPayloadSchema = briefReportResponseSchema.omit({
  reportId: true,
});

export const analysisContextSchema = z.object({
  searchId: z.string(),
  primaryKeyword: z.string(),
  primaryAsin: z.string(),
  compareAsins: z.array(z.string()),
});

export const analysisPageDataSchema = z.object({
  analysis: analysisResponseSchema,
  product: candidateProductSchema,
  compareProducts: z.array(candidateProductSchema),
  analysisContext: analysisContextSchema,
  latestInspiration: inspirationResponseSchema.nullable(),
  spApiStatus: dataSourceSchema,
  demoCase: demoCaseSchema.nullable().optional(),
});

export type ApiMode = z.infer<typeof modeSchema>;
export type SourceStatus = z.infer<typeof sourceStatusSchema>;
export type SignalLevel = z.infer<typeof signalLevelSchema>;
export type LifecycleStage = z.infer<typeof lifecycleStageSchema>;
export type Freshness = z.infer<typeof freshnessSchema>;
export type DataSourceStatus = z.infer<typeof dataSourceSchema>;
export type CacheStatus = z.infer<typeof cacheStatusSchema>;
export type CandidateKeyword = z.infer<typeof candidateKeywordSchema>;
export type CandidateProduct = z.infer<typeof candidateProductSchema>;
export type TrendPoint = z.infer<typeof trendPointSchema>;
export type LifecycleAnalysis = z.infer<typeof lifecycleSchema>;
export type CompetitionAnalysis = z.infer<typeof competitionSchema>;
export type MarketOverview = z.infer<typeof marketOverviewSchema>;
export type ProductSnapshot = z.infer<typeof productSnapshotSchema>;
export type ListingAnalysis = z.infer<typeof listingAnalysisSchema>;
export type ReviewAnalysis = z.infer<typeof reviewAnalysisSchema>;
export type DemoCaseMeta = z.infer<typeof demoCaseSchema>;
export type ExplanationMeta = z.infer<typeof explanationMetaSchema>;
export type SearchRequest = z.infer<typeof searchRequestSchema>;
export type AnalyzeRequest = z.infer<typeof analyzeRequestSchema>;
export type InspirationRequest = z.infer<typeof inspirationRequestSchema>;
export type BriefReportRequest = z.infer<typeof briefReportRequestSchema>;
export type SearchResponse = z.infer<typeof searchResponseSchema>;
export type AnalysisResponse = z.infer<typeof analysisResponseSchema>;
export type InspirationResponse = z.infer<typeof inspirationResponseSchema>;
export type BriefReportResponse = z.infer<typeof briefReportResponseSchema>;
export type BriefReportPayload = z.infer<typeof briefReportPayloadSchema>;
export type ProductPoolItem = z.infer<typeof productPoolItemSchema>;
export type PoolUpsertRequest = z.infer<typeof poolUpsertRequestSchema>;
export type PoolListResponse = z.infer<typeof poolListResponseSchema>;
export type ManualInputs = z.infer<typeof manualInputsSchema>;
export type AnalysisContext = z.infer<typeof analysisContextSchema>;
export type AnalysisPageData = z.infer<typeof analysisPageDataSchema>;
