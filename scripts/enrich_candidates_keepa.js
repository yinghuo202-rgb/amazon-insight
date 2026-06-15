const fs = require("fs");
const path = require("path");

const KeepaAdapter = require("../src/data_adapters/keepa_adapter");

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
  const keepaRecords = readJson("keepa_enrichment_mock.json", []);
  const result = KeepaAdapter.enrichCandidates(candidates, keepaRecords, {
    updatedAt: new Date().toISOString()
  });

  result.report.mode = "local_mock_only";
  result.report.note = "No external Keepa API was called. Replace data/keepa_enrichment_mock.json with backend/API output when ready.";

  writeJson("candidate_products.json", result.candidates);
  writeJson("keepa_enrichment_report.json", result.report);

  console.log(JSON.stringify(result.report, null, 2));
}

main();
