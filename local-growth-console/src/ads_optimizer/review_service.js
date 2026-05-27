function statusForBidDecrease(before, after) {
  if (after.acos !== null && before.acos !== null && after.acos < before.acos && after.orders >= before.orders * 0.8) {
    return "effective";
  }
  if (after.orders < before.orders * 0.5) return "ineffective";
  return "observing";
}

function statusForIncrease(before, after, maxAcos = 0.4) {
  if (after.orders > before.orders && (after.acos === null || after.acos <= maxAcos)) return "effective";
  if (after.acos !== null && after.acos > maxAcos) return "ineffective";
  return "observing";
}

function reviewAction(action, before, after, options = {}) {
  const actionType = action.action_type || "";
  let resultStatus = "observing";

  if (actionType.startsWith("decrease_")) resultStatus = statusForBidDecrease(before, after);
  if (actionType.startsWith("increase_")) resultStatus = statusForIncrease(before, after, options.max_acos);
  if (actionType === "add_negative_exact") {
    resultStatus = after.spend < before.spend && after.orders >= before.orders ? "effective" : "observing";
  }

  return {
    action_id: action.action_id,
    before_window: options.before_window || "7d",
    after_window: options.after_window || "7d",
    before_spend: before.spend,
    before_sales: before.sales,
    before_orders: before.orders,
    before_acos: before.acos,
    before_roas: before.roas,
    after_spend: after.spend,
    after_sales: after.sales,
    after_orders: after.orders,
    after_acos: after.acos,
    after_roas: after.roas,
    result_status: resultStatus,
    summary: resultStatus === "effective"
      ? "Action improved the main efficiency metric without a material order drop."
      : "Action needs more data before a final conclusion."
  };
}

module.exports = {
  reviewAction
};
