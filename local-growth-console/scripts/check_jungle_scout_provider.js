const fs = require("fs");
const path = require("path");

const JungleScoutProvider = require("../src/providers/jungleScoutProvider");
const { ROOT, readJsonFirst, writeJson } = require("./data_paths");

function readLocalConfig() {
  const localPath = path.join(ROOT, "config", "jungle_scout.config.local.json");
  if (fs.existsSync(localPath)) {
    return readJsonFirst(["config/jungle_scout.config.local.json"], {});
  }
  return readJsonFirst(["config/jungle_scout.config.example.json"], {});
}

function readAuthFileEnv(config) {
  const desktopApiPath = path.join(process.env.USERPROFILE || "", "Desktop", "api.txt");
  const apiFilePath = process.env.JUNGLE_SCOUT_API_FILE || desktopApiPath;
  if (!fs.existsSync(apiFilePath)) return process.env;
  const text = fs.readFileSync(apiFilePath, "utf8").replace(/^\uFEFF/, "").trim();
  if (!text) return process.env;
  const env = { ...process.env };
  const parsed = JungleScoutProvider.parseAuth(text);
  if (parsed.keyName && parsed.apiKey) {
    env[config.authEnv || "JUNGLE_SCOUT_AUTH"] = text;
  } else {
    env[config.apiKeyEnv || "JUNGLE_SCOUT_API_KEY"] = text;
  }
  return env;
}

function main() {
  const config = readLocalConfig();
  const env = readAuthFileEnv(config);
  const status = JungleScoutProvider.getStatus(config, env);
  const report = {
    checked_at: new Date().toISOString(),
    ...status,
    note: "Configuration check only. No external Jungle Scout API request was made."
  };

  writeJson("data/product_research/jungle_scout_provider_status.json", report);
  console.log(JSON.stringify(report, null, 2));
}

main();
