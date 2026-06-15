const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");

const paths = {
  root: ROOT,
  data: DATA_DIR,
  mock: path.join(DATA_DIR, "mock"),
  store: path.join(DATA_DIR, "store"),
  productResearch: path.join(DATA_DIR, "product_research"),
  dailyRecommendations: path.join(DATA_DIR, "product_research", "daily_recommendations"),
  ads: path.join(DATA_DIR, "ads"),
  adsRawReports: path.join(DATA_DIR, "ads", "raw_reports"),
  adsCleanedReports: path.join(DATA_DIR, "ads", "cleaned_reports"),
  adsLlmInputs: path.join(DATA_DIR, "ads", "llm_inputs"),
  adsLlmOutputs: path.join(DATA_DIR, "ads", "llm_outputs"),
  adsActionPayloads: path.join(DATA_DIR, "ads", "action_payloads"),
  adsExecutionResults: path.join(DATA_DIR, "ads", "execution_results"),
  adsReviewResults: path.join(DATA_DIR, "ads", "review_results"),
  adsAdjustmentLogs: path.join(DATA_DIR, "ads", "adjustment_logs"),
  db: path.join(DATA_DIR, "db"),
  audit: path.join(DATA_DIR, "audit")
};

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function ensureCoreDirs() {
  Object.values(paths).forEach(value => {
    if (value !== ROOT && value !== DATA_DIR) ensureDir(value);
  });
  ensureDir(path.join(paths.adsActionPayloads, "requests"));
  ensureDir(path.join(paths.adsActionPayloads, "responses"));
  ensureDir(path.join(paths.productResearch, "llm_inputs"));
  ensureDir(path.join(paths.productResearch, "llm_outputs"));
}

function existingPath(relativePaths) {
  for (const relativePath of relativePaths) {
    const fullPath = path.join(ROOT, relativePath);
    if (fs.existsSync(fullPath)) return fullPath;
  }
  return path.join(ROOT, relativePaths[0]);
}

function readJsonFirst(relativePaths, fallback = null) {
  const fullPath = existingPath(relativePaths);
  if (!fs.existsSync(fullPath)) return fallback;
  return JSON.parse(fs.readFileSync(fullPath, "utf8").replace(/^\uFEFF/, ""));
}

function writeJson(relativePath, value) {
  const fullPath = path.join(ROOT, relativePath);
  ensureDir(path.dirname(fullPath));
  fs.writeFileSync(fullPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return fullPath;
}

module.exports = {
  ROOT,
  DATA_DIR,
  paths,
  ensureDir,
  ensureCoreDirs,
  existingPath,
  readJsonFirst,
  writeJson
};
