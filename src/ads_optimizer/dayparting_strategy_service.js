const { calculateMetrics } = require("./metrics_calculator");
const { applyDaypartingRiskControls } = require("./risk_control_service");

function aggregateBlocks(rows) {
  const totals = rows.reduce((map, row) => {
    const block = row.time_block || "unknown";
    map[block] = map[block] || { time_block: block, impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0 };
    map[block].impressions += Number(row.impressions || 0);
    map[block].clicks += Number(row.clicks || 0);
    map[block].spend += Number(row.spend || row.cost || 0);
    map[block].sales += Number(row.sales || 0);
    map[block].orders += Number(row.orders || row.purchases || 0);
    return map;
  }, {});

  return Object.values(totals).map(row => ({
    block: row.time_block,
    ...calculateMetrics(row)
  }));
}

function suggestBlockAction(block, rules = {}) {
  const targetAcos = Number(rules.target_acos ?? 0.3);
  const maxAcos = Number(rules.max_acos ?? 0.4);

  if (block.orders < 2 || (block.acos !== null && block.acos > maxAcos)) {
    return { ...block, action: "decrease_bid", bid_multiplier: 0.8, risk_level: "low" };
  }
  if (block.orders >= 3 && block.acos !== null && block.acos < targetAcos && block.cvr >= 0.06) {
    return { ...block, action: "increase_bid", bid_multiplier: 1.15, risk_level: "medium" };
  }
  return { ...block, action: "keep", bid_multiplier: 1, risk_level: "low" };
}

function buildDaypartingStrategy(rows, options = {}) {
  const blocks = aggregateBlocks(rows)
    .map(block => suggestBlockAction(block, options.rules))
    .map(block => applyDaypartingRiskControls(block, options.rules));

  const shouldEnable = blocks.some(block => block.action !== "keep") && blocks.reduce((sum, block) => sum + block.orders, 0) >= 8;

  return {
    strategy_id: options.strategy_id || `DAY-${new Date().toISOString().slice(0, 10)}`,
    campaign: options.campaign || "Mock Sponsored Products Campaign",
    timezone: options.timezone || "America/Los_Angeles",
    data_window: options.data_window || "30d",
    should_enable_dayparting: shouldEnable,
    status: "pending_review",
    requires_approval: blocks.some(block => block.requires_approval),
    summary: shouldEnable
      ? "Local aggregation found enough block-level signal for a controlled dayparting test."
      : "Local aggregation does not show enough signal to enable dayparting.",
    time_blocks: blocks
  };
}

module.exports = {
  aggregateBlocks,
  buildDaypartingStrategy
};
