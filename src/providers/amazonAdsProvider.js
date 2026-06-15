(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AmazonAdsProvider = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const REGION_BASE_URLS = {
    NA: "https://advertising-api.amazon.com",
    EU: "https://advertising-api-eu.amazon.com",
    FE: "https://advertising-api-fe.amazon.com"
  };

  const DEFAULT_CONFIG = {
    provider: "amazon_ads",
    enabled: false,
    requestMode: "disabled",
    region: "NA",
    marketplace: "US",
    baseUrl: REGION_BASE_URLS.NA,
    tokenUrl: "https://api.amazon.com/auth/o2/token",
    clientIdEnv: "AMAZON_ADS_CLIENT_ID",
    clientSecretEnv: "AMAZON_ADS_CLIENT_SECRET",
    refreshTokenEnv: "AMAZON_ADS_REFRESH_TOKEN",
    profileIdEnv: "AMAZON_ADS_PROFILE_ID",
    defaultReportWindowDays: 14,
    reportPollAttempts: 8,
    reportPollDelayMs: 5000,
    writeActionsEnabled: false
  };

  function normalizeConfig(config = {}) {
    const region = String(config.region || DEFAULT_CONFIG.region).toUpperCase();
    return {
      ...DEFAULT_CONFIG,
      ...config,
      region,
      baseUrl: config.baseUrl || REGION_BASE_URLS[region] || DEFAULT_CONFIG.baseUrl,
      marketplace: String(config.marketplace || DEFAULT_CONFIG.marketplace).toUpperCase(),
      requestMode: config.requestMode || DEFAULT_CONFIG.requestMode,
      defaultReportWindowDays: Number(config.defaultReportWindowDays || DEFAULT_CONFIG.defaultReportWindowDays),
      reportPollAttempts: Number(config.reportPollAttempts || DEFAULT_CONFIG.reportPollAttempts),
      reportPollDelayMs: Number(config.reportPollDelayMs || DEFAULT_CONFIG.reportPollDelayMs)
    };
  }

  function maskSecret(value) {
    const text = String(value || "");
    if (!text) return "";
    if (text.length <= 8) return `${text.slice(0, 2)}***`;
    return `${text.slice(0, 4)}***${text.slice(-4)}`;
  }

  function readCredentials(config = {}, env = {}) {
    const normalized = normalizeConfig(config);
    const source = env || {};
    return {
      clientId: String(source[normalized.clientIdEnv] || source.amazon_ads_client_id || "").trim(),
      clientSecret: String(source[normalized.clientSecretEnv] || source.amazon_ads_client_secret || "").trim(),
      refreshToken: String(source[normalized.refreshTokenEnv] || source.amazon_ads_refresh_token || "").trim(),
      profileId: String(source[normalized.profileIdEnv] || source.amazon_ads_profile_id || "").trim(),
      region: String(source.amazon_ads_region || normalized.region || "NA").toUpperCase()
    };
  }

  function getStatus(config = {}, env = {}) {
    const normalized = normalizeConfig(config);
    const credentials = readCredentials(normalized, env);
    const ready = Boolean(
      normalized.enabled &&
      normalized.requestMode === "api" &&
      normalized.baseUrl &&
      credentials.clientId &&
      credentials.clientSecret &&
      credentials.refreshToken
    );
    return {
      provider: normalized.provider,
      enabled: Boolean(normalized.enabled),
      ready,
      requestMode: normalized.requestMode,
      marketplace: normalized.marketplace,
      region: credentials.region || normalized.region,
      baseUrlConfigured: Boolean(normalized.baseUrl),
      profileIdPresent: Boolean(credentials.profileId),
      profileIdMasked: maskSecret(credentials.profileId),
      clientIdPresent: Boolean(credentials.clientId),
      clientIdMasked: maskSecret(credentials.clientId),
      clientSecretPresent: Boolean(credentials.clientSecret),
      refreshTokenPresent: Boolean(credentials.refreshToken),
      writeActionsEnabled: Boolean(normalized.writeActionsEnabled),
      external_request_made: false,
      warnings: [
        !normalized.enabled ? "Amazon Ads provider is disabled." : "",
        normalized.requestMode !== "api" ? "Request mode is disabled; no external Amazon Ads calls will be made." : "",
        !normalized.baseUrl ? "Amazon Ads base URL is not configured." : "",
        !credentials.clientId ? `Client ID is not set. Use ${normalized.clientIdEnv}.` : "",
        !credentials.clientSecret ? `Client secret is not set. Use ${normalized.clientSecretEnv}.` : "",
        !credentials.refreshToken ? `Refresh token is not set. Use ${normalized.refreshTokenEnv}.` : "",
        !credentials.profileId ? `Profile ID is not set. Use ${normalized.profileIdEnv} or select one from /v2/profiles.` : ""
      ].filter(Boolean)
    };
  }

  function assertReady(config = {}, env = {}) {
    const status = getStatus(config, env);
    if (!status.ready) {
      const error = new Error(`Amazon Ads API provider is not ready: ${status.warnings.join(" ")}`);
      error.statusCode = 503;
      error.publicDetails = status;
      throw error;
    }
    return status;
  }

  async function parseResponse(response) {
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { raw: text };
    }
    if (!response.ok) {
      const error = new Error(`Amazon Ads API request failed with HTTP ${response.status}`);
      error.status = response.status;
      error.statusCode = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  async function requestAccessToken({ config = {}, env = {}, fetchImpl } = {}) {
    const normalized = normalizeConfig(config);
    const credentials = readCredentials(normalized, env);
    if (!credentials.clientId || !credentials.clientSecret || !credentials.refreshToken) {
      throw new Error("Missing Amazon Ads LWA credentials.");
    }
    const fetchFn = fetchImpl || fetch;
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: credentials.refreshToken,
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret
    });
    const response = await fetchFn(normalized.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body
    });
    const payload = await parseResponse(response);
    if (!payload || !payload.access_token) throw new Error("Amazon LWA token response did not include access_token.");
    return payload;
  }

  async function apiRequest({ path, method = "GET", body, config = {}, env = {}, profileId = "", fetchImpl } = {}) {
    const normalized = normalizeConfig(config);
    assertReady(normalized, env);
    const credentials = readCredentials(normalized, env);
    const fetchFn = fetchImpl || fetch;
    const token = await requestAccessToken({ config: normalized, env, fetchImpl: fetchFn });
    const targetProfileId = profileId || credentials.profileId;
    const headers = {
      Authorization: `Bearer ${token.access_token}`,
      "Amazon-Advertising-API-ClientId": credentials.clientId,
      Accept: "application/vnd.createasyncreportrequest.v3+json, application/json"
    };
    if (targetProfileId) headers["Amazon-Advertising-API-Scope"] = targetProfileId;
    if (body !== undefined) headers["Content-Type"] = "application/vnd.createasyncreportrequest.v3+json";

    const response = await fetchFn(new URL(path, normalized.baseUrl).toString(), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return {
      payload: await parseResponse(response),
      status: response.status,
      external_request_made: true
    };
  }

  function dateDaysAgo(days) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - Number(days || 0));
    return date.toISOString().slice(0, 10);
  }

  function defaultDateWindow(days = 14) {
    return {
      startDate: dateDaysAgo(days),
      endDate: dateDaysAgo(1)
    };
  }

  function reportConfig(reportType, { startDate, endDate, name } = {}) {
    const base = {
      name: name || `${reportType}_${startDate}_${endDate}`,
      startDate,
      endDate
    };
    const configs = {
      search_term_report: {
        ...base,
        configuration: {
          adProduct: "SPONSORED_PRODUCTS",
          reportTypeId: "spSearchTerm",
          timeUnit: "SUMMARY",
          format: "GZIP_JSON",
          groupBy: ["searchTerm"],
          columns: [
            "campaignId", "campaignName", "adGroupId", "adGroupName",
            "keywordId", "keyword", "searchTerm", "matchType",
            "impressions", "clicks", "cost", "sales14d", "purchases14d"
          ]
        }
      },
      keyword_report: {
        ...base,
        configuration: {
          adProduct: "SPONSORED_PRODUCTS",
          reportTypeId: "spTargeting",
          timeUnit: "SUMMARY",
          format: "GZIP_JSON",
          groupBy: ["targeting"],
          columns: [
            "campaignId", "campaignName", "adGroupId", "adGroupName",
            "keywordId", "keyword", "matchType", "targeting",
            "impressions", "clicks", "cost", "sales14d", "purchases14d"
          ]
        }
      },
      placement_report: {
        ...base,
        configuration: {
          adProduct: "SPONSORED_PRODUCTS",
          reportTypeId: "spCampaigns",
          timeUnit: "SUMMARY",
          format: "GZIP_JSON",
          groupBy: ["campaignPlacement"],
          columns: [
            "campaignId", "campaignName", "campaignStatus", "placement",
            "impressions", "clicks", "cost", "sales14d", "purchases14d"
          ]
        }
      }
    };
    if (!configs[reportType]) throw new Error(`Unsupported Amazon Ads report type: ${reportType}`);
    return configs[reportType];
  }

  function listProfiles(options = {}) {
    return apiRequest({ ...options, path: "/v2/profiles", method: "GET", profileId: "" });
  }

  function listSponsoredProductsCampaigns(options = {}) {
    return apiRequest({
      ...options,
      path: "/sp/campaigns/list",
      method: "POST",
      body: options.body || { stateFilter: { include: ["ENABLED", "PAUSED"] }, maxResults: 100 }
    });
  }

  async function createReport({ reportType, startDate, endDate, config = {}, env = {}, profileId = "", fetchImpl } = {}) {
    const normalized = normalizeConfig(config);
    const window = startDate && endDate ? { startDate, endDate } : defaultDateWindow(normalized.defaultReportWindowDays);
    return apiRequest({
      path: "/reporting/reports",
      method: "POST",
      body: reportConfig(reportType, window),
      config: normalized,
      env,
      profileId,
      fetchImpl
    });
  }

  function getReport({ reportId, ...options } = {}) {
    if (!reportId) throw new Error("reportId is required.");
    return apiRequest({ ...options, path: `/reporting/reports/${encodeURIComponent(reportId)}`, method: "GET" });
  }

  async function downloadReport({ url, fetchImpl } = {}) {
    if (!url) throw new Error("Report download URL is required.");
    const fetchFn = fetchImpl || fetch;
    const response = await fetchFn(url);
    if (!response.ok) {
      const error = new Error(`Amazon Ads report download failed with HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return Buffer.from(await response.arrayBuffer());
  }

  return {
    DEFAULT_CONFIG,
    REGION_BASE_URLS,
    normalizeConfig,
    maskSecret,
    readCredentials,
    getStatus,
    assertReady,
    requestAccessToken,
    apiRequest,
    defaultDateWindow,
    reportConfig,
    listProfiles,
    listSponsoredProductsCampaigns,
    createReport,
    getReport,
    downloadReport
  };
});
