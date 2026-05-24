import { describe, expect, it } from "vitest";

import {
  analyzeCompetition,
  analyzeLifecycle,
  buildMarketOverview,
  buildTemplateInspiration,
} from "@/lib/analysis";
import { candidateProductSchema } from "@/lib/contracts";
import { getDemoCaseCards, getDemoCasePageData } from "@/lib/demo/cases";
import {
  buildListingAnalysis,
  buildReviewAnalysis,
  extractProductSnapshot,
} from "@/lib/product-signals";
import { normalizeKeyword } from "@/lib/utils";

const primaryProduct = candidateProductSchema.parse({
  asin: "B01234567",
  title: "Portable Blender Travel Bottle USB-C Edition",
  brand: "North Harbor",
  imageUrl: "mock",
  price: 39.99,
  rating: 4.4,
  reviews: 420,
  category: "Home & Kitchen",
  monthlyUnits: 920,
  monthlyRevenue: 36790,
  sourceKeyword: "portable blender",
  relevanceHint: "核心关键词贴近",
  rawJson: {
    seller_type: "FBA",
    number_of_sellers: 3,
    variants: [{ id: 1 }, { id: 2 }],
    listing_quality_score: 72,
    product_rank: 512,
    product_tier: "Small Standard-Size",
    date_first_available: "2024-01-01",
    length_value: 4.8,
    width_value: 4.8,
    height_value: 9.6,
    dimensions_unit: "in",
  },
});

const compareProducts = [
  candidateProductSchema.parse({
    asin: "B07654321",
    title: "Portable Blender USB-C Edition",
    brand: "LumaNest",
    imageUrl: "mock",
    price: 34.99,
    rating: 4.3,
    reviews: 860,
    category: "Home & Kitchen",
    monthlyUnits: 760,
    monthlyRevenue: 26590,
    sourceKeyword: "portable blender",
    relevanceHint: "适合作为参考竞品",
  }),
];

const trendSeries = Array.from({ length: 12 }).map((_, index) => ({
  date: new Date(2025, index, 1).toISOString(),
  value: 1000 + index * 140,
  label: `2025-${index + 1}`,
}));

const salesSeries = Array.from({ length: 12 }).map((_, index) => ({
  date: new Date(2025, index, 1).toISOString(),
  value: 220 + index * 28,
  label: `2025-${index + 1}`,
}));

describe("utility", () => {
  it("normalizes keywords by trimming and lowercasing", () => {
    expect(normalizeKeyword("  Portable   Blender ")).toBe("portable blender");
  });
});

describe("analysis rules", () => {
  it("produces a lifecycle assessment with evidence", () => {
    const lifecycle = analyzeLifecycle({
      trendSeries,
      salesSeries,
      primaryProduct,
      compareProducts,
      shareOfVoice: [
        { brand: "North Harbor", share: 28 },
        { brand: "LumaNest", share: 22 },
        { brand: "Arbor Peak", share: 16 },
      ],
    });

    expect(lifecycle.stage).toBe("growth");
    expect(lifecycle.evidence.length).toBeGreaterThan(2);
  });

  it("produces competition and market overview", () => {
    const competition = analyzeCompetition({
      primaryProduct,
      compareProducts,
      shareOfVoice: [
        { brand: "North Harbor", share: 48 },
        { brand: "LumaNest", share: 20 },
        { brand: "Arbor Peak", share: 11 },
      ],
    });
    const lifecycle = analyzeLifecycle({
      trendSeries,
      salesSeries,
      primaryProduct,
      compareProducts,
      shareOfVoice: [
        { brand: "North Harbor", share: 48 },
        { brand: "LumaNest", share: 20 },
        { brand: "Arbor Peak", share: 11 },
      ],
    });
    const overview = buildMarketOverview({
      lifecycle,
      competition,
      trendSeries,
      salesSeries,
      shareOfVoice: [
        { brand: "North Harbor", share: 48 },
        { brand: "LumaNest", share: 20 },
        { brand: "Arbor Peak", share: 11 },
      ],
      primaryProduct,
      compareProducts,
    });

    expect(competition.level).toMatch(/low|medium|high/);
    expect(overview.recommendation.length).toBeGreaterThan(10);
  });
});

describe("product signals", () => {
  it("extracts product snapshot from raw product attributes", () => {
    const snapshot = extractProductSnapshot({
      product: primaryProduct,
      compareProducts,
    });

    expect(snapshot.sellerType).toBe("FBA");
    expect(snapshot.variantCount).toBe(2);
    expect(snapshot.listingQualityScore).toBe(72);
  });

  it("builds listing and review analysis without direct review text", () => {
    const snapshot = extractProductSnapshot({
      product: primaryProduct,
      compareProducts,
    });
    const listing = buildListingAnalysis({
      product: primaryProduct,
      compareProducts,
      snapshot,
    });
    const review = buildReviewAnalysis({
      product: primaryProduct,
      compareProducts,
    });

    expect(listing.summary.length).toBeGreaterThan(10);
    expect(review.coverage).toBe("heuristic_only");
  });
});

describe("template inspiration", () => {
  it("generates structured inspiration without external LLM", () => {
    const competition = analyzeCompetition({
      primaryProduct,
      compareProducts,
      shareOfVoice: [
        { brand: "North Harbor", share: 32 },
        { brand: "LumaNest", share: 19 },
        { brand: "Arbor Peak", share: 16 },
      ],
    });
    const lifecycle = analyzeLifecycle({
      trendSeries,
      salesSeries,
      primaryProduct,
      compareProducts,
      shareOfVoice: [
        { brand: "North Harbor", share: 32 },
        { brand: "LumaNest", share: 19 },
        { brand: "Arbor Peak", share: 16 },
      ],
    });
    const snapshot = extractProductSnapshot({
      product: primaryProduct,
      compareProducts,
    });
    const listing = buildListingAnalysis({
      product: primaryProduct,
      compareProducts,
      snapshot,
    });
    const review = buildReviewAnalysis({
      product: primaryProduct,
      compareProducts,
    });
    const analysis = {
      analysisId: "analysis_test",
      lifecycle,
      competition,
      marketOverview: buildMarketOverview({
        lifecycle,
        competition,
        trendSeries,
        salesSeries,
        shareOfVoice: [
          { brand: "North Harbor", share: 32 },
          { brand: "LumaNest", share: 19 },
          { brand: "Arbor Peak", share: 16 },
        ],
        primaryProduct,
        compareProducts,
      }),
      recommendation: "值得进入下一轮深挖。",
      summary: "市场热度较高，进入门槛中等。",
      trendSeries,
      productSnapshot: snapshot,
      listingAnalysis: listing,
      reviewAnalysis: review,
      demoCase: null,
      explanationMeta: {
        ruleBased: true,
        llmAssisted: false,
        manualInputsUsed: [],
        generatedAt: new Date().toISOString(),
        notes: [],
      },
      dataSources: [],
      cacheStatus: {
        state: "miss" as const,
        key: "analysis_test",
        expiresAt: null,
      },
      missingData: [],
      mode: "rule_based" as const,
    };

    const inspiration = buildTemplateInspiration({
      product: primaryProduct,
      analysis,
      manualInputs: {
        manualListingText: "一键清洗，适合通勤。",
        manualAPlusText: "",
        manualReviewText: "用户抱怨续航不稳定。",
        notes: "",
      },
    });

    expect(inspiration.valueProps.length).toBeGreaterThan(0);
    expect(inspiration.generationMeta.mode).toBe("rule_based");
  });
});

describe("demo cases", () => {
  it("returns several seeded demo cases with stable analysis ids", () => {
    const cases = getDemoCaseCards();

    expect(cases.length).toBeGreaterThanOrEqual(4);
    expect(cases.every((item) => item.analysisId.startsWith("demo:"))).toBe(true);
  });

  it("resolves a demo analysis page by asin and analysis id", () => {
    const [firstCase] = getDemoCaseCards();
    const pageData = getDemoCasePageData(firstCase.analysisId, firstCase.asin);

    expect(pageData?.demoCase?.id).toBe(firstCase.id);
    expect(pageData?.analysis.reviewAnalysis?.coverage).toBe("seeded_summary");
  });
});
