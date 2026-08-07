import type {
  AnalysisResponse,
  CandidateProduct,
  CompetitionAnalysis,
  LifecycleAnalysis,
  ManualInputs,
  MarketOverview,
  SignalLevel,
  TrendPoint,
} from "@/lib/contracts";
import { extractKeySentences, formatPercent, levelLabel, percentDelta, stageLabel } from "@/lib/utils";

function resolveConfidence(evidenceCount: number, missingCount: number): SignalLevel {
  if (evidenceCount >= 4 && missingCount <= 1) {
    return "high";
  }

  if (evidenceCount >= 2) {
    return "medium";
  }

  return "low";
}

function levelFromScore(score: number): SignalLevel {
  if (score >= 70) {
    return "high";
  }

  if (score >= 45) {
    return "medium";
  }

  return "low";
}

export function analyzeLifecycle(input: {
  trendSeries: TrendPoint[];
  salesSeries: TrendPoint[];
  primaryProduct: CandidateProduct;
  compareProducts: CandidateProduct[];
  shareOfVoice: Array<{ brand: string; share: number }>;
}): LifecycleAnalysis {
  const { trendSeries, salesSeries, primaryProduct, compareProducts, shareOfVoice } = input;
  const evidence: string[] = [];
  const missingData: string[] = [];

  const searchTrendDelta = percentDelta(trendSeries);
  const salesTrendDelta = percentDelta(salesSeries);
  const averageReviews =
    [primaryProduct, ...compareProducts]
      .map((product) => product.reviews)
      .filter((reviews): reviews is number => reviews !== null)
      .reduce((total, reviews, _, values) => total + reviews / values.length, 0) || null;
  const concentration = shareOfVoice.slice(0, 3).reduce((total, entry) => total + entry.share, 0) || null;
  const priceValues = [primaryProduct, ...compareProducts]
    .map((product) => product.price)
    .filter((price): price is number => price !== null);
  const priceSpread =
    priceValues.length > 1 ? (Math.max(...priceValues) - Math.min(...priceValues)) / Math.max(...priceValues) : null;

  if (searchTrendDelta === null) {
    missingData.push("缺少搜索趋势。");
  } else if (searchTrendDelta > 0.18) {
    evidence.push(`搜索热度近 12 个月上升 ${formatPercent(searchTrendDelta)}。`);
  } else if (searchTrendDelta < -0.1) {
    evidence.push(`搜索热度近 12 个月下降 ${formatPercent(Math.abs(searchTrendDelta))}。`);
  } else {
    evidence.push("搜索热度基本稳定。");
  }

  if (salesTrendDelta === null) {
    missingData.push("缺少销量趋势。");
  } else if (salesTrendDelta > 0.15) {
    evidence.push(`销量估算仍在上行，约 ${formatPercent(salesTrendDelta)}。`);
  } else if (salesTrendDelta < -0.08) {
    evidence.push(`销量估算开始回落，约 ${formatPercent(Math.abs(salesTrendDelta))}。`);
  } else {
    evidence.push("销量波动不大。");
  }

  if (averageReviews === null) {
    missingData.push("缺少评论门槛。");
  } else if (averageReviews < 260) {
    evidence.push("头部评论门槛偏低。");
  } else if (averageReviews > 1300) {
    evidence.push("头部评论沉淀明显。");
  }

  if (concentration === null) {
    missingData.push("缺少品牌集中度。");
  } else if (concentration > 72) {
    evidence.push("头部品牌集中。");
  } else if (concentration < 48) {
    evidence.push("品牌分布较分散。");
  }

  if (priceSpread !== null) {
    if (priceSpread < 0.18) {
      evidence.push("价格带压缩明显。");
    } else {
      evidence.push("价格带仍有区隔。");
    }
  }

  let stage: LifecycleAnalysis["stage"] = "uncertain";
  if (searchTrendDelta !== null && salesTrendDelta !== null) {
    if (searchTrendDelta < -0.12 && salesTrendDelta < -0.08) {
      stage = "decline";
    } else if (searchTrendDelta > 0.16 && salesTrendDelta > 0.12 && (averageReviews === null || averageReviews < 1100)) {
      stage = averageReviews !== null && averageReviews < 240 ? "introduction" : "growth";
    } else if ((averageReviews !== null && averageReviews > 900) || (concentration !== null && concentration > 65)) {
      stage = "maturity";
    } else {
      stage = "growth";
    }
  } else if (averageReviews !== null && averageReviews > 1000) {
    stage = "maturity";
  }

  return {
    stage,
    confidence: resolveConfidence(evidence.length, missingData.length),
    evidence,
    missingData,
  };
}

export function analyzeCompetition(input: {
  primaryProduct: CandidateProduct;
  compareProducts: CandidateProduct[];
  shareOfVoice: Array<{ brand: string; share: number }>;
}): CompetitionAnalysis {
  const { primaryProduct, compareProducts, shareOfVoice } = input;
  const products = [primaryProduct, ...compareProducts];
  const evidence: string[] = [];

  const concentration = shareOfVoice.slice(0, 3).reduce((total, entry) => total + entry.share, 0);
  const reviewBarrier =
    products
      .map((product) => product.reviews)
      .filter((reviews): reviews is number => reviews !== null)
      .sort((left, right) => left - right)[Math.floor(products.length / 2)] ?? 0;
  const priceValues = products
    .map((product) => product.price)
    .filter((price): price is number => price !== null);
  const priceSpread =
    priceValues.length > 1 ? (Math.max(...priceValues) - Math.min(...priceValues)) / Math.max(...priceValues) : 0.2;
  const brandedCount = products.filter((product) => Boolean(product.brand)).length;
  const homogeneityScore = products.filter((product) =>
    product.title.toLowerCase().includes(primaryProduct.sourceKeyword?.toLowerCase() || ""),
  ).length;

  let levelScore = 40;
  let entryScore = 38;
  let differentiationScore = 65;

  if (concentration > 70) {
    levelScore += 22;
    entryScore += 18;
    differentiationScore -= 18;
    evidence.push("头部品牌份额集中。");
  } else if (concentration < 50) {
    differentiationScore += 10;
    evidence.push("品牌份额分散。");
  }

  if (reviewBarrier > 1500) {
    levelScore += 18;
    entryScore += 22;
    evidence.push("评论门槛较高。");
  } else if (reviewBarrier < 350) {
    entryScore -= 10;
    differentiationScore += 8;
    evidence.push("评论门槛还没有锁死。");
  }

  if (priceSpread < 0.16) {
    levelScore += 10;
    differentiationScore -= 14;
    evidence.push("价格带压缩明显。");
  } else {
    differentiationScore += 12;
    evidence.push("价格带还有层次。");
  }

  if (brandedCount >= Math.max(products.length - 1, 2)) {
    levelScore += 6;
    entryScore += 6;
    evidence.push("品牌识别较强。");
  }

  if (homogeneityScore >= Math.max(products.length - 1, 2)) {
    differentiationScore -= 8;
    evidence.push("标题卖点偏同质化。");
  }

  return {
    level: levelFromScore(levelScore),
    entryDifficulty: levelFromScore(entryScore),
    differentiationRoom: levelFromScore(differentiationScore),
    evidence,
  };
}

export function buildMarketOverview(input: {
  lifecycle: LifecycleAnalysis;
  competition: CompetitionAnalysis;
  trendSeries: TrendPoint[];
  salesSeries: TrendPoint[];
  shareOfVoice: Array<{ brand: string; share: number }>;
  primaryProduct: CandidateProduct;
  compareProducts: CandidateProduct[];
}): MarketOverview {
  const { lifecycle, competition, trendSeries, salesSeries, shareOfVoice, primaryProduct, compareProducts } = input;
  const searchTrendDelta = percentDelta(trendSeries);
  const salesTrendDelta = percentDelta(salesSeries);
  const brandConcentration = shareOfVoice.slice(0, 3).reduce((total, entry) => total + entry.share, 0);
  const reviewBarrier =
    [primaryProduct, ...compareProducts]
      .map((product) => product.reviews)
      .filter((reviews): reviews is number => reviews !== null)
      .sort((left, right) => left - right)[1] ?? null;
  const priceValues = [primaryProduct, ...compareProducts]
    .map((product) => product.price)
    .filter((price): price is number => price !== null);
  const priceSpread =
    priceValues.length > 1 ? (Math.max(...priceValues) - Math.min(...priceValues)) / Math.max(...priceValues) : null;

  const heatScore =
    (searchTrendDelta !== null ? Math.max(searchTrendDelta, 0) * 100 : 28) +
    (salesTrendDelta !== null ? Math.max(salesTrendDelta, 0) * 85 : 24) +
    ((primaryProduct.monthlyUnits ?? 0) > 700 ? 18 : 10);
  const barrierScore =
    (competition.level === "high" ? 35 : competition.level === "medium" ? 24 : 12) +
    (competition.entryDifficulty === "high" ? 35 : competition.entryDifficulty === "medium" ? 22 : 10) +
    (brandConcentration > 70 ? 14 : 4);
  const opportunityScore =
    (competition.differentiationRoom === "high" ? 34 : competition.differentiationRoom === "medium" ? 22 : 10) +
    (lifecycle.stage === "growth"
      ? 28
      : lifecycle.stage === "introduction"
        ? 24
        : lifecycle.stage === "maturity"
          ? 14
          : 6) +
    (competition.entryDifficulty === "low" ? 24 : competition.entryDifficulty === "medium" ? 16 : 8);

  const marketHeat = levelFromScore(heatScore);
  const entryBarrier = levelFromScore(barrierScore);
  const opportunityLevel = levelFromScore(opportunityScore);

  const summary = `市场热度${levelLabel(marketHeat)}，进入门槛${levelLabel(entryBarrier)}，当前更接近${stageLabel(
    lifecycle.stage,
  )}。`;

  const recommendation =
    opportunityLevel === "high"
      ? "建议继续深挖，优先验证差异点和评论痛点。"
      : opportunityLevel === "medium"
        ? "可以继续看，但建议先收紧场景或人群。"
        : "当前更适合谨慎观察，除非你有明确的差异化。";

  return {
    marketHeat,
    entryBarrier,
    differentiationRoom: competition.differentiationRoom,
    opportunityLevel,
    summary,
    recommendation,
    metrics: {
      searchTrendDelta,
      salesTrendDelta,
      brandConcentration,
      reviewBarrier,
      priceSpread,
    },
  };
}

export function buildTemplateInspiration(input: {
  product: CandidateProduct;
  analysis: AnalysisResponse;
  manualInputs: ManualInputs;
}) {
  const { product, analysis, manualInputs } = input;
  const manualListing = extractKeySentences(manualInputs.manualListingText);
  const manualAPlus = extractKeySentences(manualInputs.manualAPlusText);
  const manualReview = extractKeySentences(manualInputs.manualReviewText);
  const manualNotes = extractKeySentences(manualInputs.notes, 3);
  const listingSummary = analysis.listingAnalysis?.summary;
  const listingGap = analysis.listingAnalysis?.gaps[0];
  const reviewPain = analysis.reviewAnalysis?.painPoints[0];
  const reviewDriver = analysis.reviewAnalysis?.purchaseDrivers[0];
  const pricePositioning = analysis.productSnapshot?.pricePositioning;

  const audience =
    product.category === "Pet Supplies"
      ? "重视宠物日常便利和卫生体验的家庭用户"
      : product.category === "Sports & Outdoors"
        ? "希望兼顾便携性和效率的轻运动用户"
        : "看重效率、易用性和质感表达的家庭消费人群";

  const purchaseDrivers = [
    analysis.marketOverview.summary,
    manualListing[0] || reviewDriver || "用户更偏好一眼就能看懂的核心收益。",
    product.relevanceHint || "核心关键词和使用场景贴合。",
  ].slice(0, 3);

  const valueProps = [
    manualListing[1] || listingSummary || "先讲清场景收益，再讲参数。",
    manualAPlus[0] || "把使用前后的变化讲清楚。",
    analysis.competition.differentiationRoom === "high"
      ? "突出更具体的人群和场景。"
      : "把差异点压缩成少数几个关键细节。",
  ].slice(0, 3);

  const painPoints = [
    manualReview[0] || reviewPain || "用户容易抱怨维护麻烦或体验不稳定。",
    manualReview[1] || listingGap || "包装、配件和说明清晰度容易影响评价。",
    analysis.competition.level === "high"
      ? "同质化卖点过多，用户难以快速区分。"
      : "场景表达不清时会更像泛类目替代品。",
  ].slice(0, 3);

  const differentiationIdeas = [
    analysis.marketOverview.opportunityLevel === "high"
      ? "围绕更窄的人群和场景切入。"
      : "先验证一个最明确的体验改良点。",
    manualNotes[0] || "把完成度放在套装、收纳或使用流程优化上。",
    analysis.competition.differentiationRoom === "high"
      ? "用场景化信息架构替代通用参数堆叠。"
      : "从材质、静音、便携或清洁体验里找突破。",
  ].slice(0, 3);

  const listingAngles = [
    "标题先写主关键词，再写场景收益和差异点。",
    pricePositioning === "premium"
      ? "五点里要先解释为什么值得更高价格。"
      : "五点优先覆盖场景、节省时间、维护成本和质感。",
    manualAPlus[1] || "A+ 建议按问题、方案、细节、场景四段展开。",
  ].slice(0, 3);

  const visualAngles = [
    "首图保持干净，副图承接细节和对比逻辑。",
    "至少一张副图展示真实使用动作。",
    analysis.competition.level === "high"
      ? "增加一张“为什么这版更省心”的信息图。"
      : "强化场景氛围和材质细节。",
  ].slice(0, 3);

  return {
    audience,
    purchaseDrivers,
    valueProps,
    painPoints,
    differentiationIdeas,
    listingAngles,
    visualAngles,
    generationMeta: {
      provider: "template-disabled-llm",
      mode: "rule_based" as const,
      manualInputsUsed: Object.entries(manualInputs)
        .filter(([, value]) => value && value.trim().length > 0)
        .map(([key]) => key),
      notes: [
        "当前结果由规则和模板生成，没有调用外部 LLM。",
        "手工补充内容会优先进入 pain point 和 angle 提示。",
      ],
      generatedAt: new Date().toISOString(),
    },
    mode: "rule_based" as const,
  };
}
