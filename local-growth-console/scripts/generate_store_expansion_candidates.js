const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");

function readJson(fileName, fallback) {
  const filePath = path.join(DATA_DIR, fileName);
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(fileName, data) {
  fs.writeFileSync(path.join(DATA_DIR, fileName), `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function existingTypeSet(exclusionRules) {
  return new Set((exclusionRules.product_type_rules || []).map(rule => rule.product_type));
}

function existingScenarioSet(exclusionRules) {
  return new Set((exclusionRules.sub_scenario_rules || []).map(rule => rule.sub_scenario));
}

const CATALOG = {
  water_pressure_control_expansion: [
    {
      title: "Garden Hose Leak-Proof Quick Connect Set",
      category: "Garden Hose / Water Fittings",
      product_type: "hose_quick_connector",
      sub_scenario: "connection_fitting",
      reference_price: 24.99,
      estimated_monthly_sales: 45,
      keywords: ["garden hose", "quick connect", "leak proof", "brass", "hose fitting"],
      use_case: "Homeowners connect hoses, nozzles, and sprinklers quickly while reducing leaks.",
      store_relation: "Adjacent to the store's pressure and water-fitting depth, but not a gauge or regulator duplicate.",
      why_recommended: "Same water-control buyer intent, different function, low complexity, and likely supplier overlap.",
      main_risks: "Commodity listings are common; differentiation needs better seals, clear thread standards, or bundled parts.",
      next_step: "Validate leak-related reviews, connector standards, and supplier tolerance before sourcing."
    },
    {
      title: "Inline Hose Shut-Off Valve 2 Pack",
      category: "Garden Hose / Water Fittings",
      product_type: "inline_hose_shutoff_valve",
      sub_scenario: "flow_control",
      reference_price: 21.99,
      estimated_monthly_sales: 38,
      keywords: ["hose valve", "shut off", "garden hose", "flow control", "fitting"],
      use_case: "Users control water flow at the hose end without walking back to the spigot.",
      store_relation: "Extends existing pressure and flow-control knowledge into a small accessory.",
      why_recommended: "Simple product, relevant buyer scenario, and easy to validate through review complaints about leaks.",
      main_risks: "Valve handle breakage and leak complaints can drive returns.",
      next_step: "Check supplier valve material, gasket quality, and review frequency for leaking."
    }
  ],
  water_filtration_expansion: [
    {
      title: "RV Inline Water Filter Stand",
      category: "RV Accessories / Water Filtration",
      product_type: "rv_filter_stand",
      sub_scenario: "water_filtration",
      reference_price: 32.99,
      estimated_monthly_sales: 40,
      keywords: ["rv", "water filter", "filter stand", "hose support", "campground"],
      use_case: "RV users keep inline water filters off the ground and reduce hose strain at campsite hookups.",
      store_relation: "Adjacent to store water-system products while solving a different RV setup problem.",
      why_recommended: "Same buyer group, different product function, seasonal RV travel relevance, and moderate price.",
      main_risks: "Compatibility with popular filter sizes must be clear.",
      next_step: "Validate common filter diameters and whether collapsible design reduces package risk."
    },
    {
      title: "RV Hose Storage Bag Set",
      category: "RV Accessories / Storage",
      product_type: "rv_hose_storage_bag",
      sub_scenario: "organization",
      reference_price: 24.99,
      estimated_monthly_sales: 36,
      keywords: ["rv", "hose storage", "storage bag", "camping", "fresh water hose"],
      use_case: "RV users store and carry hoses cleanly after campsite water connection.",
      store_relation: "Adjacent to RV water-system buyers without duplicating regulators or gauges.",
      why_recommended: "Same buyer scenario, different function, low complexity, and likely easy to source.",
      main_risks: "Generic fabric bag designs can become commoditized.",
      next_step: "Validate competitor reviews, fabric thickness, zipper quality, and supplier options."
    }
  ],
  protection_expansion: [
    {
      title: "Outdoor Faucet Freeze Protection Cover 4 Pack",
      category: "Outdoor Maintenance / Freeze Protection",
      product_type: "outdoor_faucet_cover",
      sub_scenario: "protection",
      reference_price: 18.99,
      estimated_monthly_sales: 22,
      keywords: ["outdoor faucet cover", "spigot cover", "freeze protection", "winter"],
      use_case: "Homeowners cover outdoor spigots before freezing weather.",
      store_relation: "Extends existing protection and water-related products into a seasonal winter use case.",
      why_recommended: "Low complexity seasonal extension with a clear early-layout window.",
      main_risks: "Low price can weaken margin unless pack count and shipping economics work.",
      next_step: "Check pack economics, dimensions, and timing for late-summer listing preparation."
    },
    {
      title: "RV Winterization Blowout Adapter Kit",
      category: "RV Accessories / Seasonal Maintenance",
      product_type: "rv_winterization_adapter",
      sub_scenario: "winterization",
      reference_price: 29.99,
      estimated_monthly_sales: 24,
      keywords: ["rv winterization", "blowout adapter", "air compressor", "freeze protection", "water line"],
      use_case: "RV owners clear water lines before winter storage.",
      store_relation: "Seasonal extension of water-pressure and fitting knowledge without repeating current pressure products.",
      why_recommended: "Strong future seasonal window; useful product idea for early validation and supplier checks.",
      main_risks: "Timing risk and fitting compatibility are the main blockers.",
      next_step: "Validate thread standards and prepare seasonal listing copy before demand opens."
    }
  ],
  flow_control_expansion: [
    {
      title: "Garden Hose Splitter Valve with Large Handles",
      category: "Garden Hose / Irrigation / Water Fittings",
      product_type: "garden_hose_splitter_valve",
      sub_scenario: "flow_control",
      reference_price: 26.99,
      estimated_monthly_sales: 55,
      keywords: ["garden hose", "splitter valve", "two way", "large handle", "watering"],
      use_case: "Homeowners run two watering tools from one spigot and control each branch independently.",
      store_relation: "Adjacent to existing valve, fitting, and water-control directions.",
      why_recommended: "Current spring/summer demand, clear utility, and straightforward supplier validation.",
      main_risks: "Thread fit and leaking complaints are frequent in this category.",
      next_step: "Review competitor leakage complaints and verify gasket and handle durability."
    },
    {
      title: "Drip Irrigation Pressure Reducer and Filter Set",
      category: "Irrigation / Water Fittings",
      product_type: "irrigation_pressure_filter_set",
      sub_scenario: "garden_watering",
      reference_price: 34.99,
      estimated_monthly_sales: 42,
      keywords: ["drip irrigation", "pressure reducer", "filter", "garden watering", "fitting"],
      use_case: "Gardeners reduce water pressure and filter debris before drip irrigation lines.",
      store_relation: "Uses pressure-control credibility in a garden watering scenario.",
      why_recommended: "Adjacent to pressure and water-control expertise with a differentiated use case.",
      main_risks: "Compatibility and installation clarity matter; unclear fittings can cause returns.",
      next_step: "Validate fitting standards and competitor complaints about clogging or incorrect adapters."
    }
  ]
};

function templateForTheme(theme) {
  return CATALOG[theme.theme_id] || [];
}

function isDirectDuplicate(candidate, typeSet, scenarioSet) {
  const genericAllowed = new Set([
    "hose_quick_connector",
    "inline_hose_shutoff_valve",
    "rv_filter_stand",
    "rv_hose_storage_bag",
    "outdoor_faucet_cover",
    "rv_winterization_adapter",
    "garden_hose_splitter_valve",
    "irrigation_pressure_filter_set"
  ]);

  if (genericAllowed.has(candidate.product_type)) return false;
  return typeSet.has(candidate.product_type) && scenarioSet.has(candidate.sub_scenario);
}

function buildCandidate(theme, template, index) {
  const id = `${theme.theme_id}_${index + 1}`;
  return {
    asin: "",
    parent_asin: "",
    title: template.title,
    brand: "",
    category: template.category,
    product_type: template.product_type,
    sub_scenario: template.sub_scenario,
    reference_price: template.reference_price,
    estimated_monthly_sales: template.estimated_monthly_sales,
    sales_confidence: "directional_mock",
    recommendation_sources: ["store_expansion"],
    store_fit: Number(theme.priority_score || 0) >= 85 ? "high" : "medium",
    opportunity_type: "store_adjacent",
    timing_window: "unknown",
    seasonal_attribute: "unknown",
    keywords: template.keywords,
    market_situation: `${theme.label}: generated from store profile expansion theme; market data is directional mock only.`,
    use_case: template.use_case,
    store_relation: template.store_relation,
    why_recommended: template.why_recommended,
    main_risks: template.main_risks,
    next_step: template.next_step,
    source_theme_id: theme.theme_id,
    source_theme_label: theme.label,
    source_priority_score: theme.priority_score,
    candidate_level: "product_idea",
    source: "store_profile_expansion",
    updated_at: new Date().toISOString(),
    idea_id: `idea_${slug(id)}`
  };
}

function generateCandidates(profileSummary, exclusionRules, expansionOpportunities) {
  const typeSet = existingTypeSet(exclusionRules);
  const scenarioSet = existingScenarioSet(exclusionRules);
  const seen = new Set();
  const candidates = [];
  const excluded = [];

  const themes = [...(expansionOpportunities.opportunities || [])]
    .sort((a, b) => Number(b.priority_score || 0) - Number(a.priority_score || 0));

  for (const theme of themes) {
    for (const [index, template] of templateForTheme(theme).entries()) {
      const candidate = buildCandidate(theme, template, index);
      const key = `${candidate.product_type}:${candidate.sub_scenario}:${slug(candidate.title)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      if (isDirectDuplicate(candidate, typeSet, scenarioSet)) {
        excluded.push({
          title: candidate.title,
          product_type: candidate.product_type,
          sub_scenario: candidate.sub_scenario,
          reason: "direct_existing_type_and_scenario"
        });
        continue;
      }

      candidates.push(candidate);
    }
  }

  const report = {
    generated_at: new Date().toISOString(),
    marketplace: expansionOpportunities.marketplace || profileSummary.marketplace || "US",
    source_theme_count: themes.length,
    generated_count: candidates.length,
    excluded_count: excluded.length,
    excluded,
    source_themes: themes.map(theme => ({
      theme_id: theme.theme_id,
      label: theme.label,
      priority_score: theme.priority_score
    }))
  };

  return { candidates, report };
}

function main() {
  const profileSummary = readJson("store_profile_summary.json", {});
  const exclusionRules = readJson("store_exclusion_rules.json", {});
  const expansionOpportunities = readJson("store_expansion_opportunities.json", { opportunities: [] });
  const result = generateCandidates(profileSummary, exclusionRules, expansionOpportunities);
  writeJson("store_expansion_candidates.json", result.candidates);
  console.log(JSON.stringify(result.report, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = {
  generateCandidates
};
