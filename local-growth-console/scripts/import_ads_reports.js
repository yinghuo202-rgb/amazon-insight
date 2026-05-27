const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const { ROOT, ensureDir, writeJson } = require("./data_paths");

const INPUT_DIR = path.join(ROOT, "input", "ads_reports");
const RAW_OUT = "data/ads/raw_reports/uploaded_ads_reports.json";
const CLEAN_OUT = "data/ads/cleaned_reports/cleaned_ads_reports.json";
const LEGACY_CLEAN_OUT = "data/cleaned_reports/uploaded_ads_reports_cleaned.json";

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

function readWorkbook(filePath) {
  const workbook = XLSX.readFile(filePath);
  return workbook.SheetNames.flatMap(sheetName => XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" }));
}

function listInputFiles() {
  if (!fs.existsSync(INPUT_DIR)) return [];
  return fs.readdirSync(INPUT_DIR)
    .filter(file => /\.(csv|xlsx)$/i.test(file))
    .map(file => path.join(INPUT_DIR, file));
}

function readRows(filePath) {
  if (/\.csv$/i.test(filePath)) return parseCsv(fs.readFileSync(filePath, "utf8"));
  return readWorkbook(filePath);
}

function pick(row, names) {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== "") return row[name];
  }
  return "";
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  const number = Number(String(value).replace(/[$,%\s,]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function ratio(numerator, denominator) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : null;
}

function inferReportType(fileName, row) {
  const lower = fileName.toLowerCase();
  if (lower.includes("target")) return "targeting_report";
  if (lower.includes("search")) return "search_term_report";
  if (pick(row, ["Customer Search Term", "Search Term", "customer_search_term"])) return "search_term_report";
  return "targeting_report";
}

function cleanRow(row, sourceFile, reportType) {
  const impressions = toNumber(pick(row, ["Impressions", "impressions"]));
  const clicks = toNumber(pick(row, ["Clicks", "clicks"]));
  const spend = toNumber(pick(row, ["Spend", "Cost", "cost", "spend"]));
  const sales = toNumber(pick(row, ["Sales", "7 Day Total Sales", "sales"]));
  const orders = toNumber(pick(row, ["Orders", "7 Day Total Orders (#)", "Purchases", "orders", "purchases"]));
  return {
    report_type: reportType,
    date_range_start: String(pick(row, ["Start Date", "Date", "date_range_start"]) || ""),
    date_range_end: String(pick(row, ["End Date", "Date", "date_range_end"]) || ""),
    campaign_name: String(pick(row, ["Campaign Name", "Campaign", "campaign_name", "campaignName"]) || ""),
    ad_group_name: String(pick(row, ["Ad Group Name", "Ad Group", "ad_group_name", "adGroupName"]) || ""),
    targeting: String(pick(row, ["Targeting", "Keyword", "Keyword Text", "targeting", "keywordText"]) || ""),
    match_type: String(pick(row, ["Match Type", "match_type", "matchType"]) || ""),
    customer_search_term: String(pick(row, ["Customer Search Term", "Search Term", "customer_search_term", "searchTerm"]) || ""),
    impressions,
    clicks,
    spend,
    sales,
    orders,
    acos: ratio(spend, sales),
    cpc: ratio(spend, clicks),
    conversion_rate: ratio(orders, clicks),
    source_file: sourceFile
  };
}

function main() {
  ensureDir(INPUT_DIR);
  const files = listInputFiles();
  const rawReports = [];
  const cleanedRows = [];
  const warnings = [];

  files.forEach(filePath => {
    const sourceFile = path.relative(ROOT, filePath).replace(/\\/g, "/");
    const rows = readRows(filePath);
    const reportType = inferReportType(path.basename(filePath), rows[0] || {});
    rawReports.push({ report_type: reportType, source_file: sourceFile, rows });
    rows.forEach(row => cleanedRows.push(cleanRow(row, sourceFile, reportType)));
  });

  if (!files.length) warnings.push("No files found under input/ads_reports. Add CSV or XLSX exports to import real local reports.");

  const report = {
    imported_at: new Date().toISOString(),
    source_files: files.map(file => path.relative(ROOT, file).replace(/\\/g, "/")),
    raw_report_count: rawReports.length,
    cleaned_row_count: cleanedRows.length,
    supported_report_types: Array.from(new Set(cleanedRows.map(row => row.report_type))),
    warnings,
    errors: []
  };

  writeJson(RAW_OUT, rawReports);
  writeJson(CLEAN_OUT, cleanedRows);
  writeJson(LEGACY_CLEAN_OUT, cleanedRows);
  writeJson("data/ads/ads_import_report.json", report);
  console.log(JSON.stringify(report, null, 2));
}

main();
