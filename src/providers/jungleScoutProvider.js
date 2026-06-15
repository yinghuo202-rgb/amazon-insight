(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.JungleScoutProvider = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const DEFAULT_CONFIG = {
    provider: "jungle_scout",
    enabled: false,
    baseUrl: "https://developer.junglescout.com",
    marketplace: "us",
    keyNameEnv: "JUNGLE_SCOUT_KEY_NAME",
    apiKeyEnv: "JUNGLE_SCOUT_API_KEY",
    authEnv: "JUNGLE_SCOUT_AUTH",
    requestMode: "disabled",
    maxBatchSize: 25,
    accept: "application/vnd.junglescout.v1+json",
    contentType: "application/vnd.api+json",
    apiType: "junglescout"
  };

  function normalizeConfig(config = {}) {
    return {
      ...DEFAULT_CONFIG,
      ...config,
      keyNameEnv: config.keyNameEnv || DEFAULT_CONFIG.keyNameEnv,
      apiKeyEnv: config.apiKeyEnv || DEFAULT_CONFIG.apiKeyEnv,
      authEnv: config.authEnv || DEFAULT_CONFIG.authEnv,
      marketplace: String(config.marketplace || DEFAULT_CONFIG.marketplace).toLowerCase(),
      requestMode: config.requestMode || DEFAULT_CONFIG.requestMode,
      maxBatchSize: Number(config.maxBatchSize || DEFAULT_CONFIG.maxBatchSize)
    };
  }

  function parseAuth(value) {
    const text = String(value || "").trim();
    if (!text) return { keyName: "", apiKey: "" };

    try {
      const parsed = JSON.parse(text);
      const keyName = String(parsed.keyName || parsed.key_name || parsed.name || "").trim();
      const apiKey = String(parsed.apiKey || parsed.api_key || parsed.key || "").trim();
      if (keyName && apiKey) return { keyName, apiKey };
    } catch {
      // Plain text formats are handled below.
    }

    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const pairs = {};
    lines.forEach(line => {
      const match = line.match(/^([A-Za-z0-9_ -]+)\s*[:=]\s*(.+)$/);
      if (!match) return;
      const key = match[1].toLowerCase().replace(/[\s-]+/g, "_");
      pairs[key] = match[2].trim();
    });
    const pairKeyName = pairs.key_name || pairs.keyname || pairs.name || pairs.api_key_name;
    const pairApiKey = pairs.api_key || pairs.apikey || pairs.key;
    if (pairKeyName && pairApiKey) {
      return { keyName: pairKeyName, apiKey: pairApiKey };
    }

    if (lines.length >= 2 && !lines[0].includes(":") && !lines[0].includes("=")) {
      return { keyName: lines[0], apiKey: lines.slice(1).join("").trim() };
    }

    const separatorIndex = text.indexOf(":");
    if (separatorIndex <= 0 || separatorIndex === text.length - 1) {
      return { keyName: "", apiKey: "" };
    }
    return {
      keyName: text.slice(0, separatorIndex).trim(),
      apiKey: text.slice(separatorIndex + 1).trim()
    };
  }

  function readApiKey(config = {}, env = {}) {
    return readCredentials(config, env).apiKey;
  }

  function readCredentials(config = {}, env = {}) {
    const normalized = normalizeConfig(config);
    const source = env || {};
    const auth = parseAuth(source[normalized.authEnv]);
    if (auth.keyName && auth.apiKey) return auth;
    return {
      keyName: String(source[normalized.keyNameEnv] || "").trim(),
      apiKey: String(source[normalized.apiKeyEnv] || "").trim()
    };
  }

  function maskSecret(value) {
    const text = String(value || "");
    if (!text) return "";
    if (text.length <= 8) return `${text.slice(0, 2)}***`;
    return `${text.slice(0, 4)}***${text.slice(-4)}`;
  }

  function getStatus(config = {}, env = {}) {
    const normalized = normalizeConfig(config);
    const credentials = readCredentials(normalized, env);
    const ready = Boolean(normalized.enabled && normalized.baseUrl && credentials.keyName && credentials.apiKey);
    return {
      provider: normalized.provider,
      enabled: Boolean(normalized.enabled),
      ready,
      requestMode: normalized.requestMode,
      baseUrlConfigured: Boolean(normalized.baseUrl),
      marketplace: normalized.marketplace,
      keyNameEnv: normalized.keyNameEnv,
      apiKeyEnv: normalized.apiKeyEnv,
      authEnv: normalized.authEnv,
      keyNamePresent: Boolean(credentials.keyName),
      keyNameMasked: maskSecret(credentials.keyName),
      apiKeyPresent: Boolean(credentials.apiKey),
      apiKeyMasked: maskSecret(credentials.apiKey),
      external_request_made: false,
      warnings: [
        !normalized.enabled ? "Provider is disabled." : "",
        !normalized.baseUrl ? "Base URL is not configured." : "",
        !credentials.keyName ? `Key name is not set. Use ${normalized.authEnv} or ${normalized.keyNameEnv}.` : "",
        !credentials.apiKey ? `API key is not set. Use ${normalized.authEnv} or ${normalized.apiKeyEnv}.` : "",
        normalized.requestMode !== "api" ? "Request mode is disabled; no external calls will be made." : ""
      ].filter(Boolean)
    };
  }

  function buildHeaders(config = {}, env = {}) {
    const normalized = normalizeConfig(config);
    const credentials = readCredentials(normalized, env);
    if (!credentials.keyName || !credentials.apiKey) {
      throw new Error(`Missing Jungle Scout credentials. Set ${normalized.authEnv}=KEY_NAME:API_KEY or set ${normalized.keyNameEnv} and ${normalized.apiKeyEnv}.`);
    }
    return {
      Authorization: `${credentials.keyName}:${credentials.apiKey}`,
      Accept: normalized.accept,
      "Content-Type": normalized.contentType,
      "X-API-Type": normalized.apiType
    };
  }

  function productDatabaseQueryUrl(config = {}, nextUrl = "") {
    const normalized = normalizeConfig(config);
    if (nextUrl) return nextUrl;
    const url = new URL("/api/product_database_query", normalized.baseUrl);
    url.searchParams.set("marketplace", normalized.marketplace);
    if (normalized.maxBatchSize) url.searchParams.set("page[size]", String(normalized.maxBatchSize));
    return url.toString();
  }

  async function requestJson({ url, body, config = {}, env = {}, fetchImpl } = {}) {
    const normalized = normalizeConfig(config);
    const fetchFn = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
    if (!fetchFn) throw new Error("Global fetch is unavailable in this runtime.");
    const response = await fetchFn(url, {
      method: "POST",
      headers: buildHeaders(normalized, env),
      body: JSON.stringify(body)
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { raw: text };
    }
    if (!response.ok) {
      const error = new Error(`Jungle Scout API request failed with HTTP ${response.status}`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return {
      status: response.status,
      payload,
      external_request_made: true
    };
  }

  function buildProductDatabaseBody({ keyword, categories = [], attributes = {} } = {}) {
    return {
      data: {
        type: "product_database_query",
        attributes: {
          include_keywords: [keyword],
          ...(categories.length ? { categories } : {}),
          exclude_unavailable_products: true,
          ...attributes
        }
      }
    };
  }

  async function searchByKeyword({ keyword, config = {}, env = {}, categories = [], attributes = {}, fetchImpl } = {}) {
    const normalized = normalizeConfig(config);
    if (!keyword) throw new Error("keyword is required.");
    if (!normalized.enabled || normalized.requestMode !== "api") {
      return {
        provider: "jungle_scout",
        status: "disabled",
        keyword,
        candidates: [],
        external_request_made: false,
        warning: "Jungle Scout API provider is configured as a disabled placeholder. Use CSV import until API endpoint contract is confirmed."
      };
    }
    const body = buildProductDatabaseBody({ keyword, categories, attributes });
    const result = await requestJson({
      url: productDatabaseQueryUrl(normalized),
      body,
      config: normalized,
      env,
      fetchImpl
    });
    return {
      provider: "jungle_scout",
      status: "ok",
      keyword,
      data: Array.isArray(result.payload && result.payload.data) ? result.payload.data : [],
      meta: result.payload && result.payload.meta ? result.payload.meta : {},
      links: result.payload && result.payload.links ? result.payload.links : {},
      external_request_made: result.external_request_made
    };
  }

  async function searchByAsinBatch({ asins = [], config = {}, env = {} } = {}) {
    const normalized = normalizeConfig(config);
    const normalizedAsins = (asins || []).map(value => String(value || "").trim().toUpperCase()).filter(Boolean);
    if (!normalizedAsins.length) throw new Error("asins must contain at least one ASIN.");
    if (!normalized.enabled || normalized.requestMode !== "api") {
      return {
        provider: "jungle_scout",
        status: "disabled",
        asins: normalizedAsins,
        candidates: [],
        external_request_made: false,
        warning: "Jungle Scout API provider is configured as a disabled placeholder. Use CSV import until API endpoint contract is confirmed."
      };
    }
    buildHeaders(normalized, env);
    return {
      provider: "jungle_scout",
      status: "not_implemented",
      asins: normalizedAsins,
      candidates: [],
      external_request_made: false,
      warning: "ASIN batch endpoint mapping has not been confirmed in the public API contract."
    };
  }

  return {
    DEFAULT_CONFIG,
    normalizeConfig,
    parseAuth,
    readCredentials,
    readApiKey,
    maskSecret,
    getStatus,
    buildHeaders,
    productDatabaseQueryUrl,
    buildProductDatabaseBody,
    searchByKeyword,
    searchByAsinBatch
  };
});
