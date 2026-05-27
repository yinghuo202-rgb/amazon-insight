const { applyBidRiskControls } = require("./risk_control_service");

function recommendationId(index) {
  return `ADS-GEN-${String(index + 1).padStart(3, "0")}`;
}

function actionFromRow(row, rules = {}) {
  const targetAcos = Number(rules.target_acos ?? 0.3);
  const maxAcos = Number(rules.max_acos ?? 0.4);

  if (row.search_term && row.orders > 0 && row.acos !== null && row.acos <= targetAcos && row.clicks >= 8) {
    return {
      recommendation_type: "search_term_harvest",
      suggested_action: "add_keyword_exact",
      risk_level: "medium",
      reason: "Search term has orders and ACOS is at or below target."
    };
  }

  if (row.search_term && row.orders === 0 && row.clicks >= 20 && row.spend >= 20) {
    return {
      recommendation_type: "negative_keyword",
      suggested_action: "add_negative_exact",
      risk_level: "low",
      reason: "Search term has enough clicks and spend with no orders."
    };
  }

  if (row.keyword_text && row.orders > 0 && row.acos !== null && row.acos > targetAcos && row.acos <= maxAcos) {
    return {
      recommendation_type: "bid_adjustment",
      suggested_action: "decrease_keyword_bid",
      suggested_change_pct: -0.12,
      risk_level: "medium",
      reason: "Keyword still converts, but ACOS is above target."
    };
  }

  if (row.keyword_text && row.orders >= 3 && row.acos !== null && row.acos < targetAcos && row.cvr >= 0.05) {
    return {
      recommendation_type: "bid_adjustment",
      suggested_action: "increase_keyword_bid",
      suggested_change_pct: 0.1,
      risk_level: "medium",
      reason: "Keyword has profitable conversion and room to scale."
    };
  }

  return null;
}

function generateRecommendations(cleanedRows, options = {}) {
  const recommendations = [];

  cleanedRows.forEach(row => {
    const action = actionFromRow(row, options.rules);
    if (!action) return;

    const base = {
      recommendation_id: recommendationId(recommendations.length),
      title: row.search_term || row.keyword_text || row.targeting_text,
      priority: action.risk_level === "low" ? "medium" : "high",
      entity_type: row.search_term ? "search_term" : "keyword",
      entity_name: row.search_term || row.keyword_text || row.targeting_text,
      campaign: row.campaign_name,
      current_problem: action.reason,
      expected_impact: "Improve spend allocation while preserving traceable local approval.",
      data_window: options.data_window || "14d",
      evidence_path: options.evidence_path || "",
      requires_approval: action.suggested_action.startsWith("increase_") || action.risk_level !== "low",
      status: "pending_review",
      created_at: new Date().toISOString(),
      metrics: {
        impressions: row.impressions,
        clicks: row.clicks,
        spend: row.spend,
        sales: row.sales,
        orders: row.orders,
        acos: row.acos,
        roas: row.roas,
        cpc: row.cpc,
        ctr: row.ctr,
        cvr: row.cvr
      },
      ...action
    };

    recommendations.push(applyBidRiskControls(base, options.rules));
  });

  return recommendations;
}

module.exports = {
  generateRecommendations
};
