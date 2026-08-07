import "server-only";

import {
  type ApiMode,
  candidateKeywordSchema,
  type CandidateKeyword,
  candidateProductSchema,
  type CandidateProduct,
  type DataSourceStatus,
  type TrendPoint,
} from "@/lib/contracts";
import { getJungleScoutCredentialStatus } from "@/lib/junglescout/settings";
import {
  asInt,
  asNumber,
  asString,
  buildFreshness,
  clamp,
  hashString,
  makeProductImage,
  normalizeKeyword,
  titleCase,
} from "@/lib/utils";

const API_BASE_URL =
  process.env.JS_API_BASE_URL?.trim().replace(/\/+$/, "") || "https://developer.junglescout.com/api";

const DEFAULT_ENDPOINTS = {
  keywordsByKeyword: {
    path: process.env.JS_ENDPOINT_KEYWORDS_BY_KEYWORD || "/keywords/keywords_by_keyword_query",
    resourceType: process.env.JS_RESOURCE_TYPE_KEYWORDS_BY_KEYWORD || "keywords_by_keyword_query",
  },
  productDatabase: {
    path: process.env.JS_ENDPOINT_PRODUCT_DATABASE || "/product_database_query",
    resourceType: process.env.JS_RESOURCE_TYPE_PRODUCT_DATABASE || "product_database_query",
  },
  keywordsByAsin: {
    path: process.env.JS_ENDPOINT_KEYWORDS_BY_ASIN || "/keywords/keywords_by_asin_query",
    resourceType: process.env.JS_RESOURCE_TYPE_KEYWORDS_BY_ASIN || "keywords_by_asin_query",
  },
  historicalSearchVolume: {
    path: process.env.JS_ENDPOINT_HISTORICAL_SEARCH_VOLUME || "/keywords/historical_search_volume",
  },
  salesEstimates: {
    path: process.env.JS_ENDPOINT_SALES_ESTIMATES || "/sales_estimates_query",
  },
  shareOfVoice: {
    path: process.env.JS_ENDPOINT_SHARE_OF_VOICE || "/share_of_voice",
  },
} as const;

const MARKETPLACE_CATEGORIES: Record<string, string[]> = {
  us: [
    "Appliances",
    "Arts, Crafts & Sewing",
    "Automotive",
    "Baby",
    "Beauty & Personal Care",
    "Camera & Photo",
    "Cell Phones & Accessories",
    "Clothing, Shoes & Jewelry",
    "Computers & Accessories",
    "Electronics",
    "Grocery & Gourmet Food",
    "Health & Household",
    "Home & Kitchen",
    "Industrial & Scientific",
    "Kitchen & Dining",
    "Musical Instruments",
    "Office Products",
    "Patio, Lawn & Garden",
    "Pet Supplies",
    "Software",
    "Sports & Outdoors",
    "Tools & Home Improvement",
    "Toys & Games",
    "Video Games",
  ],
};

type JsonApiResource = {
  id?: string;
  type?: string;
  attributes?: Record<string, unknown>;
};

type JsonApiResponse = {
  data?: JsonApiResource | JsonApiResource[];
  errors?: Array<{ detail?: string; title?: string }>;
  error?: string;
  message?: string;
};

type QueryValue = string | number | boolean | null | undefined;

type SearchDiscovery = {
  mode: ApiMode;
  sourceStatus: DataSourceStatus["status"];
  keywords: CandidateKeyword[];
  products: CandidateProduct[];
  diagnostics: string[];
};

export type MarketSignals = {
  mode: ApiMode;
  sourceStatus: DataSourceStatus["status"];
  keywordAssociations: CandidateKeyword[];
  searchTrendSeries: TrendPoint[];
  salesTrendSeries: TrendPoint[];
  shareOfVoice: Array<{ brand: string; share: number }>;
  diagnostics: string[];
};

export class JungleScoutError extends Error {
  status?: number;
  code: string;

  constructor(message: string, code = "upstream_error", status?: number) {
    super(message);
    this.name = "JungleScoutError";
    this.code = code;
    this.status = status;
  }
}

function getMarketplace() {
  return process.env.JS_MARKETPLACE?.trim().toLowerCase() || "us";
}

function getMarketplaceCategories() {
  return MARKETPLACE_CATEGORIES[getMarketplace()];
}

function shouldPreferMockMode() {
  return process.env.JS_USE_MOCK?.trim().toLowerCase() === "true";
}

function buildUrl(path: string, params?: Record<string, QueryValue>) {
  const url = new URL(`${API_BASE_URL}${path}`);

  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null || value === "") {
      continue;
    }

    url.searchParams.set(key, String(value));
  }

  return url.toString();
}

function getHeaders(authorization: string) {
  return {
    Accept: "application/vnd.junglescout.v1+json",
    Authorization: authorization,
    "Content-Type": "application/vnd.api+json",
    X_API_Type: process.env.JS_API_TYPE?.trim() || "junglescout",
  };
}

function getResourceArray(response: JsonApiResponse) {
  if (Array.isArray(response.data)) {
    return response.data;
  }

  if (response.data) {
    return [response.data];
  }

  return [];
}

function getFirstDefined(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && `${value}`.trim().length > 0) {
      return value;
    }
  }

  return undefined;
}

function normalizeTrendValue(value: number | null) {
  if (value === null) {
    return null;
  }

  return Math.abs(value) > 1 ? value / 100 : value;
}

function formatMonthLabel(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("zh-CN", {
    month: "short",
    year: "2-digit",
  });
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

function getFallbackDiagnostic(context: string, error: unknown) {
  if (error instanceof JungleScoutError) {
    const suffix = error.status ? `（HTTP ${error.status}）` : "";
    return `${context}失败，已回退到 mock${suffix}：${error.message}`;
  }

  if (error instanceof Error) {
    return `${context}失败，已回退到 mock：${error.message}`;
  }

  return `${context}失败，已回退到 mock。`;
}

function mapKeywordResource(resource: JsonApiResource): CandidateKeyword {
  const attributes = resource.attributes ?? {};
  const keyword = asString(
    getFirstDefined(attributes, ["name", "keyword", "query", "search_term", "term"]) ?? resource.id,
  );
  const searchVolume = asInt(
    getFirstDefined(attributes, [
      "monthly_search_volume_exact",
      "monthly_search_volume_broad",
      "search_volume",
      "monthly_volume",
      "volume",
    ]),
    null,
  );
  const trendScore = normalizeTrendValue(
    asNumber(
      getFirstDefined(attributes, ["monthly_trend", "quarterly_trend", "trend_score"]),
      null,
    ),
  );
  const difficultyScore = asNumber(
    getFirstDefined(attributes, [
      "ease_of_ranking_score",
      "difficulty_score",
      "keyword_difficulty",
      "difficulty",
    ]),
    null,
  );
  const relevance = asNumber(getFirstDefined(attributes, ["relevancy_score", "relevance", "score"]), null);
  const cpc = asNumber(
    getFirstDefined(attributes, ["ppc_bid_exact", "ppc_bid_broad", "sp_brand_ad_bid", "cpc"]),
    null,
  );

  const difficulty =
    difficultyScore === null
      ? null
      : difficultyScore >= 70
        ? "high"
        : difficultyScore >= 40
          ? "medium"
          : "low";

  const trend =
    trendScore === null ? null : trendScore > 0.08 ? "up" : trendScore < -0.08 ? "down" : "steady";

  return candidateKeywordSchema.parse({
    keyword,
    searchVolume,
    trend,
    difficulty,
    relevance,
    cpc,
    rawJson: attributes,
  });
}

function mapProductResource(resource: JsonApiResource, fallbackKeyword: string): CandidateProduct {
  const attributes = resource.attributes ?? {};
  const asin = asString(getFirstDefined(attributes, ["asin", "parent_asin"]) ?? resource.id);
  const title = asString(getFirstDefined(attributes, ["title", "name", "product_title"]) ?? asin);
  const reviews = asInt(getFirstDefined(attributes, ["reviews", "variant_reviews", "review_count"]), null);
  const monthlyUnits = asInt(
    getFirstDefined(attributes, ["approximate_30_day_units_sold", "monthly_units", "estimated_units", "sales"]),
    null,
  );
  const monthlyRevenue = asNumber(
    getFirstDefined(attributes, ["approximate_30_day_revenue", "monthly_revenue", "revenue", "estimated_revenue"]),
    null,
  );

  let relevanceHint: string | null = null;
  if (reviews !== null && reviews < 300) {
    relevanceHint = "评论门槛偏低";
  } else if (monthlyUnits !== null && monthlyUnits > 1000) {
    relevanceHint = "销量较高";
  } else if (monthlyRevenue !== null && monthlyRevenue > 40000) {
    relevanceHint = "收入规模较高";
  }

  return candidateProductSchema.parse({
    asin,
    title,
    brand: asString(getFirstDefined(attributes, ["brand", "brand_name"]), "") || null,
    imageUrl:
      asString(getFirstDefined(attributes, ["image_url", "image", "main_image"]), "") ||
      makeProductImage(titleCase(fallbackKeyword)),
    price: asNumber(getFirstDefined(attributes, ["price", "listing_price", "sale_price"]), null),
    rating: asNumber(getFirstDefined(attributes, ["rating", "average_rating", "stars"]), null),
    reviews,
    category: asString(getFirstDefined(attributes, ["category", "dominant_category"]), "") || null,
    monthlyUnits,
    monthlyRevenue,
    sourceKeyword: fallbackKeyword,
    relevanceHint,
    rawJson: attributes,
  });
}

async function requestJsonApi(input: {
  authorization: string;
  method: "GET" | "POST";
  path: string;
  params?: Record<string, QueryValue>;
  resourceType?: string;
  attributes?: Record<string, unknown>;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  const url = buildUrl(input.path, input.params);

  try {
    const response = await fetch(url, {
      method: input.method,
      headers: getHeaders(input.authorization),
      body:
        input.method === "POST"
          ? JSON.stringify({
              data: {
                type: input.resourceType,
                attributes: input.attributes ?? {},
              },
            })
          : undefined,
      signal: controller.signal,
      cache: "no-store",
    });

    const rawText = await response.text();
    let payload: JsonApiResponse = {};
    if (rawText.length > 0) {
      try {
        payload = JSON.parse(rawText) as JsonApiResponse;
      } catch {
        payload = { message: rawText };
      }
    }

    if (!response.ok) {
      const detail =
        payload.errors?.map((error) => error.detail || error.title).join(" / ") ||
        payload.error ||
        payload.message ||
        response.statusText;
      throw new JungleScoutError(detail, "api_error", response.status);
    }

    return payload;
  } catch (error) {
    if (error instanceof JungleScoutError) {
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new JungleScoutError("Jungle Scout 请求超时。", "timeout", 504);
    }

    throw new JungleScoutError("Jungle Scout 请求失败。", "request_failed", 500);
  } finally {
    clearTimeout(timeout);
  }
}

function buildMockKeywords(keyword: string) {
  const normalized = normalizeKeyword(keyword);
  const seed = hashString(normalized);
  const variants = [
    normalized,
    `${normalized} for travel`,
    `${normalized} with usb-c`,
    `best ${normalized}`,
    `${normalized} for small spaces`,
    `${normalized} mini`,
    `${normalized} premium`,
    `${normalized} for gifts`,
  ];

  return variants.slice(0, 8).map((entry, index) =>
    candidateKeywordSchema.parse({
      keyword: entry,
      searchVolume: 2800 + ((seed + index * 941) % 22000),
      trend: index < 3 ? "up" : index === 3 ? "steady" : "down",
      difficulty: index < 2 ? "medium" : index > 5 ? "low" : "high",
      relevance: clamp(0.95 - index * 0.08, 0.42, 0.95),
      cpc: Math.round((0.7 + ((seed % 900) + index * 13) / 1000) * 100) / 100,
      rawJson: { mock: true, seed },
    }),
  );
}

function buildMockProducts(keyword: string, keywords: CandidateKeyword[]) {
  const normalized = normalizeKeyword(keyword);
  const seed = hashString(normalized);
  const descriptors = ["Travel Bottle", "Compact Kit", "USB-C Edition", "Quiet Series", "Starter Bundle", "Family Pack", "Slim Design", "Pro Upgrade"];
  const brands = ["North Harbor", "LumaNest", "Arbor Peak", "Blue Mesa", "Halo Craft", "Morrow & Co", "Bright Theory", "Aster Lane"];

  return descriptors.map((descriptor, index) => {
    const asin = `B0${((seed + index * 9137) % 90000000).toString().padStart(8, "0")}`.slice(0, 10);
    const keywordRef = keywords[index % keywords.length]?.keyword ?? normalized;
    const price = Math.round((18 + ((seed + index * 11) % 47) + 0.99) * 100) / 100;
    const monthlyUnits = 260 + ((seed + index * 997) % 1400);
    const rating = Math.round((3.7 + (((seed + index * 29) % 13) / 10)) * 10) / 10;
    const reviews = 90 + ((seed + index * 241) % 2400);
    const sellerCount = 1 + ((seed + index * 3) % 9);
    const variantCount = 1 + ((seed + index * 5) % 8);
    const listingQualityScore = 45 + ((seed + index * 7) % 38);
    const ageMonths = 6 + ((seed + index * 17) % 48);
    const firstAvailable = new Date(new Date().getFullYear(), new Date().getMonth() - ageMonths, 1)
      .toISOString()
      .slice(0, 10);

    return candidateProductSchema.parse({
      asin,
      title: `${titleCase(normalized)} ${descriptor}`,
      brand: brands[index % brands.length],
      imageUrl: makeProductImage(`${titleCase(normalized)} ${index + 1}`),
      price,
      rating: clamp(rating, 3.7, 4.9),
      reviews,
      category: seed % 2 === 0 ? "Home & Kitchen" : seed % 3 === 0 ? "Pet Supplies" : "Sports & Outdoors",
      monthlyUnits,
      monthlyRevenue: Math.round(monthlyUnits * price),
      sourceKeyword: keywordRef,
      relevanceHint: index < 3 ? "贴近核心词" : index < 6 ? "类目距离较近" : "适合做参考竞品",
      rawJson: {
        mock: true,
        seed,
        keywordRef,
        seller_type: index % 3 === 0 ? "FBA" : "FBM",
        number_of_sellers: sellerCount,
        variants: new Array(variantCount).fill("variant"),
        listing_quality_score: listingQualityScore,
        product_rank: 200 + index * 73,
        product_tier: index % 2 === 0 ? "Small Standard-Size" : "Standard",
        date_first_available: firstAvailable,
        length_value: 4 + (index % 4) * 1.2,
        width_value: 3.4 + (index % 3) * 0.8,
        height_value: 2.6 + (index % 5) * 0.6,
        dimensions_unit: "in",
      },
    });
  });
}

function buildMockTrendSeries(keyword: string) {
  const normalized = normalizeKeyword(keyword);
  const seed = hashString(normalized);
  const now = new Date();

  return Array.from({ length: 12 }).map((_, index) => {
    const pointDate = new Date(now.getFullYear(), now.getMonth() - (11 - index), 1);
    const baseline = 4200 + (seed % 9000);
    const growth = 1 + index * 0.035 + ((seed % 7) - 3) * 0.01;
    const seasonal = Math.sin(index / 2.4) * 420;

    return {
      date: pointDate.toISOString(),
      value: Math.round(baseline * growth + seasonal),
      label: pointDate.toLocaleDateString("zh-CN", {
        month: "short",
        year: "2-digit",
      }),
    };
  });
}

function buildMockSalesSeries(primaryProduct: CandidateProduct) {
  const seed = hashString(primaryProduct.asin);
  const now = new Date();

  return Array.from({ length: 12 }).map((_, index) => {
    const pointDate = new Date(now.getFullYear(), now.getMonth() - (11 - index), 1);
    const baseline = primaryProduct.monthlyUnits ?? 500;
    const movement = baseline * (1 + index * 0.028 + ((seed % 5) - 2) * 0.012);
    const seasonal = Math.cos(index / 2) * 18;

    return {
      date: pointDate.toISOString(),
      value: Math.round(movement + seasonal),
      label: pointDate.toLocaleDateString("zh-CN", {
        month: "short",
        year: "2-digit",
      }),
    };
  });
}

function buildMockShareOfVoice(primaryProduct: CandidateProduct, compareProducts: CandidateProduct[]) {
  const products = [primaryProduct, ...compareProducts].slice(0, 5);
  const total = products.reduce((accumulator, product, index) => accumulator + ((product.reviews ?? 100) * (5 - index) + 100), 0);

  return products.map((product, index) => ({
    brand: product.brand || `Brand ${index + 1}`,
    share: clamp((((product.reviews ?? 100) * (5 - index) + 100) / total) * 100, 5, 55),
  }));
}

function buildMockDiscovery(keyword: string, sourceStatus: DataSourceStatus["status"], diagnostics: string[]): SearchDiscovery {
  const keywords = buildMockKeywords(keyword);
  const products = buildMockProducts(keyword, keywords);

  return {
    mode: "mock",
    sourceStatus,
    keywords,
    products,
    diagnostics,
  };
}

function buildMockSignals(
  input: {
    primaryKeyword: string;
    primaryProduct: CandidateProduct;
    compareProducts: CandidateProduct[];
  },
  sourceStatus: DataSourceStatus["status"],
  diagnostics: string[],
): MarketSignals {
  const { primaryKeyword, primaryProduct, compareProducts } = input;

  return {
    mode: "mock",
    sourceStatus,
    keywordAssociations: buildMockKeywords(primaryKeyword).slice(0, 6),
    searchTrendSeries: buildMockTrendSeries(primaryKeyword),
    salesTrendSeries: buildMockSalesSeries(primaryProduct),
    shareOfVoice: buildMockShareOfVoice(primaryProduct, compareProducts),
    diagnostics,
  };
}

function toTrendSeries(entries: Array<{ date: string; value: number | null | undefined }>): TrendPoint[] {
  return entries
    .filter((entry): entry is { date: string; value: number } => Boolean(entry.date) && typeof entry.value === "number" && Number.isFinite(entry.value))
    .sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime())
    .map((entry) => ({
      date: entry.date,
      value: entry.value,
      label: formatMonthLabel(entry.date),
    }));
}

function parseHistoricalSearchVolume(payload: JsonApiResponse) {
  return toTrendSeries(
    getResourceArray(payload).map((resource) => {
      const attributes = resource.attributes ?? {};
      return {
        date: asString(getFirstDefined(attributes, ["estimate_end_date", "estimate_start_date", "date", "month"])),
        value: asInt(getFirstDefined(attributes, ["estimated_exact_search_volume", "estimated_search_volume", "search_volume", "value"]), null),
      };
    }),
  );
}

function parseSalesEstimates(payload: JsonApiResponse) {
  return toTrendSeries(
    getResourceArray(payload).flatMap((resource) => {
      const attributes = resource.attributes ?? {};
      const rows = Array.isArray(attributes.data) ? (attributes.data as Array<Record<string, unknown>>) : [];

      return rows.map((row) => ({
        date: asString(getFirstDefined(row, ["date", "month"])),
        value: asInt(getFirstDefined(row, ["estimated_units_sold", "units", "sales", "value"]), null),
      }));
    }),
  );
}

function normalizeShareValue(value: unknown) {
  const numericValue = asNumber(value, null);
  if (numericValue === null) {
    return null;
  }

  return numericValue <= 1 ? numericValue * 100 : numericValue;
}

function parseShareOfVoice(payload: JsonApiResponse) {
  const resource = Array.isArray(payload.data) ? payload.data[0] : payload.data;
  const brands = Array.isArray(resource?.attributes?.brands) ? (resource.attributes.brands as Array<Record<string, unknown>>) : [];

  return brands
    .map((brand, index) => ({
      brand: asString(getFirstDefined(brand, ["brand", "name"]), "").trim() || `Brand ${index + 1}`,
      share: clamp(
        normalizeShareValue(
          getFirstDefined(brand, [
            "combined_weighted_sov",
            "combined_basic_sov",
            "organic_weighted_sov",
            "organic_basic_sov",
            "share",
          ]),
        ) ?? 0,
        0,
        100,
      ),
    }))
    .filter((entry) => entry.share > 0)
    .sort((left, right) => right.share - left.share);
}

function buildDateRange() {
  const end = new Date();
  const start = new Date(end.getFullYear(), end.getMonth() - 11, 1);

  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

function scoreCandidateProduct(product: CandidateProduct, keyword: string) {
  const normalizedKeyword = normalizeKeyword(keyword);
  const title = product.title.toLowerCase();
  const keywordTokens = normalizedKeyword.split(" ").filter(Boolean);
  const matchedTokens = keywordTokens.filter((token) => title.includes(token)).length;

  let score = 0;
  score += Math.min((product.monthlyRevenue ?? 0) / 2500, 32);
  score += Math.min((product.monthlyUnits ?? 0) / 120, 24);
  score += product.rating ? Math.max((product.rating - 3.7) * 12, 0) : 0;
  score += keywordTokens.length > 0 ? (matchedTokens / keywordTokens.length) * 18 : 0;

  if (product.reviews !== null) {
    if (product.reviews >= 250 && product.reviews <= 1800) {
      score += 12;
    } else if (product.reviews > 5000) {
      score -= 6;
    } else if (product.reviews < 60) {
      score -= 4;
    }
  }

  if (product.price !== null && product.price >= 15 && product.price <= 80) {
    score += 6;
  }

  return score;
}

export async function discoverFromSeedKeyword(keyword: string): Promise<SearchDiscovery> {
  const normalized = normalizeKeyword(keyword);
  const auth = await getJungleScoutCredentialStatus();

  if (shouldPreferMockMode()) {
    return buildMockDiscovery(normalized, auth.authorization ? "configured" : auth.sourceStatus, [
      ...auth.diagnostics,
      "已按配置强制使用 mock。",
    ]);
  }

  if (!auth.authorization) {
    return buildMockDiscovery(normalized, auth.sourceStatus, auth.diagnostics);
  }

  const diagnostics = [...auth.diagnostics];
  let sourceStatus: DataSourceStatus["status"] = "configured";

  const keywordResult = await requestJsonApi({
    authorization: auth.authorization,
    method: "POST",
    path: DEFAULT_ENDPOINTS.keywordsByKeyword.path,
    params: {
      marketplace: getMarketplace(),
      "page[size]": 8,
    },
    resourceType: DEFAULT_ENDPOINTS.keywordsByKeyword.resourceType,
    attributes: {
      search_terms: normalized,
      categories: getMarketplaceCategories(),
    },
  }).catch((error) => error);

  let keywords: CandidateKeyword[] = [];
  if (keywordResult instanceof Error) {
    sourceStatus = "partial";
    diagnostics.push(`关键词接口失败：${keywordResult.message}`);
    keywords = buildMockKeywords(normalized).slice(0, 6);
  } else {
    keywords = getResourceArray(keywordResult).map(mapKeywordResource).slice(0, 8);
    if (keywords.length === 0) {
      sourceStatus = "partial";
      diagnostics.push("关键词接口返回为空，已用规则关键词补齐。");
      keywords = buildMockKeywords(normalized).slice(0, 6);
    }
  }

  try {
    const includeKeywords = uniqueStrings([normalized, ...keywords.slice(0, 5).map((item) => item.keyword)]).slice(0, 6);
    const productPayload = await requestJsonApi({
      authorization: auth.authorization,
      method: "POST",
      path: DEFAULT_ENDPOINTS.productDatabase.path,
      params: {
        marketplace: getMarketplace(),
        "page[size]": 12,
        collapse_by_parent: "true",
      },
      resourceType: DEFAULT_ENDPOINTS.productDatabase.resourceType,
      attributes: {
        include_keywords: includeKeywords,
        categories: getMarketplaceCategories(),
      },
    });

    const dedupedProducts = new Map<string, CandidateProduct>();
    for (const resource of getResourceArray(productPayload)) {
      const product = mapProductResource(resource, normalized);
      if (!dedupedProducts.has(product.asin)) {
        dedupedProducts.set(product.asin, product);
      }
    }

    if (dedupedProducts.size === 0) {
      throw new JungleScoutError("商品接口返回为空。", "empty_live_result", 502);
    }

    diagnostics.push(`官方接口返回 ${keywords.length} 个关键词、${dedupedProducts.size} 个商品。`);

    return {
      mode: "live",
      sourceStatus,
      keywords,
      products: Array.from(dedupedProducts.values()).sort(
        (left, right) => scoreCandidateProduct(right, normalized) - scoreCandidateProduct(left, normalized),
      ),
      diagnostics,
    };
  } catch (error) {
    return buildMockDiscovery(normalized, "partial", [
      ...diagnostics,
      getFallbackDiagnostic("Jungle Scout 搜索", error),
      "当前搜索结果来自 mock 数据。",
    ]);
  }
}

export async function getMarketSignals(input: {
  primaryKeyword: string;
  primaryProduct: CandidateProduct;
  compareProducts: CandidateProduct[];
}): Promise<MarketSignals> {
  const auth = await getJungleScoutCredentialStatus();

  if (shouldPreferMockMode()) {
    return buildMockSignals(input, auth.authorization ? "configured" : auth.sourceStatus, [
      ...auth.diagnostics,
      "已按配置强制使用 mock。",
    ]);
  }

  if (!auth.authorization) {
    return buildMockSignals(input, auth.sourceStatus, auth.diagnostics);
  }

  const { primaryKeyword, primaryProduct, compareProducts } = input;
  const diagnostics = [...auth.diagnostics];
  const { startDate, endDate } = buildDateRange();
  const asins = uniqueStrings([primaryProduct.asin, ...compareProducts.map((product) => product.asin)]).slice(0, 10);

  const [keywordResult, trendResult, salesResult, shareResult] = await Promise.allSettled([
    requestJsonApi({
      authorization: auth.authorization,
      method: "POST",
      path: DEFAULT_ENDPOINTS.keywordsByAsin.path,
      params: {
        marketplace: getMarketplace(),
        "page[size]": 8,
      },
      resourceType: DEFAULT_ENDPOINTS.keywordsByAsin.resourceType,
      attributes: {
        asins,
        include_variants: true,
      },
    }),
    requestJsonApi({
      authorization: auth.authorization,
      method: "GET",
      path: DEFAULT_ENDPOINTS.historicalSearchVolume.path,
      params: {
        marketplace: getMarketplace(),
        keyword: primaryKeyword,
        start_date: startDate,
        end_date: endDate,
      },
    }),
    requestJsonApi({
      authorization: auth.authorization,
      method: "GET",
      path: DEFAULT_ENDPOINTS.salesEstimates.path,
      params: {
        marketplace: getMarketplace(),
        asin: primaryProduct.asin,
        start_date: startDate,
        end_date: endDate,
      },
    }),
    requestJsonApi({
      authorization: auth.authorization,
      method: "GET",
      path: DEFAULT_ENDPOINTS.shareOfVoice.path,
      params: {
        marketplace: getMarketplace(),
        keyword: primaryKeyword,
      },
    }),
  ]);

  let sourceStatus: DataSourceStatus["status"] = "configured";
  let successCount = 0;

  const keywordAssociations =
    keywordResult.status === "fulfilled"
      ? (() => {
          successCount += 1;
          return getResourceArray(keywordResult.value).map(mapKeywordResource).slice(0, 8);
        })()
      : (() => {
          sourceStatus = "partial";
          diagnostics.push(
            `ASIN 关键词接口失败：${
              keywordResult.reason instanceof Error ? keywordResult.reason.message : "未知错误"
            }`,
          );
          return buildMockKeywords(primaryKeyword).slice(0, 6);
        })();

  const searchTrendSeries =
    trendResult.status === "fulfilled"
      ? (() => {
          const liveSeries = parseHistoricalSearchVolume(trendResult.value);
          if (liveSeries.length > 0) {
            successCount += 1;
            return liveSeries;
          }

          sourceStatus = "partial";
          diagnostics.push("历史搜索量接口返回为空，已用规则趋势补齐。");
          return buildMockTrendSeries(primaryKeyword);
        })()
      : (() => {
          sourceStatus = "partial";
          diagnostics.push(
            `历史搜索量接口失败：${trendResult.reason instanceof Error ? trendResult.reason.message : "未知错误"}`,
          );
          return buildMockTrendSeries(primaryKeyword);
        })();

  const salesTrendSeries =
    salesResult.status === "fulfilled"
      ? (() => {
          const liveSeries = parseSalesEstimates(salesResult.value);
          if (liveSeries.length > 0) {
            successCount += 1;
            return liveSeries;
          }

          sourceStatus = "partial";
          diagnostics.push("销量估算接口返回为空，已用规则趋势补齐。");
          return buildMockSalesSeries(primaryProduct);
        })()
      : (() => {
          sourceStatus = "partial";
          diagnostics.push(
            `销量估算接口失败：${salesResult.reason instanceof Error ? salesResult.reason.message : "未知错误"}`,
          );
          return buildMockSalesSeries(primaryProduct);
        })();

  const shareOfVoice =
    shareResult.status === "fulfilled"
      ? (() => {
          const liveSov = parseShareOfVoice(shareResult.value);
          if (liveSov.length > 0) {
            successCount += 1;
            return liveSov;
          }

          sourceStatus = "partial";
          diagnostics.push("Share of Voice 接口返回为空，已用规则分布补齐。");
          return buildMockShareOfVoice(primaryProduct, compareProducts);
        })()
      : (() => {
          sourceStatus = "partial";
          diagnostics.push(
            `Share of Voice 接口失败：${shareResult.reason instanceof Error ? shareResult.reason.message : "未知错误"}`,
          );
          return buildMockShareOfVoice(primaryProduct, compareProducts);
        })();

  if (successCount === 0) {
    return buildMockSignals(input, "partial", [
      ...diagnostics,
      "官方分析接口没有返回可用数据，当前分析结果来自 mock。",
    ]);
  }

  diagnostics.push(`分析链路命中 ${successCount}/4 个官方接口。`);

  return {
    mode: "live",
    sourceStatus,
    keywordAssociations,
    searchTrendSeries,
    salesTrendSeries,
    shareOfVoice,
    diagnostics,
  };
}

export function buildJungleScoutDataSource(
  mode: ApiMode,
  sourceStatus: DataSourceStatus["status"],
  diagnostics: string[],
) {
  return {
    source: "junglescout" as const,
    label: "Jungle Scout",
    mode,
    status: sourceStatus,
    freshness:
      mode === "mock"
        ? "本地 mock 即时生成"
        : `官方接口返回于 ${buildFreshness(24, "live").generatedAt}`,
    details: diagnostics,
  };
}
