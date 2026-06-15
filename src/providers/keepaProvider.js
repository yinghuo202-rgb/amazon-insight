(function (root, factory) {
  const api = factory(root.KeepaAdapter);
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("../data_adapters/keepa_adapter"));
  }
  root.KeepaProvider = api;
})(typeof window !== "undefined" ? window : globalThis, function (KeepaAdapter) {
  function normalizeAsin(value) {
    return String(value || "").trim().toUpperCase();
  }

  function indexMockRecords(records) {
    return KeepaAdapter.indexByAsin(records || []);
  }

  async function loadMockKeepaRecords() {
    const paths = ["./data/mock/keepa_enrichment.mock.json", "./data/keepa_enrichment_mock.json"];
    for (const path of paths) {
      try {
        const response = await fetch(path, { cache: "no-store" });
        if (response.ok) return response.json();
      } catch {
        continue;
      }
    }
    return [];
  }

  async function enrichAsinWithMock(asin, options = {}) {
    const normalizedAsin = normalizeAsin(asin);
    const records = options.records || await loadMockKeepaRecords();
    const record = indexMockRecords(records).get(normalizedAsin);
    return {
      asin: normalizedAsin,
      provider: "mock_keepa",
      status: record ? "enriched" : "failed",
      enrichment: record || null,
      error: record ? "" : "No local mock Keepa record found for ASIN.",
      external_request_made: false,
      updated_at: new Date().toISOString()
    };
  }

  async function enrichAsinWithKeepaApi() {
    throw new Error("Real Keepa API is not enabled. Use a local backend script with config/keepa.config.local.json before connecting external API.");
  }

  async function enrichQueueWithMock(queue, options = {}) {
    const records = options.records || await loadMockKeepaRecords();
    const index = indexMockRecords(records);
    const now = new Date().toISOString();
    return (queue || []).map(item => {
      if (!["pending", "failed"].includes(item.status)) return item;
      const asin = normalizeAsin(item.asin);
      const enrichment = index.get(asin);
      return {
        ...item,
        asin,
        status: enrichment ? "enriched" : "failed",
        updated_at: now,
        attempt_count: Number(item.attempt_count || 0) + 1,
        last_error: enrichment ? "" : "No local mock Keepa record found for ASIN.",
        provider: "mock_keepa",
        enrichment: enrichment || null,
        external_request_made: false
      };
    });
  }

  return {
    loadMockKeepaRecords,
    enrichAsinWithMock,
    enrichAsinWithKeepaApi,
    enrichQueueWithMock
  };
});
