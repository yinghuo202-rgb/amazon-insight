(function () {
  const FEEDBACK_KEY = "amazon_recommender_feedback";

  const rejectionReasons = [
    { value: "too_competitive", label: "Too competitive" },
    { value: "price_too_low", label: "Price too low" },
    { value: "weak_profit_potential", label: "Weak profit potential" },
    { value: "too_large", label: "Too large" },
    { value: "high_return_risk", label: "High return risk" },
    { value: "installation_too_complex", label: "Installation too complex" },
    { value: "fitment_risk", label: "Fitment risk" },
    { value: "duplicate_or_too_similar", label: "Duplicate or too similar" },
    { value: "category_not_preferred", label: "Category not preferred" },
    { value: "seasonality_not_right", label: "Seasonality not right" },
    { value: "compliance_risk", label: "Compliance risk" },
    { value: "not_interested", label: "Not interested" },
    { value: "other", label: "Other" }
  ];

  function readRecords() {
    try {
      const parsed = JSON.parse(localStorage.getItem(FEEDBACK_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.warn("Feedback records could not be parsed.", error);
      return [];
    }
  }

  function writeRecords(records) {
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify(records));
  }

  function normalizeRecord(product, action, reason = "") {
    const normalizedAction = normalizeAction(action);
    return {
      asin: product.asin,
      idea_id: product.idea_id || "",
      title: product.title,
      action: normalizedAction,
      reason,
      timestamp: new Date().toISOString(),
      product_type: product.product_type,
      category: product.category,
      sub_scenario: product.sub_scenario,
      reference_price: product.reference_price,
      recommendation_sources: product.recommendation_sources || []
    };
  }

  function normalizeAction(action) {
    const aliases = {
      watchlisted: "add_to_watchlist",
      supplier_check: "check_suppliers",
      rejected: "reject"
    };
    return aliases[action] || action;
  }

  function addRecord(product, action, reason = "") {
    const records = readRecords();
    const record = normalizeRecord(product, action, reason);
    records.push(record);
    writeRecords(records);
    return record;
  }

  function latestByAsin() {
    const latest = {};
    for (const record of readRecords()) {
      const key = record.asin || record.idea_id || `${record.product_type || "unknown"}:${record.title || ""}`;
      latest[key] = record;
    }
    return latest;
  }

  function latestForProduct(asin, ideaId = "", fallbackKey = "") {
    return latestByAsin()[asin || ideaId || fallbackKey] || null;
  }

  function actionLabel(action) {
    const labels = {
      interested: "Marked as interested and shortlisted",
      add_to_watchlist: "Added to watchlist",
      watchlisted: "Added to watchlist",
      reject: "Rejected",
      rejected: "Rejected",
      check_suppliers: "Added to watchlist",
      supplier_check: "Added to watchlist",
      hold: "Marked as hold"
    };
    return labels[action] || action;
  }

  function reasonLabel(reason) {
    return (rejectionReasons.find(item => item.value === reason) || {}).label || reason || "";
  }

  function statusText(record) {
    if (!record) return "";
    if ((record.action === "reject" || record.action === "rejected") && record.reason) {
      return `${actionLabel(record.action)}: ${reasonLabel(record.reason).toLowerCase()}`;
    }
    return actionLabel(record.action);
  }

  function getWatchlist() {
    const latest = latestByAsin();
    return Object.values(latest).filter(record => (
      record.action === "add_to_watchlist" ||
      record.action === "watchlisted" ||
      record.action === "interested" ||
      record.action === "check_suppliers" ||
      record.action === "supplier_check"
    ));
  }

  function clearAll() {
    localStorage.removeItem(FEEDBACK_KEY);
  }

  window.Feedback = {
    addRecord,
    clearAll,
    getRecords: readRecords,
    getWatchlist,
    latestByAsin,
    latestForProduct,
    normalizeAction,
    rejectionReasons,
    reasonLabel,
    statusText
  };
})();
