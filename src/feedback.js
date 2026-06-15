(function () {
  const FEEDBACK_KEY = "amazon_recommender_feedback";

  const rejectionReasons = [
    { value: "too_competitive", label: "竞争过强" },
    { value: "price_too_low", label: "价格过低" },
    { value: "weak_profit_potential", label: "利润潜力弱" },
    { value: "too_large", label: "体积过大" },
    { value: "high_return_risk", label: "退货风险高" },
    { value: "installation_too_complex", label: "安装过复杂" },
    { value: "fitment_risk", label: "适配风险" },
    { value: "duplicate_or_too_similar", label: "重复或过于相似" },
    { value: "category_not_preferred", label: "类目不优先" },
    { value: "seasonality_not_right", label: "季节窗口不合适" },
    { value: "compliance_risk", label: "合规风险" },
    { value: "not_interested", label: "暂不感兴趣" },
    { value: "other", label: "其他" }
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
      interested: "已标记为感兴趣，并加入短名单",
      add_to_watchlist: "已加入观察清单",
      watchlisted: "已加入观察清单",
      reject: "已拒绝",
      rejected: "已拒绝",
      check_suppliers: "已加入观察清单",
      supplier_check: "已加入观察清单",
      hold: "已标记为暂缓"
    };
    return labels[action] || action;
  }

  function reasonLabel(reason) {
    return (rejectionReasons.find(item => item.value === reason) || {}).label || reason || "";
  }

  function statusText(record) {
    if (!record) return "";
    if ((record.action === "reject" || record.action === "rejected") && record.reason) {
      return `${actionLabel(record.action)}：${reasonLabel(record.reason)}`;
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
