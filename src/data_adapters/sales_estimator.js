(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SalesEstimator = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function categoryMultiplier(category = "") {
    const text = String(category).toLowerCase();
    if (text.includes("garden") || text.includes("hose")) return 1.15;
    if (text.includes("rv")) return 0.95;
    if (text.includes("automotive")) return 1.05;
    if (text.includes("garage")) return 0.85;
    if (text.includes("trailer")) return 0.9;
    return 1;
  }

  function estimateFromBsr(candidate) {
    const bsr = number(candidate.bsr);
    if (!bsr) return null;
    const base = Math.max(12, Math.round(260000 / Math.sqrt(bsr)));
    const trendBoost = candidate.bsr_30d_trend === "improving" ? 1.18 : candidate.bsr_30d_trend === "worsening" ? 0.82 : 1;
    const reviewBoost = number(candidate.review_30d_growth) >= 15 ? 1.12 : 1;
    return Math.round(base * trendBoost * reviewBoost * categoryMultiplier(candidate.category));
  }

  function estimateSales(candidate) {
    const keepaEstimate = estimateFromBsr(candidate);
    const existing = number(candidate.estimated_monthly_sales);
    let midpoint = keepaEstimate || existing || 0;
    let confidence = "low";
    let source = "manual_mock";

    if (keepaEstimate && existing) {
      midpoint = Math.round((keepaEstimate * 0.55) + (existing * 0.45));
      confidence = "medium";
      source = "keepa_like_bsr_plus_mock_sales";
    } else if (keepaEstimate) {
      confidence = "low";
      source = "keepa_like_bsr";
    } else if (existing) {
      confidence = candidate.sales_confidence || "low";
      source = candidate.sales_source || "manual_mock";
    }

    if (number(candidate.review_30d_growth) >= 20 && confidence === "medium") confidence = "high";
    if (candidate.candidate_level === "product_idea") confidence = "low";

    const spread = confidence === "high" ? 0.25 : confidence === "medium" ? 0.4 : 0.6;
    const low = Math.max(0, Math.round(midpoint * (1 - spread)));
    const high = Math.max(low, Math.round(midpoint * (1 + spread)));
    const price = number(candidate.reference_price);

    return {
      estimated_monthly_sales: midpoint,
      estimated_monthly_sales_range: midpoint ? `${low}-${high}` : "unknown",
      estimated_monthly_revenue: midpoint && price ? Number((midpoint * price).toFixed(2)) : null,
      sales_confidence: confidence || "unknown",
      sales_source: source
    };
  }

  function enrichCandidate(candidate, updatedAt = new Date().toISOString()) {
    const estimate = estimateSales(candidate);
    return {
      ...candidate,
      ...estimate,
      sales_estimated_at: updatedAt,
      updated_at: updatedAt
    };
  }

  function enrichCandidates(candidates, options = {}) {
    const updatedAt = options.updatedAt || new Date().toISOString();
    const enriched = (candidates || []).map(candidate => enrichCandidate(candidate, updatedAt));
    const report = {
      generated_at: updatedAt,
      input_candidate_count: (candidates || []).length,
      estimated_count: enriched.filter(item => item.estimated_monthly_sales_range && item.estimated_monthly_sales_range !== "unknown").length,
      by_confidence: enriched.reduce((counts, item) => {
        const confidence = item.sales_confidence || "unknown";
        counts[confidence] = (counts[confidence] || 0) + 1;
        return counts;
      }, {}),
      by_source: enriched.reduce((counts, item) => {
        const source = item.sales_source || "unknown";
        counts[source] = (counts[source] || 0) + 1;
        return counts;
      }, {})
    };
    return { candidates: enriched, report };
  }

  return {
    enrichCandidate,
    enrichCandidates,
    estimateSales
  };
});
