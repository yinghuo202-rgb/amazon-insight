const fs = require("fs");
const path = require("path");

const CandidateNormalizer = require("../src/data_adapters/candidate_normalizer");
const JungleScoutProvider = require("../src/providers/jungleScoutProvider");
const { ROOT, ensureDir, readJsonFirst, writeJson } = require("./data_paths");

const CANDIDATE_RAW_PATH = "data/product_research/candidate_products_raw.json";
const CANDIDATE_PATH = "data/product_research/candidate_products.json";
const LEGACY_RAW_PATH = "data/candidate_products_raw.json";
const LEGACY_CANDIDATE_PATH = "data/candidate_products.json";

function argValue(name, fallback = "") {
  const prefix = `--${name}=`;
  const item = process.argv.find(value => value.startsWith(prefix));
  return item ? item.slice(prefix.length) : fallback;
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const number = Number(String(value).replace(/[$,%\s,]/g, ""));
  return Number.isFinite(number) ? number : null;
}

function normalizeAsin(value) {
  const asin = String(value || "").trim().toUpperCase();
  return /^[A-Z0-9]{10}$/.test(asin) ? asin : "";
}

function extractAsin(value) {
  const text = String(value || "").toUpperCase();
  const match = text.match(/[A-Z0-9]{10}/);
  return match ? match[0] : "";
}

function unique(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function getField(source, aliases) {
  for (const alias of aliases) {
    if (source && source[alias] !== undefined && source[alias] !== null && source[alias] !== "") {
      return source[alias];
    }
  }
  return "";
}

function stringifyDimension(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function timestampSlug(date) {
  return date.toISOString().replace(/[:.]/g, "-").replace("Z", "");
}

function candidateKey(candidate) {
  return candidate.asin ? `asin:${candidate.asin}` : `title:${String(candidate.title || "").toLowerCase()}`;
}

function mergeCandidate(existing, incoming) {
  if (!existing) return incoming;
  return {
    ...existing,
    ...incoming,
    recommendation_sources: unique([...(existing.recommendation_sources || []), ...(incoming.recommendation_sources || [])]),
    keepa_enriched: existing.keepa_enriched,
    keepa_missing: existing.keepa_missing,
    keepa_updated_at: existing.keepa_updated_at,
    review_pain_points: existing.review_pain_points,
    review_analysis_summary: existing.review_analysis_summary
  };
}

function readConfig() {
  const localPath = path.join(ROOT, "config", "jungle_scout.config.local.json");
  const config = fs.existsSync(localPath)
    ? readJsonFirst(["config/jungle_scout.config.local.json"], {})
    : readJsonFirst(["config/jungle_scout.config.example.json"], {});
  return JungleScoutProvider.normalizeConfig({
    ...config,
    enabled: true,
    requestMode: "api",
    maxBatchSize: Number(argValue("page-size", process.env.JUNGLE_SCOUT_API_PAGE_SIZE || config.maxBatchSize || 25))
  });
}

function readApiFileEnv(config) {
  const desktopApiPath = path.join(process.env.USERPROFILE || "", "Desktop", "api.txt");
  const apiFilePath = process.env.JUNGLE_SCOUT_API_FILE || desktopApiPath;
  const env = { ...process.env };
  if (env[config.authEnv] || (env[config.keyNameEnv] && env[config.apiKeyEnv])) {
    return { env, source: "environment", fileFound: fs.existsSync(apiFilePath) };
  }
  if (!fs.existsSync(apiFilePath)) {
    return { env, source: "missing", fileFound: false };
  }
  const text = fs.readFileSync(apiFilePath, "utf8").replace(/^\uFEFF/, "").trim();
  const parsed = JungleScoutProvider.parseAuth(text);
  if (parsed.keyName && parsed.apiKey) {
    env[config.authEnv] = text;
    return { env, source: "desktop_api_txt", fileFound: true };
  }
  if (text) {
    env[config.apiKeyEnv] = text;
    return { env, source: "desktop_api_txt_api_key_only", fileFound: true };
  }
  return { env, source: "invalid_api_txt", fileFound: true };
}

function loadKeywords() {
  const explicit = argValue("keywords", "");
  if (explicit) {
    return explicit.split(",").map(value => value.trim()).filter(Boolean);
  }
  const tasks = readJsonFirst(["data/product_research/jungle_scout_keyword_tasks.json"], { tasks: [] });
  return (tasks.tasks || []).map(task => task.keyword).filter(Boolean);
}

function mapApiRecord(record, keyword, importedAt) {
  const attrs = record && record.attributes ? record.attributes : (record || {});
  const asin = normalizeAsin(getField(attrs, ["asin", "ASIN"])) || extractAsin(record.id);
  const title = String(getField(attrs, ["title", "name", "product_title", "product_name"]) || "").trim();
  const category = String(getField(attrs, ["category", "category_name", "category_path", "product_category", "breadcrumb_path"]) || "").trim();
  const brand = String(getField(attrs, ["brand", "brand_name"]) || "").trim();
  const price = toNumber(getField(attrs, ["price", "current_price", "list_price", "buy_box_price", "average_price"]));
  const sales = toNumber(getField(attrs, ["estimated_monthly_sales", "monthly_sales", "units_sold", "sales", "approximate_30_day_units_sold"]));
  const revenue = toNumber(getField(attrs, ["estimated_monthly_revenue", "monthly_revenue", "revenue", "approximate_30_day_revenue"]));
  const reviews = toNumber(getField(attrs, ["reviews", "review_count", "reviews_count", "ratings_count"]));
  const rating = toNumber(getField(attrs, ["rating", "star_rating", "average_rating"]));
  const bsr = toNumber(getField(attrs, ["rank", "bsr", "sales_rank", "product_rank"]));
  const opportunityScore = toNumber(getField(attrs, ["opportunity_score", "jungle_scout_opportunity_score", "score", "listing_quality_score"]));
  const dimensions = [
    getField(attrs, ["length_value"]) ? `L ${getField(attrs, ["length_value"])}` : "",
    getField(attrs, ["width_value"]) ? `W ${getField(attrs, ["width_value"])}` : "",
    getField(attrs, ["height_value"]) ? `H ${getField(attrs, ["height_value"])}` : "",
    getField(attrs, ["dimensions_unit"]) || ""
  ].filter(Boolean).join(" ");
  const weight = [
    getField(attrs, ["weight_value"]),
    getField(attrs, ["weight_unit"])
  ].filter(Boolean).join(" ");

  return {
    asin,
    parent_asin: normalizeAsin(getField(attrs, ["parent_asin", "parent"])) || extractAsin(getField(attrs, ["parent_asin", "parent"])),
    title,
    brand,
    category,
    reference_price: price,
    estimated_monthly_sales: sales,
    estimated_monthly_revenue: revenue,
    sales_confidence: "medium",
    sales_source: "jungle_scout_api",
    rating,
    review_count: reviews,
    bsr,
    jungle_scout_opportunity_score: opportunityScore,
    fulfillment_fee_estimate: toNumber(getField(attrs, ["fulfillment_fee", "fba_fee", "fees"])),
    net_profit_estimate: toNumber(getField(attrs, ["net_profit", "profit", "estimated_profit"])),
    weight: String(getField(attrs, ["weight", "product_weight"]) || weight).trim(),
    dimensions: stringifyDimension(getField(attrs, ["dimensions", "product_dimensions"]) || dimensions),
    seller_type: String(getField(attrs, ["seller_type", "seller"]) || "").trim(),
    recommendation_sources: ["market_opportunity", "jungle_scout_api"],
    opportunity_type: "market_import",
    timing_window: "unknown",
    seasonal_attribute: "unknown",
    complexity_level: "unknown",
    size_risk: "unknown",
    compliance_risk: "unknown",
    market_score: opportunityScore ? Math.max(5, Math.round(opportunityScore / 5)) : 12,
    seasonality_score: 0,
    store_fit_score: 0,
    profit_potential_score: 0,
    risk_score: 0,
    keywords: unique([keyword, title, category, brand].join(" ").toLowerCase().split(/\s+/).filter(token => token.length > 2)).slice(0, 16),
    market_situation: "Imported from Jungle Scout API; validate demand, competition, review issues, and landed cost before acting.",
    use_case: `Amazon US product candidate discovered from keyword: ${keyword}.`,
    store_relation: "Store relation will be evaluated by the recommendation engine.",
    why_recommended: "Jungle Scout API supplied product database demand and market fields.",
    main_risks: "API fields can be incomplete; verify supplier cost, review complaints, and duplicate proximity.",
    next_step: "Run recommendation audit, duplicate filtering, and supplier cost validation.",
    source: "jungle_scout_api",
    source_file: `api:${keyword}`,
    updated_at: importedAt,
    data_freshness: "fresh",
    raw_fields: {
      id: record.id || "",
      type: record.type || "",
      attributes: attrs
    }
  };
}

function buildContext() {
  return {
    seasonalCalendar: readJsonFirst(["data/product_research/seasonal_calendar.json", "data/seasonal_calendar.json"], {}),
    expansionOpportunities: readJsonFirst(["data/store/store_expansion_opportunities.json", "data/store_expansion_opportunities.json"], { opportunities: [] }),
    profileSummary: readJsonFirst(["data/store/store_profile_summary.json", "data/store_profile_summary.json"], {}),
    exclusionRules: readJsonFirst(["data/store/store_exclusion_rules.json", "data/store_exclusion_rules.json"], {}),
    storeProducts: readJsonFirst(["data/store/store_product_profile_merged.json", "data/store_product_profile_merged.json"], [])
  };
}

async function main() {
  ensureDir(path.join(ROOT, "data", "product_research", "backups"));
  ensureDir(path.join(ROOT, "data", "product_research", "import_reports"));
  const config = readConfig();
  const credentialEnv = readApiFileEnv(config);
  const status = JungleScoutProvider.getStatus(config, credentialEnv.env);
  if (!status.ready) {
    writeJson("data/product_research/import_reports/jungle_scout_api_import_latest.json", {
      imported_at: new Date().toISOString(),
      credential_source: credentialEnv.source,
      key_name_present: status.keyNamePresent,
      key_name_masked: status.keyNameMasked,
      api_key_present: status.apiKeyPresent,
      api_key_masked: status.apiKeyMasked,
      external_requests_made: 0,
      imported_count: 0,
      warnings: status.warnings,
      errors: ["Jungle Scout API provider is not ready."]
    });
    throw new Error(`Jungle Scout API provider is not ready: ${status.warnings.join(" ")}`);
  }

  const importedAtDate = new Date();
  const importedAt = importedAtDate.toISOString();
  const allKeywords = loadKeywords();
  const limit = Number(argValue("limit", process.env.JUNGLE_SCOUT_API_KEYWORD_LIMIT || 3));
  const keywords = allKeywords.slice(0, Math.max(1, limit));
  const warnings = [];
  const errors = [];
  const importedByAsin = new Map();
  const requests = [];

  for (const keyword of keywords) {
    try {
      const result = await JungleScoutProvider.searchByKeyword({ keyword, config, env: credentialEnv.env });
      const records = result.data || [];
      requests.push({ keyword, status: result.status, rows: records.length, external_request_made: result.external_request_made });
      records.forEach(record => {
        const candidate = mapApiRecord(record, keyword, importedAt);
        if (!candidate.asin) {
          warnings.push(`Skipped API record without valid ASIN for keyword: ${keyword}`);
          return;
        }
        importedByAsin.set(candidate.asin, mergeCandidate(importedByAsin.get(candidate.asin), candidate));
      });
    } catch (error) {
      const detail = error.status ? `HTTP ${error.status}` : error.message;
      errors.push(`Keyword "${keyword}" failed: ${detail}`);
      requests.push({ keyword, status: "failed", rows: 0, external_request_made: Boolean(error.status) });
    }
  }

  const importedRaw = Array.from(importedByAsin.values());
  const existingRaw = readJsonFirst([CANDIDATE_RAW_PATH, LEGACY_RAW_PATH], []);
  const existingNormalized = readJsonFirst([CANDIDATE_PATH, LEGACY_CANDIDATE_PATH], []);
  if (existingNormalized.length && importedRaw.length) {
    writeJson(`data/product_research/backups/candidate_products_${timestampSlug(importedAtDate)}.json`, existingNormalized);
  }

  const rawByKey = new Map((existingRaw || []).map(item => [candidateKey(item), item]));
  const normalizedByKey = new Map((existingNormalized || []).map(item => [candidateKey(item), item]));
  const context = buildContext();
  let mergedExistingCount = 0;
  let newCandidateCount = 0;

  importedRaw.forEach(candidate => {
    const key = candidateKey(candidate);
    if (rawByKey.has(key)) mergedExistingCount += 1;
    else newCandidateCount += 1;
    rawByKey.set(key, mergeCandidate(rawByKey.get(key), candidate));
  });

  const normalizedImports = CandidateNormalizer.normalizeCandidates(importedRaw, {
    seasonalCalendar: context.seasonalCalendar,
    expansionOpportunities: context.expansionOpportunities,
    profileSummary: context.profileSummary,
    exclusionRules: context.exclusionRules,
    storeProducts: context.storeProducts,
    currentMonth: context.seasonalCalendar.current_month
  });
  normalizedImports.forEach(candidate => {
    const key = candidateKey(candidate);
    normalizedByKey.set(key, mergeCandidate(normalizedByKey.get(key), candidate));
  });

  if (importedRaw.length) {
    const mergedRaw = Array.from(rawByKey.values());
    const mergedNormalized = Array.from(normalizedByKey.values());
    writeJson(CANDIDATE_RAW_PATH, mergedRaw);
    writeJson(CANDIDATE_PATH, mergedNormalized);
    writeJson(LEGACY_RAW_PATH, mergedRaw);
    writeJson(LEGACY_CANDIDATE_PATH, mergedNormalized);
  }

  const report = {
    imported_at: importedAt,
    credential_source: credentialEnv.source,
    key_name_present: status.keyNamePresent,
    key_name_masked: status.keyNameMasked,
    api_key_present: status.apiKeyPresent,
    api_key_masked: status.apiKeyMasked,
    external_requests_made: requests.filter(item => item.external_request_made).length,
    keywords_requested: keywords,
    requests,
    imported_count: importedByAsin.size,
    new_candidate_count: newCandidateCount,
    merged_existing_count: mergedExistingCount,
    missing_title_count: importedRaw.filter(item => !item.title).length,
    missing_price_count: importedRaw.filter(item => item.reference_price === null).length,
    missing_sales_count: importedRaw.filter(item => item.estimated_monthly_sales === null).length,
    warnings,
    errors
  };

  writeJson("data/product_research/import_reports/jungle_scout_api_import_latest.json", report);
  writeJson(`data/product_research/import_reports/jungle_scout_api_import_${timestampSlug(importedAtDate)}.json`, report);

  console.log("Jungle Scout API Import Complete");
  console.log(`Keywords requested: ${keywords.length}`);
  console.log(`External requests made: ${report.external_requests_made}`);
  console.log(`Imported candidates: ${report.imported_count}`);
  console.log(`New candidates: ${newCandidateCount}`);
  console.log(`Merged existing: ${mergedExistingCount}`);
  console.log(`Warnings: ${warnings.length}`);
  console.log(`Errors: ${errors.length}`);
  if (errors.length) {
    errors.forEach(error => console.log(`- ${error}`));
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
