function buildExecutionPayload(action) {
  const actionType = action.action_type || action.suggested_action;
  const payload = {
    action_type: actionType,
    entity_type: action.entity_type,
    entity_id: action.entity_id || action.recommendation_id,
    entity_name: action.entity_name,
    approval_status: action.approval_status || "approved",
    generated_at: new Date().toISOString()
  };

  if (actionType.includes("bid")) {
    payload.bid = {
      before_value: action.before_value ?? action.current_value ?? null,
      final_value: action.final_value ?? action.suggested_value ?? null,
      suggested_change_pct: action.suggested_change_pct ?? null
    };
  }

  if (actionType === "add_negative_exact") {
    payload.negative_keyword = {
      match_type: "negativeExact",
      keyword_text: action.entity_name
    };
  }

  if (actionType === "add_keyword_exact") {
    payload.keyword = {
      match_type: "exact",
      keyword_text: action.entity_name
    };
  }

  if (actionType === "add_product_target") {
    payload.product_target = {
      expression_type: "manual",
      asin: action.entity_name
    };
  }

  return payload;
}

function mockExecuteAction(action) {
  const payload = buildExecutionPayload(action);
  return {
    request_payload: payload,
    response_payload: {
      status: "mock_success",
      message: "No Amazon Ads API call was made. This is a local execution simulation.",
      action_type: payload.action_type,
      entity_id: payload.entity_id,
      executed_at: new Date().toISOString()
    }
  };
}

module.exports = {
  buildExecutionPayload,
  mockExecuteAction
};
