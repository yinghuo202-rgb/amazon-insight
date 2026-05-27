(function () {
  function compareCandidates(left, right) {
    if (right.total_score !== left.total_score) return right.total_score - left.total_score;
    if (Number(right.candidate_level !== "product_idea") !== Number(left.candidate_level !== "product_idea")) {
      return Number(right.candidate_level !== "product_idea") - Number(left.candidate_level !== "product_idea");
    }
    if (Number(right.is_price_focus) !== Number(left.is_price_focus)) {
      return Number(right.is_price_focus) - Number(left.is_price_focus);
    }
    return Number(right.estimated_monthly_sales || 0) - Number(left.estimated_monthly_sales || 0);
  }

  function isRealAmazonCandidate(candidate) {
    const sources = candidate.recommendation_sources || [];
    const asin = String(candidate.asin || "").trim().toUpperCase();
    return (
      /^[A-Z0-9]{10}$/.test(asin) &&
      (
        candidate.source === "jungle_scout_api" ||
        candidate.source === "jungle_scout_csv" ||
        candidate.sales_source === "jungle_scout_api" ||
        candidate.sales_source === "jungle_scout" ||
        sources.includes("jungle_scout_api") ||
        sources.includes("jungle_scout_import")
      )
    );
  }

  function recommendProducts({ storeProducts, storeContext, candidateProducts, seasonalCalendar, feedbackRecords = [], watchlistRecords = [], limit = 5 }) {
    const context = storeContext || (window.StoreProfile ? window.StoreProfile.buildContext({ storeProducts }) : null);
    const exclusionProducts = context ? context.exclusionProducts : storeProducts;
    const duplicateResult = window.DuplicateFilter.filterDuplicates(candidateProducts, exclusionProducts);
    const riskResult = window.RecommendationConstraints
      ? window.RecommendationConstraints.filterRiskCandidates(duplicateResult.kept, { feedbackRecords, watchlistRecords })
      : { kept: duplicateResult.kept, excluded: [] };
    const scored = riskResult.kept
      .map(candidate => window.Scoring.scoreCandidate({
        ...candidate,
        seasonal_calendar_marketplace: seasonalCalendar && seasonalCalendar.marketplace
      }, { feedbackRecords, storeProducts, storeContext: context }))
      .sort(compareCandidates);
    const realScored = scored.filter(isRealAmazonCandidate);
    const selectionPool = realScored.length >= limit ? realScored : scored;

    const selectionResult = window.RecommendationConstraints
      ? window.RecommendationConstraints.applyFinalSelection(selectionPool, { limit })
      : { selected: selectionPool.slice(0, limit), skipped: [], over_80_selected_count: 0 };
    const recommendations = window.RecommendationFormatter
      ? window.RecommendationFormatter.formatRecommendations(selectionResult.selected)
      : selectionResult.selected;

    return {
      recommendations,
      diagnostics: {
        scanned_candidates: candidateProducts.length,
        duplicate_exclusions: duplicateResult.excluded,
        eligible_after_duplicate_filter: duplicateResult.kept.length,
        risk_exclusions: riskResult.excluded,
        eligible_after_risk_filter: riskResult.kept.length,
        feedback_records_applied: feedbackRecords.length,
        watchlist_records_applied: watchlistRecords.length,
        store_profile_applied: Boolean(context),
        product_idea_candidates: candidateProducts.filter(candidate => candidate.candidate_level === "product_idea").length,
        product_ideas_selected: recommendations.filter(candidate => candidate.candidate_level === "product_idea").length,
        final_selection_skipped: selectionResult.skipped,
        over_80_selected_count: selectionResult.over_80_selected_count,
        real_amazon_candidate_count: realScored.length,
        real_amazon_preferred: realScored.length >= limit,
        scored_candidates: scored,
        final_count: recommendations.length
      }
    };
  }

  window.Recommender = {
    recommendProducts
  };
})();
