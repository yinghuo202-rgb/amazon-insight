const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");

const JungleScoutProvider = require("../src/providers/jungleScoutProvider");
const JungleScoutCandidateMapper = require("../src/data_adapters/jungle_scout_candidate_mapper");
const { ROOT, readJsonFirst, writeJson, ensureDir } = require("./data_paths");

const PORT = Number(process.env.PORT || process.env.AMAZON_GROWTH_CONSOLE_PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";
const PRODUCT_RESEARCH_CANDIDATES = "data/product_research/candidate_products.json";
const LEGACY_CANDIDATES = "data/candidate_products.json";
const API_REPORT_PATH = "data/product_research/import_reports/jungle_scout_realtime_asin_latest.json";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8"
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function sendText(response, statusCode, text) {
  response.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(text);
}

function readConfig() {
  const localPath = path.join(ROOT, "config", "jungle_scout.config.local.json");
  const config = fs.existsSync(localPath)
    ? readJsonFirst(["config/jungle_scout.config.local.json"], {})
    : readJsonFirst(["config/jungle_scout.config.example.json"], {});
  return JungleScoutProvider.normalizeConfig({
    ...config,
    enabled: true,
    requestMode: "api",
    maxBatchSize: Number(process.env.JUNGLE_SCOUT_API_PAGE_SIZE || config.maxBatchSize || 25)
  });
}

function readApiFileEnv(config) {
  const desktopApiPath = path.join(process.env.USERPROFILE || "", "Desktop", "api.txt");
  const apiFilePath = process.env.JUNGLE_SCOUT_API_FILE || desktopApiPath;
  const env = { ...process.env };
  if (env[config.authEnv] || (env[config.keyNameEnv] && env[config.apiKeyEnv])) {
    return { env, source: "environment", fileFound: fs.existsSync(apiFilePath) };
  }
  if (!fs.existsSync(apiFilePath)) {
    return { env, source: "missing", fileFound: false };
  }

  const text = fs.readFileSync(apiFilePath, "utf8").replace(/^\uFEFF/, "").trim();
  const parsed = JungleScoutProvider.parseAuth(text);
  if (parsed.keyName && parsed.apiKey) {
    env[config.authEnv] = `${parsed.keyName}:${parsed.apiKey}`;
    return { env, source: "desktop_api_txt", fileFound: true };
  }
  if (text) {
    env[config.keyNameEnv] = process.env.JUNGLE_SCOUT_DEFAULT_KEY_NAME || "test";
    env[config.apiKeyEnv] = text;
    return { env, source: "desktop_api_txt_api_key_only", fileFound: true };
  }
  return { env, source: "invalid_api_txt", fileFound: true };
}

function candidateKey(candidate) {
  return candidate.asin ? `asin:${candidate.asin}` : `title:${String(candidate.title || "").toLowerCase()}`;
}

function mergeCandidate(existing, incoming) {
  if (!existing) return incoming;
  return {
    ...existing,
    ...incoming,
    recommendation_sources: Array.from(new Set([
      ...(existing.recommendation_sources || []),
      ...(incoming.recommendation_sources || [])
    ]))
  };
}

function persistCandidate(candidate) {
  if (!candidate || !candidate.asin) return { persisted: false };
  const current = readJsonFirst([PRODUCT_RESEARCH_CANDIDATES, LEGACY_CANDIDATES], []);
  const byKey = new Map((Array.isArray(current) ? current : []).map(item => [candidateKey(item), item]));
  const key = candidateKey(candidate);
  byKey.set(key, mergeCandidate(byKey.get(key), candidate));
  const merged = Array.from(byKey.values());
  writeJson(PRODUCT_RESEARCH_CANDIDATES, merged);
  writeJson(LEGACY_CANDIDATES, merged);
  return { persisted: true, candidate_count: merged.length };
}

function maskedStatus(config, credentialEnv) {
  const status = JungleScoutProvider.getStatus(config, credentialEnv.env);
  return {
    provider: status.provider,
    ready: status.ready,
    enabled: status.enabled,
    requestMode: status.requestMode,
    marketplace: status.marketplace,
    credential_source: credentialEnv.source,
    key_name_present: status.keyNamePresent,
    key_name_masked: status.keyNameMasked,
    api_key_present: status.apiKeyPresent,
    api_key_masked: status.apiKeyMasked,
    warnings: status.warnings
  };
}

async function queryAsin(asin) {
  const normalizedAsin = JungleScoutCandidateMapper.normalizeAsin(asin);
  if (!normalizedAsin) {
    const error = new Error("Invalid ASIN. Use a 10-character Amazon ASIN.");
    error.statusCode = 400;
    throw error;
  }

  const config = readConfig();
  const credentialEnv = readApiFileEnv(config);
  const status = JungleScoutProvider.getStatus(config, credentialEnv.env);
  if (!status.ready) {
    const error = new Error(`Jungle Scout API provider is not ready: ${status.warnings.join(" ")}`);
    error.statusCode = 503;
    error.publicDetails = maskedStatus(config, credentialEnv);
    throw error;
  }

  const apiResult = await JungleScoutProvider.searchByKeyword({
    keyword: normalizedAsin,
    config,
    env: credentialEnv.env
  });
  const importedAt = new Date().toISOString();
  const candidates = (apiResult.data || [])
    .map(record => JungleScoutCandidateMapper.mapApiRecord(record, normalizedAsin, importedAt))
    .filter(candidate => candidate.asin);
  const exact = candidates.find(candidate => candidate.asin === normalizedAsin);
  const selected = exact || candidates[0] || null;
  if (!selected) {
    const error = new Error("No Jungle Scout product record returned for this ASIN.");
    error.statusCode = 404;
    error.publicDetails = { asin: normalizedAsin, returned_count: candidates.length };
    throw error;
  }

  const persistence = persistCandidate(selected);
  const report = {
    queried_at: importedAt,
    asin: normalizedAsin,
    exact_match: Boolean(exact),
    returned_count: candidates.length,
    selected_asin: selected.asin,
    credential_source: credentialEnv.source,
    key_name_masked: status.keyNameMasked,
    api_key_present: status.apiKeyPresent,
    external_request_made: true,
    persisted: persistence.persisted,
    candidate_count: persistence.candidate_count
  };
  writeJson(API_REPORT_PATH, report);
  return {
    ok: true,
    mode: "jungle_scout_api_live",
    asin: normalizedAsin,
    exact_match: Boolean(exact),
    returned_count: candidates.length,
    candidate: selected,
    provider: {
      name: "jungle_scout",
      marketplace: config.marketplace,
      external_request_made: true,
      credential_source: credentialEnv.source
    }
  };
}

async function handleApi(request, response, url) {
  if (url.pathname === "/api/jungle-scout/status") {
    const config = readConfig();
    const credentialEnv = readApiFileEnv(config);
    sendJson(response, 200, maskedStatus(config, credentialEnv));
    return;
  }

  if (url.pathname === "/api/jungle-scout/asin") {
    try {
      const payload = await queryAsin(url.searchParams.get("asin"));
      sendJson(response, 200, payload);
    } catch (error) {
      sendJson(response, error.statusCode || error.status || 500, {
        ok: false,
        error: error.message,
        details: error.publicDetails || null
      });
    }
    return;
  }

  sendJson(response, 404, { ok: false, error: "Unknown API route." });
}

function safeStaticPath(urlPathname) {
  const decodedPath = decodeURIComponent(urlPathname);
  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
  const fullPath = path.resolve(ROOT, relativePath);
  if (!fullPath.startsWith(ROOT)) return "";
  return fullPath;
}

function serveStatic(request, response, url) {
  const fullPath = safeStaticPath(url.pathname);
  if (!fullPath) {
    sendText(response, 403, "Forbidden");
    return;
  }
  fs.stat(fullPath, (statError, stat) => {
    if (statError || !stat.isFile()) {
      sendText(response, 404, "Not found");
      return;
    }
    const ext = path.extname(fullPath).toLowerCase();
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" || ext === ".js" ? "no-store" : "public, max-age=60"
    });
    fs.createReadStream(fullPath).pipe(response);
  });
}

function start() {
  ensureDir(path.join(ROOT, "data", "product_research", "import_reports"));
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || `${HOST}:${PORT}`}`);
    if (url.pathname.startsWith("/api/")) {
      handleApi(request, response, url);
      return;
    }
    serveStatic(request, response, url);
  });

  server.listen(PORT, HOST, () => {
    console.log(`Amazon Growth Console running at http://${HOST}:${PORT}/`);
    console.log("Jungle Scout realtime ASIN endpoint: /api/jungle-scout/asin?asin=B0XXXXXXXX");
  });
}

start();
