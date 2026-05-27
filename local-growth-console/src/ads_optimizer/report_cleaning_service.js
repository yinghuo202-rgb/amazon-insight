const { anomalyFlags, calculateMetrics, numberOrZero } = require("./metrics_calculator");

const FIELD_ALIASES = {
  campaignName: "campaign_name",
  campaignId: "campaign_id",
  adGroupName: "ad_group_name",
  adGroupId: "ad_group_id",
  keywordText: "keyword_text",
  keywordId: "keyword_id",
  searchTerm: "search_term",
  matchType: "match_type",
  targetingText: "targeting_text",
  targetId: "target_id",
  placement: "placement",
  cost: "spend",
  spend: "spend",
  sales: "sales",
  purchases: "orders",
  orders: "orders",
  impressions: "impressions",
  clicks: "clicks",
  date: "date"
};

function snakeCase(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
}

function normalizeDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function normalizeRawRow(raw) {
  const normalized = {};
  Object.entries(raw).forEach(([key, value]) => {
    const targetKey = FIELD_ALIASES[key] || FIELD_ALIASES[snakeCase(key)] || snakeCase(key);
    normalized[targetKey] = value;
  });

  const metrics = calculateMetrics({
    impressions: normalized.impressions,
    clicks: normalized.clicks,
    spend: normalized.spend,
    sales: normalized.sales,
    orders: normalized.orders
  });

  return {
    date: normalizeDate(normalized.date),
    campaign_id: String(normalized.campaign_id || ""),
    campaign_name: String(normalized.campaign_name || ""),
    ad_group_id: String(normalized.ad_group_id || ""),
    ad_group_name: String(normalized.ad_group_name || ""),
    keyword_id: String(normalized.keyword_id || ""),
    keyword_text: String(normalized.keyword_text || ""),
    search_term: String(normalized.search_term || ""),
    target_id: String(normalized.target_id || ""),
    targeting_text: String(normalized.targeting_text || ""),
    match_type: String(normalized.match_type || ""),
    placement: String(normalized.placement || ""),
    ...metrics
  };
}

function rowIdentity(row) {
  return [
    row.date,
    row.campaign_id,
    row.ad_group_id,
    row.keyword_id,
    row.target_id,
    row.search_term,
    row.placement
  ].join("|");
}

function cleanReportRows(rows, options = {}) {
  const seen = new Set();
  const cleaned = [];

  for (const raw of rows || []) {
    const row = normalizeRawRow(raw);
    const key = rowIdentity(row);
    if (seen.has(key)) continue;
    seen.add(key);

    const flags = anomalyFlags(row, options.rules);
    flags.is_unmapped_entity = !row.campaign_id || (!row.keyword_id && !row.target_id && !row.search_term && !row.placement);

    cleaned.push({
      ...row,
      ...flags,
      profit_after_ads: options.gross_margin !== undefined
        ? Number((numberOrZero(row.sales) * numberOrZero(options.gross_margin) - numberOrZero(row.spend)).toFixed(2))
        : null
    });
  }

  return cleaned;
}

function cleanReportPayload(payload, options = {}) {
  return {
    report_type: payload.report_type,
    marketplace: payload.marketplace || "US",
    profile_id: payload.profile_id || "",
    start_date: payload.start_date || "",
    end_date: payload.end_date || "",
    cleaned_at: new Date().toISOString(),
    row_count: Array.isArray(payload.rows) ? payload.rows.length : 0,
    cleaned_row_count: cleanReportRows(payload.rows, options).length,
    rows: cleanReportRows(payload.rows, options)
  };
}

module.exports = {
  cleanReportPayload,
  cleanReportRows,
  normalizeRawRow
};
