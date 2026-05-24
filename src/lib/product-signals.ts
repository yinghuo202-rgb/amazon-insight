import {
  listingAnalysisSchema,
  productSnapshotSchema,
  reviewAnalysisSchema,
  type CandidateProduct,
  type ListingAnalysis,
  type ProductSnapshot,
  type ReviewAnalysis,
  type SignalLevel,
} from "@/lib/contracts";
import { asInt, asNumber, asString, formatCurrency } from "@/lib/utils";

export type ListingAnalysisSeed = {
  summary?: string;
  strengths?: string[];
  gaps?: string[];
  warnings?: string[];
};

export type ReviewAnalysisSeed = {
  summary: string;
  painPoints: string[];
  purchaseDrivers: string[];
  risks?: string[];
  notes?: string[];
};

function resolveSignalLevel(score: number): SignalLevel {
  if (score >= 3.25) {
    return "high";
  }

  if (score >= 1.75) {
    return "medium";
  }

  return "low";
}

function getRawAttributes(product: CandidateProduct) {
  if (product.rawJson && typeof product.rawJson === "object" && !Array.isArray(product.rawJson)) {
    return product.rawJson as Record<string, unknown>;
  }

  return {};
}

function monthsSince(value: string | null) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const now = new Date();
  const monthDelta = (now.getFullYear() - date.getFullYear()) * 12 + (now.getMonth() - date.getMonth());
  return Math.max(monthDelta, 0);
}

function formatDimensions(raw: Record<string, unknown>) {
  const length = asNumber(raw.length_value, null);
  const width = asNumber(raw.width_value, null);
  const height = asNumber(raw.height_value, null);
  const unit = asString(raw.dimensions_unit, "");

  if ([length, width, height].every((entry) => entry === null)) {
    return null;
  }

  return `${length ?? "?"} x ${width ?? "?"} x ${height ?? "?"}${unit ? ` ${unit}` : ""}`;
}

function resolvePricePositioning(
  product: CandidateProduct,
  compareProducts: CandidateProduct[],
): ProductSnapshot["pricePositioning"] {
  if (product.price === null) {
    return "unknown";
  }

  const comparePrices = compareProducts.map((entry) => entry.price).filter((entry): entry is number => entry !== null);

  if (comparePrices.length === 0) {
    return "unknown";
  }

  const averagePrice = comparePrices.reduce((total, value) => total + value, 0) / comparePrices.length;

  if (product.price <= averagePrice * 0.85) {
    return "budget";
  }

  if (product.price >= averagePrice * 1.15) {
    return "premium";
  }

  return "mid";
}

export function extractProductSnapshot(input: {
  product: CandidateProduct;
  compareProducts: CandidateProduct[];
}): ProductSnapshot {
  const { product, compareProducts } = input;
  const raw = getRawAttributes(product);
  const variants = Array.isArray(raw.variants) ? raw.variants.length : null;
  const sellerCount = asInt(raw.number_of_sellers, null);
  const listingQualityScore = asNumber(raw.listing_quality_score, null);
  const firstAvailable = asString(raw.date_first_available, "") || null;
  const ageMonths = monthsSince(firstAvailable);
  const flags: string[] = [];

  if (sellerCount !== null && sellerCount >= 6) {
    flags.push("卖家数量偏多");
  }

  if (variants !== null && variants >= 8) {
    flags.push("变体数量较多");
  }

  if (product.reviews !== null && product.reviews >= 2000) {
    flags.push("评论门槛较高");
  }

  if (product.rating !== null && product.rating <= 4.1) {
    flags.push("评分压力明显");
  }

  if (ageMonths !== null && ageMonths >= 30) {
    flags.push("上市时间较久");
  }

  return productSnapshotSchema.parse({
    sellerType: asString(raw.seller_type, "") || null,
    sellerCount,
    variantCount: variants,
    listingQualityScore,
    productRank: asInt(raw.product_rank, null),
    sizeTier: asString(raw.product_tier ?? raw.size_tier, "") || null,
    pricePositioning: resolvePricePositioning(product, compareProducts),
    ageMonths,
    firstAvailable,
    dimensionsSummary: formatDimensions(raw),
    flags,
  });
}

export function buildListingAnalysis(input: {
  product: CandidateProduct;
  compareProducts: CandidateProduct[];
  snapshot: ProductSnapshot;
  seed?: ListingAnalysisSeed;
}): ListingAnalysis {
  const { product, compareProducts, snapshot, seed } = input;
  const titleLength = product.title.trim().length;
  const strengths = [...(seed?.strengths ?? [])];
  const gaps = [...(seed?.gaps ?? [])];
  const warnings = [...(seed?.warnings ?? [])];
  let score = seed ? 3 : 0;

  if (product.brand) {
    strengths.push("品牌信息明确，用户更容易识别。");
    score += 0.6;
  } else {
    gaps.push("品牌露出偏弱，点击后识别度可能不够。");
  }

  if (titleLength >= 70 && titleLength <= 160) {
    strengths.push("标题长度处在较易读的区间。");
    score += 0.6;
  } else if (titleLength < 50) {
    gaps.push("标题偏短，核心场景或规格可能没有说清。");
  } else if (titleLength > 180) {
    warnings.push("标题偏长，移动端阅读负担较高。");
  }

  if (snapshot.listingQualityScore !== null) {
    if (snapshot.listingQualityScore >= 75) {
      strengths.push("Listing 质量分较高。");
      score += 1;
    } else if (snapshot.listingQualityScore <= 45) {
      gaps.push("Listing 质量分偏低，转化表达仍有明显缺口。");
    }
  }

  if (product.imageUrl) {
    strengths.push("已具备主图信号，可以支撑基础点击转化。");
    score += 0.4;
  } else {
    gaps.push("缺少图片信号。");
  }

  if (snapshot.variantCount !== null && snapshot.variantCount >= 4) {
    strengths.push("变体较多，便于覆盖颜色、容量或规格选择。");
    score += 0.3;
  }

  if (snapshot.sellerCount !== null && snapshot.sellerCount >= 8) {
    warnings.push("卖家数量偏多，可能存在价格和 Buy Box 压力。");
  }

  if (snapshot.pricePositioning === "premium" && (product.rating ?? 0) < 4.3) {
    warnings.push(`当前定价偏高，但评分没有明显优势（${formatCurrency(product.price)}）。`);
  }

  const currentPrice = product.price;
  if (
    compareProducts.length > 0 &&
    currentPrice !== null &&
    compareProducts.every((entry) => entry.price !== null && entry.price > currentPrice)
  ) {
    strengths.push("定价低于主要参考竞品，适合切入。");
    score += 0.3;
  }

  const summary =
    seed?.summary ||
    (strengths.length > gaps.length
      ? "当前 Listing 基础不差，但差异点还需要表达得更具体。"
      : "当前 Listing 更像可售状态，不像高质量说服页，仍有较多补强空间。");

  return listingAnalysisSchema.parse({
    source: seed ? "demo_seed" : snapshot.listingQualityScore !== null || snapshot.sellerCount !== null ? "live" : "rule_based",
    confidence: resolveSignalLevel(score),
    summary,
    strengths: Array.from(new Set(strengths)).slice(0, 4),
    gaps: Array.from(new Set(gaps)).slice(0, 4),
    warnings: Array.from(new Set(warnings)).slice(0, 4),
  });
}

export function buildReviewAnalysis(input: {
  product: CandidateProduct;
  compareProducts: CandidateProduct[];
  seed?: ReviewAnalysisSeed;
}): ReviewAnalysis {
  const { product, compareProducts, seed } = input;

  if (seed) {
    return reviewAnalysisSchema.parse({
      retrievalMode: "demo_seed",
      coverage: "seeded_summary",
      confidence: "high",
      summary: seed.summary,
      painPoints: seed.painPoints.slice(0, 4),
      purchaseDrivers: seed.purchaseDrivers.slice(0, 4),
      risks: (seed.risks ?? []).slice(0, 4),
      notes: ["该案例使用稳定的 demo review seed，用于演示评论分析结构。", ...(seed.notes ?? [])].slice(0, 4),
    });
  }

  const painPoints: string[] = [];
  const purchaseDrivers: string[] = [];
  const risks: string[] = [];
  const notes = ["当前没有直接抓取评论文本，以下判断主要来自评分、评论量和竞品对比。"];
  let score = 0;

  if (product.rating !== null) {
    score += 1;
    if (product.rating < 4.1) {
      painPoints.push("评分偏低，说明一致性或质量稳定性可能存在问题。");
      risks.push("如果没有明确的体验改良点，进入后容易被差评拖累。");
    } else if (product.rating < 4.4) {
      painPoints.push("评分不算突出，通常意味着清洁、耐用或噪音类问题仍在。");
    } else {
      purchaseDrivers.push("评分表现不错，说明核心需求已经被验证。");
    }
  }

  if (product.reviews !== null) {
    score += 1;
    if (product.reviews >= 2000) {
      risks.push("评论沉淀很深，新品跨越社会证明门槛的成本较高。");
    } else if (product.reviews <= 350) {
      purchaseDrivers.push("评论门槛还没有完全锁死，仍有切入空间。");
    }
  }

  const compareRatings = compareProducts.map((entry) => entry.rating).filter((entry): entry is number => entry !== null);
  if (compareRatings.length > 0 && product.rating !== null) {
    score += 1;
    const compareAverage = compareRatings.reduce((total, value) => total + value, 0) / compareRatings.length;

    if (product.rating >= compareAverage + 0.2) {
      purchaseDrivers.push("评分高于主要参考竞品，体验心智更容易建立。");
    } else if (product.rating <= compareAverage - 0.2) {
      painPoints.push("评分低于主要参考竞品，需要优先确认真实差评来源。");
    }
  }

  if (product.price !== null) {
    const comparePrices = compareProducts.map((entry) => entry.price).filter((entry): entry is number => entry !== null);
    if (comparePrices.length > 0) {
      const compareAverage = comparePrices.reduce((total, value) => total + value, 0) / comparePrices.length;

      if (product.price > compareAverage * 1.15 && (product.rating ?? 0) < 4.4) {
        risks.push("产品存在溢价，但评分还不够强，容易引发性价比质疑。");
      }

      if (product.price < compareAverage * 0.9) {
        purchaseDrivers.push("价格相对友好，用户更容易在早期接受。");
      }
    }
  }

  const summary =
    purchaseDrivers.length > painPoints.length
      ? "评论侧暂时看不到致命风险，但门槛和体验稳定性仍需用真实评论文本验证。"
      : "评论侧已经出现明显压力信号，正式进入前建议先拿到真实评论文本再拆解。";

  return reviewAnalysisSchema.parse({
    retrievalMode: score > 0 ? "heuristic" : "unavailable",
    coverage: score > 0 ? "heuristic_only" : "none",
    confidence: score >= 3 ? "medium" : "low",
    summary,
    painPoints: painPoints.slice(0, 4),
    purchaseDrivers: purchaseDrivers.slice(0, 4),
    risks: risks.slice(0, 4),
    notes,
  });
}
