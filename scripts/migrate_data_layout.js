const fs = require("fs");
const path = require("path");
const { ROOT, ensureCoreDirs, ensureDir } = require("./data_paths");

const COPY_MAP = [
  ["data/candidate_products.json", "data/product_research/candidate_products.json"],
  ["data/candidate_products_raw.json", "data/product_research/candidate_products_raw.json"],
  ["data/candidate_data_report.json", "data/product_research/candidate_data_report.json"],
  ["data/store_expansion_candidates.json", "data/product_research/store_expansion_candidates.json"],
  ["data/seasonal_calendar.json", "data/product_research/seasonal_calendar.json"],
  ["data/watchlist.json", "data/product_research/watchlist.json"],
  ["data/feedback_records.json", "data/product_research/feedback_records.json"],
  ["data/recommendation_history.json", "data/product_research/daily_recommendations/recommendation_history.json"],
  ["data/daily_recommendations/latest.json", "data/product_research/daily_recommendations/latest.json"],
  ["data/daily_recommendations/2026-05-22.json", "data/product_research/daily_recommendations/2026-05-22.json"],
  ["data/daily_recommendations/2026-05-22_report.md", "data/product_research/daily_recommendations/2026-05-22_report.md"],
  ["data/store_products.json", "data/store/store_products.json"],
  ["data/store_cost_profile_us.json", "data/store/store_cost_profile_us.json"],
  ["data/store_cost_profile_ca.json", "data/store/store_cost_profile_ca.json"],
  ["data/store_sales_snapshot.json", "data/store/store_sales_snapshot.json"],
  ["data/store_product_profile_merged.json", "data/store/store_product_profile_merged.json"],
  ["data/store_data_report.json", "data/store/store_data_report.json"],
  ["data/store_profile_summary.json", "data/store/store_profile_summary.json"],
  ["data/store_exclusion_rules.json", "data/store/store_exclusion_rules.json"],
  ["data/store_expansion_opportunities.json", "data/store/store_expansion_opportunities.json"],
  ["data/asin_analysis_mock.json", "data/mock/asin_screening.mock.json"],
  ["data/keepa_enrichment_mock.json", "data/mock/keepa_enrichment.mock.json"],
  ["data/ads_optimizer_mock.json", "data/mock/ads_reports.mock.json"],
  ["data/candidate_products_raw.json", "data/mock/candidates.mock.json"],
  ["data/daily_recommendations/latest.json", "data/mock/recommendations.mock.json"],
  ["data/amazon_growth_console.sqlite", "data/db/amazon_growth_console.sqlite"],
  ["data/ads_sync_logs.json", "data/ads/ads_sync_logs.json"],
  ["data/raw_report_archives.json", "data/ads/raw_report_archives.json"],
  ["data/cleaned_report_archives.json", "data/ads/cleaned_report_archives.json"],
  ["data/llm_analysis_logs.json", "data/ads/llm_analysis_logs.json"],
  ["data/ads_recommendations_generated.json", "data/ads/ads_recommendations_generated.json"],
  ["data/ads_adjustment_logs.json", "data/ads/adjustment_logs/ads_adjustment_logs.json"],
  ["data/ads_action_results.json", "data/ads/review_results/ads_action_results.json"],
  ["data/ads_dayparting_strategy_generated.json", "data/ads/ads_dayparting_strategy_generated.json"],
  ["data/ads_bootstrap_report.json", "data/ads/ads_bootstrap_report.json"],
  ["data/cleaned_reports/llm_inputs/keyword_optimization_local_profile_us_001_2026-05-22.json", "data/ads/llm_inputs/keyword_optimization_local_profile_us_001_2026-05-22.json"],
  ["data/llm_outputs/deepseek_keyword_optimization_local_profile_us_001_2026-05-22.json", "data/ads/llm_outputs/deepseek_keyword_optimization_local_profile_us_001_2026-05-22.json"],
  ["data/api_payloads/requests/MOCK-ACT-001.json", "data/ads/action_payloads/requests/MOCK-ACT-001.json"],
  ["data/api_payloads/requests/MOCK-ACT-002.json", "data/ads/action_payloads/requests/MOCK-ACT-002.json"],
  ["data/api_payloads/responses/MOCK-ACT-001.json", "data/ads/action_payloads/responses/MOCK-ACT-001.json"],
  ["data/api_payloads/responses/MOCK-ACT-002.json", "data/ads/action_payloads/responses/MOCK-ACT-002.json"]
];

function copyIfPresent(fromRelative, toRelative) {
  const from = path.join(ROOT, fromRelative);
  const to = path.join(ROOT, toRelative);
  if (!fs.existsSync(from)) return false;
  ensureDir(path.dirname(to));
  fs.copyFileSync(from, to);
  return true;
}

function copyDirectoryIfPresent(fromRelative, toRelative) {
  const from = path.join(ROOT, fromRelative);
  const to = path.join(ROOT, toRelative);
  if (!fs.existsSync(from)) return 0;
  ensureDir(to);
  let count = 0;
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) {
      count += copyDirectoryIfPresent(path.relative(ROOT, source), path.relative(ROOT, target));
    } else {
      fs.copyFileSync(source, target);
      count += 1;
    }
  }
  return count;
}

function writeJsonIfMissing(relativePath, value) {
  const fullPath = path.join(ROOT, relativePath);
  if (fs.existsSync(fullPath)) return false;
  ensureDir(path.dirname(fullPath));
  fs.writeFileSync(fullPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return true;
}

function main() {
  ensureCoreDirs();
  let copied = 0;
  for (const [from, to] of COPY_MAP) {
    if (copyIfPresent(from, to)) copied += 1;
  }
  copied += copyDirectoryIfPresent("data/raw_reports", "data/ads/raw_reports");
  copied += copyDirectoryIfPresent("data/cleaned_reports", "data/ads/cleaned_reports");

  const createdQueue = writeJsonIfMissing("data/product_research/enrichment_queue.json", []);
  writeJsonIfMissing("data/product_research/asin_screening_results.json", []);
  writeJsonIfMissing("data/ads/execution_results/execution_results.json", []);

  const report = {
    generated_at: new Date().toISOString(),
    copied_file_count: copied,
    created_enrichment_queue: createdQueue,
    mode: "compatibility_copy",
    note: "New Phase A directories were populated while legacy data/*.json paths remain available."
  };
  fs.writeFileSync(path.join(ROOT, "data", "audit", "data_layout_migration.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
}

main();
