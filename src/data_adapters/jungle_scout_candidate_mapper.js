(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.JungleScoutCandidateMapper = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  function toNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    const number = Number(String(value).replace(/[$,%\s,]/g, ""));
    return Number.isFinite(number) ? number : null;
  }

  function normalizeAsin(value) {
    const asin = String(value || "").trim().toUpperCase();
    return /^[A-Z0-9]{10}$/.test(asin) ? asin : "";
  }

  function extractAsin(value) {
    const text = String(value || "").toUpperCase();
    const match = text.match(/[A-Z0-9]{10}/);
    return match ? match[0] : "";
  }

  function unique(values) {
    return Array.from(new Set((values || []).filter(Boolean)));
  }

  function getField(source, aliases) {
    for (const alias of aliases) {
      if (source && source[alias] !== undefined && source[alias] !== null && source[alias] !== "") {
        return source[alias];
      }
    }
    return "";
  }

  function stringifyDimension(value) {
    if (!value) return "";
    if (typeof value === "string") return value;
    return JSON.stringify(value);
  }

  function inferProductType(title = "", category = "") {
    const text = `${title} ${category}`.toLowerCase();
    if (text.includes("water pressure regulator") || text.includes("pressure reducer")) return "pressure_regulator";
    if (text.includes("pressure gauge")) return "pressure_gauge";
    if (text.includes("faucet cover") || text.includes("spigot cover")) return "faucet_cover";
    if (text.includes("hose storage") || text.includes("storage bag")) return "hose_storage_bag";
    if (text.includes("door edge guard")) return "automotive_edge_guard";
    if (text.includes("sewer hose support")) return "rv_sewer_hose_support";
    if (text.includes("wheel chock")) return "wheel_chock";
    if (text.includes("hook")) return "hook";
    if (text.includes("filter")) return "filter";
    if (text.includes("connector") || text.includes("fitting")) return "connector";
    if (text.includes("hose")) return "hose_accessory";
    return "amazon_product";
  }

  function inferSubScenario(title = "", category = "", productType = "") {
    const text = `${title} ${category}`.toLowerCase();
    if (productType === "faucet_cover" || text.includes("freeze protection")) return "protection";
    if (productType === "hose_storage_bag" || text.includes("storage")) return "organization";
    if (productType === "automotive_edge_guard") return "automotive_edge_protection";
    if (productType === "rv_sewer_hose_support") return "rv_waste_system";
    if (productType === "wheel_chock") return "trailer_utility";
    if (text.includes("rv") && text.includes("water")) return "rv_water_system";
    if (text.includes("garden") && text.includes("water")) return "garden_watering";
    return "general_market";
  }

  function mapApiRecord(record, keyword = "", importedAt = new Date().toISOString()) {
    const attrs = record && record.attributes ? record.attributes : (record || {});
    const asin = normalizeAsin(getField(attrs, ["asin", "ASIN"])) || extractAsin(record && record.id);
    const title = String(getField(attrs, ["title", "name", "product_title", "product_name"]) || "").trim();
    const category = String(getField(attrs, ["category", "category_name", "category_path", "product_category", "breadcrumb_path"]) || "").trim();
    const brand = String(getField(attrs, ["brand", "brand_name"]) || "").trim();
    const price = toNumber(getField(attrs, ["price", "current_price", "list_price", "buy_box_price", "average_price"]));
    const sales = toNumber(getField(attrs, ["estimated_monthly_sales", "monthly_sales", "units_sold", "sales", "approximate_30_day_units_sold"]));
    const revenue = toNumber(getField(attrs, ["estimated_monthly_revenue", "monthly_revenue", "revenue", "approximate_30_day_revenue"]));
    const reviews = toNumber(getField(attrs, ["reviews", "review_count", "reviews_count", "ratings_count"]));
    const rating = toNumber(getField(attrs, ["rating", "star_rating", "average_rating"]));
    const bsr = toNumber(getField(attrs, ["rank", "bsr", "sales_rank", "product_rank"]));
    const opportunityScore = toNumber(getField(attrs, ["opportunity_score", "jungle_scout_opportunity_score", "score", "listing_quality_score"]));
    const dimensions = [
      getField(attrs, ["length_value"]) ? `L ${getField(attrs, ["length_value"])}` : "",
      getField(attrs, ["width_value"]) ? `W ${getField(attrs, ["width_value"])}` : "",
      getField(attrs, ["height_value"]) ? `H ${getField(attrs, ["height_value"])}` : "",
      getField(attrs, ["dimensions_unit"]) || ""
    ].filter(Boolean).join(" ");
    const weight = [
      getField(attrs, ["weight_value"]),
      getField(attrs, ["weight_unit"])
    ].filter(Boolean).join(" ");
    const productType = inferProductType(title, category);
    const subScenario = inferSubScenario(title, category, productType);

    return {
      asin,
      parent_asin: normalizeAsin(getField(attrs, ["parent_asin", "parent"])) || extractAsin(getField(attrs, ["parent_asin", "parent"])),
      title,
      brand,
      category,
      product_type: productType,
      sub_scenario: subScenario,
      reference_price: price,
      estimated_monthly_sales: sales,
      estimated_monthly_revenue: revenue,
      sales_confidence: "medium",
      sales_source: "jungle_scout_api",
      rating,
      review_count: reviews,
      bsr,
      jungle_scout_opportunity_score: opportunityScore,
      fulfillment_fee_estimate: toNumber(getField(attrs, ["fulfillment_fee", "fba_fee", "fees"])),
      net_profit_estimate: toNumber(getField(attrs, ["net_profit", "profit", "estimated_profit"])),
      weight: String(getField(attrs, ["weight", "product_weight"]) || weight).trim(),
      dimensions: stringifyDimension(getField(attrs, ["dimensions", "product_dimensions"]) || dimensions),
      seller_type: String(getField(attrs, ["seller_type", "seller"]) || "").trim(),
      recommendation_sources: ["market_opportunity", "jungle_scout_api"],
      opportunity_type: "market_import",
      timing_window: "unknown",
      seasonal_attribute: "unknown",
      complexity_level: "unknown",
      size_risk: "unknown",
      compliance_risk: "unknown",
      market_score: opportunityScore ? Math.max(5, Math.round(opportunityScore / 5)) : 12,
      seasonality_score: 0,
      store_fit_score: 0,
      profit_potential_score: 0,
      risk_score: 0,
      keywords: unique([keyword, title, category, brand].join(" ").toLowerCase().split(/\s+/).filter(token => token.length > 2)).slice(0, 16),
      market_situation: "Imported from Jungle Scout API; validate demand, competition, review issues, and landed cost before acting.",
      use_case: `Amazon US product candidate discovered from query: ${keyword || asin}.`,
      store_relation: "Store relation will be evaluated by the recommendation engine.",
      why_recommended: "Jungle Scout API supplied product database demand and market fields.",
      main_risks: "API fields can be incomplete; verify supplier cost, review complaints, and duplicate proximity.",
      next_step: "Run recommendation audit, duplicate filtering, and supplier cost validation.",
      source: "jungle_scout_api",
      source_file: `api:${keyword || asin}`,
      updated_at: importedAt,
      data_freshness: "fresh",
      raw_fields: {
        id: record && record.id || "",
        type: record && record.type || "",
        attributes: attrs
      }
    };
  }

  return {
    toNumber,
    normalizeAsin,
    extractAsin,
    getField,
    mapApiRecord
  };
});
