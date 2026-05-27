(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ProductCandidateProvider = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const PATHS = {
    mockCandidates: ["./data/mock/candidates.mock.json", "./data/candidate_products_raw.json"],
    manualCandidates: ["./data/product_research/candidate_products_raw.json", "./data/candidate_products_raw.json"],
    normalizedCandidates: ["./data/product_research/candidate_products.json", "./data/candidate_products.json"],
    keepaCandidates: ["./data/product_research/keepa_enriched_candidates.json", "./data/candidate_products.json"],
    seasonalCalendar: ["./data/product_research/seasonal_calendar.json", "./data/seasonal_calendar.json"],
    storeProducts: ["./data/store/store_product_profile_merged.json", "./data/store_product_profile_merged.json"],
    storeProfileSummary: ["./data/store/store_profile_summary.json", "./data/store_profile_summary.json"],
    storeExclusionRules: ["./data/store/store_exclusion_rules.json", "./data/store_exclusion_rules.json"],
    storeExpansionOpportunities: ["./data/store/store_expansion_opportunities.json", "./data/store_expansion_opportunities.json"],
    latestDaily: ["./data/product_research/daily_recommendations/latest.json", "./data/daily_recommendations/latest.json"]
  };

  async function loadJson(path) {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) throw new Error(`Failed to load ${path}: ${response.status}`);
    return response.json();
  }

  async function loadFirst(paths, fallback = null) {
    let lastError = null;
    for (const path of paths) {
      try {
        return await loadJson(path);
      } catch (error) {
        lastError = error;
      }
    }
    if (fallback !== null) return fallback;
    throw lastError || new Error("No candidate provider path configured.");
  }

  function loadMockCandidates() {
    return loadFirst(PATHS.mockCandidates, []);
  }

  function loadManualCandidates() {
    return loadFirst(PATHS.manualCandidates, []);
  }

  function loadNormalizedCandidates() {
    return loadFirst(PATHS.normalizedCandidates, []);
  }

  function loadKeepaCandidates() {
    return loadFirst(PATHS.keepaCandidates, []);
  }

  function loadCandidateProducts() {
    return loadNormalizedCandidates();
  }

  function loadSeasonalCalendar() {
    return loadFirst(PATHS.seasonalCalendar, {});
  }

  function loadStoreProducts() {
    return loadFirst(PATHS.storeProducts, []);
  }

  function loadStoreProfileSummary() {
    return loadFirst(PATHS.storeProfileSummary, {});
  }

  function loadStoreExclusionRules() {
    return loadFirst(PATHS.storeExclusionRules, {});
  }

  function loadStoreExpansionOpportunities() {
    return loadFirst(PATHS.storeExpansionOpportunities, { opportunities: [] });
  }

  function loadLatestDailyRecommendations() {
    return loadFirst(PATHS.latestDaily, null);
  }

  return {
    PATHS,
    loadFirst,
    loadMockCandidates,
    loadManualCandidates,
    loadNormalizedCandidates,
    loadKeepaCandidates,
    loadCandidateProducts,
    loadSeasonalCalendar,
    loadStoreProducts,
    loadStoreProfileSummary,
    loadStoreExclusionRules,
    loadStoreExpansionOpportunities,
    loadLatestDailyRecommendations
  };
});
