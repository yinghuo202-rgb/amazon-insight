const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const DATA_PATH = path.join(ROOT, "data", "ads_optimizer_mock.json");
const INDEX_PATH = path.join(ROOT, "index.html");
const APP_PATH = path.join(ROOT, "src", "ads_optimizer.js");
const CONFIG_PATH = path.join(ROOT, "config", "app.config.json");
const AMAZON_ADS_PROVIDER_PATH = path.join(ROOT, "src", "providers", "amazonAdsProvider.js");
const AMAZON_ADS_SYNC_SCRIPT_PATH = path.join(ROOT, "scripts", "sync_amazon_ads_reports.js");
const SQLITE_PATH = path.join(DATA_DIR, "amazon_growth_console.sqlite");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assertCheck(report, name, passed, details = {}) {
  report.checks.push({ name, passed, details });
  if (!passed) report.failed_checks += 1;
}

function main() {
  const data = readJson(DATA_PATH);
  const config = readJson(CONFIG_PATH);
  const html = fs.readFileSync(INDEX_PATH, "utf8");
  const app = fs.readFileSync(APP_PATH, "utf8");
  const provider = fs.existsSync(AMAZON_ADS_PROVIDER_PATH) ? fs.readFileSync(AMAZON_ADS_PROVIDER_PATH, "utf8") : "";
  const bootstrapReportPath = path.join(DATA_DIR, "ads_bootstrap_report.json");
  const rawArchivesPath = path.join(DATA_DIR, "raw_report_archives.json");
  const cleanedArchivesPath = path.join(DATA_DIR, "cleaned_report_archives.json");
  const llmLogsPath = path.join(DATA_DIR, "llm_analysis_logs.json");
  const generatedRecommendationsPath = path.join(DATA_DIR, "ads_recommendations_generated.json");
  const adjustmentLogsPath = path.join(DATA_DIR, "ads_adjustment_logs.json");
  const actionResultsPath = path.join(DATA_DIR, "ads_action_results.json");

  const report = {
    generated_at: new Date().toISOString(),
    failed_checks: 0,
    checks: []
  };

  const requiredViews = [
    "homeView",
    "productSelectionView",
    "asinAnalyzerView",
    "adsOptimizerView",
    "reportsView",
    "daypartingView",
    "productsProfitView",
    "adjustmentsView",
    "reviewsView",
    "settingsView"
  ];
  const requiredTypes = [
    "search_term_harvest",
    "negative_keyword",
    "bid_adjustment",
    "product_targeting",
    "structure_diagnosis"
  ];
  const allowedActions = new Set([
    "add_keyword_exact",
    "add_negative_exact",
    "increase_keyword_bid",
    "decrease_keyword_bid",
    "add_product_target",
    "increase_product_target_bid",
    "decrease_product_target_bid",
    "apply_dayparting_bid_adjustment",
    "structure_diagnosis"
  ]);

  assertCheck(report, "ads_mock_data_exists", fs.existsSync(DATA_PATH));
  assertCheck(report, "all_required_views_present", requiredViews.every(id => html.includes(`id="${id}"`)), {
    missing: requiredViews.filter(id => !html.includes(`id="${id}"`))
  });
  assertCheck(report, "ads_script_loaded", html.includes("src/ads_optimizer.js"));
  assertCheck(report, "recommendation_types_covered", requiredTypes.every(type => data.recommendations.some(item => item.recommendation_type === type)), {
    types: Array.from(new Set(data.recommendations.map(item => item.recommendation_type)))
  });
  assertCheck(report, "allowed_action_types_only", data.recommendations.every(item => allowedActions.has(item.suggested_action)), {
    invalid: data.recommendations.filter(item => !allowedActions.has(item.suggested_action)).map(item => item.suggested_action)
  });
  assertCheck(report, "keyword_bid_increase_capped", data.recommendations.every(item => (
    item.suggested_action !== "increase_keyword_bid" || Number(item.suggested_change_pct || 0) <= 0.15
  )));
  assertCheck(report, "keyword_bid_decrease_capped", data.recommendations.every(item => (
    item.suggested_action !== "decrease_keyword_bid" || Number(item.suggested_change_pct || 0) >= -0.2
  )));
  assertCheck(report, "bid_increases_require_approval", data.recommendations.every(item => (
    !String(item.suggested_action).startsWith("increase_") || item.requires_approval === true
  )));
  assertCheck(report, "dayparting_caps_applied", data.dayparting.every(strategy => strategy.time_blocks.every(block => (
    Number(block.bid_multiplier || 1) <= 1.15 && Number(block.bid_multiplier || 1) >= 0.8
  ))));
  assertCheck(report, "settings_do_not_store_real_secrets", [
    data.settings.amazon_ads_credentials_status,
    data.settings.deepseek_api_key_status
  ].every(value => value === "not_configured"));
  assertCheck(report, "local_state_used_for_approval", app.includes("localStorage") && app.includes("recommendation_status"));
  assertCheck(report, "adjustment_logs_supported", app.includes("local_adjustments") && app.includes("renderAdjustments"));
  assertCheck(report, "recommendation_filter_controls_present", [
    'id="adsSearchInput"',
    'id="adsTypeFilter"',
    'id="adsRiskFilter"',
    'id="adsStatusFilter"',
    'id="resetAdsFilters"'
  ].every(token => html.includes(token)) && app.includes("recommendationMatchesFilters") && app.includes("filteredRecommendations"));
  assertCheck(report, "action_preview_and_execution_loop_present", [
    "actionPreview",
    "executeQueuedAdjustments",
    "executeAdjustment",
    "rollbackAdjustment",
    "data-adjustment-id"
  ].every(token => app.includes(token)) && html.includes('id="executeQueuedAdjustments"'));
  assertCheck(report, "modified_approval_and_exports_present", [
    "modified_values",
    "approve-modified",
    "ads-modify-panel",
    "downloadJson",
    "exportVisibleRecommendations",
    "exportAdjustmentLogs",
    "resetAdsLocalState"
  ].every(token => app.includes(token)) && [
    'id="exportAdsRecommendations"',
    'id="exportAdjustmentLogs"',
    'id="resetAdsLocalState"'
  ].every(token => html.includes(token)));
  assertCheck(report, "protected_terms_can_be_removed", app.includes('data-ads-action="unprotect"') && app.includes("data-protected-term"));
  assertCheck(report, "amazon_ads_api_provider_present", Boolean(
    fs.existsSync(AMAZON_ADS_PROVIDER_PATH) &&
    fs.existsSync(AMAZON_ADS_SYNC_SCRIPT_PATH) &&
    provider.includes("requestAccessToken") &&
    provider.includes("/v2/profiles") &&
    provider.includes("/reporting/reports") &&
    provider.includes("writeActionsEnabled")
  ));
  assertCheck(report, "amazon_ads_frontend_status_controls_present", [
    "loadAmazonAdsStatus",
    "syncAmazonAdsProfiles",
    "syncAmazonAdsProfiles",
    "亚马逊广告接口状态"
  ].every(token => app.includes(token) || html.includes(token)));
  assertCheck(report, "local_config_available", Boolean(fs.existsSync(CONFIG_PATH) && config.sqlite_database_path && config.raw_report_archive_path), {
    sqlite_database_path: config.sqlite_database_path,
    raw_report_archive_path: config.raw_report_archive_path
  });
  assertCheck(report, "gitignore_protects_local_secrets", fs.existsSync(path.join(ROOT, ".gitignore")) && [
    ".env.local",
    "config/secrets.local.json",
    "config/amazon_ads.config.local.json",
    "data/",
    "logs/",
    "*.sqlite"
  ].every(pattern => fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8").includes(pattern)));
  assertCheck(report, "bootstrap_report_available", fs.existsSync(bootstrapReportPath));

  if (fs.existsSync(bootstrapReportPath)) {
    const bootstrapReport = readJson(bootstrapReportPath);
    assertCheck(report, "bootstrap_generated_local_loop", Boolean(
      bootstrapReport.raw_report_count >= 3 &&
      bootstrapReport.cleaned_report_count >= 3 &&
      bootstrapReport.llm_validation_status === "valid" &&
      bootstrapReport.generated_recommendation_count >= 5 &&
      bootstrapReport.adjustment_log_count >= 2 &&
      bootstrapReport.review_result_count >= 2 &&
      bootstrapReport.external_requests_made === 0
    ), bootstrapReport);
  }

  const localArtifactPaths = [
    rawArchivesPath,
    cleanedArchivesPath,
    llmLogsPath,
    generatedRecommendationsPath,
    adjustmentLogsPath,
    actionResultsPath,
    path.join(DATA_DIR, "ads_sync_logs.json"),
    path.join(DATA_DIR, "amazon_growth_console_schema.sql")
  ];
  assertCheck(report, "local_ads_artifacts_created", localArtifactPaths.every(fs.existsSync), {
    missing: localArtifactPaths.filter(item => !fs.existsSync(item)).map(item => path.relative(ROOT, item))
  });

  if (fs.existsSync(rawArchivesPath) && fs.existsSync(cleanedArchivesPath)) {
    const rawArchives = readJson(rawArchivesPath);
    const cleanedArchives = readJson(cleanedArchivesPath);
    assertCheck(report, "raw_report_files_archived", rawArchives.every(item => fs.existsSync(path.join(ROOT, item.file_path)) && item.file_hash && item.row_count > 0), {
      raw_count: rawArchives.length
    });
    assertCheck(report, "cleaned_report_files_archived", cleanedArchives.every(item => fs.existsSync(path.join(ROOT, item.file_path)) && item.cleaning_status === "success" && item.row_count > 0), {
      cleaned_count: cleanedArchives.length
    });
  }

  if (fs.existsSync(generatedRecommendationsPath)) {
    const generatedRecommendations = readJson(generatedRecommendationsPath);
    assertCheck(report, "generated_recommendations_include_required_actions", [
      "add_keyword_exact",
      "add_negative_exact",
      "decrease_keyword_bid",
      "increase_keyword_bid"
    ].every(action => generatedRecommendations.some(item => item.suggested_action === action)), {
      actions: Array.from(new Set(generatedRecommendations.map(item => item.suggested_action)))
    });
    assertCheck(report, "generated_bid_actions_pass_risk_control", generatedRecommendations.every(item => (
      item.risk_control_status === "passed" &&
      (item.suggested_action !== "increase_keyword_bid" || item.suggested_change_pct <= 0.15) &&
      (item.suggested_action !== "decrease_keyword_bid" || item.suggested_change_pct >= -0.2)
    )));
  }

  if (fs.existsSync(llmLogsPath)) {
    const llmLogs = readJson(llmLogsPath);
    assertCheck(report, "llm_logs_validated_and_local", llmLogs.every(item => (
      item.validation_status === "valid" &&
      item.input_summary_hash &&
      item.input_summary_path &&
      item.parsed_json_path &&
      !String(item.response_text).includes("client_secret") &&
      !String(item.response_text).includes("refresh_token")
    )), {
      llm_log_count: llmLogs.length
    });
  }

  if (fs.existsSync(adjustmentLogsPath)) {
    const adjustments = readJson(adjustmentLogsPath);
    assertCheck(report, "adjustment_logs_have_payload_paths", adjustments.every(item => (
      item.request_payload_path &&
      item.response_payload_path &&
      fs.existsSync(path.join(ROOT, item.request_payload_path)) &&
      fs.existsSync(path.join(ROOT, item.response_payload_path))
    )), {
      adjustment_count: adjustments.length
    });
  }

  if (fs.existsSync(actionResultsPath)) {
    const actionResults = readJson(actionResultsPath);
    assertCheck(report, "action_reviews_available", actionResults.every(item => (
      ["effective", "ineffective", "observing"].includes(item.result_status) &&
      item.before_window &&
      item.after_window &&
      item.summary
    )), {
      review_count: actionResults.length
    });
  }

  assertCheck(report, "sqlite_database_created", fs.existsSync(SQLITE_PATH));
  if (fs.existsSync(SQLITE_PATH)) {
    const db = new DatabaseSync(SQLITE_PATH);
    const tables = [
      "raw_report_archives",
      "cleaned_report_archives",
      "llm_analysis_logs",
      "recommendations",
      "adjustment_logs",
      "action_results"
    ];
    const counts = {};
    tables.forEach(table => {
      counts[table] = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
    });
    db.close();
    assertCheck(report, "sqlite_core_tables_populated", Object.values(counts).every(count => count > 0), counts);
  }

  fs.writeFileSync(path.join(ROOT, "data", "ads_optimizer_audit_report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));

  if (report.failed_checks > 0) {
    process.exitCode = 1;
  }
}

main();
