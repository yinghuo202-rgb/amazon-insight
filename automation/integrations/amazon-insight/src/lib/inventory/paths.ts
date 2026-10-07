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

export function runtimePath(...segments: string[]) {
  return path.join(runtimeRoot(), ...segments);
}

export function sourceDataRoot(configuredFallback = "../") {
  const configured = process.env.STORE_OPS_DATA_ROOT?.trim();
  return configured
    ? path.resolve(configured)
    : path.resolve(automationRoot(), configuredFallback);
}
