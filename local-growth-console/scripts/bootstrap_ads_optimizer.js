const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");

const { cleanReportPayload } = require("../src/ads_optimizer/report_cleaning_service");
const { buildKeywordOptimizationInput, hashObject } = require("../src/ads_optimizer/llm_input_builder");
const { validateLlmOutput } = require("../src/ads_optimizer/llm_output_validator");
const { generateRecommendations } = require("../src/ads_optimizer/recommendation_engine");
const { buildDaypartingStrategy } = require("../src/ads_optimizer/dayparting_strategy_service");
const { mockExecuteAction } = require("../src/ads_optimizer/action_execution_service");
const { reviewAction } = require("../src/ads_optimizer/review_service");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const CONFIG_PATH = path.join(ROOT, "config", "app.config.json");
const RAW_DIR = path.join(DATA_DIR, "raw_reports", "sponsored_products");
const CLEAN_DIR = path.join(DATA_DIR, "cleaned_reports", "sponsored_products");
const LLM_INPUT_DIR = path.join(DATA_DIR, "cleaned_reports", "llm_inputs");
const LLM_OUTPUT_DIR = path.join(DATA_DIR, "llm_outputs");
const API_REQUEST_DIR = path.join(DATA_DIR, "api_payloads", "requests");
const API_RESPONSE_DIR = path.join(DATA_DIR, "api_payloads", "responses");
const LOG_DIR = path.join(ROOT, "logs");

const RUN_DATE = "2026-05-22";
const START_DATE = "2026-05-08";
const END_DATE = "2026-05-22";
const PROFILE_ID = "local_profile_us_001";
const MARKETPLACE = "US";

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function timestampForFile() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function archiveName(prefix) {
  return `${prefix}_${PROFILE_ID}_${START_DATE}_${END_DATE}_${timestampForFile()}.json`;
}

function mockRawReports() {
  return [
    {
      report_type: "search_term_report",
      rows: [
        {
          date: "2026-05-15",
          campaignId: "1001",
          campaignName: "SP - RV Water Accessories - Auto",
          adGroupId: "2001",
          adGroupName: "RV Water Auto",
          keywordId: "3001",
          keywordText: "rv water accessories",
          searchTerm: "rv water filter hose stand",
          matchType: "broad",
          impressions: 8200,
          clicks: 91,
          cost: 58.7,
          sales: 266.3,
          purchases: 4
        },
        {
          date: "2026-05-15",
          campaignId: "1001",
          campaignName: "SP - RV Water Accessories - Auto",
          adGroupId: "2001",
          adGroupName: "RV Water Auto",
          keywordId: "3002",
          keywordText: "rv water pump",
          searchTerm: "rv water pump replacement motor",
          matchType: "broad",
          impressions: 5300,
          clicks: 39,
          cost: 46.2,
          sales: 0,
          purchases: 0
        },
        {
          date: "2026-05-16",
          campaignId: "1002",
          campaignName: "SP - Garden Hose Fittings - Broad",
          adGroupId: "2002",
          adGroupName: "Garden Broad",
          keywordId: "3003",
          keywordText: "garden hose repair",
          searchTerm: "free garden hose repair",
          matchType: "broad",
          impressions: 6100,
          clicks: 28,
          cost: 23.8,
          sales: 0,
          purchases: 0
        }
      ]
    },
    {
      report_type: "keyword_report",
      rows: [
        {
          date: "2026-05-15",
          campaignId: "1003",
          campaignName: "SP - Garden Hose Fittings - Exact",
          adGroupId: "2003",
          adGroupName: "Exact Hose",
          keywordId: "3004",
          keywordText: "garden hose quick connect",
          matchType: "exact",
          impressions: 12400,
          clicks: 116,
          cost: 106.7,
          sales: 280.4,
          purchases: 6
        },
        {
          date: "2026-05-16",
          campaignId: "1004",
          campaignName: "SP - RV Organization - Exact",
          adGroupId: "2004",
          adGroupName: "RV Storage",
          keywordId: "3005",
          keywordText: "rv hose storage bag",
          matchType: "exact",
          impressions: 4100,
          clicks: 52,
          cost: 35.4,
          sales: 186.1,
          purchases: 5
        }
      ]
    },
    {
      report_type: "placement_report",
      rows: [
        {
          date: "2026-05-15",
          campaignId: "1001",
          campaignName: "SP - RV Water Accessories - Exact",
          placement: "Top of Search",
          impressions: 4300,
          clicks: 63,
          cost: 72.4,
          sales: 241.2,
          purchases: 6
        },
        {
          date: "2026-05-15",
          campaignId: "1001",
          campaignName: "SP - RV Water Accessories - Exact",
          placement: "Rest of Search",
          impressions: 9700,
          clicks: 84,
          cost: 54.5,
          sales: 143.0,
          purchases: 3
        }
      ]
    }
  ].map(report => ({
    ...report,
    marketplace: MARKETPLACE,
    profile_id: PROFILE_ID,
    start_date: START_DATE,
    end_date: END_DATE,
    generated_at: new Date().toISOString()
  }));
}

function mockDaypartingRows() {
  return [
    { time_block: "00:00-06:00", impressions: 4900, clicks: 68, spend: 42.5, sales: 60, orders: 2 },
    { time_block: "06:00-10:00", impressions: 3700, clicks: 49, spend: 37, sales: 101.2, orders: 3 },
    { time_block: "10:00-14:00", impressions: 5600, clicks: 76, spend: 61.8, sales: 180, orders: 5 },
    { time_block: "14:00-18:00", impressions: 5200, clicks: 69, spend: 58.1, sales: 160, orders: 4 },
    { time_block: "18:00-22:00", impressions: 4100, clicks: 61, spend: 55.2, sales: 230, orders: 7 },
    { time_block: "22:00-24:00", impressions: 2100, clicks: 24, spend: 17.9, sales: 35, orders: 1 }
  ];
}

function schemaSql() {
  return `
CREATE TABLE IF NOT EXISTS stores (
  id INTEGER PRIMARY KEY,
  name TEXT,
  marketplace TEXT,
  profile_id TEXT,
  status TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS app_settings (
  id INTEGER PRIMARY KEY,
  setting_key TEXT UNIQUE,
  setting_value TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS raw_report_archives (
  id INTEGER PRIMARY KEY,
  report_type TEXT,
  profile_id TEXT,
  marketplace TEXT,
  start_date TEXT,
  end_date TEXT,
  file_path TEXT,
  file_hash TEXT,
  file_size INTEGER,
  row_count INTEGER,
  api_request_id TEXT,
  imported_at TEXT,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS cleaned_report_archives (
  id INTEGER PRIMARY KEY,
  raw_report_id INTEGER,
  report_type TEXT,
  start_date TEXT,
  end_date TEXT,
  file_path TEXT,
  file_hash TEXT,
  row_count INTEGER,
  cleaning_status TEXT,
  error_message TEXT,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS llm_analysis_logs (
  id INTEGER PRIMARY KEY,
  analysis_type TEXT,
  model TEXT,
  input_summary_hash TEXT,
  input_summary_path TEXT,
  response_text TEXT,
  parsed_json_path TEXT,
  validation_status TEXT,
  validation_error TEXT,
  token_usage TEXT,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS recommendations (
  id TEXT PRIMARY KEY,
  recommendation_type TEXT,
  priority TEXT,
  risk_level TEXT,
  title TEXT,
  problem_summary TEXT,
  reason TEXT,
  expected_impact TEXT,
  data_window TEXT,
  status TEXT,
  requires_approval INTEGER,
  evidence_path TEXT,
  llm_analysis_id TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS adjustment_logs (
  id TEXT PRIMARY KEY,
  action_id TEXT,
  recommendation_id TEXT,
  action_type TEXT,
  entity_type TEXT,
  entity_id TEXT,
  entity_name TEXT,
  before_value TEXT,
  suggested_value TEXT,
  final_value TEXT,
  reason TEXT,
  risk_level TEXT,
  approval_status TEXT,
  execution_status TEXT,
  request_payload_path TEXT,
  response_payload_path TEXT,
  error_message TEXT,
  executed_at TEXT,
  rollback_available INTEGER,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS action_results (
  id INTEGER PRIMARY KEY,
  action_id TEXT,
  before_window TEXT,
  after_window TEXT,
  before_spend REAL,
  before_sales REAL,
  before_orders INTEGER,
  before_acos REAL,
  before_roas REAL,
  after_spend REAL,
  after_sales REAL,
  after_orders INTEGER,
  after_acos REAL,
  after_roas REAL,
  result_status TEXT,
  summary TEXT,
  created_at TEXT
);
`;
}

function resetSqlite(dbPath) {
  if (fs.existsSync(dbPath)) fs.rmSync(dbPath);
  const db = new DatabaseSync(dbPath);
  db.exec(schemaSql());
  return db;
}

function insertArchiveRows(db, rawArchives, cleanedArchives, llmLogs, recommendations, adjustments, reviews) {
  const now = new Date().toISOString();
  db.prepare("INSERT INTO stores (name, marketplace, profile_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run("Local Amazon US Store", MARKETPLACE, PROFILE_ID, "active", now, now);

  rawArchives.forEach(item => {
    db.prepare(`INSERT INTO raw_report_archives
      (report_type, profile_id, marketplace, start_date, end_date, file_path, file_hash, file_size, row_count, api_request_id, imported_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(item.report_type, item.profile_id, item.marketplace, item.start_date, item.end_date, item.file_path, item.file_hash, item.file_size, item.row_count, item.api_request_id, item.imported_at, item.created_at);
  });

  cleanedArchives.forEach(item => {
    db.prepare(`INSERT INTO cleaned_report_archives
      (raw_report_id, report_type, start_date, end_date, file_path, file_hash, row_count, cleaning_status, error_message, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(item.raw_report_id, item.report_type, item.start_date, item.end_date, item.file_path, item.file_hash, item.row_count, item.cleaning_status, item.error_message, item.created_at);
  });

  llmLogs.forEach(item => {
    db.prepare(`INSERT INTO llm_analysis_logs
      (analysis_type, model, input_summary_hash, input_summary_path, response_text, parsed_json_path, validation_status, validation_error, token_usage, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(item.analysis_type, item.model, item.input_summary_hash, item.input_summary_path, item.response_text, item.parsed_json_path, item.validation_status, item.validation_error, item.token_usage, item.created_at);
  });

  recommendations.forEach(item => {
    db.prepare(`INSERT INTO recommendations
      (id, recommendation_type, priority, risk_level, title, problem_summary, reason, expected_impact, data_window, status, requires_approval, evidence_path, llm_analysis_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(item.recommendation_id, item.recommendation_type, item.priority, item.risk_level, item.title || item.entity_name, item.current_problem, item.reason, item.expected_impact, item.data_window, item.status, item.requires_approval ? 1 : 0, item.evidence_path, item.llm_analysis_id || "", item.created_at, now);
  });

  adjustments.forEach(item => {
    db.prepare(`INSERT INTO adjustment_logs
      (id, action_id, recommendation_id, action_type, entity_type, entity_id, entity_name, before_value, suggested_value, final_value, reason, risk_level, approval_status, execution_status, request_payload_path, response_payload_path, error_message, executed_at, rollback_available, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(item.adjustment_id, item.action_id, item.recommendation_id, item.action_type, item.entity_type, item.entity_id, item.entity_name, String(item.before_value ?? ""), String(item.suggested_value ?? ""), String(item.final_value ?? ""), item.reason, item.risk_level, item.approval_status, item.execution_status, item.request_payload_path, item.response_payload_path, item.error_message || "", item.executed_at, item.rollback_available ? 1 : 0, item.created_at);
  });

  reviews.forEach(item => {
    db.prepare(`INSERT INTO action_results
      (action_id, before_window, after_window, before_spend, before_sales, before_orders, before_acos, before_roas, after_spend, after_sales, after_orders, after_acos, after_roas, result_status, summary, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(item.action_id, item.before_window, item.after_window, item.before_spend, item.before_sales, item.before_orders, item.before_acos, item.before_roas, item.after_spend, item.after_sales, item.after_orders, item.after_acos, item.after_roas, item.result_status, item.summary, now);
  });
}

function main() {
  [
    RAW_DIR,
    CLEAN_DIR,
    LLM_INPUT_DIR,
    LLM_OUTPUT_DIR,
    API_REQUEST_DIR,
    API_RESPONSE_DIR,
    LOG_DIR,
    path.join(DATA_DIR, "backups"),
    path.join(DATA_DIR, "exports")
  ].forEach(ensureDir);

  const config = readJson(CONFIG_PATH);
  const rules = {
    ...config.execution,
    target_acos: config.default_target_acos || 0.3,
    max_acos: config.default_max_acos || 0.4
  };

  const rawArchives = [];
  const cleanedArchives = [];
  const cleanedRowsForRecommendations = [];
  const reports = mockRawReports();

  reports.forEach((report, index) => {
    const rawPath = path.join(RAW_DIR, archiveName(report.report_type));
    writeJson(rawPath, report);
    const rawArchive = {
      id: index + 1,
      report_type: report.report_type,
      profile_id: PROFILE_ID,
      marketplace: MARKETPLACE,
      start_date: START_DATE,
      end_date: END_DATE,
      file_path: path.relative(ROOT, rawPath).replace(/\\/g, "/"),
      file_hash: hashFile(rawPath),
      file_size: fs.statSync(rawPath).size,
      row_count: report.rows.length,
      api_request_id: `mock_request_${index + 1}`,
      imported_at: new Date().toISOString(),
      created_at: new Date().toISOString()
    };
    rawArchives.push(rawArchive);

    const cleaned = cleanReportPayload(report, {
      rules,
      gross_margin: 0.38
    });
    const cleanedPath = path.join(CLEAN_DIR, `cleaned_${archiveName(report.report_type)}`);
    writeJson(cleanedPath, cleaned);
    cleanedArchives.push({
      raw_report_id: rawArchive.id,
      report_type: report.report_type,
      start_date: START_DATE,
      end_date: END_DATE,
      file_path: path.relative(ROOT, cleanedPath).replace(/\\/g, "/"),
      file_hash: hashFile(cleanedPath),
      row_count: cleaned.rows.length,
      cleaning_status: "success",
      error_message: "",
      created_at: new Date().toISOString()
    });

    cleanedRowsForRecommendations.push(...cleaned.rows);
  });

  const llmInput = buildKeywordOptimizationInput(cleanedRowsForRecommendations.filter(row => row.search_term || row.keyword_text), {
    marketplace: MARKETPLACE,
    data_window: "14d",
    target_acos: rules.target_acos,
    max_acos: rules.max_acos,
    max_bid_increase_pct: rules.max_keyword_bid_increase_pct,
    max_bid_decrease_pct: rules.max_keyword_bid_decrease_pct
  });
  const llmInputPath = path.join(LLM_INPUT_DIR, `keyword_optimization_${PROFILE_ID}_${RUN_DATE}.json`);
  writeJson(llmInputPath, llmInput);

  const llmOutput = {
    summary: "Mock DeepSeek analysis found harvest, negative, and bid-control opportunities. No real external request was sent.",
    recommendations: llmInput.entities.slice(0, 4).map((entity, index) => ({
      entity_alias: entity.entity_alias,
      action_type: index === 0 ? "add_keyword_exact" : index === 1 ? "add_negative_exact" : index === 2 ? "decrease_keyword_bid" : "increase_keyword_bid",
      suggested_change_pct: index === 2 ? -0.12 : index === 3 ? 0.1 : 0,
      reason: "Mock JSON output kept inside local validation limits.",
      risk_level: index === 1 ? "low" : "medium",
      confidence: 0.78
    }))
  };
  const llmOutputPath = path.join(LLM_OUTPUT_DIR, `deepseek_keyword_optimization_${PROFILE_ID}_${RUN_DATE}.json`);
  writeJson(llmOutputPath, llmOutput);
  const llmValidation = validateLlmOutput(llmOutput, llmInput);
  const llmLogs = [{
    analysis_type: "keyword_optimization_analysis",
    model: config.deepseek.default_model,
    input_summary_hash: llmInput.input_summary_hash,
    input_summary_path: path.relative(ROOT, llmInputPath).replace(/\\/g, "/"),
    response_text: JSON.stringify(llmOutput),
    parsed_json_path: path.relative(ROOT, llmOutputPath).replace(/\\/g, "/"),
    validation_status: llmValidation.validation_status,
    validation_error: llmValidation.validation_error,
    token_usage: JSON.stringify({ prompt_tokens: 0, completion_tokens: 0, mode: "mock" }),
    created_at: new Date().toISOString()
  }];

  const generatedRecommendations = generateRecommendations(cleanedRowsForRecommendations, {
    rules,
    data_window: "14d",
    evidence_path: path.relative(ROOT, llmInputPath).replace(/\\/g, "/")
  }).map((item, index) => ({
    ...item,
    recommendation_id: item.recommendation_id || `ADS-GEN-${String(index + 1).padStart(3, "0")}`,
    llm_analysis_id: "mock_llm_analysis_001"
  }));
  writeJson(path.join(DATA_DIR, "ads_recommendations_generated.json"), generatedRecommendations);

  const daypartingStrategy = buildDaypartingStrategy(mockDaypartingRows(), {
    strategy_id: `DAY-${RUN_DATE}`,
    campaign: "SP - RV Water Accessories - Exact",
    rules,
    data_window: "30d"
  });
  writeJson(path.join(DATA_DIR, "ads_dayparting_strategy_generated.json"), daypartingStrategy);

  const approved = generatedRecommendations.slice(0, 2);
  const adjustments = [];
  const reviews = [];
  approved.forEach((rec, index) => {
    const action = {
      action_id: `MOCK-ACT-${String(index + 1).padStart(3, "0")}`,
      recommendation_id: rec.recommendation_id,
      action_type: rec.suggested_action,
      entity_type: rec.entity_type,
      entity_id: rec.recommendation_id,
      entity_name: rec.entity_name,
      before_value: rec.current_value ?? "not_set",
      suggested_value: rec.suggested_value ?? rec.suggested_action,
      final_value: rec.suggested_value ?? rec.suggested_action,
      suggested_change_pct: rec.suggested_change_pct,
      approval_status: "approved"
    };
    const execution = mockExecuteAction(action);
    const requestPath = path.join(API_REQUEST_DIR, `${action.action_id}.json`);
    const responsePath = path.join(API_RESPONSE_DIR, `${action.action_id}.json`);
    writeJson(requestPath, execution.request_payload);
    writeJson(responsePath, execution.response_payload);

    adjustments.push({
      adjustment_id: `MOCK-ADJ-${String(index + 1).padStart(3, "0")}`,
      action_id: action.action_id,
      recommendation_id: rec.recommendation_id,
      action_type: rec.suggested_action,
      entity_type: rec.entity_type,
      entity_id: rec.recommendation_id,
      entity_name: rec.entity_name,
      before_value: action.before_value,
      suggested_value: action.suggested_value,
      final_value: action.final_value,
      reason: rec.reason,
      risk_level: rec.risk_level,
      approval_status: "approved",
      execution_status: "executed",
      request_payload_path: path.relative(ROOT, requestPath).replace(/\\/g, "/"),
      response_payload_path: path.relative(ROOT, responsePath).replace(/\\/g, "/"),
      error_message: "",
      executed_at: new Date().toISOString(),
      rollback_available: true,
      created_at: new Date().toISOString()
    });

    reviews.push(reviewAction(
      { action_id: action.action_id, action_type: rec.suggested_action },
      { spend: rec.metrics.spend, sales: rec.metrics.sales, orders: rec.metrics.orders, acos: rec.metrics.acos, roas: rec.metrics.roas },
      { spend: Math.max(0, rec.metrics.spend * 0.78), sales: rec.metrics.sales * 0.96, orders: rec.metrics.orders, acos: rec.metrics.acos === null ? null : rec.metrics.acos * 0.82, roas: rec.metrics.roas === null ? null : rec.metrics.roas * 1.12 },
      { max_acos: rules.max_acos }
    ));
  });
  writeJson(path.join(DATA_DIR, "ads_adjustment_logs.json"), adjustments);
  writeJson(path.join(DATA_DIR, "ads_action_results.json"), reviews);

  const syncLogs = reports.map((report, index) => ({
    sync_id: `SYNC-${String(index + 1).padStart(3, "0")}`,
    sync_type: "mock_local_bootstrap",
    report_type: report.report_type,
    start_date: START_DATE,
    end_date: END_DATE,
    started_at: report.generated_at,
    finished_at: new Date().toISOString(),
    status: "success",
    raw_report_path: rawArchives[index].file_path,
    cleaned_report_path: cleanedArchives[index].file_path,
    row_count: cleanedArchives[index].row_count,
    error_message: ""
  }));
  writeJson(path.join(DATA_DIR, "ads_sync_logs.json"), syncLogs);
  writeJson(path.join(DATA_DIR, "raw_report_archives.json"), rawArchives);
  writeJson(path.join(DATA_DIR, "cleaned_report_archives.json"), cleanedArchives);
  writeJson(path.join(DATA_DIR, "llm_analysis_logs.json"), llmLogs);
  fs.writeFileSync(path.join(DATA_DIR, "amazon_growth_console_schema.sql"), schemaSql(), "utf8");

  const dbPath = path.join(ROOT, config.sqlite_database_path);
  ensureDir(path.dirname(dbPath));
  const db = resetSqlite(dbPath);
  insertArchiveRows(db, rawArchives, cleanedArchives, llmLogs, generatedRecommendations, adjustments, reviews);
  db.close();

  const report = {
    generated_at: new Date().toISOString(),
    sqlite_database_path: config.sqlite_database_path,
    raw_report_count: rawArchives.length,
    cleaned_report_count: cleanedArchives.length,
    cleaned_row_count: cleanedRowsForRecommendations.length,
    llm_validation_status: llmValidation.validation_status,
    generated_recommendation_count: generatedRecommendations.length,
    dayparting_strategy_generated: true,
    adjustment_log_count: adjustments.length,
    review_result_count: reviews.length,
    external_requests_made: 0
  };
  writeJson(path.join(DATA_DIR, "ads_bootstrap_report.json"), report);
  fs.appendFileSync(path.join(LOG_DIR, "app.log"), `${new Date().toISOString()} bootstrap_ads_optimizer ${JSON.stringify(report)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
}

main();
