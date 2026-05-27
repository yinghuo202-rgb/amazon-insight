(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.ReviewPainPointAnalyzer = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const THEMES = [
    {
      theme: "leaking",
      keywords: ["leak", "leaking", "drip", "water escaping"],
      improvement_angle: "Improve sealing surfaces, gasket quality, and thread tolerance."
    },
    {
      theme: "poor sealing",
      keywords: ["seal", "gasket", "o ring", "o-ring", "washer"],
      improvement_angle: "Upgrade washers and include clearer sealing instructions."
    },
    {
      theme: "inaccurate gauge",
      keywords: ["inaccurate", "gauge", "wrong psi", "calibration"],
      improvement_angle: "Use better calibrated gauges and state tolerance clearly."
    },
    {
      theme: "fitment mismatch",
      keywords: ["does not fit", "fitment", "thread mismatch", "wrong thread", "adapter mismatch"],
      improvement_angle: "Clarify compatibility and include adapter sizing guidance."
    },
    {
      theme: "installation difficulty",
      keywords: ["hard to install", "installation", "instructions", "confusing", "difficult"],
      improvement_angle: "Improve instructions and reduce tool-dependent steps."
    },
    {
      theme: "weak material",
      keywords: ["thin", "weak", "flimsy", "cheap material", "bent"],
      improvement_angle: "Upgrade material thickness and avoid overstated load claims."
    },
    {
      theme: "wrong size",
      keywords: ["wrong size", "too small", "too large", "size mismatch"],
      improvement_angle: "Add clearer dimension diagrams and fit notes."
    },
    {
      theme: "unclear instructions",
      keywords: ["unclear", "no instructions", "bad instructions", "manual"],
      improvement_angle: "Add step-by-step images and plain installation copy."
    },
    {
      theme: "rust",
      keywords: ["rust", "corrosion", "rusted"],
      improvement_angle: "Improve coating, stainless hardware, or drainage design."
    },
    {
      theme: "breakage",
      keywords: ["broke", "break", "cracked", "snapped", "failed"],
      improvement_angle: "Validate stress points and improve material choice."
    },
    {
      theme: "packaging damage",
      keywords: ["package", "packaging", "damaged box", "arrived damaged"],
      improvement_angle: "Improve packaging protection and carton specification."
    },
    {
      theme: "high return risk",
      keywords: ["returned", "return", "refund", "not worth"],
      improvement_angle: "Clarify expectations and reduce fit or quality ambiguity."
    }
  ];

  function normalize(value) {
    return String(value || "").toLowerCase();
  }

  function frequency(count, sampleCount) {
    if (count >= 3 || count / Math.max(1, sampleCount) >= 0.45) return "high";
    if (count >= 2 || count / Math.max(1, sampleCount) >= 0.25) return "medium";
    return "low";
  }

  function analyzeReviews(asin, reviews = []) {
    const samples = reviews.map(review => normalize(review.summary || review.text || review)).filter(Boolean);
    const painPoints = [];

    for (const theme of THEMES) {
      const matched = samples.filter(sample => theme.keywords.some(keyword => sample.includes(keyword)));
      if (!matched.length) continue;
      painPoints.push({
        theme: theme.theme,
        frequency: frequency(matched.length, samples.length),
        example_summary: matched[0].slice(0, 180),
        improvement_angle: theme.improvement_angle
      });
    }

    const highFrequency = painPoints.filter(point => point.frequency === "high");
    return {
      asin,
      pain_points: painPoints,
      risk_notes: painPoints.map(point => `${point.theme}: ${point.frequency}`),
      opportunity_notes: highFrequency.map(point => point.improvement_angle)
    };
  }

  function analyzeReviewDataset(reviewDataset) {
    return (reviewDataset || []).map(item => analyzeReviews(item.asin, item.reviews || []));
  }

  function riskAdjustment(analysis) {
    let adjustment = 0;
    for (const point of analysis.pain_points || []) {
      if (point.frequency === "high") adjustment += 3;
      if (point.frequency === "medium") adjustment += 2;
      if (["high return risk", "breakage", "fitment mismatch"].includes(point.theme)) adjustment += 2;
    }
    return Math.min(adjustment, 10);
  }

  function opportunityAdjustment(analysis) {
    const usefulThemes = new Set(["leaking", "poor sealing", "unclear instructions", "fitment mismatch"]);
    return Math.min(5, (analysis.pain_points || []).filter(point => usefulThemes.has(point.theme)).length * 2);
  }

  function enrichCandidate(candidate, analysis) {
    if (!analysis) return candidate;
    const risks = (analysis.risk_notes || []).join("; ");
    const opportunities = (analysis.opportunity_notes || []).join("; ");
    const riskAdj = riskAdjustment(analysis);
    const opportunityAdj = opportunityAdjustment(analysis);
    const checklistAdditions = (analysis.pain_points || []).slice(0, 3).map(point => `Validate review pain point: ${point.theme}`);

    return {
      ...candidate,
      review_pain_points: analysis.pain_points || [],
      review_risk_notes: analysis.risk_notes || [],
      review_opportunity_notes: analysis.opportunity_notes || [],
      risk_score: Number(candidate.risk_score || 0) + riskAdj,
      market_score: Number(candidate.market_score || 0) + opportunityAdj,
      main_risks: risks ? `${candidate.main_risks || "Review risk needs validation."} Review themes: ${risks}.` : candidate.main_risks,
      why_recommended: opportunities ? `${candidate.why_recommended || ""} Review gaps suggest improvement angles: ${opportunities}.`.trim() : candidate.why_recommended,
      next_step: analysis.pain_points && analysis.pain_points.length
        ? `${candidate.next_step || "Validate product details."} Specifically validate ${analysis.pain_points.slice(0, 2).map(point => point.theme).join(" and ")}.`
        : candidate.next_step,
      validation_checklist: [
        ...((candidate.validation_checklist || [])),
        ...checklistAdditions
      ]
    };
  }

  return {
    THEMES,
    analyzeReviewDataset,
    analyzeReviews,
    enrichCandidate,
    opportunityAdjustment,
    riskAdjustment
  };
});
