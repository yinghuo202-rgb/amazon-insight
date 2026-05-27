(function () {
  const WATCHLIST_KEY = "amazon_recommender_watchlist_v2";
  const ACTIVE_STATUSES = new Set([
    "watching",
    "checking_supplier",
    "review_analysis",
    "sample_requested",
    "shortlisted",
    "developing"
  ]);

  function readItems() {
    try {
      const parsed = JSON.parse(localStorage.getItem(WATCHLIST_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.warn("Watchlist records could not be parsed.", error);
      return [];
    }
  }

  function writeItems(items) {
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(items));
  }

  function productKey(product) {
    return product.asin || product.idea_id || `${product.product_type || "unknown"}:${product.title || ""}`;
  }

  function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next.toISOString().slice(0, 10);
  }

  function nextCheckDate(product, now = new Date()) {
    const sources = product.recommendation_sources || [];
    if (product.timing_window === "early_layout" || sources.includes("seasonal_early_layout")) {
      return addDays(now, 30);
    }
    if (product.timing_window === "near_term_opening") {
      return addDays(now, 14);
    }
    if (product.timing_window === "off_season_observation") {
      return addDays(now, 60);
    }
    return "";
  }

  function normalizeItem(product, options = {}) {
    const now = new Date().toISOString();
    return {
      asin: product.asin || "",
      idea_id: product.idea_id || "",
      title: product.title || "",
      category: product.category || "",
      product_type: product.product_type || "",
      sub_scenario: product.sub_scenario || "",
      reference_price: product.reference_price ?? null,
      estimated_monthly_sales: product.estimated_monthly_sales ?? null,
      timing_window: product.timing_window || "",
      seasonal_attribute: product.seasonal_attribute || "",
      reason_added: options.reason_added || defaultReason(product),
      status: options.status || "watching",
      next_check_date: options.next_check_date || nextCheckDate(product),
      next_step: product.next_step || "",
      notes: options.notes || "",
      recommendation_sources: product.recommendation_sources || [],
      created_at: options.created_at || now,
      updated_at: now
    };
  }

  function defaultReason(product) {
    if (product.timing_window === "early_layout") return "seasonal_early_layout";
    if ((product.recommendation_sources || []).includes("store_expansion")) return "store_expansion";
    return "manual_watchlist";
  }

  function upsert(product, options = {}) {
    const items = readItems();
    const key = productKey(product);
    const index = items.findIndex(item => productKey(item) === key);
    if (index >= 0) {
      const existing = items[index];
      items[index] = {
        ...existing,
        ...normalizeItem(product, {
          ...options,
          created_at: existing.created_at,
          next_check_date: options.next_check_date || existing.next_check_date || nextCheckDate(product)
        })
      };
      writeItems(items);
      return items[index];
    }

    const item = normalizeItem(product, options);
    items.push(item);
    writeItems(items);
    return item;
  }

  function updateStatus(productOrKey, status, notes = "") {
    const items = readItems();
    const key = typeof productOrKey === "string" ? productOrKey : productKey(productOrKey);
    const index = items.findIndex(item => productKey(item) === key);
    if (index < 0) return null;
    items[index] = {
      ...items[index],
      status,
      notes: notes || items[index].notes || "",
      updated_at: new Date().toISOString()
    };
    writeItems(items);
    return items[index];
  }

  function remove(productOrKey) {
    const items = readItems();
    const key = typeof productOrKey === "string" ? productOrKey : productKey(productOrKey);
    const nextItems = items.filter(item => productKey(item) !== key);
    writeItems(nextItems);
    return nextItems.length !== items.length;
  }

  function activeItems() {
    return readItems().filter(item => ACTIVE_STATUSES.has(item.status || "watching"));
  }

  function hasActive(product) {
    const key = productKey(product);
    return activeItems().some(item => productKey(item) === key);
  }

  function clearAll() {
    localStorage.removeItem(WATCHLIST_KEY);
  }

  window.Watchlist = {
    ACTIVE_STATUSES,
    add: upsert,
    clearAll,
    getAll: readItems,
    getActive: activeItems,
    hasActive,
    nextCheckDate,
    productKey,
    remove,
    updateStatus
  };
})();
