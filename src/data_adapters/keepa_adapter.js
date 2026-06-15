(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.KeepaAdapter = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  function toNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(String(value).replace(/[$,%\s,]/g, ""));
    return Number.isFinite(number) ? number : null;
  }

  function compactObject(object) {
    return Object.fromEntries(
      Object.entries(object).filter(([, value]) => value !== null && value !== undefined && value !== "")
    );
  }

  function normalizeTrend(value) {
    const normalized = String(value || "").toLowerCase().trim();
    if (["improving", "up", "rank_improving", "better"].includes(normalized)) return "improving";
    if (["worsening", "down", "rank_worsening", "worse"].includes(normalized)) return "worsening";
    if (["flat", "stable", "unchanged"].includes(normalized)) return "stable";
    return normalized || "unknown";
  }

  function normalizeKeepaRecord(raw) {
    const asin = String(raw.asin || raw.ASIN || "").trim();
    return compactObject({
      asin,
      reference_price: toNumber(raw.reference_price ?? raw.current_price ?? raw.buy_box_price ?? raw.last_price),
      rating: toNumber(raw.rating ?? raw.review_rating),
      review_count: toNumber(raw.review_count ?? raw.reviews),
      bsr: toNumber(raw.bsr ?? raw.sales_rank),
      bsr_30d_trend: normalizeTrend(raw.bsr_30d_trend ?? raw.sales_rank_30d_trend),
      review_30d_growth: toNumber(raw.review_30d_growth ?? raw.reviews_30d_growth),
      price_30d_change: toNumber(raw.price_30d_change ?? raw.price_change_30d),
      offer_count: toNumber(raw.offer_count ?? raw.offers),
      category: raw.category || raw.product_group || "",
      keepa_source: raw.keepa_source || "local_mock"
    });
  }

  function indexByAsin(records) {
    const index = new Map();
    for (const raw of records || []) {
      const normalized = normalizeKeepaRecord(raw);
      if (normalized.asin) index.set(normalized.asin, normalized);
    }
    return index;
  }

  function keepaSignalAdjustment(enrichment) {
    let adjustment = 0;
    if (enrichment.bsr_30d_trend === "improving") adjustment += 3;
    if (enrichment.bsr_30d_trend === "worsening") adjustment -= 3;
    if (Number(enrichment.review_30d_growth || 0) >= 15) adjustment += 2;
    if (Number(enrichment.review_30d_growth || 0) < 0) adjustment -= 2;
    if (Number(enrichment.rating || 0) > 0 && Number(enrichment.rating) < 4.1) adjustment += 2;
    if (Number(enrichment.offer_count || 0) >= 30) adjustment -= 2;
    return adjustment;
  }

  function enrichCandidate(candidate, enrichment, updatedAt = new Date().toISOString()) {
    if (!enrichment) {
      return {
        ...candidate,
        keepa_enriched: Boolean(candidate.keepa_enriched),
        keepa_missing: Boolean(candidate.asin)
      };
    }

    const marketAdjustment = keepaSignalAdjustment(enrichment);
    return {
      ...candidate,
      ...compactObject({
        reference_price: enrichment.reference_price,
        rating: enrichment.rating,
        review_count: enrichment.review_count,
        bsr: enrichment.bsr,
        bsr_30d_trend: enrichment.bsr_30d_trend,
        review_30d_growth: enrichment.review_30d_growth,
        price_30d_change: enrichment.price_30d_change,
        offer_count: enrichment.offer_count,
        category: enrichment.category
      }),
      market_score: Math.max(0, Number(candidate.market_score || 0) + marketAdjustment),
      keepa_signal_adjustment: marketAdjustment,
      keepa_enriched: true,
      keepa_missing: false,
      keepa_source: enrichment.keepa_source || "local_mock",
      keepa_updated_at: updatedAt,
      updated_at: updatedAt
    };
  }

  function enrichCandidates(candidates, keepaRecords, options = {}) {
    const updatedAt = options.updatedAt || new Date().toISOString();
    const keepaIndex = indexByAsin(keepaRecords);
    const enriched = [];
    const report = {
      generated_at: updatedAt,
      input_candidate_count: (candidates || []).length,
      keepa_record_count: keepaIndex.size,
      asin_candidate_count: 0,
      product_idea_skipped_count: 0,
      enriched_count: 0,
      missing_keepa_count: 0,
      missing_keepa_asins: [],
      enriched_asins: []
    };

    for (const candidate of candidates || []) {
      if (!candidate.asin) {
        report.product_idea_skipped_count += 1;
        enriched.push({
          ...candidate,
          keepa_enriched: false,
          keepa_missing: false
        });
        continue;
      }

      report.asin_candidate_count += 1;
      const enrichment = keepaIndex.get(candidate.asin);
      if (!enrichment) {
        report.missing_keepa_count += 1;
        report.missing_keepa_asins.push(candidate.asin);
        enriched.push(enrichCandidate(candidate, null, updatedAt));
        continue;
      }

      report.enriched_count += 1;
      report.enriched_asins.push(candidate.asin);
      enriched.push(enrichCandidate(candidate, enrichment, updatedAt));
    }

    return { candidates: enriched, report };
  }

  return {
    enrichCandidate,
    enrichCandidates,
    indexByAsin,
    normalizeKeepaRecord
  };
});
