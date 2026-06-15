const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const INDEX_PATH = path.join(ROOT, "index.html");
const DATA_PATH = fs.existsSync(path.join(ROOT, "data", "mock", "asin_screening.mock.json"))
  ? path.join(ROOT, "data", "mock", "asin_screening.mock.json")
  : path.join(ROOT, "data", "asin_analysis_mock.json");
const SCRIPT_PATH = path.join(ROOT, "src", "asin_analyzer.js");
const ENRICHMENT_SCRIPT_PATH = path.join(ROOT, "src", "asin_research_enrichment.js");
const NAV_SCRIPT_PATH = path.join(ROOT, "src", "navigation.js");
const QUEUE_PATH = path.join(ROOT, "data", "product_research", "enrichment_queue.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assertCheck(report, name, passed, details = {}) {
  report.checks.push({ name, passed: Boolean(passed), details });
  if (!passed) report.failed_checks += 1;
}

function main() {
  const html = fs.readFileSync(INDEX_PATH, "utf8");
  const script = fs.readFileSync(SCRIPT_PATH, "utf8");
  const enrichmentScript = fs.existsSync(ENRICHMENT_SCRIPT_PATH) ? fs.readFileSync(ENRICHMENT_SCRIPT_PATH, "utf8") : "";
  const navScript = fs.readFileSync(NAV_SCRIPT_PATH, "utf8");
  const data = readJson(DATA_PATH);
  const cases = Object.values(data.cases || {});

  const report = {
    generated_at: new Date().toISOString(),
    failed_checks: 0,
    checks: []
  };

  assertCheck(report, "asin_view_present", html.includes('id="asinAnalyzerView"') && html.includes("ASIN"));
  assertCheck(report, "asin_script_loaded", html.includes("src/asin_analyzer.js"));
  assertCheck(report, "asin_enrichment_script_loaded", html.includes("src/asin_research_enrichment.js") && enrichmentScript.includes("AsinResearchEnrichment"));
  assertCheck(report, "navigation_script_loaded", html.includes("src/navigation.js") && navScript.includes("switchView"));
  assertCheck(report, "asin_input_present", html.includes('id="asinInput"') && html.includes('id="asinAnalyzerForm"'));
  assertCheck(report, "force_realtime_api_button_present", html.includes('data-asin-action="refresh-live"') && script.includes("forceRemote"));
  assertCheck(report, "batch_import_ui_present", html.includes('id="asinBatchInput"') && html.includes('id="asinBatchFile"') && html.includes('id="asinBatchResults"'));
  assertCheck(report, "asin_market_switch_present", html.includes('data-asin-market="US"') && html.includes('data-asin-market="CA"') && html.includes('data-asin-market="IT"'));
  assertCheck(report, "workspace_nav_grouped", html.includes("nav-brand") && html.includes("nav-group") && html.includes("data-nav-icon"));
  assertCheck(report, "sample_cases_available", cases.length >= 3, {
    count: cases.length,
    asins: Object.keys(data.cases || {})
  });
  assertCheck(report, "required_reference_patterns_present", cases.some(item => item.analysis.competition.level === "high") && cases.some(item => item.analysis.review_analysis.coverage === "seeded_summary") && cases.some(item => item.analysis.decision === "advance"), {
    labels: cases.map(item => item.label)
  });
  assertCheck(report, "analysis_sections_complete", cases.every(item => (
    item.product.asin &&
    item.analysis.summary &&
    item.analysis.recommendation &&
    item.analysis.lifecycle.evidence.length &&
    item.analysis.competition.evidence.length &&
    item.analysis.product_snapshot.flags.length &&
    item.analysis.listing_analysis.summary &&
    item.analysis.review_analysis.summary &&
    item.analysis.next_steps.length
  )));
  assertCheck(report, "data_missing_queue_present", script.includes("dataMissingCase") && script.includes("enqueueMissingAsin") && fs.existsSync(QUEUE_PATH));
  if (fs.existsSync(QUEUE_PATH)) {
    const queue = readJson(QUEUE_PATH);
    assertCheck(report, "enrichment_queue_schema_valid", Array.isArray(queue) && queue.every(item => (
      item.asin &&
      item.source &&
      ["pending", "processing", "enriched", "failed", "ignored"].includes(item.status) &&
      item.created_at &&
      item.updated_at &&
      typeof item.attempt_count === "number"
    )), { queue_count: queue.length });
  }
  assertCheck(report, "batch_import_logic_present", script.includes("extractAsins") && script.includes("analyzeBatch") && script.includes("FileReader"));
  assertCheck(report, "recent_asin_state_local", script.includes("localStorage") && script.includes("RECENT_KEY"));
  assertCheck(report, "candidate_pool_lookup_present", script.includes("ProductCandidateProvider") && script.includes("local_candidate_pool"));
  assertCheck(report, "jungle_scout_realtime_proxy_present", script.includes("/api/jungle-scout/asin") && script.includes("jungle_scout_api_live"));
  assertCheck(report, "asin_enriched_market_sections_present", [
    "peerProducts",
    "buildCompareProducts",
    "reviewSignalFor",
    "buildListingAnalysis",
    "buildReviewAnalysis",
    "市场热度",
    "品牌集中度",
    "子类目排名",
    "费用合计"
  ].every(token => script.includes(token)));
  assertCheck(report, "asin_research_enrichment_present", [
    "renderEnrichment",
    "enhance-search",
    "restriction_risks",
    "crawler_tasks"
  ].every(token => script.includes(token)) && [
    "US",
    "CA",
    "IT",
    "restriction_risks",
    "crawler_tasks",
    "market_snapshot"
  ].every(token => enrichmentScript.includes(token)));
  assertCheck(report, "api_error_uses_missing_renderer", script.includes('record.mode === "data_missing" || record.mode === "api_error"'));
  assertCheck(report, "no_browser_secret_or_direct_external_api", !script.includes("api.junglescout") && !script.includes("amazonaws.com") && !script.includes('fetch("https://') && !script.includes("JUNGLE_SCOUT_API_KEY"));

  fs.mkdirSync(path.join(ROOT, "data", "audit"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "data", "asin_analyzer_audit_report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(ROOT, "data", "audit", "audit_asin.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));

  if (report.failed_checks > 0) process.exitCode = 1;
}

main();
