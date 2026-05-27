const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const CandidateNormalizer = require("../src/data_adapters/candidate_normalizer");
const { ROOT, ensureDir, readJsonFirst, writeJson } = require("./data_paths");

const INPUT_DIR = path.join(ROOT, "input");
const CSV_PATH = path.join(INPUT_DIR, "product_candidates.csv");
const XLSX_PATH = path.join(INPUT_DIR, "product_candidates.xlsx");

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
  const headers = rows[0].map(value => String(value || "").trim());
  return rows.slice(1).map(values => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = values[index] === undefined ? "" : values[index];
    });
    return record;
  });
}

function readInputRows() {
  if (fs.existsSync(CSV_PATH)) {
    return {
      sourceFile: "input/product_candidates.csv",
      rows: parseCsv(fs.readFileSync(CSV_PATH, "utf8"))
    };
  }
  if (fs.existsSync(XLSX_PATH)) {
    const workbook = XLSX.readFile(XLSX_PATH);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return {
      sourceFile: "input/product_candidates.xlsx",
      rows: XLSX.utils.sheet_to_json(sheet, { defval: "" })
    };
  }
  return { sourceFile: "", rows: [] };
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replace(/[$,%\s,]/g, ""));
  return Number.isFinite(number) ? number : null;
}

function normalizeAsin(value) {
  const asin = String(value || "").trim().toUpperCase();
  return /^[A-Z0-9]{10}$/.test(asin) ? asin : "";
}

function splitKeywords(value) {
  if (Array.isArray(value)) return value;
  return String(value || "")
    .split(/[,\n;|]/)
    .map(item => item.trim())
    .filter(Boolean);
}

function normalizeRawRow(row) {
  return {
    asin: normalizeAsin(row.asin || row.ASIN),
    parent_asin: normalizeAsin(row.parent_asin || row["Parent ASIN"]),
    title: String(row.title || row.Title || "").trim(),
    brand: String(row.brand || row.Brand || "").trim(),
    category: String(row.category || row.Category || "").trim(),
    reference_price: toNumber(row.price || row.reference_price),
    estimated_monthly_sales: toNumber(row.estimated_monthly_sales),
    estimated_monthly_sales_range: String(row.estimated_monthly_sales_range || "").trim(),
    sales_confidence: String(row.sales_confidence || "manual").trim() || "manual",
    rating: toNumber(row.rating),
    review_count: toNumber(row.review_count),
    bsr: toNumber(row.bsr),
    source: String(row.source || "manual_csv_import").trim() || "manual_csv_import",
    keywords: splitKeywords(row.keywords),
    notes: String(row.notes || "").trim()
  };
}

function countBy(items, key) {
  return items.reduce((counts, item) => {
    const value = item[key] || "unknown";
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

function main() {
  ensureDir(path.join(ROOT, "data", "product_research"));
  const { sourceFile, rows } = readInputRows();
  if (!sourceFile) {
    const report = {
      imported_at: new Date().toISOString(),
      source_file: "",
      raw_count: 0,
      normalized_count: 0,
      duplicate_asin_count: 0,
      missing_asin_count: 0,
      missing_title_count: 0,
      missing_price_count: 0,
      missing_sales_count: 0,
      source_distribution: {},
      warnings: ["No input/product_candidates.csv or input/product_candidates.xlsx file found. Existing candidate pool was left unchanged."],
      errors: []
    };
    writeJson("data/product_research/candidate_data_report.json", report);
    writeJson("data/candidate_data_report.json", report);
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const rawRecords = rows.map(normalizeRawRow);
  const missingAsin = rawRecords.filter(item => !item.asin).length;
  const missingTitle = rawRecords.filter(item => !item.title).length;
  const missingPrice = rawRecords.filter(item => item.reference_price === null).length;
  const missingSales = rawRecords.filter(item => item.estimated_monthly_sales === null).length;

  const seen = new Set();
  let duplicateAsinCount = 0;
  const deduped = rawRecords.filter(item => {
    if (!item.asin) return false;
    if (seen.has(item.asin)) {
      duplicateAsinCount += 1;
      return false;
    }
    seen.add(item.asin);
    return true;
  });

  const seasonalCalendar = readJsonFirst(["data/product_research/seasonal_calendar.json", "data/seasonal_calendar.json"], {});
  const expansionOpportunities = readJsonFirst(["data/store/store_expansion_opportunities.json", "data/store_expansion_opportunities.json"], { opportunities: [] });
  const profileSummary = readJsonFirst(["data/store/store_profile_summary.json", "data/store_profile_summary.json"], {});
  const exclusionRules = readJsonFirst(["data/store/store_exclusion_rules.json", "data/store_exclusion_rules.json"], {});
  const storeProducts = readJsonFirst(["data/store/store_product_profile_merged.json", "data/store_product_profile_merged.json"], []);

  const normalized = CandidateNormalizer.normalizeCandidates(deduped, {
    seasonalCalendar,
    expansionOpportunities,
    profileSummary,
    exclusionRules,
    storeProducts,
    currentMonth: seasonalCalendar.current_month
  });

  const report = {
    imported_at: new Date().toISOString(),
    source_file: sourceFile,
    raw_count: rows.length,
    normalized_count: normalized.length,
    duplicate_asin_count: duplicateAsinCount,
    missing_asin_count: missingAsin,
    missing_title_count: missingTitle,
    missing_price_count: missingPrice,
    missing_sales_count: missingSales,
    source_distribution: countBy(deduped, "source"),
    warnings: sourceFile ? [] : ["No input/product_candidates.csv or input/product_candidates.xlsx file found."],
    errors: []
  };

  writeJson("data/product_research/candidate_products_raw.json", deduped);
  writeJson("data/product_research/candidate_products.json", normalized);
  writeJson("data/product_research/candidate_data_report.json", report);
  writeJson("data/candidate_products_raw.json", deduped);
  writeJson("data/candidate_products.json", normalized);
  writeJson("data/candidate_data_report.json", report);
  console.log(JSON.stringify(report, null, 2));
}

main();
