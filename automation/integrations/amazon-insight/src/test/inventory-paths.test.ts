import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { automationRoot, runtimePath, runtimeRoot, sourceDataRoot } from "@/lib/inventory/paths";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("inventory deployment paths", () => {
  it("uses dedicated NAS mounts when configured", () => {
    vi.stubEnv("STORE_OPS_AUTOMATION_ROOT", "/opt/store-ops");
    vi.stubEnv("STORE_OPS_RUNTIME_ROOT", "/data/runtime");
    vi.stubEnv("STORE_OPS_DATA_ROOT", "/data/sources");

    expect(automationRoot()).toBe(path.resolve("/opt/store-ops"));
    expect(runtimeRoot()).toBe(path.resolve("/data/runtime"));
    expect(runtimePath("reports", "inventory_dashboard.json")).toBe(
      path.resolve("/data/runtime/reports/inventory_dashboard.json"),
    );
    expect(sourceDataRoot()).toBe(path.resolve("/data/sources"));
  });

  it("keeps local defaults relative to the automation project", () => {
    vi.stubEnv("STORE_OPS_AUTOMATION_ROOT", "/workspace/automation");
    vi.stubEnv("STORE_OPS_RUNTIME_ROOT", "");
    vi.stubEnv("STORE_OPS_DATA_ROOT", "");

    expect(runtimeRoot()).toBe(path.resolve("/workspace/automation/runtime"));
    expect(sourceDataRoot("../")).toBe(path.resolve("/workspace"));
  });
});
