const crypto = require("crypto");

function hashObject(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function alias(index, prefix) {
  return `${prefix}_${String(index + 1).padStart(3, "0")}`;
}

function buildKeywordOptimizationInput(cleanedRows, options = {}) {
  const entities = cleanedRows.map((row, index) => ({
    entity_alias: alias(index, row.search_term ? "search_term" : "keyword"),
    campaign_alias: row.campaign_id ? `campaign_${row.campaign_id}` : "campaign_unmapped",
    keyword_or_search_term: row.search_term || row.keyword_text || row.targeting_text,
    match_type: row.match_type || "",
    impressions: row.impressions,
    clicks: row.clicks,
    spend: row.spend,
    sales: row.sales,
    orders: row.orders,
    acos: row.acos,
    roas: row.roas,
    cpc: row.cpc,
    ctr: row.ctr,
    cvr: row.cvr,
    anomaly_flags: {
      is_zero_order_high_spend: row.is_zero_order_high_spend,
      is_high_acos: row.is_high_acos,
      is_low_acos: row.is_low_acos,
      is_data_insufficient: row.is_data_insufficient
    }
  }));

  const summary = {
    analysis_type: options.analysis_type || "keyword_optimization_analysis",
    marketplace: options.marketplace || "US",
    data_window: options.data_window || "14d",
    goal: options.goal || "profit",
    rules: {
      max_bid_increase_pct: options.max_bid_increase_pct ?? 0.15,
      max_bid_decrease_pct: options.max_bid_decrease_pct ?? 0.2,
      target_acos: options.target_acos ?? 0.3,
      max_acos: options.max_acos ?? 0.4
    },
    entities
  };

  return {
    ...summary,
    input_summary_hash: hashObject(summary)
  };
}

module.exports = {
  buildKeywordOptimizationInput,
  hashObject
};
