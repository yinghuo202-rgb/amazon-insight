(function () {
  function valueOrFallback(value, fallback) {
    if (value === null || value === undefined || value === "") return fallback;
    return value;
  }

  function salesConfidenceText(candidate) {
    const confidence = candidate.sales_confidence || "unknown";
    const range = candidate.estimated_monthly_sales_range || "unknown";
    return `Estimated monthly sales range: ${range}; confidence: ${confidence}.`;
  }

  function oneSentenceConclusion(candidate) {
    if (candidate.one_sentence_conclusion) return candidate.one_sentence_conclusion;
    if (candidate.timing_window === "early_layout") {
      return `${candidate.title} is a seasonal early-layout candidate; validate suppliers now and watch demand before stocking.`;
    }
    if ((candidate.recommendation_sources || []).includes("store_expansion")) {
      return `${candidate.title} is worth checking because it extends the store's current buyer scenarios without being a direct duplicate.`;
    }
    return `${candidate.title} is worth reviewing because the current score, price band, and use case are actionable.`;
  }

  function validationChecklist(candidate) {
    const checklist = Array.isArray(candidate.validation_checklist) ? candidate.validation_checklist.filter(Boolean) : [];
    if (checklist.length) return checklist;
    return [
      "Check supplier quote and landed cost",
      "Review negative reviews for recurring defects",
      "Confirm it is not a store duplicate",
      "Validate package size, FBA fees, and return risk"
    ];
  }

  function formatRecommendation(candidate) {
    const formatted = {
      ...candidate,
      asin: candidate.asin || "",
      parent_asin: candidate.parent_asin || "",
      title: valueOrFallback(candidate.title, "Untitled product opportunity"),
      display_title: valueOrFallback(candidate.display_title, candidate.title || "Untitled product opportunity"),
      category: valueOrFallback(candidate.category, "Uncategorized"),
      reference_price: candidate.reference_price === null || candidate.reference_price === undefined ? 0 : Number(candidate.reference_price),
      estimated_monthly_sales: Number(candidate.estimated_monthly_sales || 0),
      estimated_monthly_sales_range: candidate.estimated_monthly_sales_range || "",
      estimated_monthly_revenue: candidate.estimated_monthly_revenue ?? null,
      sales_confidence: candidate.sales_confidence || "unknown",
      sales_source: candidate.sales_source || "",
      recommendation_sources: Array.isArray(candidate.recommendation_sources) ? candidate.recommendation_sources : [],
      store_fit: candidate.store_fit || "medium",
      opportunity_type: candidate.opportunity_type || "current_opportunity",
      timing_window: candidate.timing_window || "not_seasonal",
      seasonal_attribute: valueOrFallback(candidate.seasonal_attribute, "No narrow seasonal attribute detected."),
      recommendation_grade: candidate.recommendation_grade || "C",
      action_suggestion: candidate.action_suggestion || "hold",
      one_sentence_conclusion: oneSentenceConclusion(candidate),
      market_situation: valueOrFallback(candidate.market_situation, salesConfidenceText(candidate)),
      use_case: valueOrFallback(candidate.use_case, "Validate the buyer scenario before supplier outreach."),
      store_relation: valueOrFallback(candidate.store_relation, candidate.store_expansion_rationale || "No direct store relation found; treat as a broader opportunity."),
      why_recommended: valueOrFallback(candidate.why_recommended, oneSentenceConclusion(candidate)),
      main_risks: valueOrFallback(candidate.main_risks, "Main risks are supplier consistency, competition, and FBA economics."),
      next_step: valueOrFallback(candidate.next_step, "Review suppliers, negative reviews, and margin assumptions."),
      competitive_notes: valueOrFallback(candidate.competitive_notes, "Review competitor negative reviews before advancing."),
      seasonality_notes: valueOrFallback(candidate.seasonality_notes, candidate.seasonal_attribute || "No narrow seasonal window detected."),
      store_expansion_logic: valueOrFallback(candidate.store_expansion_logic, candidate.store_relation || candidate.store_expansion_rationale || "Store fit should be validated manually."),
      validation_checklist: validationChecklist(candidate)
    };

    if (formatted.candidate_level === "product_idea") {
      formatted.one_sentence_conclusion = `${formatted.one_sentence_conclusion} This is a product direction, not a validated ASIN.`;
    }

    return formatted;
  }

  function formatRecommendations(candidates) {
    return (candidates || []).map(formatRecommendation);
  }

  window.RecommendationFormatter = {
    formatRecommendation,
    formatRecommendations
  };
})();
