(function (root, factory) {
  const api = factory(root.SeasonalityAnalyzer);
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("../analyzers/seasonality_analyzer"));
  }
  root.CandidateNormalizer = api;
})(typeof window !== "undefined" ? window : globalThis, function (SeasonalityAnalyzer) {
  const MAIN_CATEGORY_KEYWORDS = [
    "industrial", "hardware", "garden", "hose", "irrigation", "water", "fitting",
    "rv", "automotive", "trailer", "towing", "garage", "outdoor maintenance"
  ];

  const TYPE_RULES = [
    { terms: ["rv water pressure regulator", "pressure regulator", "water pressure valve", "pressure valve"], product_type: "rv_water_pressure_regulator", sub_scenario: "water_pressure_control" },
    { terms: ["quick connect"], product_type: "hose_quick_connector", sub_scenario: "connection_fitting" },
    { terms: ["hose storage bag"], product_type: "rv_hose_storage_bag", sub_scenario: "organization" },
    { terms: ["inline water filter stand", "filter stand"], product_type: "rv_filter_stand", sub_scenario: "water_filtration" },
    { terms: ["winterization blowout adapter", "blowout adapter", "winterization adapter"], product_type: "rv_winterization_adapter", sub_scenario: "winterization" },
    { terms: ["outdoor faucet cover", "spigot cover"], product_type: "outdoor_faucet_cover", sub_scenario: "protection" },
    { terms: ["garage wall hook", "wall hook"], product_type: "garage_wall_hook", sub_scenario: "garage_storage" },
    { terms: ["garden hose reel", "hose reel"], product_type: "garden_hose_reel", sub_scenario: "water_hose" },
    { terms: ["door edge guard", "edge guard"], product_type: "automotive_edge_guard", sub_scenario: "automotive_edge_protection" },
    { terms: ["snow brush", "ice scraper"], product_type: "winter_scraper_replacement_head", sub_scenario: "winter_maintenance" },
    { terms: ["wheel chock", "trailer chock", "chock"], product_type: "wheel_chock", sub_scenario: "trailer_utility" },
    { terms: ["pressure gauge", "gauge", "psi meter"], product_type: "pressure_gauge", sub_scenario: "pressure_measurement" },
    { terms: ["connector", "fitting", "adapter"], product_type: "connector", sub_scenario: "connection_fitting" },
    { terms: ["garden hose", "hose"], product_type: "hose", sub_scenario: "water_hose" },
    { terms: ["irrigation", "drip", "sprinkler"], product_type: "irrigation_accessory", sub_scenario: "garden_watering" },
    { terms: ["winterization", "blowout", "freeze"], product_type: "freeze_protection", sub_scenario: "winterization" },
    { terms: ["faucet cover", "cover", "protector"], product_type: "cover", sub_scenario: "protection" },
    { terms: ["valve", "shut off", "shutoff"], product_type: "valve", sub_scenario: "flow_control" },
    { terms: ["filter"], product_type: "filter", sub_scenario: "water_filtration" },
    { terms: ["grill", "bbq"], product_type: "grill_accessory", sub_scenario: "outdoor_cooking" },
    { terms: ["garage hook", "hook"], product_type: "hook", sub_scenario: "garage_storage" },
    { terms: ["storage bag", "organizer", "storage"], product_type: "storage_accessory", sub_scenario: "organization" },
    { terms: ["bracket", "mount"], product_type: "bracket", sub_scenario: "mounting_support" },
    { terms: ["edge guard", "door edge", "trim guard"], product_type: "edge_guard", sub_scenario: "automotive_edge_protection" },
    { terms: ["snow", "ice scraper", "winter tool"], product_type: "winter_tool_accessory", sub_scenario: "winter_maintenance" }
  ];

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function normalizeText(value) {
    return String(value || "").toLowerCase().replace(/[_/,-]+/g, " ").replace(/\s+/g, " ").trim();
  }

  function toNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const cleaned = String(value).replace(/[$,%\s,]/g, "");
    const number = Number(cleaned);
    return Number.isFinite(number) ? number : null;
  }

  function unique(values) {
    return Array.from(new Set(asArray(values).map(value => String(value || "").trim()).filter(Boolean)));
  }

  function titleText(raw) {
    return normalizeText([raw.title, raw.category, raw.notes, ...(raw.keywords || [])].join(" "));
  }

  function inferProductProfile(raw) {
    const text = titleText(raw);
    const explicitType = normalizeText(raw.product_type).replace(/\s+/g, "_");
    const explicitScenario = normalizeText(raw.sub_scenario).replace(/\s+/g, "_");
    if (explicitType && explicitScenario) {
      return { product_type: explicitType, sub_scenario: explicitScenario };
    }

    const rule = TYPE_RULES.find(item => item.terms.some(term => text.includes(term)));
    if (rule) {
      return {
        product_type: explicitType || rule.product_type,
        sub_scenario: explicitScenario || rule.sub_scenario
      };
    }

    return {
      product_type: explicitType || "general_accessory",
      sub_scenario: explicitScenario || "general_store_expansion"
    };
  }

  function inferComplexity(raw, profile) {
    const text = titleText(raw);
    if (text.includes("electrical") || text.includes("sensor") || text.includes("calibrated")) return "medium";
    if (["pressure_regulator", "valve", "filter"].includes(profile.product_type)) return "medium";
    return "low";
  }

  function inferSizeRisk(raw) {
    const price = toNumber(raw.reference_price) || 0;
    const text = titleText(raw);
    if (text.includes("reel") || text.includes("large") || text.includes("heavy duty cart")) return "high";
    if (price > 80 || text.includes("hook") || text.includes("chock")) return "medium";
    return "low";
  }

  function inferComplianceRisk(raw, profile) {
    const text = titleText(raw);
    if (text.includes("propane") || text.includes("electrical") || text.includes("brake")) return "medium";
    if (["pressure_regulator", "valve"].includes(profile.product_type)) return "medium";
    return "low";
  }

  function sourceTags(raw, timingWindow, expansionMatch) {
    const rawSources = asArray(raw.recommendation_sources || raw.source_tags || raw.sources);
    const sources = rawSources.length ? rawSources : [raw.source || "market_opportunity"];
    if (timingWindow === "early_layout" && !sources.includes("seasonal_early_layout")) sources.push("seasonal_early_layout");
    if (expansionMatch && !sources.includes("store_expansion")) sources.push("store_expansion");
    return unique(sources.map(source => String(source).replace(/-/g, "_")));
  }

  function priceScore(price) {
    if (price >= 20 && price <= 80) return 16;
    if (price > 80 && price <= 120) return 10;
    if (price > 0 && price < 20) return 8;
    return 6;
  }

  function salesScore(sales) {
    if (sales >= 200) return 22;
    if (sales >= 100) return 18;
    if (sales >= 50) return 15;
    if (sales >= 30) return 12;
    if (sales > 0) return 7;
    return 5;
  }

  function marketScore(raw, timingWindow) {
    const sales = toNumber(raw.estimated_monthly_sales) || 0;
    const rating = toNumber(raw.rating);
    const reviewGrowth = toNumber(raw.review_30d_growth) || 0;
    let score = salesScore(sales);
    if (rating && rating < 4.2) score += 3;
    if (reviewGrowth > 10) score += 2;
    if (sales < 30 && timingWindow !== "early_layout") score -= 5;
    return Math.max(5, score);
  }

  function profitPotentialScore(raw, sizeRisk) {
    const price = toNumber(raw.reference_price) || 0;
    let score = priceScore(price);
    if (sizeRisk === "low") score += 3;
    if (sizeRisk === "high") score -= 4;
    return Math.max(4, score);
  }

  function riskScore(complexityLevel, sizeRisk, complianceRisk, raw) {
    let score = 4;
    if (complexityLevel === "medium") score += 3;
    if (complexityLevel === "high") score += 7;
    if (sizeRisk === "medium") score += 3;
    if (sizeRisk === "high") score += 7;
    if (complianceRisk === "medium") score += 4;
    if (complianceRisk === "high") score += 9;
    if ((toNumber(raw.reference_price) || 0) > 80) score += 2;
    return score;
  }

  function expansionMatches(profile, expansionOpportunities) {
    return asArray(expansionOpportunities && expansionOpportunities.opportunities)
      .filter(theme => (
        asArray(theme.target_product_types).some(type => (
          profile.product_type === type ||
          profile.product_type.endsWith(`_${type}`) ||
          profile.product_type.includes(`${type}_`)
        )) ||
        asArray(theme.target_sub_scenarios).some(scenario => (
          profile.sub_scenario === scenario ||
          profile.sub_scenario.endsWith(`_${scenario}`) ||
          profile.sub_scenario.includes(`${scenario}_`)
        ))
      ));
  }

  function storeFitScore(raw, profile, expansionOpportunities) {
    const matches = expansionMatches(profile, expansionOpportunities);
    if (matches.length) return 18;
    const text = titleText(raw);
    if (MAIN_CATEGORY_KEYWORDS.some(keyword => text.includes(keyword))) return 13;
    return 9;
  }

  function storeFitLabel(score) {
    if (score >= 17) return "high";
    if (score >= 12) return "medium";
    return "low";
  }

  function opportunityType(timingWindow, sources) {
    if (timingWindow === "early_layout" || sources.includes("seasonal_early_layout")) return "future_seasonal_opportunity";
    if (timingWindow === "near_term_opening") return "near_term_opening";
    return "current_opportunity";
  }

  function seasonalAttribute(candidate, seasonalCalendar, month) {
    const match = SeasonalityAnalyzer.matchCandidateToTheme(candidate, seasonalCalendar);
    if (!match) return "Steady utility demand; no narrow seasonal attribute detected.";
    const timing = SeasonalityAnalyzer.classifyTimingWindow(candidate, month, seasonalCalendar);
    const theme = match.theme;
    return `${theme.label || theme.key}; timing window: ${timing.replace(/_/g, " ")}.`;
  }

  function inferKeywords(raw, profile) {
    const words = [
      ...(raw.keywords || []),
      raw.category,
      profile.product_type,
      profile.sub_scenario,
      ...normalizeText(raw.title).split(" ")
    ];
    return unique(words.map(value => normalizeText(value).replace(/\s+/g, "_")).filter(value => value && value.length > 1));
  }

  function defaultCopy(raw, profile, timingWindow, sources, seasonalNote, expansionThemes) {
    const title = raw.title || "Untitled candidate";
    const expansionLabels = expansionThemes.map(theme => theme.label).filter(Boolean).join("; ");
    return {
      market_situation: raw.market_situation || `${title} sits in a practical accessory category with enough mock sales signal to justify validation.`,
      use_case: raw.use_case || `Used by Amazon US buyers handling ${profile.sub_scenario.replace(/_/g, " ")} tasks.`,
      store_relation: raw.store_relation || (expansionLabels ? `Adjacent to current store strengths: ${expansionLabels}.` : "Fits the broader store direction without duplicating an existing listing."),
      why_recommended: raw.why_recommended || `${sources.join(" + ")} signal with ${timingWindow.replace(/_/g, " ")} timing and manageable product complexity.`,
      main_risks: raw.main_risks || "Validate review complaints, supplier consistency, packaging size, and whether the product is too close to an existing store item.",
      next_step: raw.next_step || "Check supplier quotes, landed cost, negative reviews, and differentiation angle before advancing.",
      competitive_notes: raw.competitive_notes || "Use review mining to verify repeated complaints and avoid commodity-only listings.",
      seasonality_notes: raw.seasonality_notes || seasonalNote,
      store_expansion_logic: raw.store_expansion_logic || (expansionLabels ? `Matches store expansion themes: ${expansionLabels}.` : "Adjacent opportunity; no direct expansion theme match."),
      validation_checklist: asArray(raw.validation_checklist).length ? raw.validation_checklist : [
        "Check supplier landed cost",
        "Review negative reviews and return reasons",
        "Confirm product is not a store duplicate",
        "Validate package size and FBA fee exposure"
      ]
    };
  }

  function normalizeCandidate(raw, options = {}) {
    const seasonalCalendar = options.seasonalCalendar || {};
    const month = Number(options.currentMonth || seasonalCalendar.current_month || SeasonalityAnalyzer.getCurrentMonth());
    const profile = inferProductProfile(raw);
    const price = toNumber(raw.reference_price);
    const sales = toNumber(raw.estimated_monthly_sales);
    const keywords = inferKeywords(raw, profile);
    const shellCandidate = { ...raw, ...profile, keywords };
    const timingWindow = raw.timing_window && raw.timing_window !== "unknown"
      ? raw.timing_window
      : SeasonalityAnalyzer.classifyTimingWindow(shellCandidate, month, seasonalCalendar);
    const seasonalityScore = raw.seasonality_score ?? SeasonalityAnalyzer.calculateSeasonalityScore(shellCandidate, month, seasonalCalendar);
    const expansionThemes = expansionMatches(profile, options.expansionOpportunities);
    const sources = sourceTags(raw, timingWindow, expansionThemes.length > 0);
    const complexityLevel = raw.complexity_level || inferComplexity(raw, profile);
    const sizeRisk = raw.size_risk || inferSizeRisk(raw);
    const complianceRisk = raw.compliance_risk || inferComplianceRisk(raw, profile);
    const storeScore = raw.store_fit_score ?? storeFitScore(raw, profile, options.expansionOpportunities);
    const seasonalNote = SeasonalityAnalyzer.generateSeasonalityNote(shellCandidate, seasonalCalendar, month);
    const copy = defaultCopy(raw, profile, timingWindow, sources, seasonalNote, expansionThemes);

    return {
      asin: raw.asin || "",
      parent_asin: raw.parent_asin || "",
      idea_id: raw.idea_id || "",
      candidate_level: raw.candidate_level || (raw.asin ? "asin_product" : "product_idea"),
      title: raw.title || "",
      display_title: raw.display_title || raw.title || "",
      brand: raw.brand || "",
      category: raw.category || "",
      product_type: profile.product_type,
      sub_scenario: profile.sub_scenario,
      reference_price: price,
      estimated_monthly_sales: sales || 0,
      sales_confidence: raw.sales_confidence || "mock",
      rating: toNumber(raw.rating),
      review_count: toNumber(raw.review_count),
      bsr: toNumber(raw.bsr),
      estimated_monthly_revenue: toNumber(raw.estimated_monthly_revenue),
      jungle_scout_opportunity_score: toNumber(raw.jungle_scout_opportunity_score),
      fulfillment_fee_estimate: toNumber(raw.fulfillment_fee_estimate),
      net_profit_estimate: toNumber(raw.net_profit_estimate),
      weight: raw.weight || "",
      dimensions: raw.dimensions || "",
      seller_type: raw.seller_type || "",
      raw_fields: raw.raw_fields || {},
      bsr_30d_trend: raw.bsr_30d_trend || "",
      review_30d_growth: toNumber(raw.review_30d_growth),
      price_30d_change: toNumber(raw.price_30d_change),
      recommendation_sources: sources,
      store_fit: raw.store_fit || storeFitLabel(storeScore),
      opportunity_type: raw.opportunity_type && raw.opportunity_type !== "unknown" ? raw.opportunity_type : opportunityType(timingWindow, sources),
      timing_window: timingWindow,
      seasonal_attribute: raw.seasonal_attribute && raw.seasonal_attribute !== "unknown"
        ? raw.seasonal_attribute
        : seasonalAttribute(shellCandidate, seasonalCalendar, month),
      complexity_level: complexityLevel,
      size_risk: sizeRisk,
      compliance_risk: complianceRisk,
      market_score: raw.market_score ?? marketScore(raw, timingWindow),
      seasonality_score: Number(seasonalityScore),
      store_fit_score: Number(storeScore),
      profit_potential_score: raw.profit_potential_score ?? profitPotentialScore(raw, sizeRisk),
      risk_score: raw.risk_score ?? riskScore(complexityLevel, sizeRisk, complianceRisk, raw),
      keywords,
      ...copy,
      source: raw.source || "manual_mock_candidate_pool",
      sales_source: raw.sales_source || "",
      source_file: raw.source_file || "",
      data_freshness: raw.data_freshness || "",
      updated_at: raw.updated_at || new Date().toISOString()
    };
  }

  function normalizeCandidates(rawCandidates, options = {}) {
    const seen = new Set();
    const normalized = [];

    for (const raw of asArray(rawCandidates)) {
      const candidate = normalizeCandidate(raw, options);
      const key = candidate.asin ? `asin:${candidate.asin}` : `idea:${normalizeText(candidate.title)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      normalized.push(candidate);
    }

    return normalized;
  }

  function buildCandidateReport(rawCandidates, normalizedCandidates) {
    const above80 = normalizedCandidates.filter(item => Number(item.reference_price || 0) > 80).length;
    const earlyLayout = normalizedCandidates.filter(item => item.timing_window === "early_layout").length;
    const bySource = {};
    const byScenario = {};
    for (const candidate of normalizedCandidates) {
      for (const source of candidate.recommendation_sources || []) {
        bySource[source] = (bySource[source] || 0) + 1;
      }
      byScenario[candidate.sub_scenario] = (byScenario[candidate.sub_scenario] || 0) + 1;
    }

    return {
      generated_at: new Date().toISOString(),
      raw_candidate_count: asArray(rawCandidates).length,
      normalized_candidate_count: normalizedCandidates.length,
      duplicate_raw_candidate_count: Math.max(0, asArray(rawCandidates).length - normalizedCandidates.length),
      above_80_count: above80,
      early_layout_count: earlyLayout,
      by_recommendation_source: bySource,
      by_sub_scenario: byScenario,
      missing_asin_count: normalizedCandidates.filter(item => !item.asin).length,
      missing_price_count: normalizedCandidates.filter(item => item.reference_price === null).length,
      missing_sales_count: normalizedCandidates.filter(item => !Number(item.estimated_monthly_sales)).length
    };
  }

  return {
    normalizeCandidate,
    normalizeCandidates,
    buildCandidateReport,
    inferProductProfile
  };
});
