(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AdsDataProvider = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const PATHS = {
    mockAdsReports: ["./data/mock/ads_reports.mock.json", "./data/ads_optimizer_mock.json"],
    uploadedAdsReports: ["./data/ads/raw_reports/uploaded_ads_reports.json"],
    cleanedAdsReports: ["./data/ads/cleaned_reports/cleaned_ads_reports.json"],
    syncLogs: ["./data/ads/ads_sync_logs.json", "./data/ads_sync_logs.json"],
    rawArchives: ["./data/ads/raw_report_archives.json", "./data/raw_report_archives.json"],
    cleanedArchives: ["./data/ads/cleaned_report_archives.json", "./data/cleaned_report_archives.json"],
    llmLogs: ["./data/ads/llm_analysis_logs.json", "./data/llm_analysis_logs.json"],
    amazonAdsSync: ["./data/ads/amazon_ads_sync_latest.json"],
    amazonAdsProfiles: ["./data/ads/amazon_ads_profiles_latest.json"]
  };

  async function loadJson(path) {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) throw new Error(`Failed to load ${path}: ${response.status}`);
    return response.json();
  }

  async function loadFirst(paths, fallback = null) {
    for (const path of paths) {
      try {
        return await loadJson(path);
      } catch {
        continue;
      }
    }
    return fallback;
  }

  function loadMockAdsReports() {
    return loadFirst(PATHS.mockAdsReports, {});
  }

  function loadUploadedAdsReports() {
    return loadFirst(PATHS.uploadedAdsReports, []);
  }

  function loadCleanedAdsReports() {
    return loadFirst(PATHS.cleanedAdsReports, []);
  }

  function loadAmazonAdsApiReports() {
    return loadFirst(PATHS.amazonAdsSync, {});
  }

  async function loadAmazonAdsStatus() {
    try {
      const response = await fetch("./api/amazon-ads/status", { cache: "no-store" });
      if (!response.ok) throw new Error(`Amazon Ads status failed: ${response.status}`);
      return response.json();
    } catch (error) {
      return {
        provider: "amazon_ads",
        ready: false,
        enabled: false,
        requestMode: "unavailable",
        warnings: [error.message],
        external_request_made: false
      };
    }
  }

  async function syncAmazonAdsProfiles({ live = true } = {}) {
    const response = await fetch(`./api/amazon-ads/sync?live=${live ? "1" : "0"}&profiles=1`, {
      method: "POST",
      cache: "no-store"
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload && payload.report && payload.report.errors ? payload.report.errors.join(" ") : `Amazon Ads sync failed: ${response.status}`);
    return payload;
  }

  async function loadAdsReports() {
    const mock = await loadMockAdsReports();
    const cleaned = await loadCleanedAdsReports();
    return {
      mock,
      cleaned,
      source: cleaned.length ? "cleaned_local_reports" : "mock"
    };
  }

  async function loadAdsArtifacts() {
    const [syncLogs, rawArchives, cleanedArchives, llmLogs] = await Promise.all([
      loadFirst(PATHS.syncLogs, []),
      loadFirst(PATHS.rawArchives, []),
      loadFirst(PATHS.cleanedArchives, []),
      loadFirst(PATHS.llmLogs, [])
    ]);
    const [amazonAdsSync, amazonAdsProfiles] = await Promise.all([
      loadFirst(PATHS.amazonAdsSync, {}),
      loadFirst(PATHS.amazonAdsProfiles, {})
    ]);
    return { syncLogs, rawArchives, cleanedArchives, llmLogs, amazonAdsSync, amazonAdsProfiles };
  }

  return {
    PATHS,
    loadFirst,
    loadMockAdsReports,
    loadUploadedAdsReports,
    loadCleanedAdsReports,
    loadAmazonAdsApiReports,
    loadAmazonAdsStatus,
    syncAmazonAdsProfiles,
    loadAdsReports,
    loadAdsArtifacts
  };
});
