const DEFAULT_RULES = {
  low_risk_auto_execution_enabled: false,
  require_approval_for_bid_increase: true,
  require_approval_for_dayparting_increase: true,
  max_keyword_bid_increase_pct: 0.15,
  max_keyword_bid_decrease_pct: 0.2,
  max_dayparting_increase_pct: 0.15,
  max_dayparting_decrease_pct: 0.2,
  target_acos: 0.3,
  max_acos: 0.4
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value || 0)));
}

function applyBidRiskControls(recommendation, rules = {}) {
  const merged = { ...DEFAULT_RULES, ...rules };
  const next = { ...recommendation, risk_control_notes: [] };
  const action = recommendation.action_type || recommendation.suggested_action;
  let change = Number(recommendation.suggested_change_pct || 0);

  if (action === "increase_keyword_bid" || action === "increase_product_target_bid") {
    const clipped = clamp(change, 0, merged.max_keyword_bid_increase_pct);
    if (clipped !== change) next.risk_control_notes.push("Increase clipped to local max bid increase.");
    change = clipped;
    next.requires_approval = true;
  }

  if (action === "decrease_keyword_bid" || action === "decrease_product_target_bid") {
    const clipped = clamp(change, -merged.max_keyword_bid_decrease_pct, 0);
    if (clipped !== change) next.risk_control_notes.push("Decrease clipped to local max bid decrease.");
    change = clipped;
    next.requires_approval = !(
      merged.low_risk_auto_execution_enabled &&
      recommendation.risk_level === "low" &&
      Math.abs(change) <= 0.1
    );
  }

  if (action === "add_negative_exact") {
    next.requires_approval = !(merged.low_risk_auto_execution_enabled && recommendation.risk_level === "low");
  }

  next.suggested_change_pct = Number(change.toFixed(4));
  next.risk_control_status = "passed";
  return next;
}

function applyDaypartingRiskControls(block, rules = {}) {
  const merged = { ...DEFAULT_RULES, ...rules };
  const next = { ...block };
  const multiplier = Number(block.bid_multiplier || 1);
  const minMultiplier = 1 - merged.max_dayparting_decrease_pct;
  const maxMultiplier = 1 + merged.max_dayparting_increase_pct;
  next.bid_multiplier = Number(clamp(multiplier, minMultiplier, maxMultiplier).toFixed(2));
  next.requires_approval = block.action === "increase_bid";
  next.risk_control_status = "passed";

  if (block.action === "increase_bid" && Number(block.orders || 0) < 3) {
    next.action = "keep";
    next.bid_multiplier = 1;
    next.requires_approval = false;
    next.risk_control_status = "clipped";
    next.risk_control_note = "Increase removed because order count is insufficient.";
  }

  if (block.action === "increase_bid" && block.acos !== null && Number(block.acos) > merged.max_acos) {
    next.action = "keep";
    next.bid_multiplier = 1;
    next.requires_approval = false;
    next.risk_control_status = "blocked";
    next.risk_control_note = "Increase blocked because ACOS is above max ACOS.";
  }

  return next;
}

module.exports = {
  DEFAULT_RULES,
  applyBidRiskControls,
  applyDaypartingRiskControls
};
