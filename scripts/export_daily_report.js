const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const DAILY_DIR = path.join(DATA_DIR, "daily_recommendations");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function line(text = "") {
  return `${text}\n`;
}

function formatRecommendation(item, index) {
  return [
    line(`## ${index + 1}. ${item.title}`),
    line(`- ASIN: ${item.asin || item.idea_id || "Product idea"}`),
    line(`- Category: ${item.category}`),
    line(`- Price: $${Number(item.reference_price || 0).toFixed(2)}`),
    line(`- Estimated monthly sales: ${item.estimated_monthly_sales_range || item.estimated_monthly_sales || "unknown"}; confidence: ${item.sales_confidence || "unknown"}`),
    line(`- Grade: ${item.recommendation_grade}; Action: ${item.action_suggestion}`),
    line(`- Timing: ${item.timing_window}; Sources: ${(item.recommendation_sources || []).join(", ")}`),
    line(`- Why now: ${item.why_recommended}`),
    line(`- Use case: ${item.use_case}`),
    line(`- Store relation: ${item.store_relation}`),
    line(`- Main risks: ${item.main_risks}`),
    line(`- Next step: ${item.next_step}`),
    line()
  ].join("");
}

function main() {
  const date = process.argv[2];
  const inputPath = date
    ? path.join(DAILY_DIR, `${date}.json`)
    : path.join(DAILY_DIR, "latest.json");
  const daily = readJson(inputPath);
  const outputPath = path.join(DAILY_DIR, `${daily.date}_report.md`);

  const content = [
    line(`# Amazon Daily Product Recommender - ${daily.date}`),
    line(`Marketplace: ${daily.marketplace}`),
    line(`Generated at: ${daily.generated_at}`),
    line("## Summary"),
    line(`- Candidates scanned: ${daily.summary.candidate_count}`),
    line(`- Eligible candidates: ${daily.summary.eligible_count}`),
    line(`- Final recommendations: ${daily.summary.final_count}`),
    line(`- Main themes: ${(daily.summary.main_themes || []).join(", ")}`),
    line(`- Current opportunities: ${daily.summary.current_opportunity_count}`),
    line(`- Seasonal early-layout opportunities: ${daily.summary.seasonal_early_layout_count}`),
    line(`- Store expansion opportunities: ${daily.summary.store_expansion_count}`),
    line(`- Risk notes: ${(daily.summary.risk_notes || []).join("; ")}`),
    line(),
    ...(daily.recommendations || []).map(formatRecommendation),
    line("## Debug"),
    line(`- Duplicate filtered: ${daily.debug.filtered_duplicate_count}`),
    line(`- Risk filtered: ${daily.debug.filtered_risk_count}`),
    line(`- Over $80 selected: ${daily.debug.over_80_selected_count}`)
  ].join("");

  fs.writeFileSync(outputPath, content, "utf8");
  console.log(JSON.stringify({ output: `data/daily_recommendations/${path.basename(outputPath)}` }, null, 2));
}

main();
