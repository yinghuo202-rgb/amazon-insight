const ALLOWED_ACTIONS = new Set([
  "add_keyword_exact",
  "add_negative_exact",
  "increase_keyword_bid",
  "decrease_keyword_bid",
  "add_product_target",
  "increase_product_target_bid",
  "decrease_product_target_bid",
  "apply_dayparting_bid_adjustment",
  "structure_diagnosis"
]);

const ALLOWED_RISKS = new Set(["low", "medium", "high"]);

function parseLlmOutput(output) {
  if (typeof output === "string") return JSON.parse(output);
  return output;
}

function validateRecommendation(item, entityAliases, rules) {
  const errors = [];
  if (!item || typeof item !== "object") errors.push("recommendation must be an object");
  if (!item.entity_alias || !entityAliases.has(item.entity_alias)) errors.push("entity_alias is not mapped locally");
  if (!ALLOWED_ACTIONS.has(item.action_type)) errors.push("action_type is not allowed");
  if (!ALLOWED_RISKS.has(item.risk_level)) errors.push("risk_level is invalid");
  if (!item.reason) errors.push("reason is required");

  const confidence = Number(item.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) errors.push("confidence must be between 0 and 1");

  const change = Number(item.suggested_change_pct || 0);
  if (item.action_type === "increase_keyword_bid" && change > rules.max_bid_increase_pct) {
    errors.push("keyword bid increase exceeds max limit");
  }
  if (item.action_type === "decrease_keyword_bid" && Math.abs(change) > rules.max_bid_decrease_pct) {
    errors.push("keyword bid decrease exceeds max limit");
  }

  return errors;
}

function validateLlmOutput(output, inputSummary) {
  const result = {
    validation_status: "valid",
    validation_error: "",
    parsed_json: null,
    valid_recommendations: [],
    invalid_recommendations: []
  };

  try {
    const parsed = parseLlmOutput(output);
    result.parsed_json = parsed;
    if (!parsed.summary) throw new Error("summary is required");
    if (!Array.isArray(parsed.recommendations)) throw new Error("recommendations must be an array");

    const aliases = new Set((inputSummary.entities || []).map(item => item.entity_alias));
    const rules = inputSummary.rules || {};

    parsed.recommendations.forEach(item => {
      const errors = validateRecommendation(item, aliases, rules);
      if (errors.length) {
        result.invalid_recommendations.push({ item, errors });
      } else {
        result.valid_recommendations.push(item);
      }
    });

    if (result.invalid_recommendations.length) {
      result.validation_status = "partially_valid";
      result.validation_error = "Some recommendations failed validation.";
    }
  } catch (error) {
    result.validation_status = "invalid";
    result.validation_error = error.message;
  }

  return result;
}

module.exports = {
  ALLOWED_ACTIONS,
  ALLOWED_RISKS,
  validateLlmOutput
};
