const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const DAILY_DIR = path.join(DATA_DIR, "daily_recommendations");

function readJson(fileName) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, fileName), "utf8"));
}

function loadBrowserModules() {
  const storage = {};
  const localStorage = {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null;
    },
    setItem(key, value) {
      storage[key] = String(value);
    },
    removeItem(key) {
      delete storage[key];
    }
  };
  const context = { window: { localStorage }, localStorage, console };
  context.window.window = context.window;
  vm.createContext(context);

  [
    "src/duplicate_filter.js",
    "src/store_profile.js",
    "src/scoring.js",
    "src/recommendation_constraints.js",
    "src/recommendation_formatter.js",
    "src/analyzers/review_pain_point_analyzer.js",
    "src/watchlist.js",
    "src/recommender.js"
  ].forEach(file => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), context, { filename: file });
  });

  return context.window;
}

function countBy(items, key) {
  return items.reduce((counts, item) => {
    const value = item[key] || "unknown";
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

function assertCheck(report, name, passed, details = {}) {
  report.checks.push({ name, passed, details });
  if (!passed) report.failed_checks += 1;
}

function main() {
  const api = loadBrowserModules();
  const storeProducts = readJson("store_product_profile_merged.json");
  const candidateProducts = readJson("candidate_products.json");
  const seasonalCalendar = readJson("seasonal_calendar.json");
  const profileSummary = readJson("store_profile_summary.json");
  const exclusionRules = readJson("store_exclusion_rules.json");
  const expansionOpportunities = readJson("store_expansion_opportunities.json");
  const storeContext = api.StoreProfile.buildContext({ storeProducts, profileSummary, exclusionRules, expansionOpportunities });
  const result = api.Recommender.recommendProducts({
    storeProducts,
    storeContext,
    candidateProducts,
    seasonalCalendar,
    feedbackRecords: [],
    watchlistRecords: [],
    limit: 5
  });

  const recommendations = result.recommendations;
  const report = {
    generated_at: new Date().toISOString(),
    candidate_count: candidateProducts.length,
    final_count: recommendations.length,
    failed_checks: 0,
    checks: [],
    selected: recommendations.map(item => ({
      id: item.asin || item.idea_id,
      title: item.title,
      candidate_level: item.candidate_level,
      sub_scenario: item.sub_scenario,
      timing_window: item.timing_window,
      recommendation_sources: item.recommendation_sources,
      total_score: item.total_score
    })),
    diagnostics_summary: {
      duplicate_exclusions: result.diagnostics.duplicate_exclusions.length,
      risk_exclusions: result.diagnostics.risk_exclusions.length,
      product_ideas_selected: result.diagnostics.product_ideas_selected,
      over_80_selected_count: result.diagnostics.over_80_selected_count
    }
  };

  const above80 = recommendations.filter(item => Number(item.reference_price || 0) > 80).length;
  const subScenarioCounts = countBy(recommendations, "sub_scenario");
  const duplicateIds = recommendations
    .map(item => item.asin || item.idea_id)
    .filter(Boolean)
    .filter((id, index, ids) => ids.indexOf(id) !== index);
  const realAmazonPreferred = Boolean(result.diagnostics && result.diagnostics.real_amazon_preferred);

  assertCheck(report, "outputs_exactly_5_when_candidates_available", recommendations.length === 5, { final_count: recommendations.length });
  assertCheck(report, "at_most_one_above_80", above80 <= 1, { above80 });
  assertCheck(report, "sub_scenario_limit", Object.values(subScenarioCounts).every(count => count <= 2), { subScenarioCounts });
  assertCheck(report, "no_duplicate_selected_ids", duplicateIds.length === 0, { duplicateIds });
  assertCheck(report, "existing_products_filtered", result.diagnostics.duplicate_exclusions.length >= 2, {
    duplicate_exclusions: result.diagnostics.duplicate_exclusions.map(item => item.title)
  });
  assertCheck(report, "early_layout_can_enter_final", realAmazonPreferred || recommendations.some(item => item.timing_window === "early_layout"), {
    early_layout_titles: recommendations.filter(item => item.timing_window === "early_layout").map(item => item.title),
    real_amazon_preferred: realAmazonPreferred
  });
  assertCheck(report, "store_expansion_can_enter_final", recommendations.some(item => (item.recommendation_sources || []).includes("store_expansion")), {
    store_expansion_count: recommendations.filter(item => (item.recommendation_sources || []).includes("store_expansion")).length
  });
  assertCheck(report, "formatted_copy_complete", recommendations.every(item => (
    item.one_sentence_conclusion &&
    item.market_situation &&
    item.use_case &&
    item.store_relation &&
    item.why_recommended &&
    item.main_risks &&
    item.next_step &&
    Array.isArray(item.validation_checklist) &&
    item.validation_checklist.length
  )));
  assertCheck(report, "supplier_check_action_removed", recommendations.every(item => item.action_suggestion !== "check_suppliers"), {
    action_suggestions: recommendations.map(item => item.action_suggestion)
  });

  const watchlistTarget = recommendations[0];
  const firstWatchlist = api.Watchlist.add(watchlistTarget, { reason_added: "audit", status: "watching" });
  const secondWatchlist = api.Watchlist.add(watchlistTarget, { reason_added: "audit_duplicate", status: "shortlisted" });
  const watchlistItems = api.Watchlist.getActive();
  const afterWatchlist = api.Recommender.recommendProducts({
    storeProducts,
    storeContext,
    candidateProducts,
    seasonalCalendar,
    feedbackRecords: [],
    watchlistRecords: watchlistItems,
    limit: 5
  });

  assertCheck(report, "watchlist_deduplicates_same_product", watchlistItems.length === 1, {
    first_status: firstWatchlist.status,
    second_status: secondWatchlist.status,
    watchlist_count: watchlistItems.length
  });
  const removedFromWatchlist = api.Watchlist.remove(watchlistTarget);
  const watchlistAfterRemove = api.Watchlist.getActive();
  api.Watchlist.add(watchlistTarget, { reason_added: "audit_restore", status: "watching" });
  assertCheck(report, "watchlist_remove_deletes_active_item", removedFromWatchlist && watchlistAfterRemove.length === 0, {
    removed: removedFromWatchlist,
    active_after_remove: watchlistAfterRemove.length
  });
  assertCheck(report, "watchlist_blocks_active_recommendation", !afterWatchlist.recommendations.some(item => (
    (item.asin || item.idea_id) === (watchlistTarget.asin || watchlistTarget.idea_id)
  )), {
    blocked_id: watchlistTarget.asin || watchlistTarget.idea_id,
    risk_exclusions: afterWatchlist.diagnostics.risk_exclusions.filter(item => item.reason === "already_in_watchlist")
  });

  const earlyLayoutProduct = recommendations.find(item => item.timing_window === "early_layout");
  if (earlyLayoutProduct) {
    api.Watchlist.clearAll();
    const seasonalWatch = api.Watchlist.add(earlyLayoutProduct, { reason_added: "audit_seasonal" });
    assertCheck(report, "seasonal_watchlist_has_next_check_date", Boolean(seasonalWatch.next_check_date), {
      title: earlyLayoutProduct.title,
      next_check_date: seasonalWatch.next_check_date
    });
  } else if (realAmazonPreferred) {
    assertCheck(report, "seasonal_watchlist_has_next_check_date", true, {
      reason: "real_amazon_preferred_no_early_layout"
    });
  } else {
    assertCheck(report, "seasonal_watchlist_has_next_check_date", false, { reason: "no early_layout recommendation available" });
  }

  const latestDailyPath = path.join(DAILY_DIR, "latest.json");
  const historyPath = path.join(DATA_DIR, "recommendation_history.json");
  if (fs.existsSync(latestDailyPath) && fs.existsSync(historyPath)) {
    const latestDaily = JSON.parse(fs.readFileSync(latestDailyPath, "utf8"));
    const history = JSON.parse(fs.readFileSync(historyPath, "utf8"));
    const dateFilePath = path.join(DAILY_DIR, `${latestDaily.date}.json`);
    const dateFile = fs.existsSync(dateFilePath) ? JSON.parse(fs.readFileSync(dateFilePath, "utf8")) : null;

    assertCheck(report, "daily_latest_schema_complete", Boolean(
      latestDaily.date &&
      latestDaily.marketplace &&
      latestDaily.summary &&
      latestDaily.summary.final_count === 5 &&
      Array.isArray(latestDaily.recommendations) &&
      latestDaily.recommendations.length === latestDaily.summary.final_count &&
      latestDaily.debug
    ), {
      date: latestDaily.date,
      final_count: latestDaily.summary && latestDaily.summary.final_count
    });
    assertCheck(report, "daily_date_file_matches_latest", Boolean(dateFile && dateFile.date === latestDaily.date), {
      latest_date: latestDaily.date,
      date_file_exists: Boolean(dateFile)
    });
    assertCheck(report, "recommendation_history_contains_latest", (history.runs || []).some(item => item.date === latestDaily.date), {
      latest_date: latestDaily.date,
      history_count: (history.runs || []).length
    });
  } else {
    assertCheck(report, "daily_output_available", false, {
      latest_exists: fs.existsSync(latestDailyPath),
      history_exists: fs.existsSync(historyPath)
    });
  }

  const keepaReportPath = path.join(DATA_DIR, "keepa_enrichment_report.json");
  if (fs.existsSync(keepaReportPath)) {
    const keepaReport = JSON.parse(fs.readFileSync(keepaReportPath, "utf8"));
    const enrichedCandidates = readJson("candidate_products.json");
    const enrichedCount = enrichedCandidates.filter(item => item.keepa_enriched).length;
    const missingButKept = enrichedCandidates.filter(item => item.asin && item.keepa_missing).length;
    assertCheck(report, "keepa_enrichment_report_available", keepaReport.enriched_count === enrichedCount, {
      report_enriched_count: keepaReport.enriched_count,
      candidate_enriched_count: enrichedCount,
      mode: keepaReport.mode
    });
    assertCheck(report, "keepa_missing_candidates_are_kept", keepaReport.missing_keepa_count === missingButKept, {
      report_missing_count: keepaReport.missing_keepa_count,
      candidate_missing_count: missingButKept
    });
    assertCheck(report, "keepa_enriched_fields_present", enrichedCandidates.filter(item => item.keepa_enriched).every(item => (
      item.keepa_updated_at &&
      item.keepa_source &&
      item.bsr !== undefined &&
      item.offer_count !== undefined
    )), {
      enriched_count: enrichedCount
    });
  } else {
    assertCheck(report, "keepa_enrichment_report_available", false, { reason: "data/keepa_enrichment_report.json is missing" });
  }

  const salesReportPath = path.join(DATA_DIR, "sales_estimation_report.json");
  if (fs.existsSync(salesReportPath)) {
    const salesReport = JSON.parse(fs.readFileSync(salesReportPath, "utf8"));
    const salesCandidates = readJson("candidate_products.json");
    assertCheck(report, "sales_estimation_report_available", salesReport.estimated_count === salesCandidates.length, {
      estimated_count: salesReport.estimated_count,
      candidate_count: salesCandidates.length,
      by_confidence: salesReport.by_confidence
    });
    assertCheck(report, "sales_fields_present", salesCandidates.every(item => (
      item.estimated_monthly_sales_range &&
      item.sales_confidence &&
      item.sales_source
    )), {
      missing: salesCandidates.filter(item => !item.estimated_monthly_sales_range || !item.sales_confidence || !item.sales_source).map(item => item.title)
    });
  } else {
    assertCheck(report, "sales_estimation_report_available", false, { reason: "data/sales_estimation_report.json is missing" });
  }

  const reviewReportPath = path.join(DATA_DIR, "review_pain_point_report.json");
  const painPointsPath = path.join(DATA_DIR, "review_pain_points.json");
  if (fs.existsSync(reviewReportPath) && fs.existsSync(painPointsPath)) {
    const reviewReport = JSON.parse(fs.readFileSync(reviewReportPath, "utf8"));
    const painPoints = JSON.parse(fs.readFileSync(painPointsPath, "utf8"));
    assertCheck(report, "review_pain_points_available", painPoints.length === reviewReport.review_sample_asin_count, {
      review_sample_asin_count: reviewReport.review_sample_asin_count,
      pain_point_records: painPoints.length
    });
    const supportedThemes = new Set((api.ReviewPainPointAnalyzer && api.ReviewPainPointAnalyzer.THEMES || []).map(item => item.theme));
    assertCheck(report, "review_required_themes_supported", [
      "leaking",
      "poor sealing",
      "inaccurate gauge",
      "fitment mismatch",
      "installation difficulty",
      "weak material",
      "wrong size",
      "unclear instructions",
      "rust",
      "breakage",
      "packaging damage",
      "high return risk"
    ].every(theme => supportedThemes.has(theme)), {
      supported_count: supportedThemes.size
    });
  } else {
    assertCheck(report, "review_pain_points_available", false, {
      review_report_exists: fs.existsSync(reviewReportPath),
      pain_points_exists: fs.existsSync(painPointsPath)
    });
  }

  const latestForReportPath = path.join(DAILY_DIR, "latest.json");
  if (fs.existsSync(latestForReportPath)) {
    const latestForReport = JSON.parse(fs.readFileSync(latestForReportPath, "utf8"));
    const markdownReportPath = path.join(DAILY_DIR, `${latestForReport.date}_report.md`);
    assertCheck(report, "daily_markdown_report_exported", fs.existsSync(markdownReportPath), {
      expected: `data/daily_recommendations/${latestForReport.date}_report.md`
    });
  }

  assertCheck(report, "api_integration_plan_documented", fs.existsSync(path.join(ROOT, "docs", "api_integration_plan.md")), {
    path: "docs/api_integration_plan.md"
  });

  fs.writeFileSync(path.join(DATA_DIR, "recommendation_audit_report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));

  if (report.failed_checks > 0) {
    process.exitCode = 1;
  }
}

main();
