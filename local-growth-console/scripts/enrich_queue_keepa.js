const fs = require("fs");
const path = require("path");

const KeepaProvider = require("../src/providers/keepaProvider");
const { ROOT, ensureDir, readJsonFirst, writeJson } = require("./data_paths");

function normalizeAsin(value) {
  return String(value || "").trim().toUpperCase();
}

function readQueue() {
  return readJsonFirst(["data/product_research/enrichment_queue.json"], []);
}

function readKeepaRecords() {
  return readJsonFirst(["data/mock/keepa_enrichment.mock.json", "data/keepa_enrichment_mock.json"], []);
}

function updateCandidatePool(enrichedQueue) {
  const candidates = readJsonFirst(["data/product_research/candidate_products.json", "data/candidate_products.json"], []);
  const byAsin = new Map(enrichedQueue
    .filter(item => item.status === "enriched" && item.enrichment)
    .map(item => [normalizeAsin(item.asin), item.enrichment]));
  let updatedCount = 0;
  const updatedCandidates = candidates.map(candidate => {
    const enrichment = byAsin.get(normalizeAsin(candidate.asin));
    if (!enrichment) return candidate;
    updatedCount += 1;
    return {
      ...candidate,
      ...enrichment,
      keepa_enriched: true,
      keepa_missing: false,
      keepa_source: enrichment.keepa_source || "queue_mock_keepa",
      keepa_updated_at: new Date().toISOString()
    };
  });
  if (updatedCount) {
    writeJson("data/product_research/candidate_products.json", updatedCandidates);
    writeJson("data/candidate_products.json", updatedCandidates);
  }
  return updatedCount;
}

async function main() {
  ensureDir(path.join(ROOT, "data", "product_research"));
  const queue = readQueue();
  const records = readKeepaRecords();
  const beforePending = queue.filter(item => item.status === "pending").length;
  const enrichedQueue = await KeepaProvider.enrichQueueWithMock(queue, { records });
  const enrichedCount = enrichedQueue.filter(item => item.status === "enriched").length;
  const failedCount = enrichedQueue.filter(item => item.status === "failed").length;
  const updatedCandidateCount = updateCandidatePool(enrichedQueue);

  const report = {
    generated_at: new Date().toISOString(),
    mode: "mock_keepa_queue_only",
    external_requests_made: 0,
    input_queue_count: queue.length,
    pending_before_count: beforePending,
    enriched_queue_count: enrichedCount,
    failed_queue_count: failedCount,
    updated_candidate_count: updatedCandidateCount,
    processed_asins: enrichedQueue
      .filter(item => item.provider === "mock_keepa")
      .map(item => ({ asin: item.asin, status: item.status, last_error: item.last_error || "" })),
    note: "Only enrichment_queue ASINs were processed. No real Keepa API call was made."
  };

  writeJson("data/product_research/enrichment_queue.json", enrichedQueue);
  writeJson("data/product_research/keepa_queue_enrichment_report.json", report);
  writeJson("data/keepa_queue_enrichment_report.json", report);
  console.log(JSON.stringify(report, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
