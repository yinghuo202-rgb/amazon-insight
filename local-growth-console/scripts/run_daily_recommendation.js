const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const DAILY_DIR = path.join(DATA_DIR, "daily_recommendations");
const PRODUCT_RESEARCH_DAILY_DIR = path.join(DATA_DIR, "product_research", "daily_recommendations");
const TIME_ZONE = "Asia/Shanghai";

function readJson(fileName, fallback = null) {
  const filePath = path.join(DATA_DIR, fileName);
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function localDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
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
    "src/watchlist.js",
    "src/recommender.js"
  ].forEach(file => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), context, { filename: file });
  });

  return context.window;
}

function countWhere(items, predicate) {
  return items.filter(predicate).length;
}

function topValues(items, getter, limit = 4) {
  const counts = new Map();
  for (const item of items) {
    const value = getter(item);
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

function riskNotes(diagnostics) {
  const reasons = topValues(diagnostics.risk_exclusions || [], item => item.reason, 3);
  const notes = reasons.map(item => `${item.value}: ${item.count}`);
  if ((diagnostics.duplicate_exclusions || []).length) {
    notes.unshift(`existing_or_duplicate_filtered: ${diagnostics.duplicate_exclusions.length}`);
  }
  return notes;
}

function buildDailyResult({ date, recommendationResult, seasonalCalendar }) {
  const recommendations = recommendationResult.recommendations;
  const diagnostics = recommendationResult.diagnostics;
  const sourceThemes = topValues(recommendations, item => item.sub_scenario, 5).map(item => item.value);
  const priorityProducts = recommendations.slice(0, 2).map(item => ({
    title: item.title,
    reason: item.one_sentence_conclusion || item.why_recommended,
    action_suggestion: item.action_suggestion
  }));

  return {
    date,
    generated_at: new Date().toISOString(),
    marketplace: seasonalCalendar.marketplace || "Amazon US",
    summary: {
      candidate_count: diagnostics.scanned_candidates,
      eligible_count: diagnostics.eligible_after_risk_filter,
      final_count: recommendations.length,
      main_themes: sourceThemes,
      current_opportunity_count: countWhere(recommendations, item => item.timing_window === "current_opportunity"),
      seasonal_early_layout_count: countWhere(recommendations, item => item.timing_window === "early_layout"),
      store_expansion_count: countWhere(recommendations, item => (item.recommendation_sources || []).includes("store_expansion")),
      risk_notes: riskNotes(diagnostics),
      priority_products: priorityProducts
    },
    recommendations,
    debug: {
      filtered_existing_count: countWhere(diagnostics.duplicate_exclusions || [], item => (
        item.reason === "same_asin" || item.reason === "same_parent_asin" || item.reason === "same_product_type"
      )),
      filtered_duplicate_count: (diagnostics.duplicate_exclusions || []).length,
      filtered_risk_count: (diagnostics.risk_exclusions || []).length,
      over_80_selected_count: diagnostics.over_80_selected_count,
      product_ideas_selected: diagnostics.product_ideas_selected,
      feedback_records_applied: diagnostics.feedback_records_applied,
      watchlist_records_applied: diagnostics.watchlist_records_applied,
      final_selection_skipped_count: (diagnostics.final_selection_skipped || []).length,
      duplicate_exclusions: diagnostics.duplicate_exclusions,
      risk_exclusions: diagnostics.risk_exclusions,
      final_selection_skipped: diagnostics.final_selection_skipped
    }
  };
}

function updateHistory(dailyResult) {
  const historyPath = path.join(DATA_DIR, "recommendation_history.json");
  const history = fs.existsSync(historyPath)
    ? JSON.parse(fs.readFileSync(historyPath, "utf8"))
    : { generated_at: "", runs: [] };

  const runSummary = {
    date: dailyResult.date,
    generated_at: dailyResult.generated_at,
    marketplace: dailyResult.marketplace,
    final_count: dailyResult.summary.final_count,
    candidate_count: dailyResult.summary.candidate_count,
    main_themes: dailyResult.summary.main_themes,
    recommendation_file: `data/daily_recommendations/${dailyResult.date}.json`
  };

  history.generated_at = new Date().toISOString();
  history.runs = [
    runSummary,
    ...(history.runs || []).filter(item => item.date !== dailyResult.date)
  ].slice(0, 60);

  writeJson(historyPath, history);
  return history;
}

function main() {
  const date = process.argv[2] || localDateString();
  const api = loadBrowserModules();
  const storeProducts = readJson("store_product_profile_merged.json", []);
  const candidateProducts = readJson("candidate_products.json", []);
  const seasonalCalendar = readJson("seasonal_calendar.json", {});
  const profileSummary = readJson("store_profile_summary.json", {});
  const exclusionRules = readJson("store_exclusion_rules.json", {});
  const expansionOpportunities = readJson("store_expansion_opportunities.json", {});
  const feedbackRecords = readJson("feedback_records.json", []);
  const watchlistRecords = readJson("watchlist.json", []);

  const storeContext = api.StoreProfile.buildContext({
    storeProducts,
    profileSummary,
    exclusionRules,
    expansionOpportunities
  });

  const recommendationResult = api.Recommender.recommendProducts({
    storeProducts,
    storeContext,
    candidateProducts,
    seasonalCalendar,
    feedbackRecords,
    watchlistRecords,
    limit: 5
  });

  const dailyResult = buildDailyResult({ date, recommendationResult, seasonalCalendar });
  writeJson(path.join(DAILY_DIR, `${date}.json`), dailyResult);
  writeJson(path.join(DAILY_DIR, "latest.json"), dailyResult);
  writeJson(path.join(PRODUCT_RESEARCH_DAILY_DIR, `${date}.json`), dailyResult);
  writeJson(path.join(PRODUCT_RESEARCH_DAILY_DIR, "latest.json"), dailyResult);
  const history = updateHistory(dailyResult);

  console.log(JSON.stringify({
    date: dailyResult.date,
    output: `data/daily_recommendations/${date}.json`,
    latest: "data/daily_recommendations/latest.json",
    history_count: history.runs.length,
    summary: dailyResult.summary,
    debug: {
      filtered_duplicate_count: dailyResult.debug.filtered_duplicate_count,
      filtered_risk_count: dailyResult.debug.filtered_risk_count,
      over_80_selected_count: dailyResult.debug.over_80_selected_count
    }
  }, null, 2));
}

main();
