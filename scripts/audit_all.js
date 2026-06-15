const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { DatabaseSync } = require("node:sqlite");

const { ROOT, ensureCoreDirs, writeJson } = require("./data_paths");

function fileExists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function readJson(relativePath, fallback = null) {
  const fullPath = path.join(ROOT, relativePath);
  if (!fs.existsSync(fullPath)) return fallback;
  return JSON.parse(fs.readFileSync(fullPath, "utf8"));
}

function moduleResult() {
  return { status: "PASS", warnings: [], errors: [] };
}

function addError(module, message) {
  module.errors.push(message);
  module.status = "FAIL";
}

function addWarning(module, message) {
  module.warnings.push(message);
  if (module.status !== "FAIL") module.status = "WARNING";
}

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8"
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || ""
  };
}

function runAuditScript(scriptPath, module) {
  const result = runCommand("node", [scriptPath]);
  if (!result.ok) {
    addError(module, `${scriptPath} failed with exit code ${result.status}. ${result.stderr || result.stdout}`.trim());
  }
  return result;
}

function checkFiles(module, label, files) {
  const missing = files.filter(file => !fileExists(file));
  if (missing.length) addError(module, `${label} missing: ${missing.join(", ")}`);
}

function validateEnrichmentQueue(module) {
  const queue = readJson("data/product_research/enrichment_queue.json", null);
  if (!Array.isArray(queue)) {
    addError(module, "enrichment_queue.json must be an array.");
    return;
  }
  const allowedStatuses = new Set(["pending", "processing", "enriched", "failed", "ignored"]);
  const invalid = queue.filter(item => (
    !item.asin ||
    !allowedStatuses.has(item.status) ||
    !item.created_at ||
    !item.updated_at ||
    typeof item.attempt_count !== "number"
  ));
  if (invalid.length) addError(module, `Invalid enrichment queue records: ${invalid.length}`);
}

function scanJsonForSensitiveTerms(module, relativePaths) {
  const pattern = /(password|apiKey|api_key|secret|accessToken|access_token|refreshToken|refresh_token|cookie|session)/i;
  const hits = [];
  relativePaths.forEach(relativePath => {
    const fullPath = path.join(ROOT, relativePath);
    if (!fs.existsSync(fullPath)) return;
    const text = fs.readFileSync(fullPath, "utf8");
    if (pattern.test(text)) hits.push(relativePath);
  });
  if (hits.length) addWarning(module, `Sensitive-looking terms found in import artifacts: ${hits.join(", ")}`);
}

function checkDatabase(module) {
  const sqlitePath = fileExists("data/db/amazon_growth_console.sqlite")
    ? path.join(ROOT, "data/db/amazon_growth_console.sqlite")
    : path.join(ROOT, "data/amazon_growth_console.sqlite");
  if (!fs.existsSync(sqlitePath)) {
    addError(module, "SQLite file missing.");
    return;
  }
  try {
    const db = new DatabaseSync(sqlitePath);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name);
    db.close();
    if (!tables.length) addError(module, "SQLite database has no tables.");
  } catch (error) {
    addError(module, `SQLite connection failed: ${error.message}`);
  }
}

function summarize(modules) {
  return Object.values(modules).reduce((summary, module) => {
    if (module.status === "PASS") summary.pass += 1;
    else if (module.status === "WARNING") summary.warning += 1;
    else summary.fail += 1;
    return summary;
  }, { pass: 0, warning: 0, fail: 0 });
}

function main() {
  ensureCoreDirs();
  runCommand("node", ["scripts/migrate_data_layout.js"]);

  const modules = {
    asin: moduleResult(),
    ads: moduleResult(),
    recommendations: moduleResult(),
    store: moduleResult(),
    database: moduleResult(),
    providers: moduleResult(),
    imports: moduleResult(),
    contracts: moduleResult(),
    keepa: moduleResult(),
    jungleScout: moduleResult()
  };

  runAuditScript("scripts/audit_asin_analyzer.js", modules.asin);
  runAuditScript("scripts/audit_ads_optimizer.js", modules.ads);
  runAuditScript("scripts/audit_recommendation_engine.js", modules.recommendations);

  checkFiles(modules.store, "Store data", [
    "data/store/store_products.json",
    "data/store/store_cost_profile_us.json",
    "data/store/store_cost_profile_ca.json",
    "data/store/store_sales_snapshot.json",
    "data/store/store_product_profile_merged.json",
    "data/store/store_profile_summary.json",
    "data/store/store_exclusion_rules.json",
    "data/store/store_expansion_opportunities.json"
  ]);

  checkFiles(modules.recommendations, "Product research data", [
    "data/product_research/candidate_products.json",
    "data/product_research/seasonal_calendar.json",
    "data/product_research/daily_recommendations/latest.json",
    "data/product_research/enrichment_queue.json"
  ]);
  validateEnrichmentQueue(modules.recommendations);

  checkFiles(modules.ads, "Ads hardening data", [
    "data/ads/raw_reports",
    "data/ads/cleaned_reports",
    "data/ads/llm_inputs",
    "data/ads/llm_outputs",
    "data/ads/action_payloads",
    "data/ads/review_results"
  ]);

  checkFiles(modules.providers, "Provider files", [
    "src/providers/productCandidateProvider.js",
    "src/providers/adsDataProvider.js",
    "src/providers/llmProvider.js",
    "src/providers/keepaProvider.js",
    "src/providers/jungleScoutProvider.js",
    "src/providers/amazonAdsProvider.js",
    "config/llm.config.example.json",
    "config/jungle_scout.config.example.json",
    "config/amazon_ads.config.example.json"
  ]);
  if (!fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8").includes("config/llm.config.local.json")) {
    addError(modules.providers, "config/llm.config.local.json must be gitignored.");
  }
  if (!fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8").includes("config/keepa.config.local.json")) {
    addError(modules.providers, "config/keepa.config.local.json must be gitignored.");
  }
  if (!fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8").includes("config/jungle_scout.config.local.json")) {
    addError(modules.providers, "config/jungle_scout.config.local.json must be gitignored.");
  }
  if (!fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8").includes("config/amazon_ads.config.local.json")) {
    addError(modules.providers, "config/amazon_ads.config.local.json must be gitignored.");
  }

  checkFiles(modules.imports, "Import scripts", [
    "scripts/import_product_candidates.js",
    "scripts/import_ads_reports.js",
    "scripts/sync_amazon_ads_reports.js",
    "scripts/enrich_queue_keepa.js",
    "scripts/import_jungle_scout_export.js",
    "scripts/import_jungle_scout_api.js",
    "scripts/check_jungle_scout_provider.js"
  ]);

  checkFiles(modules.jungleScout, "Jungle Scout import files", [
    "input/browser_exports/jungle_scout",
    "scripts/import_jungle_scout_export.js",
    "data/product_research/import_reports",
    "data/product_research/import_reports/jungle_scout_import_latest.json",
    "docs/jungle_scout_browser_import.md"
  ]);
  const jungleReport = readJson("data/product_research/import_reports/jungle_scout_import_latest.json", null);
  if (!jungleReport) {
    addError(modules.jungleScout, "Jungle Scout latest import report is missing or unreadable.");
  } else {
    [
      "imported_at",
      "files_processed",
      "raw_rows",
      "imported_count",
      "skipped_missing_asin",
      "duplicate_asin_count",
      "merged_existing_count",
      "new_candidate_count",
      "warnings",
      "errors"
    ].forEach(field => {
      if (!(field in jungleReport)) addError(modules.jungleScout, `Missing Jungle Scout report field: ${field}`);
    });
  }
  const importScript = fileExists("scripts/import_jungle_scout_export.js")
    ? fs.readFileSync(path.join(ROOT, "scripts/import_jungle_scout_export.js"), "utf8")
    : "";
  if (!importScript.includes("jungle_scout_csv") || !importScript.includes("input/browser_exports/jungle_scout")) {
    addError(modules.jungleScout, "Jungle Scout importer must support jungle_scout_csv source and browser export directory.");
  }
  scanJsonForSensitiveTerms(modules.jungleScout, [
    "data/product_research/import_reports/jungle_scout_import_latest.json",
    "data/product_research/candidate_products.json",
    "data/product_research/candidate_products_raw.json"
  ]);

  checkFiles(modules.keepa, "Keepa queue preparation", [
    "config/keepa.config.example.json",
    "data/product_research/enrichment_queue.json",
    "data/product_research/keepa_queue_enrichment_report.json",
    "data/mock/keepa_enrichment.mock.json"
  ]);
  const keepaReport = readJson("data/product_research/keepa_queue_enrichment_report.json", null);
  if (keepaReport && keepaReport.external_requests_made !== 0) {
    addError(modules.keepa, "Keepa queue enrichment must not call external APIs in local MVP mode.");
  }

  checkFiles(modules.contracts, "Contract files", ["docs/data_contract.md"]);
  const contract = fs.existsSync(path.join(ROOT, "docs/data_contract.md"))
    ? fs.readFileSync(path.join(ROOT, "docs/data_contract.md"), "utf8")
    : "";
  [
    "store_product_profile_merged",
    "candidate_product",
    "daily_recommendation",
    "asin_screening_result",
    "ad_cleaned_report",
    "llm_output",
    "enrichment_queue_item",
    "jungle_scout_import_report"
  ].forEach(section => {
    if (!contract.includes(`## ${section}`)) addError(modules.contracts, `Missing contract section: ${section}`);
  });

  checkDatabase(modules.database);

  const summary = summarize(modules);
  const status = summary.fail ? "FAIL" : summary.warning ? "WARNING" : "PASS";
  const report = {
    status,
    checked_at: new Date().toISOString(),
    modules,
    summary
  };

  writeJson("data/audit/audit_all.json", report);

  console.log("Amazon Growth Console Audit");
  console.log(`- ASIN: ${modules.asin.status}`);
  console.log(`- Ads: ${modules.ads.status}`);
  console.log(`- Recommendations: ${modules.recommendations.status}`);
  console.log(`- Store: ${modules.store.status}`);
  console.log(`- Database: ${modules.database.status}`);
  console.log(`- Providers: ${modules.providers.status}`);
  console.log(`- Imports: ${modules.imports.status}`);
  console.log(`- Contracts: ${modules.contracts.status}`);
  console.log(`- Keepa Queue: ${modules.keepa.status}`);
  console.log(`- Jungle Scout Import: ${modules.jungleScout.status}`);
  console.log("");
  console.log(`Overall: ${status}`);

  if (status === "FAIL") process.exitCode = 1;
}

main();
