(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SeasonalityAnalyzer = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  function normalizeText(value) {
    return String(value || "").toLowerCase().replace(/[_/,-]+/g, " ").replace(/\s+/g, " ").trim();
  }

  function tokenize(value) {
    return normalizeText(value).split(" ").filter(token => token.length > 1);
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function getCurrentMonth(date = new Date()) {
    return date.getMonth() + 1;
  }

  function normalizeTheme(theme) {
    return {
      ...theme,
      key: theme.theme || theme.key || theme.id,
      active_months: theme.demand_window_months || theme.active_months || [],
      early_layout_months: theme.early_layout_months || [],
      observation_months: theme.observation_months || []
    };
  }

  function getThemes(seasonalCalendar) {
    return asArray(seasonalCalendar && (seasonalCalendar.themes || seasonalCalendar.windows)).map(normalizeTheme);
  }

  function candidateSearchText(candidate) {
    return normalizeText([
      candidate.title,
      candidate.display_title,
      candidate.category,
      candidate.product_type,
      candidate.sub_scenario,
      ...(candidate.keywords || [])
    ].join(" "));
  }

  function monthIn(month, months) {
    return asArray(months).map(Number).includes(Number(month));
  }

  function themeMatchScore(candidate, theme) {
    const text = candidateSearchText(candidate);
    const candidateTokens = new Set(tokenize(text));
    let score = 0;

    for (const type of asArray(theme.related_product_types)) {
      const normalized = normalizeText(type);
      if (normalized && text.includes(normalized.replace(/_/g, " "))) score += 5;
      for (const token of tokenize(type)) {
        if (candidateTokens.has(token)) score += 1;
      }
    }

    for (const keyword of asArray(theme.related_keywords)) {
      const normalized = normalizeText(keyword);
      if (normalized && text.includes(normalized)) score += 3;
      for (const token of tokenize(keyword)) {
        if (candidateTokens.has(token)) score += 0.5;
      }
    }

    return score;
  }

  function matchCandidateToTheme(candidate, seasonalCalendar) {
    const matches = getThemes(seasonalCalendar)
      .map(theme => ({ theme, score: themeMatchScore(candidate, theme) }))
      .filter(match => match.score >= 3)
      .sort((a, b) => b.score - a.score);

    return matches[0] || null;
  }

  function classifyTimingWindow(candidate, month, seasonalCalendar) {
    const match = matchCandidateToTheme(candidate, seasonalCalendar);
    if (!match) return "not_seasonal";

    const theme = match.theme;
    if (monthIn(month, theme.active_months)) return "current_opportunity";
    if (monthIn(month, theme.early_layout_months)) return "early_layout";
    if (monthIn(month, theme.observation_months)) return "near_term_opening";
    return "off_season_observation";
  }

  function calculateSeasonalityScore(candidate, month, seasonalCalendar) {
    const match = matchCandidateToTheme(candidate, seasonalCalendar);
    if (!match) return 4;

    const timing = classifyTimingWindow(candidate, month, seasonalCalendar);
    const sourceBoost = asArray(candidate.recommendation_sources || candidate.source_tags).includes("seasonal_early_layout") ? 3 : 0;
    const matchBoost = Math.min(4, Math.floor(match.score / 4));

    const baseByTiming = {
      current_opportunity: 14,
      near_term_opening: 11,
      early_layout: 18,
      off_season_observation: 7,
      not_seasonal: 4
    };

    return (baseByTiming[timing] || 4) + sourceBoost + matchBoost;
  }

  function getSeasonalThemesForMonth(month, seasonalCalendar) {
    return getThemes(seasonalCalendar).filter(theme => (
      monthIn(month, theme.active_months) ||
      monthIn(month, theme.early_layout_months) ||
      monthIn(month, theme.observation_months)
    ));
  }

  function generateSeasonalityNote(candidate, seasonalCalendar, month) {
    const match = matchCandidateToTheme(candidate, seasonalCalendar);
    if (!match) return "No strong seasonal pattern in the current calendar; evaluate as a steady utility opportunity.";

    const theme = match.theme;
    const timing = classifyTimingWindow(candidate, month, seasonalCalendar);
    const label = theme.label || theme.key;

    if (timing === "current_opportunity") {
      return `${label}: demand window is active now, so supplier checks and listing validation should happen immediately.`;
    }
    if (timing === "early_layout") {
      return `${label}: current month is an early layout window; prepare listing, packaging, and supplier options before demand opens.`;
    }
    if (timing === "near_term_opening") {
      return `${label}: near-term observation window; validate search and competitor movement before committing inventory.`;
    }
    return `${label}: outside the main window; keep as watchlist unless market or store-fit signals are unusually strong.`;
  }

  return {
    getCurrentMonth,
    getSeasonalThemesForMonth,
    matchCandidateToTheme,
    classifyTimingWindow,
    calculateSeasonalityScore,
    generateSeasonalityNote
  };
});
