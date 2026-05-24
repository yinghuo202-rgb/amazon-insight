import { analyzeCompetition, analyzeLifecycle, buildMarketOverview } from "@/lib/analysis";
import { getSpApiStatus } from "@/lib/amazon-spapi/client";
import {
  candidateProductSchema,
  type AnalysisContext,
  type AnalysisPageData,
  type AnalysisResponse,
  type CandidateProduct,
  type DataSourceStatus,
  type DemoCaseMeta,
  type SignalLevel,
  type TrendPoint,
} from "@/lib/contracts";
import {
  buildListingAnalysis,
  buildReviewAnalysis,
  extractProductSnapshot,
  type ListingAnalysisSeed,
  type ReviewAnalysisSeed,
} from "@/lib/product-signals";
import { makeProductImage, normalizeKeyword } from "@/lib/utils";

type DemoCaseDefinition = {
  meta: DemoCaseMeta;
  primaryKeyword: string;
  primaryProduct: CandidateProduct;
  compareProducts: CandidateProduct[];
  searchTrendSeries: TrendPoint[];
  salesTrendSeries: TrendPoint[];
  shareOfVoice: Array<{ brand: string; share: number }>;
  listingSeed?: ListingAnalysisSeed;
  reviewSeed: ReviewAnalysisSeed;
};

export type DemoCaseCard = {
  id: string;
  analysisId: string;
  asin: string;
  title: string;
  imageUrl: string | null;
  category: string;
  label: string;
  explanation: string;
  whyUseful: string;
  lifecycleStage: AnalysisResponse["lifecycle"]["stage"];
  competitionLevel: SignalLevel;
  opportunityLevel: SignalLevel;
};

function createMonthlySeries(input: { start: string; values: number[] }): TrendPoint[] {
  const startDate = new Date(input.start);

  return input.values.map((value, index) => {
    const pointDate = new Date(startDate.getFullYear(), startDate.getMonth() + index, 1);
    return {
      date: pointDate.toISOString(),
      value,
      label: pointDate.toLocaleDateString("zh-CN", {
        month: "short",
        year: "2-digit",
      }),
    };
  });
}

function product(input: {
  asin: string;
  title: string;
  brand: string;
  price: number;
  rating: number;
  reviews: number;
  category: string;
  monthlyUnits: number;
  monthlyRevenue: number;
  sourceKeyword: string;
  relevanceHint: string;
  imageSeed: string;
  rawJson: Record<string, unknown>;
}) {
  return candidateProductSchema.parse({
    ...input,
    imageUrl: makeProductImage(input.imageSeed),
  });
}

function demoSource(details: string[]): DataSourceStatus {
  return {
    source: "manual",
    label: "Seeded Demo Case",
    mode: "rule_based",
    status: "configured",
    freshness: "稳定演示数据",
    details,
  };
}

const DEMO_CASES: DemoCaseDefinition[] = [
  {
    meta: {
      id: "label-maker-competition",
      label: "高评论量 / 强竞争",
      asin: "B0CGXQL7NK",
      title: "Phomemo D30 Mini Bluetooth Label Maker",
      category: "Office Products",
      explanation: "这类产品通常有很深的评论沉淀和头部品牌优势，适合演示高壁垒市场的典型信号。",
      whyUseful: "它能帮助团队区分：销量看起来不错，并不等于适合进入；评论门槛和品牌集中度往往更关键。",
    },
    primaryKeyword: "label maker",
    primaryProduct: product({
      asin: "B0CGXQL7NK",
      title: "Phomemo D30 Mini Bluetooth Label Maker",
      brand: "Phomemo",
      price: 28.99,
      rating: 4.6,
      reviews: 18420,
      category: "Office Products",
      monthlyUnits: 4600,
      monthlyRevenue: 133354,
      sourceKeyword: "label maker",
      relevanceHint: "销量高，但评论门槛已经很深",
      imageSeed: "Phomemo D30",
      rawJson: {
        seller_type: "FBA",
        number_of_sellers: 11,
        variants: new Array(12).fill("variant"),
        listing_quality_score: 83,
        product_rank: 148,
        product_tier: "Small Standard-Size",
        date_first_available: "2021-06-01",
        length_value: 5.2,
        width_value: 3.1,
        height_value: 1.6,
        dimensions_unit: "in",
      },
    }),
    compareProducts: [
      product({
        asin: "B0CF6JZ2K1",
        title: "NIIMBOT D11 Portable Label Maker Machine",
        brand: "NIIMBOT",
        price: 25.99,
        rating: 4.5,
        reviews: 12140,
        category: "Office Products",
        monthlyUnits: 3900,
        monthlyRevenue: 101361,
        sourceKeyword: "label maker",
        relevanceHint: "头部竞品",
        imageSeed: "NIIMBOT D11",
        rawJson: {
          seller_type: "FBA",
          number_of_sellers: 9,
          variants: new Array(10).fill("variant"),
          listing_quality_score: 80,
          product_rank: 171,
          product_tier: "Small Standard-Size",
          date_first_available: "2021-10-01",
          length_value: 5.3,
          width_value: 3.2,
          height_value: 1.7,
          dimensions_unit: "in",
        },
      }),
      product({
        asin: "B0CGVZ3W8P",
        title: "Brother P-touch Cube Plus Label Maker",
        brand: "Brother",
        price: 39.99,
        rating: 4.4,
        reviews: 6240,
        category: "Office Products",
        monthlyUnits: 1800,
        monthlyRevenue: 71982,
        sourceKeyword: "label maker",
        relevanceHint: "成熟品牌对照",
        imageSeed: "Brother P-touch",
        rawJson: {
          seller_type: "AMZ",
          number_of_sellers: 5,
          variants: new Array(5).fill("variant"),
          listing_quality_score: 78,
          product_rank: 236,
          product_tier: "Small Standard-Size",
          date_first_available: "2020-11-01",
          length_value: 5.8,
          width_value: 4.6,
          height_value: 2.3,
          dimensions_unit: "in",
        },
      }),
    ],
    searchTrendSeries: createMonthlySeries({
      start: "2025-01-01",
      values: [8200, 7900, 8100, 8600, 8900, 9200, 9100, 9350, 9600, 10100, 10300, 10800],
    }),
    salesTrendSeries: createMonthlySeries({
      start: "2025-01-01",
      values: [4050, 3980, 4100, 4220, 4310, 4360, 4410, 4470, 4520, 4590, 4630, 4680],
    }),
    shareOfVoice: [
      { brand: "Phomemo", share: 34 },
      { brand: "NIIMBOT", share: 27 },
      { brand: "Brother", share: 18 },
      { brand: "SUPVAN", share: 9 },
      { brand: "Others", share: 12 },
    ],
    reviewSeed: {
      summary:
        "评论驱动很强，但门槛也很深。用户对打印清晰度、App 连接和标签纸兼容性的容忍度都很低。",
      painPoints: [
        "App 配对和连接稳定性经常被提到。",
        "标签纸耗材成本和兼容性容易引发抱怨。",
        "打印深浅和裁切精度是高频体验点。",
      ],
      purchaseDrivers: [
        "便携、上手快，适合家庭整理。",
        "模板和图标丰富，非专业用户也能直接使用。",
        "体积小，能覆盖收纳、办公和学习场景。",
      ],
      risks: ["高评论基数意味着体验短板会被持续放大。"],
    },
  },
  {
    meta: {
      id: "pet-fountain-pain-points",
      label: "评论痛点清晰",
      asin: "B0CPS9N4LM",
      title: "Veken Stainless Steel Cat Water Fountain 95oz",
      category: "Pet Supplies",
      explanation: "这类产品的差评通常很集中，常围绕水泵噪音、清洗难度、滤芯更换和漏水风险展开。",
      whyUseful: "适合演示如何从明确痛点出发做改良，而不是只看销量和平均评分。",
    },
    primaryKeyword: "cat water fountain",
    primaryProduct: product({
      asin: "B0CPS9N4LM",
      title: "Veken Stainless Steel Cat Water Fountain 95oz",
      brand: "Veken",
      price: 32.99,
      rating: 4.2,
      reviews: 3260,
      category: "Pet Supplies",
      monthlyUnits: 1550,
      monthlyRevenue: 51134,
      sourceKeyword: "cat water fountain",
      relevanceHint: "痛点清晰，适合做体验改良",
      imageSeed: "Veken Fountain",
      rawJson: {
        seller_type: "FBA",
        number_of_sellers: 4,
        variants: new Array(3).fill("variant"),
        listing_quality_score: 72,
        product_rank: 913,
        product_tier: "Standard",
        date_first_available: "2023-02-01",
        length_value: 9.4,
        width_value: 9.4,
        height_value: 6.1,
        dimensions_unit: "in",
      },
    }),
    compareProducts: [
      product({
        asin: "B0CQ3W7HS8",
        title: "PETLIBRO Dockstream Cat Water Fountain Wireless Pump",
        brand: "PETLIBRO",
        price: 39.99,
        rating: 4.3,
        reviews: 2140,
        category: "Pet Supplies",
        monthlyUnits: 1330,
        monthlyRevenue: 53187,
        sourceKeyword: "cat water fountain",
        relevanceHint: "结构升级款",
        imageSeed: "PETLIBRO Fountain",
        rawJson: {
          seller_type: "FBA",
          number_of_sellers: 3,
          variants: new Array(4).fill("variant"),
          listing_quality_score: 77,
          product_rank: 1050,
          product_tier: "Standard",
          date_first_available: "2023-07-01",
          length_value: 9.8,
          width_value: 9.6,
          height_value: 6.2,
          dimensions_unit: "in",
        },
      }),
      product({
        asin: "B0CR6FWM51",
        title: "Wonder Creature Stainless Steel Cat Fountain",
        brand: "Wonder Creature",
        price: 29.99,
        rating: 4.1,
        reviews: 2890,
        category: "Pet Supplies",
        monthlyUnits: 1400,
        monthlyRevenue: 41986,
        sourceKeyword: "cat water fountain",
        relevanceHint: "同价位竞品",
        imageSeed: "Wonder Creature Fountain",
        rawJson: {
          seller_type: "FBM",
          number_of_sellers: 7,
          variants: new Array(2).fill("variant"),
          listing_quality_score: 65,
          product_rank: 1112,
          product_tier: "Standard",
          date_first_available: "2022-09-01",
          length_value: 9.3,
          width_value: 9.1,
          height_value: 5.9,
          dimensions_unit: "in",
        },
      }),
    ],
    searchTrendSeries: createMonthlySeries({
      start: "2025-01-01",
      values: [6100, 6200, 6280, 6400, 6550, 6680, 6720, 6800, 6950, 7060, 7210, 7390],
    }),
    salesTrendSeries: createMonthlySeries({
      start: "2025-01-01",
      values: [1180, 1210, 1240, 1280, 1330, 1370, 1410, 1450, 1490, 1510, 1540, 1570],
    }),
    shareOfVoice: [
      { brand: "Veken", share: 24 },
      { brand: "PETLIBRO", share: 21 },
      { brand: "Wonder Creature", share: 16 },
      { brand: "GIOTOHUN", share: 11 },
      { brand: "Others", share: 28 },
    ],
    reviewSeed: {
      summary:
        "评论痛点集中在清洗、漏水和泵寿命，说明用户对体验一致性的敏感度很高，改良空间真实存在。",
      painPoints: [
        "水泵噪音和寿命不稳定。",
        "拆洗频次高，细缝容易积垢。",
        "滤芯成本和更换节奏容易引发不满。",
      ],
      purchaseDrivers: [
        "不锈钢材质更容易建立卫生感知。",
        "宠物更愿意喝流动水，用户能感知到实际收益。",
        "容量大，减少频繁加水。",
      ],
      risks: ["如果结构设计改良不明显，用户会把它视为同质替代品。"],
    },
  },
  {
    meta: {
      id: "walking-pad-maturity",
      label: "成熟 / 饱和市场",
      asin: "B0D1J8QF2R",
      title: "UREVO 2 in 1 Under Desk Walking Pad Treadmill",
      category: "Sports & Outdoors",
      explanation: "类目需求仍大，但品牌、评论和价格带都已经很成熟，适合演示饱和市场的典型信号。",
      whyUseful: "能帮助团队区分“市场大”和“适合进入”不是一回事，尤其适合用来校准预期。",
    },
    primaryKeyword: "walking pad",
    primaryProduct: product({
      asin: "B0D1J8QF2R",
      title: "UREVO 2 in 1 Under Desk Walking Pad Treadmill",
      brand: "UREVO",
      price: 289.99,
      rating: 4.5,
      reviews: 9830,
      category: "Sports & Outdoors",
      monthlyUnits: 2400,
      monthlyRevenue: 695976,
      sourceKeyword: "walking pad",
      relevanceHint: "市场大，但门槛已经很深",
      imageSeed: "UREVO Walking Pad",
      rawJson: {
        seller_type: "AMZ",
        number_of_sellers: 6,
        variants: new Array(6).fill("variant"),
        listing_quality_score: 85,
        product_rank: 102,
        product_tier: "Large Standard-Size",
        date_first_available: "2021-03-01",
        length_value: 52.6,
        width_value: 26.4,
        height_value: 4.6,
        dimensions_unit: "in",
      },
    }),
    compareProducts: [
      product({
        asin: "B0D24R5W7H",
        title: "GOYOUTH 2 in 1 Under Desk Electric Treadmill",
        brand: "GOYOUTH",
        price: 309.99,
        rating: 4.4,
        reviews: 8420,
        category: "Sports & Outdoors",
        monthlyUnits: 1820,
        monthlyRevenue: 564182,
        sourceKeyword: "walking pad",
        relevanceHint: "成熟竞品",
        imageSeed: "GOYOUTH Treadmill",
        rawJson: {
          seller_type: "FBA",
          number_of_sellers: 5,
          variants: new Array(3).fill("variant"),
          listing_quality_score: 79,
          product_rank: 121,
          product_tier: "Large Standard-Size",
          date_first_available: "2020-12-01",
          length_value: 50.9,
          width_value: 24.8,
          height_value: 4.8,
          dimensions_unit: "in",
        },
      }),
      product({
        asin: "B0D2K7M6TY",
        title: "Sperax Walking Pad Foldable Treadmill",
        brand: "Sperax",
        price: 279.99,
        rating: 4.3,
        reviews: 7310,
        category: "Sports & Outdoors",
        monthlyUnits: 1910,
        monthlyRevenue: 534781,
        sourceKeyword: "walking pad",
        relevanceHint: "价格带接近",
        imageSeed: "Sperax Walking Pad",
        rawJson: {
          seller_type: "FBA",
          number_of_sellers: 7,
          variants: new Array(5).fill("variant"),
          listing_quality_score: 76,
          product_rank: 139,
          product_tier: "Large Standard-Size",
          date_first_available: "2022-01-01",
          length_value: 50.4,
          width_value: 24.6,
          height_value: 4.7,
          dimensions_unit: "in",
        },
      }),
    ],
    searchTrendSeries: createMonthlySeries({
      start: "2025-01-01",
      values: [22800, 21900, 21400, 21100, 20500, 20350, 20100, 19800, 19600, 19400, 19250, 19000],
    }),
    salesTrendSeries: createMonthlySeries({
      start: "2025-01-01",
      values: [2510, 2480, 2450, 2420, 2390, 2360, 2340, 2310, 2290, 2270, 2250, 2210],
    }),
    shareOfVoice: [
      { brand: "UREVO", share: 31 },
      { brand: "GOYOUTH", share: 23 },
      { brand: "Sperax", share: 19 },
      { brand: "WalkingPad", share: 11 },
      { brand: "Others", share: 16 },
    ],
    reviewSeed: {
      summary:
        "核心体验已经被充分教育，但噪音、收纳、耐用性和售后仍是评论区最容易分化的几个点。",
      painPoints: [
        "噪音和震动在公寓场景里会被明显放大。",
        "收纳尺寸、滚轮和移动体验直接影响满意度。",
        "长期使用后的电机稳定性是常见风险。",
      ],
      purchaseDrivers: [
        "在家办公场景明确，用户知道自己为什么买。",
        "大件产品更依赖品牌和已有评论。",
        "能替代久坐带来的机会成本。",
      ],
      risks: ["成熟市场里做轻微改款，通常不足以撬动用户迁移。"],
    },
  },
  {
    meta: {
      id: "mini-chopper-differentiation",
      label: "存在差异化机会",
      asin: "B0D4Q7N3SJ",
      title: "Cordless Mini Food Chopper 250ml USB-C Rechargeable",
      category: "Kitchen & Dining",
      explanation: "市场还没有完全锁死，评论里也能看到对清洗、安全锁和续航的具体诉求，适合演示可落地的差异化。",
      whyUseful: "它能展示：并不是要找完美赛道，而是找到有明确改良路径的中等竞争市场。",
    },
    primaryKeyword: "mini food chopper",
    primaryProduct: product({
      asin: "B0D4Q7N3SJ",
      title: "Cordless Mini Food Chopper 250ml USB-C Rechargeable",
      brand: "MiroCook",
      price: 23.99,
      rating: 4.3,
      reviews: 540,
      category: "Kitchen & Dining",
      monthlyUnits: 960,
      monthlyRevenue: 23030,
      sourceKeyword: "mini food chopper",
      relevanceHint: "评论门槛尚可，改良方向具体",
      imageSeed: "Mini Food Chopper",
      rawJson: {
        seller_type: "FBA",
        number_of_sellers: 2,
        variants: new Array(2).fill("variant"),
        listing_quality_score: 58,
        product_rank: 1882,
        product_tier: "Small Standard-Size",
        date_first_available: "2024-01-01",
        length_value: 4.8,
        width_value: 4.8,
        height_value: 6.2,
        dimensions_unit: "in",
      },
    }),
    compareProducts: [
      product({
        asin: "B0D5K2W8QA",
        title: "KitchenAid 3.5 Cup Food Chopper",
        brand: "KitchenAid",
        price: 54.99,
        rating: 4.6,
        reviews: 2810,
        category: "Kitchen & Dining",
        monthlyUnits: 620,
        monthlyRevenue: 34094,
        sourceKeyword: "mini food chopper",
        relevanceHint: "高价品牌对照",
        imageSeed: "KitchenAid Chopper",
        rawJson: {
          seller_type: "AMZ",
          number_of_sellers: 4,
          variants: new Array(4).fill("variant"),
          listing_quality_score: 82,
          product_rank: 1194,
          product_tier: "Small Standard-Size",
          date_first_available: "2020-05-01",
          length_value: 5,
          width_value: 7,
          height_value: 8.7,
          dimensions_unit: "in",
        },
      }),
      product({
        asin: "B0D6T4P9LU",
        title: "LINKChef Mini Garlic Chopper USB Rechargeable",
        brand: "LINKChef",
        price: 18.99,
        rating: 4.1,
        reviews: 720,
        category: "Kitchen & Dining",
        monthlyUnits: 870,
        monthlyRevenue: 16521,
        sourceKeyword: "mini food chopper",
        relevanceHint: "同价位可比款",
        imageSeed: "LINKChef Chopper",
        rawJson: {
          seller_type: "FBA",
          number_of_sellers: 3,
          variants: new Array(2).fill("variant"),
          listing_quality_score: 55,
          product_rank: 2010,
          product_tier: "Small Standard-Size",
          date_first_available: "2023-11-01",
          length_value: 4.7,
          width_value: 4.7,
          height_value: 6,
          dimensions_unit: "in",
        },
      }),
    ],
    searchTrendSeries: createMonthlySeries({
      start: "2025-01-01",
      values: [3300, 3370, 3450, 3520, 3590, 3660, 3740, 3810, 3890, 4010, 4150, 4280],
    }),
    salesTrendSeries: createMonthlySeries({
      start: "2025-01-01",
      values: [720, 760, 790, 810, 835, 860, 885, 910, 930, 950, 970, 990],
    }),
    shareOfVoice: [
      { brand: "KitchenAid", share: 18 },
      { brand: "Hamilton Beach", share: 16 },
      { brand: "BLACK+DECKER", share: 11 },
      { brand: "MiroCook", share: 9 },
      { brand: "Others", share: 46 },
    ],
    listingSeed: {
      summary: "当前 Listing 已经把便携和充电卖点摆出来了，但安全感和清洗体验还没讲透。",
      strengths: ["便携、USB-C 充电、容量定位都比较明确。"],
      gaps: ["安全锁、刀头拆洗和电池续航没有被解释清楚。"],
      warnings: ["如果继续只打“迷你便携”，很容易落入同质化。"],
    },
    reviewSeed: {
      summary:
        "用户已经给出了明确改良方向，重点不是重新定义产品，而是把安全、清洗和续航做扎实。",
      painPoints: [
        "刀头拆洗麻烦，手容易碰到刀刃。",
        "一次充电能打几次，预期经常不一致。",
        "容量和功率边界不清晰，容易买错预期。",
      ],
      purchaseDrivers: [
        "蒜蓉、辣椒、辅食等小份量场景很明确。",
        "无线便携比台式机更省空间。",
        "入门价格低，适合作为礼品或厨房补充型购买。",
      ],
      risks: ["如果安全结构和清洗体验不改，复购和口碑都会受限。"],
    },
  },
];

function buildDemoCaseData(definition: DemoCaseDefinition): AnalysisPageData {
  const snapshot = extractProductSnapshot({
    product: definition.primaryProduct,
    compareProducts: definition.compareProducts,
  });
  const lifecycle = analyzeLifecycle({
    trendSeries: definition.searchTrendSeries,
    salesSeries: definition.salesTrendSeries,
    primaryProduct: definition.primaryProduct,
    compareProducts: definition.compareProducts,
    shareOfVoice: definition.shareOfVoice,
  });
  const competition = analyzeCompetition({
    primaryProduct: definition.primaryProduct,
    compareProducts: definition.compareProducts,
    shareOfVoice: definition.shareOfVoice,
  });
  const marketOverview = buildMarketOverview({
    lifecycle,
    competition,
    trendSeries: definition.searchTrendSeries,
    salesSeries: definition.salesTrendSeries,
    shareOfVoice: definition.shareOfVoice,
    primaryProduct: definition.primaryProduct,
    compareProducts: definition.compareProducts,
  });
  const listingAnalysis = buildListingAnalysis({
    product: definition.primaryProduct,
    compareProducts: definition.compareProducts,
    snapshot,
    seed: definition.listingSeed,
  });
  const reviewAnalysis = buildReviewAnalysis({
    product: definition.primaryProduct,
    compareProducts: definition.compareProducts,
    seed: definition.reviewSeed,
  });
  const analysisId = `demo:${definition.meta.id}`;
  const analysisContext: AnalysisContext = {
    searchId: `demo-search:${definition.meta.id}`,
    primaryKeyword: normalizeKeyword(definition.primaryKeyword),
    primaryAsin: definition.primaryProduct.asin,
    compareAsins: definition.compareProducts.map((product) => product.asin),
  };

  return {
    analysis: {
      analysisId,
      lifecycle,
      competition,
      marketOverview,
      recommendation: marketOverview.recommendation,
      summary: marketOverview.summary,
      trendSeries: definition.searchTrendSeries,
      productSnapshot: snapshot,
      listingAnalysis,
      reviewAnalysis,
      demoCase: definition.meta,
      explanationMeta: {
        ruleBased: true,
        llmAssisted: false,
        manualInputsUsed: [],
        generatedAt: new Date("2026-04-18T09:00:00.000Z").toISOString(),
        notes: [
          "这是稳定 demo 数据，适合演示和对照讨论。",
          "生命周期、竞争和市场结论仍来自当前规则引擎。",
          "评论分析使用 seeded summary，不伪装成实时评论抓取。",
        ],
      },
      dataSources: [
        demoSource([
          `Demo case: ${definition.meta.label}`,
          "使用固定 ASIN 和稳定产品信号，避免演示时受上游接口波动影响。",
          "分析结果仍由当前规则层生成，保持和真实链路一致的输出结构。",
        ]),
      ],
      cacheStatus: {
        state: "hit",
        key: analysisId,
        expiresAt: null,
      },
      missingData: reviewAnalysis.coverage === "seeded_summary" ? [] : ["没有直接评论文本。"],
      mode: "rule_based",
    },
    product: definition.primaryProduct,
    compareProducts: definition.compareProducts,
    analysisContext,
    latestInspiration: null,
    spApiStatus: getSpApiStatus(),
    demoCase: definition.meta,
  };
}

const BUILT_CASES = DEMO_CASES.map((entry) => buildDemoCaseData(entry));

export function isDemoAnalysisId(analysisId: string) {
  return analysisId.startsWith("demo:");
}

export function getDemoCasePageData(analysisId: string, asin: string) {
  const data = BUILT_CASES.find((entry) => entry.analysis.analysisId === analysisId);
  if (!data || data.product.asin !== asin) {
    return null;
  }

  return data;
}

export function getDemoCaseCards(): DemoCaseCard[] {
  return BUILT_CASES.map((entry) => ({
    id: entry.demoCase?.id ?? entry.analysis.analysisId,
    analysisId: entry.analysis.analysisId,
    asin: entry.product.asin,
    title: entry.product.title,
    imageUrl: entry.product.imageUrl,
    category: entry.product.category ?? "Unknown",
    label: entry.demoCase?.label ?? "Demo",
    explanation: entry.demoCase?.explanation ?? "",
    whyUseful: entry.demoCase?.whyUseful ?? "",
    lifecycleStage: entry.analysis.lifecycle.stage,
    competitionLevel: entry.analysis.competition.level,
    opportunityLevel: entry.analysis.marketOverview.opportunityLevel,
  }));
}
