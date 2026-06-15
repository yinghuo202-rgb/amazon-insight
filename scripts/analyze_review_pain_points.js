const fs = require("fs");
const path = require("path");

const ReviewPainPointAnalyzer = require("../src/analyzers/review_pain_point_analyzer");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");

function readJson(fileName, fallback = null) {
  const filePath = path.join(DATA_DIR, fileName);
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(fileName, data) {
  fs.writeFileSync(path.join(DATA_DIR, fileName), `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function main() {
  const candidates = readJson("candidate_products.json", []);
  const reviewSamples = readJson("review_samples_mock.json", []);
  const analyses = ReviewPainPointAnalyzer.analyzeReviewDataset(reviewSamples);
  const analysisByAsin = new Map(analyses.map(item => [item.asin, item]));

  const enrichedCandidates = candidates.map(candidate => (
    ReviewPainPointAnalyzer.enrichCandidate(candidate, analysisByAsin.get(candidate.asin))
  ));

  const report = {
    generated_at: new Date().toISOString(),
    review_sample_asin_count: reviewSamples.length,
    candidate_count: candidates.length,
    candidates_with_review_analysis: enrichedCandidates.filter(item => item.review_pain_points && item.review_pain_points.length).length,
    theme_distribution: analyses.flatMap(item => item.pain_points || []).reduce((counts, point) => {
      counts[point.theme] = (counts[point.theme] || 0) + 1;
      return counts;
    }, {}),
    analyzed_asins: analyses.map(item => item.asin)
  };

  writeJson("review_pain_points.json", analyses);
  writeJson("candidate_products.json", enrichedCandidates);
  writeJson("review_pain_point_report.json", report);

  console.log(JSON.stringify(report, null, 2));
}

main();
