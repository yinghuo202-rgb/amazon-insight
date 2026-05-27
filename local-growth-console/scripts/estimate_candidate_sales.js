const fs = require("fs");
const path = require("path");

const SalesEstimator = require("../src/data_adapters/sales_estimator");

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
  const result = SalesEstimator.enrichCandidates(candidates, {
    updatedAt: new Date().toISOString()
  });

  writeJson("candidate_products.json", result.candidates);
  writeJson("sales_estimation_report.json", result.report);

  console.log(JSON.stringify(result.report, null, 2));
}

main();
