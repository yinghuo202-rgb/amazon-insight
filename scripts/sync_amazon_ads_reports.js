const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const AmazonAdsProvider = require("../src/providers/amazonAdsProvider");
const { ROOT, paths, ensureCoreDirs, ensureDir, readJsonFirst, writeJson } = require("./data_paths");

const LOCAL_CONFIG = "config/amazon_ads.config.local.json";
const EXAMPLE_CONFIG = "config/amazon_ads.config.example.json";
const SECRETS_LOCAL = "config/secrets.local.json";

function parseArgs(argv) {
  const args = {};
  argv.forEach(arg => {
    if (arg === "--live") args.live = true;
    else if (arg === "--profiles") args.profiles = true;
    else if (arg === "--reports") args.reports = true;
    else if (arg === "--wait") args.wait = true;
    else if (arg === "--download") args.download = true;
    else if (arg.startsWith("--report-types=")) args.reportTypes = arg.split("=").slice(1).join("=");
    else if (arg.startsWith("--start-date=")) args.startDate = arg.split("=").slice(1).join("=");
    else if (arg.startsWith("--end-date=")) args.endDate = arg.split("=").slice(1).join("=");
  });
  return args;
}

function readJsonIfExists(relativePath, fallback = {}) {
  const fullPath = path.join(ROOT, relativePath);
  if (!fs.existsSync(fullPath)) return fallback;
  return JSON.parse(fs.readFileSync(fullPath, "utf8").replace(/^\uFEFF/, ""));
}

function readConfig(args = {}) {
  const appConfig = readJsonFirst(["config/app.config.json"], {});
  const providerConfig = fs.existsSync(path.join(ROOT, LOCAL_CONFIG))
    ? readJsonIfExists(LOCAL_CONFIG, {})
    : readJsonIfExists(EXAMPLE_CONFIG, {});
  const forceLive = Boolean(args.live || process.env.AMAZON_ADS_LIVE_SYNC === "1");
  return AmazonAdsProvider.normalizeConfig({
    ...(appConfig.amazon_ads || {}),
    ...providerConfig,
    enabled: forceLive || providerConfig.enabled === true || process.env.AMAZON_ADS_ENABLED === "true",
    requestMode: forceLive ? "api" : (process.env.AMAZON_ADS_REQUEST_MODE || providerConfig.requestMode || "disabled")
  });
}

function readCredentialEnv() {
  const secrets = readJsonIfExists(SECRETS_LOCAL, {});
  return {
    ...process.env,
    AMAZON_ADS_CLIENT_ID: process.env.AMAZON_ADS_CLIENT_ID || secrets.amazon_ads_client_id || "",
    AMAZON_ADS_CLIENT_SECRET: process.env.AMAZON_ADS_CLIENT_SECRET || secrets.amazon_ads_client_secret || "",
    AMAZON_ADS_REFRESH_TOKEN: process.env.AMAZON_ADS_REFRESH_TOKEN || secrets.amazon_ads_refresh_token || "",
    AMAZON_ADS_PROFILE_ID: process.env.AMAZON_ADS_PROFILE_ID || secrets.amazon_ads_profile_id || "",
    amazon_ads_client_id: secrets.amazon_ads_client_id || "",
    amazon_ads_client_secret: secrets.amazon_ads_client_secret || "",
    amazon_ads_refresh_token: secrets.amazon_ads_refresh_token || "",
    amazon_ads_profile_id: secrets.amazon_ads_profile_id || "",
    amazon_ads_region: process.env.AMAZON_ADS_REGION || secrets.amazon_ads_region || ""
  };
}

function timestampForFile() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function reportTypesFromArgs(args) {
  if (!args.reports && !args.reportTypes) return [];
  if (!args.reportTypes) return ["search_term_report", "keyword_report", "placement_report"];
  return args.reportTypes.split(",").map(item => item.trim()).filter(Boolean);
}

function relativeAdsRawPath(fileName) {
  return path.join("data", "ads", "raw_reports", "amazon_ads_api", fileName).replace(/\\/g, "/");
}

function parseDownloadedRows(buffer) {
  const unzipped = zlib.gunzipSync(buffer);
  const text = unzipped.toString("utf8").replace(/^\uFEFF/, "");
  const payload = JSON.parse(text);
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.rows)) return payload.rows;
  if (Array.isArray(payload.report)) return payload.report;
  return [];
}

async function waitForReport(reportId, options) {
  let latest = null;
  for (let index = 0; index < options.config.reportPollAttempts; index += 1) {
    latest = await AmazonAdsProvider.getReport({
      reportId,
      config: options.config,
      env: options.env,
      profileId: options.profileId
    });
    const status = String(latest.payload && (latest.payload.status || latest.payload.statusDetails || "")).toUpperCase();
    if (status === "COMPLETED" || latest.payload?.url) return latest;
    if (["FAILURE", "FAILED", "CANCELLED"].includes(status)) return latest;
    await new Promise(resolve => setTimeout(resolve, options.config.reportPollDelayMs));
  }
  return latest;
}

async function createReports(args, config, env) {
  const credentials = AmazonAdsProvider.readCredentials(config, env);
  const profileId = credentials.profileId;
  const created = [];

  for (const reportType of reportTypesFromArgs(args)) {
    const response = await AmazonAdsProvider.createReport({
      reportType,
      startDate: args.startDate,
      endDate: args.endDate,
      config,
      env,
      profileId
    });
    const payload = response.payload || {};
    const reportId = payload.reportId || payload.report_id || payload.id || "";
    const record = {
      report_type: reportType,
      requested_at: new Date().toISOString(),
      profile_id: profileId,
      report_id: reportId,
      request_payload: AmazonAdsProvider.reportConfig(reportType, {
        ...(args.startDate && args.endDate
          ? { startDate: args.startDate, endDate: args.endDate }
          : AmazonAdsProvider.defaultDateWindow(config.defaultReportWindowDays))
      }),
      create_response: payload,
      status_response: null,
      downloaded: false,
      file_path: ""
    };

    if (reportId && args.wait) {
      const statusResponse = await waitForReport(reportId, { config, env, profileId });
      record.status_response = statusResponse ? statusResponse.payload : null;
      const downloadUrl = record.status_response && record.status_response.url;
      if (downloadUrl && args.download) {
        const buffer = await AmazonAdsProvider.downloadReport({ url: downloadUrl });
        const rows = parseDownloadedRows(buffer);
        const fileName = `${reportType}_${profileId || "profile"}_${timestampForFile()}.json`;
        const relativePath = relativeAdsRawPath(fileName);
        writeJson(relativePath, {
          report_type: reportType,
          marketplace: config.marketplace,
          profile_id: profileId,
          start_date: args.startDate || "",
          end_date: args.endDate || "",
          imported_at: new Date().toISOString(),
          source: "amazon_ads_api",
          rows
        });
        record.downloaded = true;
        record.file_path = relativePath;
        record.row_count = rows.length;
      }
    }

    created.push(record);
  }

  return created;
}

async function main() {
  ensureCoreDirs();
  ensureDir(path.join(paths.adsRawReports, "amazon_ads_api"));
  const args = parseArgs(process.argv.slice(2));
  const config = readConfig(args);
  const env = readCredentialEnv();
  const status = AmazonAdsProvider.getStatus(config, env);

  const report = {
    generated_at: new Date().toISOString(),
    provider: "amazon_ads",
    mode: config.requestMode,
    live_requested: Boolean(args.live || process.env.AMAZON_ADS_LIVE_SYNC === "1"),
    status,
    profiles: [],
    report_requests: [],
    external_requests_made: 0,
    errors: []
  };

  if (!status.ready) {
    report.errors.push("Amazon Ads API is not ready; no external request was made.");
    writeJson("data/ads/amazon_ads_sync_latest.json", report);
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  try {
    if (args.profiles) {
      const profiles = await AmazonAdsProvider.listProfiles({ config, env });
      report.profiles = Array.isArray(profiles.payload) ? profiles.payload : (profiles.payload?.profiles || []);
      report.external_requests_made += 1;
      writeJson("data/ads/amazon_ads_profiles_latest.json", {
        imported_at: new Date().toISOString(),
        profiles: report.profiles.map(profile => ({
          profileId: String(profile.profileId || profile.profile_id || ""),
          countryCode: profile.countryCode || "",
          currencyCode: profile.currencyCode || "",
          timezone: profile.timezone || "",
          accountInfo: profile.accountInfo ? {
            type: profile.accountInfo.type || "",
            name: profile.accountInfo.name || "",
            validPaymentMethod: profile.accountInfo.validPaymentMethod ?? null
          } : null
        }))
      });
    }

    if (reportTypesFromArgs(args).length) {
      report.report_requests = await createReports(args, config, env);
      report.external_requests_made += report.report_requests.length;
    }
  } catch (error) {
    report.errors.push(error.message);
    if (error.payload) report.error_payload = error.payload;
    process.exitCode = 1;
  }

  writeJson("data/ads/amazon_ads_sync_latest.json", report);
  console.log(JSON.stringify(report, null, 2));
}

main();
