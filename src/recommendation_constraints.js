(function () {
  const MAX_ABOVE_PRICE_FOCUS = 1;
  const MAX_PER_SUB_SCENARIO = 2;

  function candidateKey(candidate) {
    return candidate.asin || candidate.idea_id || `${candidate.product_type || "unknown"}:${candidate.title || ""}`;
  }

  function opportunityScore(candidate) {
    return (
      Number(candidate.market_score || 0) +
      Number(candidate.seasonality_score || 0) +
      Number(candidate.store_fit_score || 0) +
      Number(candidate.profit_potential_score || 0)
    );
  }

  function latestFeedbackByKey(feedbackRecords = []) {
    const latest = {};
    for (const record of feedbackRecords) {
      const key = record.asin || record.idea_id || `${record.product_type || "unknown"}:${record.title || ""}`;
      latest[key] = record;
    }
    return latest;
  }

  function isRejectedWithoutChange(candidate, feedbackRecords) {
    const latest = latestFeedbackByKey(feedbackRecords)[candidateKey(candidate)];
    if (!latest || (latest.action !== "reject" && latest.action !== "rejected")) return false;
    if (!candidate.updated_at || !latest.timestamp) return true;
    return new Date(candidate.updated_at).getTime() <= new Date(latest.timestamp).getTime();
  }

  function isBlockedByWatchlist(candidate, watchlistRecords = []) {
    const key = candidateKey(candidate);
    const activeStatuses = new Set(["watching", "checking_supplier", "review_analysis", "sample_requested", "shortlisted"]);
    return watchlistRecords.some(record => {
      const recordKey = record.asin || record.idea_id || `${record.product_type || "unknown"}:${record.title || ""}`;
      const status = record.status || (record.action === "supplier_check" ? "checking_supplier" : "watching");
      return recordKey === key && activeStatuses.has(status);
    });
  }

  function filterRiskCandidates(candidates, options = {}) {
    const kept = [];
    const excluded = [];
    const feedbackRecords = options.feedbackRecords || [];
    const watchlistRecords = options.watchlistRecords || [];

    for (const candidate of candidates || []) {
      let reason = "";

      if (!candidate.title) reason = "missing_title";
      else if (candidate.compliance_risk === "high") reason = "high_compliance_risk";
      else if (candidate.complexity_level === "high" && !candidate.allow_high_complexity) reason = "high_complexity";
      else if (candidate.size_risk === "high" && opportunityScore(candidate) < 62) reason = "high_size_risk_low_opportunity";
      else if (Number(candidate.estimated_monthly_sales || 0) < 30 && candidate.timing_window !== "early_layout") reason = "low_sales_not_early_layout";
      else if (isRejectedWithoutChange(candidate, feedbackRecords)) reason = "rejected_without_data_change";
      else if (isBlockedByWatchlist(candidate, watchlistRecords)) reason = "already_in_watchlist";

      if (reason) {
        excluded.push({
          asin: candidate.asin,
          idea_id: candidate.idea_id,
          title: candidate.title,
          reason
        });
      } else {
        kept.push(candidate);
      }
    }

    return { kept, excluded };
  }

  function isInternalDuplicate(candidate, selected) {
    for (const item of selected) {
      if (candidate.asin && item.asin && candidate.asin === item.asin) return true;
      if (candidate.parent_asin && item.parent_asin && candidate.parent_asin === item.parent_asin) return true;
      if (opportunityFamilyKey(candidate) && opportunityFamilyKey(candidate) === opportunityFamilyKey(item)) return true;
      if (
        candidate.product_type &&
        candidate.sub_scenario &&
        candidate.product_type === item.product_type &&
        candidate.sub_scenario === item.sub_scenario
      ) {
        const profile = window.DuplicateFilter && window.DuplicateFilter.similarityProfile(candidate, item);
        if (!profile || profile.combinedSimilarity >= 0.42 || candidate.title === item.title) return true;
      }
    }
    return false;
  }

  function opportunityFamilyKey(candidate = {}) {
    const text = [
      candidate.display_title,
      candidate.title,
      candidate.category,
      candidate.product_type,
      candidate.sub_scenario,
      ...(candidate.keywords || [])
    ].join(" ").toLowerCase();

    if ((text.includes("faucet") || text.includes("spigot")) && (text.includes("freeze") || text.includes("cover"))) return "faucet_freeze_cover";
    if (text.includes("hose storage") || text.includes("storage bag")) return "hose_storage";
    if (text.includes("door edge") || text.includes("edge guard")) return "automotive_edge_guard";
    if (text.includes("water pressure regulator") || text.includes("pressure reducer")) return "water_pressure_regulator";
    if (text.includes("inline water filter") || text.includes("water filter")) return "inline_water_filter";
    if (text.includes("quick connect") || text.includes("connector")) return "hose_connector";
    if (text.includes("wheel chock")) return "wheel_chock";
    if (text.includes("wall hook") || text.includes("garage hook")) return "garage_hook";

    return String(candidate.title || "")
      .toLowerCase()
      .replace(/\b(set|kit|pack|pcs|piece|heavy duty|adjustable|brass|black|white|large|small|medium)\b/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function applyFinalSelection(candidates, options = {}) {
    const limit = options.limit || 5;
    const selected = [];
    const subScenarioCounts = new Map();
    const skipped = [];
    let abovePriceFocusCount = 0;

    function trySelect(candidate, allowProductIdea) {
      if (!allowProductIdea && candidate.candidate_level === "product_idea") return false;
      if (!candidate.monthly_sales_qualified) {
        skipped.push({ asin: candidate.asin, idea_id: candidate.idea_id, title: candidate.title, reason: "monthly_sales_not_qualified" });
        return false;
      }
      if (candidate.is_above_price_focus && abovePriceFocusCount >= MAX_ABOVE_PRICE_FOCUS) {
        skipped.push({ asin: candidate.asin, idea_id: candidate.idea_id, title: candidate.title, reason: "above_80_limit" });
        return false;
      }

      const subScenario = candidate.sub_scenario || "unknown";
      const currentCount = subScenarioCounts.get(subScenario) || 0;
      if (currentCount >= MAX_PER_SUB_SCENARIO) {
        skipped.push({ asin: candidate.asin, idea_id: candidate.idea_id, title: candidate.title, reason: "sub_scenario_limit" });
        return false;
      }

      if (isInternalDuplicate(candidate, selected)) {
        skipped.push({ asin: candidate.asin, idea_id: candidate.idea_id, title: candidate.title, reason: "internal_near_duplicate" });
        return false;
      }

      selected.push(candidate);
      subScenarioCounts.set(subScenario, currentCount + 1);
      if (candidate.is_above_price_focus) abovePriceFocusCount += 1;
      return selected.length === limit;
    }

    for (const candidate of candidates) {
      if (trySelect(candidate, false)) break;
    }

    if (selected.length < limit) {
      for (const candidate of candidates) {
        if (selected.includes(candidate)) continue;
        if (trySelect(candidate, true)) break;
      }
    }

    return {
      selected,
      skipped,
      over_80_selected_count: abovePriceFocusCount
    };
  }

  window.RecommendationConstraints = {
    applyFinalSelection,
    candidateKey,
    filterRiskCandidates,
    opportunityFamilyKey
  };
})();
