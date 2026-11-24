import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export function integrationProjectRoot() {
  const configured = process.env.STORE_OPS_PROJECT_ROOT?.trim();
  if (configured) return path.resolve(configured);

  const cwd = process.cwd();
  const isStandalone = path.basename(cwd).toLowerCase() === "standalone"
    && path.basename(path.dirname(cwd)).toLowerCase() === ".next";
  return isStandalone ? path.resolve(cwd, "..", "..") : cwd;
}

export function automationRoot() {
  const configured = process.env.STORE_OPS_AUTOMATION_ROOT?.trim();
  return configured
    ? path.resolve(configured)
    : path.resolve(integrationProjectRoot(), "..", "..");
}

export function runtimeRoot() {
  const configured = process.env.STORE_OPS_RUNTIME_ROOT?.trim();
  return configured
    ? path.resolve(configured)
    : path.join(automationRoot(), "runtime");
}

export function dataRoot() {
  const configured = process.env.STORE_OPS_DATA_ROOT?.trim();
  if (configured) return path.resolve(configured);

  const root = automationRoot();
  const configPath = path.join(root, "config", "project.json");
  if (existsSync(configPath)) {
    try {
      const parsed = JSON.parse(readFileSync(configPath, "utf8")) as { data_root?: string };
      if (parsed.data_root) return path.resolve(root, parsed.data_root);
    } catch {
      // fall through to default parent directory
    }
  }
  return path.resolve(root, "..");
}

export function operationsDbPath() {
  const configured = process.env.STORE_OPS_STATE_DB?.trim();
  return configured
    ? path.resolve(configured)
    : path.join(runtimeRoot(), "db", "operations.sqlite3");
}
