(function () {
  function buildContext({ storeProducts = [], profileSummary = {}, exclusionRules = {}, expansionOpportunities = {} } = {}) {
    return {
      storeProducts,
      profileSummary,
      exclusionRules,
      expansionOpportunities,
      exclusionProducts: buildExclusionProducts(storeProducts, exclusionRules),
      strongScenarioSet: new Set((profileSummary.strong_store_scenarios || []).map(item => item.sub_scenario)),
      weakScenarioSet: new Set((profileSummary.weak_store_scenarios || []).map(item => item.sub_scenario)),
      expansionThemes: expansionOpportunities.opportunities || []
    };
  }

  function buildExclusionProducts(storeProducts, exclusionRules) {
    if (exclusionRules && Array.isArray(exclusionRules.keyword_profiles) && exclusionRules.keyword_profiles.length) {
      return exclusionRules.keyword_profiles;
    }
    return storeProducts || [];
  }

  function expansionMatch(candidate, context) {
    const themes = (context && context.expansionThemes) || [];
    const matches = themes.filter(theme => {
      const typeMatch = (theme.target_product_types || []).some(type => profileTermMatch(candidate, type));
      const scenarioMatch = (theme.target_sub_scenarios || []).some(scenario => profileTermMatch(candidate, scenario));
      return typeMatch || scenarioMatch;
    });

    if (!matches.length) {
      return {
        score: 0,
        themes: [],
        rationale: ""
      };
    }

    const bestPriority = Math.max(...matches.map(theme => Number(theme.priority_score || 0)));
    const score = Math.min(8, Math.max(2, Math.round(bestPriority / 18)));

    return {
      score,
      themes: matches.map(theme => theme.theme_id),
      rationale: matches[0].rationale || ""
    };
  }

  function profileTermMatch(candidate, target) {
    const targetText = String(target || "").toLowerCase();
    const candidateText = [
      candidate.product_type,
      candidate.sub_scenario,
      candidate.title,
      candidate.display_title,
      ...(candidate.keywords || [])
    ].join(" ").toLowerCase();

    if (!targetText || !candidateText) return false;
    if (candidateText.includes(targetText)) return true;

    const genericTokens = new Set(["water", "control", "accessory", "support", "product"]);
    const targetTokens = targetText
      .split(/[_\s-]+/)
      .filter(token => token.length >= 4 && !genericTokens.has(token));
    if (targetTokens.some(token => candidateText.includes(token))) return true;

    const aliases = {
      connector: ["connect", "quick_connect", "adapter", "fitting"],
      connection_fitting: ["connect", "connector", "adapter", "fitting"],
      filter: ["filter", "filtration"],
      water_filtration: ["filter", "filtration"],
      freeze_protection: ["winter", "winterization", "freeze"],
      winterization: ["winter", "winterization", "freeze"],
      cover: ["cover", "faucet_cover"],
      protection: ["cover", "protect"],
      hook: ["hook"],
      garage_storage: ["garage", "storage", "hook"],
      storage_accessory: ["storage", "bag", "organizer"],
      organization: ["storage", "bag", "organizer"],
      valve: ["valve"],
      flow_control: ["valve", "flow"],
      hose: ["hose"],
      water_hose: ["hose"],
      rv_accessory: ["rv"],
      rv_maintenance: ["rv", "winterization"]
    };

    return (aliases[targetText] || []).some(alias => candidateText.includes(alias));
  }

  function scenarioPenalty(candidate, context) {
    if (!context || !context.weakScenarioSet) return 0;
    return context.weakScenarioSet.has(candidate.sub_scenario) ? -4 : 0;
  }

  function isStrongStoreScenario(candidate, context) {
    return Boolean(context && context.strongScenarioSet && context.strongScenarioSet.has(candidate.sub_scenario));
  }

  window.StoreProfile = {
    buildContext,
    buildExclusionProducts,
    expansionMatch,
    profileTermMatch,
    scenarioPenalty,
    isStrongStoreScenario
  };
})();
