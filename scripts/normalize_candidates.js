const fs = require("fs");
const path = require("path");

const CandidateNormalizer = require("../src/data_adapters/candidate_normalizer");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");

function readJson(fileName, fallback = null) {
  const filePath = path.join(DATA_DIR, fileName);
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(fileName, data) {
  const filePath = path.join(DATA_DIR, fileName);
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function main() {
  const rawCandidates = readJson("candidate_products_raw.json", []);
  const storeExpansionCandidates = readJson("store_expansion_candidates.json", []);
  const seasonalCalendar = readJson("seasonal_calendar.json", {});
  const expansionOpportunities = readJson("store_expansion_opportunities.json", { opportunities: [] });
  const profileSummary = readJson("store_profile_summary.json", {});
  const exclusionRules = readJson("store_exclusion_rules.json", {});
  const storeProducts = readJson("store_product_profile_merged.json", []);

  const combinedCandidates = [
    ...rawCandidates,
    ...storeExpansionCandidates
  ];

  const normalizedCandidates = CandidateNormalizer.normalizeCandidates(combinedCandidates, {
    seasonalCalendar,
    expansionOpportunities,
    profileSummary,
    exclusionRules,
    storeProducts,
    currentMonth: seasonalCalendar.current_month
  });

  const report = CandidateNormalizer.buildCandidateReport(combinedCandidates, normalizedCandidates);
  report.marketplace = seasonalCalendar.marketplace || "Amazon US";
  report.current_month = seasonalCalendar.current_month || new Date().getMonth() + 1;
  report.store_profile_loaded = Boolean(profileSummary && profileSummary.total_products);
  report.store_expansion_theme_count = (expansionOpportunities.opportunities || []).length;
  report.manual_raw_candidate_count = rawCandidates.length;
  report.generated_store_expansion_candidate_count = storeExpansionCandidates.length;

  writeJson("candidate_products.json", normalizedCandidates);
  writeJson("candidate_data_report.json", report);

  console.log(JSON.stringify(report, null, 2));
}

main();
