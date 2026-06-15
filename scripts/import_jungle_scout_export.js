const fs = require("fs");
const path = require("path");

const CandidateNormalizer = require("../src/data_adapters/candidate_normalizer");
const { ROOT, ensureDir, readJsonFirst, writeJson } = require("./data_paths");

const INPUT_DIR = path.join(ROOT, "input", "browser_exports", "jungle_scout");
const REPORT_DIR = path.join(ROOT, "data", "product_research", "import_reports");
const CANDIDATE_RAW_PATH = "data/product_research/candidate_products_raw.json";
const CANDIDATE_PATH = "data/product_research/candidate_products.json";
const LEGACY_RAW_PATH = "data/candidate_products_raw.json";
const LEGACY_CANDIDATE_PATH = "data/candidate_products.json";
const SENSITIVE_PATTERN = /(password|apikey|api_key|secret|accesstoken|access_token|refreshtoken|refresh_token|cookie|session)/i;

const FIELD_ALIASES = {
  asin: ["ASIN", "asin", "Product ASIN"],
  parent_asin: ["Parent ASIN", "Parent", "parent_asin"],
  title: ["Title", "Product Name", "Name", "Product"],
  brand: ["Brand", "brand"],
  category: ["Category", "category", "Product Category"],
  reference_price: ["Price", "Current Price", "Avg Price", "Average Price"],
  estimated_monthly_sales: ["Monthly Sales", "Est. Sales", "Estimated Sales", "Sales"],
  estimated_monthly_revenue: ["Monthly Revenue", "Est. Revenue", "Revenue"],
  rating: ["Rating", "Star Rating"],
  review_count: ["Reviews", "Review Count", "Ratings"],
  bsr: ["BSR", "Rank", "Sales Rank"],
  jungle_scout_opportunity_score: ["Opportunity Score", "Opportunity", "Score"],
  fulfillment_fee_estimate: ["FBA Fees", "FBA Fee", "Fees"],
  net_profit_estimate: ["Net", "Net Profit", "Profit"],
  weight: ["Weight"],
  dimensions: ["Dimensions"],
  seller_type: ["Seller", "Seller Type"]
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && quoted && next === '"') {
      field += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(field);
      if (row.some(value => String(value).trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some(value => String(value).trim() !== "")) rows.push(row);
  if (!rows.length) return [];
  const headers = rows[0].map(value => String(value || "").replace(/^\uFEFF/, "").trim());
  return rows.slice(1).map(values => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = values[index] === undefined ? "" : values[index];
    });
    return record;
  });
}

function listCsvFiles() {
  ensureDir(INPUT_DIR);
  return fs.readdirSync(INPUT_DIR)
    .filter(file => /\.csv$/i.test(file))
    .map(file => path.join(INPUT_DIR, file));
}

function pick(row, aliases) {
  for (const alias of aliases) {
    if (row[alias] !== undefined && row[alias] !== "") return row[alias];
  }
  return "";
}

function toNumber(value, warnings, fieldName, sourceFile) {
  if (value === null || value === undefined || value === "") return null;
  const cleaned = String(value).replace(/[$,%\s,]/g, "");
  const number = Number(cleaned);
  if (!Number.isFinite(number)) {
    warnings.push(`Invalid numeric value for ${fieldName} in ${sourceFile}: ${value}`);
    return null;
  }
  return number;
}

function normalizeAsin(value) {
  const asin = String(value || "").trim().toUpperCase();
  return /^[A-Z0-9]{10}$/.test(asin) ? asin : "";
}

function unique(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function timestampSlug(date) {
  return date.toISOString().replace(/[:.]/g, "-").replace("Z", "");
}

function daysSince(dateString) {
  const time = new Date(dateString).getTime();
  if (!Number.isFinite(time)) return 0;
  return Math.max(0, Math.floor((Date.now() - time) / 86400000));
}

function dataFreshness(updatedAt) {
  const days = daysSince(updatedAt);
  if (days <= 14) return "fresh";
  if (days <= 30) return "aging";
  return "stale";
}

function candidateKey(candidate) {
  return candidate.asin ? `asin:${candidate.asin}` : `title:${String(candidate.title || "").toLowerCase()}`;
}

function isNewerOrEqual(incoming, existing) {
  if (!existing || !existing.updated_at) return true;
  return new Date(incoming.updated_at).getTime() >= new Date(existing.updated_at).getTime();
}

function hasSensitiveContent(value) {
  return SENSITIVE_PATTERN.test(JSON.stringify(value || {}));
}

function mapRow(row, sourceFile, updatedAt, warnings) {
  const raw = {};
  Object.entries(FIELD_ALIASES).forEach(([field, aliases]) => {
    raw[field] = pick(row, aliases);
  });

  const numericFields = [
    "reference_price",
    "estimated_monthly_sales",
    "estimated_monthly_revenue",
    "rating",
    "review_count",
    "bsr",
    "jungle_scout_opportunity_score",
    "fulfillment_fee_estimate",
    "net_profit_estimate"
  ];
  numericFields.forEach(field => {
    raw[field] = toNumber(raw[field], warnings, field, sourceFile);
  });

  const asin = normalizeAsin(raw.asin);
  const parentAsin = normalizeAsin(raw.parent_asin);
  const title = String(raw.title || "").trim();
  const category = String(raw.category || "").trim();
  const keywordText = [title, category, raw.brand].filter(Boolean).join(" ");
  const opportunityScore = Number(raw.jungle_scout_opportunity_score || 0);

  return {
    asin,
    parent_asin: parentAsin,
    title,
    brand: String(raw.brand || "").trim(),
    category,
    reference_price: raw.reference_price,
    estimated_monthly_sales: raw.estimated_monthly_sales,
    estimated_monthly_revenue: raw.estimated_monthly_revenue,
    sales_confidence: "medium",
    sales_source: "jungle_scout",
    rating: raw.rating,
    review_count: raw.review_count,
    bsr: raw.bsr,
    jungle_scout_opportunity_score: raw.jungle_scout_opportunity_score,
    fulfillment_fee_estimate: raw.fulfillment_fee_estimate,
    net_profit_estimate: raw.net_profit_estimate,
    weight: String(raw.weight || "").trim(),
    dimensions: String(raw.dimensions || "").trim(),
    seller_type: String(raw.seller_type || "").trim(),
    recommendation_sources: unique(["market_opportunity", "jungle_scout_import"]),
    opportunity_type: "market_import",
    timing_window: "unknown",
    seasonal_attribute: "unknown",
    complexity_level: "unknown",
    size_risk: "unknown",
    compliance_risk: "unknown",
    market_score: opportunityScore ? Math.round(opportunityScore / 5) : 12,
    seasonality_score: 0,
    store_fit_score: 0,
    profit_potential_score: 0,
    risk_score: 0,
    keywords: keywordText.toLowerCase().split(/\s+/).filter(token => token.length > 2).slice(0, 12),
    market_situation: "Imported from Jungle Scout CSV; validate with store fit and duplicate filters before acting.",
    use_case: "Browser-assisted product candidate import for Amazon US opportunity screening.",
    store_relation: "Store relation will be evaluated by the recommendation engine.",
    why_recommended: "Jungle Scout export supplied candidate demand and market fields.",
    main_risks: "CSV export may be stale or incomplete; verify competition, reviews, and landed cost.",
    next_step: "Run recommendation audit and review duplicate/store-fit filters before adding to watchlist.",
    source: "jungle_scout_csv",
    source_file: sourceFile,
    updated_at: updatedAt,
    data_freshness: dataFreshness(updatedAt),
    raw_fields: row
  };
}

function mergeCandidate(existing, incoming) {
  if (!existing) return incoming;
  if (!isNewerOrEqual(incoming, existing)) {
    return {
      ...existing,
      recommendation_sources: unique([...(existing.recommendation_sources || []), "jungle_scout_import"])
    };
  }
  return {
    ...existing,
    ...incoming,
    notes: existing.notes || incoming.notes || "",
    recommendation_sources: unique([...(existing.recommendation_sources || []), ...(incoming.recommendation_sources || [])]),
    keepa_enriched: existing.keepa_enriched,
    keepa_missing: existing.keepa_missing,
    keepa_updated_at: existing.keepa_updated_at,
    review_pain_points: existing.review_pain_points,
    review_analysis_summary: existing.review_analysis_summary
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

function main() {
  ensureDir(INPUT_DIR);
  ensureDir(REPORT_DIR);
  ensureDir(path.join(ROOT, "data", "product_research", "backups"));

  const importedAt = new Date();
  const updatedAt = importedAt.toISOString();
  const warnings = [];
  const errors = [];
  const files = listCsvFiles();
  let rawRows = 0;
  let skippedMissingAsin = 0;
  let missingTitleCount = 0;
  let missingPriceCount = 0;
  let missingSalesCount = 0;
  let duplicateAsinCount = 0;

  const importedByAsin = new Map();
  const filesProcessed = [];

  for (const filePath of files) {
    const sourceFile = path.relative(ROOT, filePath).replace(/\\/g, "/");
    try {
      const rows = parseCsv(fs.readFileSync(filePath, "utf8"));
      filesProcessed.push(sourceFile);
      rawRows += rows.length;
      rows.forEach(row => {
        if (hasSensitiveContent(row)) {
          warnings.push(`Sensitive-looking field name or value skipped in ${sourceFile}.`);
        }
        const candidate = mapRow(row, sourceFile, updatedAt, warnings);
        if (!candidate.asin) {
          skippedMissingAsin += 1;
          warnings.push(`Skipped row without valid ASIN in ${sourceFile}.`);
          return;
        }
        if (!candidate.title) missingTitleCount += 1;
        if (candidate.reference_price === null) missingPriceCount += 1;
        if (candidate.estimated_monthly_sales === null) missingSalesCount += 1;
        if (importedByAsin.has(candidate.asin)) duplicateAsinCount += 1;
        importedByAsin.set(candidate.asin, mergeCandidate(importedByAsin.get(candidate.asin), candidate));
      });
    } catch (error) {
      errors.push(`Could not read ${sourceFile}: ${error.message}`);
    }
  }

  const existingRaw = readJsonFirst([CANDIDATE_RAW_PATH, LEGACY_RAW_PATH], []);
  const existingNormalized = readJsonFirst([CANDIDATE_PATH, LEGACY_CANDIDATE_PATH], []);
  if (existingNormalized.length) {
    const backupName = `candidate_products_${timestampSlug(importedAt)}.json`;
    writeJson(`data/product_research/backups/${backupName}`, existingNormalized);
  }

  const rawByKey = new Map((existingRaw || []).map(item => [candidateKey(item), item]));
  const normalizedByKey = new Map((existingNormalized || []).map(item => [candidateKey(item), item]));
  const context = buildContext();

  let mergedExistingCount = 0;
  let newCandidateCount = 0;
  const importedRaw = Array.from(importedByAsin.values());
  const normalizedImports = CandidateNormalizer.normalizeCandidates(importedRaw, {
    seasonalCalendar: context.seasonalCalendar,
    expansionOpportunities: context.expansionOpportunities,
    profileSummary: context.profileSummary,
    exclusionRules: context.exclusionRules,
    storeProducts: context.storeProducts,
    currentMonth: context.seasonalCalendar.current_month
  });

  importedRaw.forEach(candidate => {
    const key = candidateKey(candidate);
    if (rawByKey.has(key)) mergedExistingCount += 1;
    else newCandidateCount += 1;
    rawByKey.set(key, mergeCandidate(rawByKey.get(key), candidate));
  });

  normalizedImports.forEach(candidate => {
    const key = candidateKey(candidate);
    normalizedByKey.set(key, mergeCandidate(normalizedByKey.get(key), candidate));
  });

  const mergedRaw = Array.from(rawByKey.values());
  const mergedNormalized = Array.from(normalizedByKey.values());
  const report = {
    imported_at: updatedAt,
    files_processed: filesProcessed,
    raw_rows: rawRows,
    imported_count: importedByAsin.size,
    skipped_missing_asin: skippedMissingAsin,
    duplicate_asin_count: duplicateAsinCount,
    merged_existing_count: mergedExistingCount,
    new_candidate_count: newCandidateCount,
    missing_title_count: missingTitleCount,
    missing_price_count: missingPriceCount,
    missing_sales_count: missingSalesCount,
    warnings: files.length ? warnings : ["No Jungle Scout CSV files found under input/browser_exports/jungle_scout. Existing candidate pool was left unchanged."],
    errors
  };

  if (files.length) {
    writeJson(CANDIDATE_RAW_PATH, mergedRaw);
    writeJson(CANDIDATE_PATH, mergedNormalized);
    writeJson(LEGACY_RAW_PATH, mergedRaw);
    writeJson(LEGACY_CANDIDATE_PATH, mergedNormalized);
  }

  writeJson("data/product_research/import_reports/jungle_scout_import_latest.json", report);
  writeJson(`data/product_research/import_reports/jungle_scout_import_${timestampSlug(importedAt)}.json`, report);

  console.log("Jungle Scout Import Complete");
  console.log("");
  console.log(`Files processed: ${filesProcessed.length}`);
  console.log(`Raw rows: ${rawRows}`);
  console.log(`Imported: ${importedByAsin.size}`);
  console.log(`New candidates: ${newCandidateCount}`);
  console.log(`Merged existing: ${mergedExistingCount}`);
  console.log(`Skipped missing ASIN: ${skippedMissingAsin}`);
  console.log(`Duplicates: ${duplicateAsinCount}`);
  console.log(`Warnings: ${report.warnings.length}`);
  console.log("");
  console.log("Next:");
  console.log("npm run audit:all");

  if (errors.length) process.exitCode = 1;
}

main();
