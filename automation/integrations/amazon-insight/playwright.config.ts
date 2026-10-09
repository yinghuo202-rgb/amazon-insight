import { defineConfig, devices } from "@playwright/test";
import { randomUUID } from "node:crypto";
import path from "node:path";
const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3107";
process.env.E2E_TEST_PASSWORD ||= randomUUID();
process.env.E2E_TEST_ENCRYPTION_SECRET ||= randomUUID();

export default defineConfig({
  testDir: "./src/test/e2e",
  workers: 1,
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: "node .next/standalone/server.js",
    url: baseURL,
    env: { DATABASE_URL: process.env.E2E_TEST_DATABASE_URL || "file:/private/tmp/measureman-e2e-unused.db", AUTH_SECURE_COOKIE: "false", SHARED_LOGIN_EMAIL: "", SECRET_KEY: process.env.E2E_TEST_ENCRYPTION_SECRET, NEXT_PUBLIC_APP_URL: baseURL, HOSTNAME: "127.0.0.1", PORT: new URL(baseURL).port || "3107", STORE_OPS_STATE_DB: process.env.E2E_TEST_STATE_DB || "/private/tmp/measureman-e2e-unused-operations.sqlite3", STORE_OPS_RUNTIME_ROOT: path.resolve(process.cwd(), "../../runtime"), STORE_OPS_WPS_INVENTORY_URL: "https://www.kdocs.cn/l/Example123", STORE_OPS_WPS_RESEARCH_URL: "", STORE_OPS_WPS_APP_ID: "", STORE_OPS_WPS_APP_KEY: "", STORE_OPS_WPS_INVENTORY_FILE_TOKEN: "", GERPGO_APP_ID: "", GERPGO_APP_KEY: "", GERPGO_BASE_URL: "https://open.gerpgo.com/api/open", GERPGO_SIGNING_ENABLED: "true", GERPGO_TIMEOUT_MS: "10000" },
    // Isolate writable audit state while continuing to read the report fixtures.
    // Test runs must never inherit real API credentials or contact the provider.
    reuseExistingServer: false,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], launchOptions: process.env.E2E_BROWSER_CHANNEL ? { channel: process.env.E2E_BROWSER_CHANNEL } : {} },
    },
  ],
});
