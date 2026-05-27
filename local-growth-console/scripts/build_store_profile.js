const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const MERGED_PROFILE = path.join(DATA_DIR, "store_product_profile_merged.json");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(fileName, payload) {
  fs.writeFileSync(path.join(DATA_DIR, fileName), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function round(value, digits = 4) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function distribution(records, field) {
  return records.reduce((acc, record) => {
    const key = record[field] || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function topCounts(records, field, limit = 12) {
  const counts = distribution(records, field);
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value, count]) => ({
      value,
      count,
      share: round(count / Math.max(records.length, 1), 4)
    }));
}

function groupBy(records, field) {
  return records.reduce((acc, record) => {
    const key = record[field] || "unknown";
    if (!acc[key]) acc[key] = [];
    acc[key].push(record);
    return acc;
  }, {});
}

function average(values) {
  const nums = values.filter(value => typeof value === "number" && Number.isFinite(value));
  if (!nums.length) return null;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function sum(values) {
  return values
    .filter(value => typeof value === "number" && Number.isFinite(value))
    .reduce((total, value) => total + value, 0);
}

function productTypeMetrics(records) {
  return Object.entries(groupBy(records, "product_type")).map(([productType, items]) => ({
    product_type: productType,
    count: items.length,
    avg_profit_usd: round(average(items.map(item => numberOrNull(item.estimated_profit_usd))), 4),
    avg_profit_margin: round(average(items.map(item => numberOrNull(item.estimated_profit_margin))), 4),
    total_monthly_sales_units: sum(items.map(item => numberOrNull(item.monthly_sales_units))),
    avg_price_usd: round(average(items.map(item => numberOrNull(item.current_price_usd))), 4)
  }));
}

function scenarioMetrics(records) {
  return Object.entries(groupBy(records, "sub_scenario")).map(([subScenario, items]) => ({
    sub_scenario: subScenario,
    count: items.length,
    avg_profit_usd: round(average(items.map(item => numberOrNull(item.estimated_profit_usd))), 4),
    avg_profit_margin: round(average(items.map(item => numberOrNull(item.estimated_profit_margin))), 4),
    total_monthly_sales_units: sum(items.map(item => numberOrNull(item.monthly_sales_units))),
    total_inventory_units: sum(items.map(item => numberOrNull(item.inventory_units))),
    main_product_types: topCounts(items, "product_type", 5)
  }));
}

const EXPANSION_MAP = {
  pressure_measurement: [
    {
      theme_id: "water_pressure_control_expansion",
      label: "Water pressure control accessories",
      target_product_types: ["pressure_regulator", "valve", "connector"],
      target_sub_scenarios: ["water_pressure_control", "flow_control", "connection_fitting"],
      rationale: "The store has pressure measurement depth; adjacent pressure control and fitting products can reuse buyer intent without duplicating gauges."
    },
    {
      theme_id: "water_filtration_expansion",
      label: "Water filtration and protection accessories",
      target_product_types: ["filter", "freeze_protection"],
      target_sub_scenarios: ["water_filtration", "winterization"],
      rationale: "Pressure and water-system customers can extend into filter and protection accessories."
    }
  ],
  water_pressure_control: [
    {
      theme_id: "flow_control_expansion",
      label: "Flow control valves and fittings",
      target_product_types: ["valve", "connector"],
      target_sub_scenarios: ["flow_control", "connection_fitting"],
      rationale: "Existing regulator capability suggests adjacent valve and connector opportunities."
    }
  ],
  garden_watering: [
    {
      theme_id: "garden_watering_expansion",
      label: "Garden watering accessory expansion",
      target_product_types: ["hose", "connector", "valve"],
      target_sub_scenarios: ["water_hose", "connection_fitting", "flow_control"],
      rationale: "Garden watering products support expansion into hose, connector, and water-control accessory bundles."
    }
  ],
  rv_maintenance: [
    {
      theme_id: "rv_maintenance_expansion",
      label: "RV water and maintenance accessories",
      target_product_types: ["rv_accessory", "freeze_protection", "filter", "storage_accessory"],
      target_sub_scenarios: ["rv_maintenance", "winterization", "water_filtration", "organization"],
      rationale: "RV maintenance products can extend into winterization, filtration, and storage accessories."
    }
  ],
  garage_storage: [
    {
      theme_id: "garage_storage_expansion",
      label: "Garage storage and support accessories",
      target_product_types: ["hook", "bracket", "storage_accessory"],
      target_sub_scenarios: ["garage_storage", "mounting_support", "organization"],
      rationale: "Garage utility products can expand through hooks, brackets, and simple storage accessories."
    }
  ],
  protection: [
    {
      theme_id: "protection_expansion",
      label: "Protection covers and seasonal shields",
      target_product_types: ["cover", "freeze_protection"],
      target_sub_scenarios: ["protection", "winterization"],
      rationale: "Protection products create adjacent seasonal and outdoor-maintenance cover opportunities."
    }
  ]
};

function strongScenario(metric) {
  return (
    metric.count >= 5 &&
    ((metric.avg_profit_margin !== null && metric.avg_profit_margin >= 0.2) ||
      metric.total_monthly_sales_units >= 60)
  );
}

function weakScenario(metric) {
  return (
    metric.count >= 3 &&
    ((metric.avg_profit_margin !== null && metric.avg_profit_margin < 0.15) ||
      (metric.total_inventory_units >= 300 && metric.total_monthly_sales_units <= 30))
  );
}

function buildExpansionOpportunities(strongScenarios, weakScenarios) {
  const weakSet = new Set(weakScenarios.map(item => item.sub_scenario));
  const opportunities = [];
  const seen = new Set();

  for (const scenario of strongScenarios) {
    const mapped = EXPANSION_MAP[scenario.sub_scenario] || [];
    for (const theme of mapped) {
      if (seen.has(theme.theme_id)) continue;
      seen.add(theme.theme_id);

      const weakOverlap = theme.target_sub_scenarios.some(subScenario => weakSet.has(subScenario));
      const priorityScore = Math.round(
        Math.min(100, 45 + scenario.count * 1.2 + (scenario.avg_profit_margin || 0) * 80 + Math.min(scenario.total_monthly_sales_units, 300) * 0.08 - (weakOverlap ? 12 : 0))
      );

      opportunities.push({
        ...theme,
        marketplace: "US",
        source_sub_scenario: scenario.sub_scenario,
        source_product_count: scenario.count,
        source_avg_profit_margin: scenario.avg_profit_margin,
        source_monthly_sales_units: scenario.total_monthly_sales_units,
        priority_score: priorityScore,
        preferred_price_band: "20_80",
        risk_notes: weakOverlap ? ["Target scenario overlaps a weak store scenario; validate demand and margin before advancing."] : [],
        exclusion_notes: ["Exclude exact existing product types and close title/keyword duplicates before recommending."]
      });
    }
  }

  return opportunities.sort((a, b) => b.priority_score - a.priority_score);
}

function buildSummary(records, scenarioStats, typeStats, expansionOpportunities) {
  const highInventoryLowSales = records
    .filter(record => (record.inventory_units || 0) >= 100 && (record.monthly_sales_units || 0) <= 20)
    .sort((a, b) => (b.inventory_units || 0) - (a.inventory_units || 0))
    .slice(0, 30)
    .map(record => ({
      sku: record.sku,
      title_cn: record.title_cn,
      product_type: record.product_type,
      sub_scenario: record.sub_scenario,
      inventory_units: record.inventory_units,
      monthly_sales_units: record.monthly_sales_units,
      estimated_profit_margin: record.estimated_profit_margin
    }));

  const strongScenarios = scenarioStats.filter(strongScenario).sort((a, b) => b.count - a.count);
  const weakScenarios = scenarioStats.filter(weakScenario).sort((a, b) => b.count - a.count);

  return {
    marketplace: "US",
    total_products: records.length,
    main_categories: topCounts(records, "category_cn"),
    main_product_types: topCounts(records, "product_type"),
    main_sub_scenarios: topCounts(records, "sub_scenario"),
    price_band_distribution: distribution(records, "price_band"),
    profit_band_distribution: distribution(records, "profit_band"),
    size_risk_distribution: distribution(records, "size_risk"),
    top_profit_product_types: typeStats
      .filter(item => item.avg_profit_margin !== null)
      .sort((a, b) => b.avg_profit_margin - a.avg_profit_margin)
      .slice(0, 12),
    low_profit_product_types: typeStats
      .filter(item => item.avg_profit_margin !== null)
      .sort((a, b) => a.avg_profit_margin - b.avg_profit_margin)
      .slice(0, 12),
    high_inventory_low_sales_products: highInventoryLowSales,
    strong_store_scenarios: strongScenarios,
    weak_store_scenarios: weakScenarios,
    recommended_expansion_themes: expansionOpportunities.slice(0, 12),
    risk_notes: [
      `${records.filter(record => record.price_band === "unknown").length} products are missing US price data.`,
      `${records.filter(record => record.profit_band === "unknown").length} products are missing profit data.`,
      `${records.filter(record => record.size_risk === "high").length} products are high size risk.`,
      `${records.filter(record => record.profit_band === "negative").length} products have negative estimated profit.`
    ]
  };
}

function buildExclusionRules(records) {
  const nonEmpty = value => value !== null && value !== undefined && value !== "";
  const typeCounts = distribution(records, "product_type");
  const scenarioCounts = distribution(records, "sub_scenario");

  return {
    marketplace: "US",
    generated_at: new Date().toISOString(),
    exact_match_fields: ["asin", "parent_asin", "sku"],
    existing_skus: records.map(record => record.sku).filter(nonEmpty).sort(),
    existing_asins: records.map(record => record.asin).filter(nonEmpty).sort(),
    existing_parent_asins: records.map(record => record.parent_asin).filter(nonEmpty).sort(),
    product_type_rules: Object.entries(typeCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([product_type, count]) => ({
        product_type,
        count,
        exclusion_strength: count >= 3 ? "hard_for_same_core_type" : "soft_review"
      })),
    sub_scenario_rules: Object.entries(scenarioCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([sub_scenario, count]) => ({
        sub_scenario,
        count,
        duplicate_review_required: count >= 3
      })),
    keyword_profiles: records.map(record => ({
      sku: record.sku,
      asin: record.asin || "",
      parent_asin: record.parent_asin || "",
      title_cn: record.title_cn || "",
      amazon_title: record.amazon_title || "",
      category_cn: record.category_cn || "",
      product_type: record.product_type || "",
      sub_scenario: record.sub_scenario || "",
      keywords: record.keywords || []
    })),
    near_duplicate_rules: {
      title_similarity_threshold: 0.55,
      keyword_similarity_threshold: 0.45,
      combined_similarity_threshold: 0.62,
      variant_only_differences: ["color", "material", "size", "quantity", "package_count", "minor_cosmetic_detail"]
    }
  };
}

function main() {
  const records = readJson(MERGED_PROFILE);
  const scenarioStats = scenarioMetrics(records);
  const typeStats = productTypeMetrics(records);
  const strongScenarios = scenarioStats.filter(strongScenario);
  const weakScenarios = scenarioStats.filter(weakScenario);
  const expansionOpportunities = buildExpansionOpportunities(strongScenarios, weakScenarios);
  const summary = buildSummary(records, scenarioStats, typeStats, expansionOpportunities);
  const exclusionRules = buildExclusionRules(records);
  const expansionOutput = {
    marketplace: "US",
    generated_at: new Date().toISOString(),
    opportunity_count: expansionOpportunities.length,
    opportunities: expansionOpportunities
  };

  writeJson("store_profile_summary.json", summary);
  writeJson("store_exclusion_rules.json", exclusionRules);
  writeJson("store_expansion_opportunities.json", expansionOutput);

  console.log(JSON.stringify({
    total_products: summary.total_products,
    main_product_types: summary.main_product_types.slice(0, 5),
    strong_store_scenarios: summary.strong_store_scenarios.length,
    weak_store_scenarios: summary.weak_store_scenarios.length,
    expansion_opportunities: expansionOutput.opportunity_count
  }, null, 2));
}

main();
