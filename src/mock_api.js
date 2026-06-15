(function () {
  async function loadJson(path) {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to load ${path}: ${response.status}`);
    }
    return response.json();
  }

  async function tryLoadJson(path) {
    try {
      return await loadJson(path);
    } catch (error) {
      return null;
    }
  }

  async function getRecommendations() {
    const feedbackRecords = window.Feedback ? window.Feedback.getRecords() : [];
    const watchlistRecords = window.Watchlist ? window.Watchlist.getActive() : [];
    const provider = window.ProductCandidateProvider;
    const latestDaily = provider
      ? await provider.loadLatestDailyRecommendations()
      : await tryLoadJson("./data/daily_recommendations/latest.json");
    if (latestDaily && feedbackRecords.length === 0 && watchlistRecords.length === 0) {
      return {
        recommendations: latestDaily.recommendations || [],
        diagnostics: {
          daily_loaded: true,
          daily_date: latestDaily.date,
          scanned_candidates: latestDaily.summary && latestDaily.summary.candidate_count,
          final_count: latestDaily.summary && latestDaily.summary.final_count,
          duplicate_exclusions: (latestDaily.debug && latestDaily.debug.duplicate_exclusions) || [],
          risk_exclusions: (latestDaily.debug && latestDaily.debug.risk_exclusions) || [],
          over_80_selected_count: latestDaily.debug && latestDaily.debug.over_80_selected_count,
          product_ideas_selected: latestDaily.debug && latestDaily.debug.product_ideas_selected,
          latest_daily_summary: latestDaily.summary
        }
      };
    }

    const [
      storeProducts,
      candidateProducts,
      seasonalCalendar,
      profileSummary,
      exclusionRules,
      expansionOpportunities
    ] = await Promise.all([
      provider ? provider.loadStoreProducts() : loadJson("./data/store_product_profile_merged.json"),
      provider ? provider.loadCandidateProducts() : loadJson("./data/candidate_products.json"),
      provider ? provider.loadSeasonalCalendar() : loadJson("./data/seasonal_calendar.json"),
      provider ? provider.loadStoreProfileSummary() : loadJson("./data/store_profile_summary.json"),
      provider ? provider.loadStoreExclusionRules() : loadJson("./data/store_exclusion_rules.json"),
      provider ? provider.loadStoreExpansionOpportunities() : loadJson("./data/store_expansion_opportunities.json")
    ]);
    const storeContext = window.StoreProfile.buildContext({
      storeProducts,
      profileSummary,
      exclusionRules,
      expansionOpportunities
    });

    return window.Recommender.recommendProducts({
      storeProducts,
      storeContext,
      candidateProducts,
      seasonalCalendar,
      feedbackRecords,
      watchlistRecords,
      limit: 5
    });
  }

  window.MockApi = {
    getRecommendations
  };
})();
