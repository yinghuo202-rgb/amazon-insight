(function () {
  function totalScore(candidate, components = {}) {
    return (
      Number(candidate.market_score || 0) +
      Number(candidate.seasonality_score || 0) +
      Number(candidate.store_fit_score || 0) +
      Number(components.store_profile_score || candidate.store_profile_score || 0) +
      Number(candidate.profit_potential_score || 0) -
      Number(candidate.risk_score || 0) +
      Number(components.feedback_score || candidate.feedback_score || 0) -
      Number(components.duplicate_similarity_penalty || candidate.duplicate_similarity_penalty || 0)
    );
  }

  function feedbackAdjustment(candidate, feedbackRecords = []) {
    let adjustment = 0;

    for (const record of feedbackRecords) {
      const sameAsin = candidate.asin === record.asin;
      const sameType = candidate.product_type && candidate.product_type === record.product_type;
      const sameSubScenario = candidate.sub_scenario && candidate.sub_scenario === record.sub_scenario;
      const sameCategory = candidate.category && candidate.category === record.category;

      if (record.action === "interested") {
        if (sameAsin) adjustment += 8;
        else if (sameSubScenario) adjustment += 2;
      }

      if (record.action === "add_to_watchlist" || record.action === "watchlisted") {
        if (sameAsin) adjustment += 6;
        else if (sameSubScenario) adjustment += 1;
      }

      if (record.action === "check_suppliers" || record.action === "supplier_check") {
        if (sameAsin) adjustment += 10;
        else if (sameType) adjustment += 2;
      }

      if (record.action !== "reject" && record.action !== "rejected") continue;

      if (sameAsin) adjustment -= 50;
      else if (sameType) adjustment -= 18;
      else if (sameSubScenario) adjustment -= 7;
      else if (sameCategory) adjustment -= 3;

      if (record.reason === "too_large" && candidate.size_risk === "high") adjustment -= 8;
      if (record.reason === "compliance_risk" && candidate.compliance_risk !== "low") adjustment -= 8;
      if (record.reason === "installation_too_complex" && candidate.complexity_level !== "low") adjustment -= 7;
      if (record.reason === "weak_profit_potential" && Number(candidate.profit_potential_score || 0) < 14) adjustment -= 6;
      if (record.reason === "price_too_low" && Number(candidate.reference_price || 0) < 20) adjustment -= 5;
      if (record.reason === "seasonality_not_right" && candidate.timing_window === "early_layout") adjustment -= 5;
      if (record.reason === "duplicate_or_too_similar" && (sameType || sameSubScenario)) adjustment -= 10;
      if (record.reason === "category_not_preferred" && sameCategory) adjustment -= 8;
      if (record.reason === "not_interested" && sameSubScenario) adjustment -= 4;
    }

    return adjustment;
  }

  function storeContextAdjustment(candidate, storeProducts = []) {
    if (!storeProducts.length) return 0;

    const sameSubScenarioCount = storeProducts.filter(product => (
      product.sub_scenario &&
      candidate.sub_scenario &&
      product.sub_scenario === candidate.sub_scenario
    )).length;
    const sameCategoryCount = storeProducts.filter(product => (
      product.category_cn &&
      candidate.category &&
      String(candidate.category).includes(product.category_cn)
    )).length;
    const sources = candidate.recommendation_sources || [];

    let adjustment = 0;
    if (sameSubScenarioCount > 0) adjustment += 2;
    if (sameSubScenarioCount >= 3) adjustment += 2;
    if (sameCategoryCount > 0) adjustment += 1;
    if (sources.includes("store_expansion") && (sameSubScenarioCount > 0 || sameCategoryCount > 0)) {
      adjustment += 3;
    }

    return Math.min(adjustment, 7);
  }

  function profileAdjustment(candidate, storeContext) {
    if (!storeContext || !window.StoreProfile) return {
      score: 0,
      themes: [],
      rationale: ""
    };

    const expansion = window.StoreProfile.expansionMatch(candidate, storeContext);
    const weakPenalty = window.StoreProfile.scenarioPenalty(candidate, storeContext);
    const strongBonus = window.StoreProfile.isStrongStoreScenario(candidate, storeContext) ? 2 : 0;

    return {
      score: expansion.score + weakPenalty + strongBonus,
      themes: expansion.themes,
      rationale: expansion.rationale
    };
  }

  function gradeFromScore(score) {
    if (score >= 72) return "A";
    if (score >= 64) return "B+";
    if (score >= 56) return "B";
    return "C";
  }

  function actionFromCandidate(candidate, score) {
    if (candidate.timing_window === "early_layout" && score < 70) return "recheck_later";
    if (candidate.timing_window === "early_layout") return "add_to_watchlist";
    if (Number(candidate.risk_score || 0) >= 12) return "review_negative_reviews";
    if (score >= 70) return "add_to_watchlist";
    if (score >= 58) return "add_to_watchlist";
    return "hold";
  }

  function scoreCandidate(candidate, options = {}) {
    const adjustment = feedbackAdjustment(candidate, options.feedbackRecords || []);
    const storeAdjustment = storeContextAdjustment(candidate, options.storeProducts || []);
    const profileAdj = profileAdjustment(candidate, options.storeContext);
    const storeProfileScore = storeAdjustment + profileAdj.score;
    const duplicateSimilarityPenalty = Number(candidate.duplicate_similarity_penalty || 0);
    const score = totalScore(candidate, {
      feedback_score: adjustment,
      store_profile_score: storeProfileScore,
      duplicate_similarity_penalty: duplicateSimilarityPenalty
    });
    const baseScore = totalScore(candidate);
    return {
      ...candidate,
      base_score: baseScore,
      feedback_score: adjustment,
      feedback_adjustment: adjustment,
      store_context_adjustment: storeAdjustment,
      store_profile_adjustment: profileAdj.score,
      store_profile_score: storeProfileScore,
      duplicate_similarity_penalty: duplicateSimilarityPenalty,
      matched_expansion_themes: profileAdj.themes,
      store_expansion_rationale: profileAdj.rationale,
      total_score: score,
      recommendation_grade: gradeFromScore(score),
      action_suggestion: candidate.action_suggestion || actionFromCandidate(candidate, score),
      is_price_focus: candidate.reference_price >= 20 && candidate.reference_price <= 80,
      is_above_price_focus: candidate.reference_price > 80,
      monthly_sales_qualified:
        Number(candidate.estimated_monthly_sales || 0) >= 30 ||
        candidate.timing_window === "early_layout"
    };
  }

  window.Scoring = {
    feedbackAdjustment,
    profileAdjustment,
    storeContextAdjustment,
    scoreCandidate,
    totalScore,
    gradeFromScore
  };
})();
