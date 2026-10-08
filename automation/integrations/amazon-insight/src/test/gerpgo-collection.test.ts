import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const location = vi.hoisted(() => ({ root: "" }));
vi.mock("@/lib/inventory/paths", () => ({ runtimePath: (...parts: string[]) => path.join(location.root, ...parts) }));
import { readGerpgoCollectionSummary } from "@/lib/inventory/gerpgo-preview";
const id = "d8a4f702-f57b-4aa1-8300-9bfcb005e001";
afterEach(() => { if (location.root) rmSync(location.root, { recursive: true, force: true }); });
describe("safe collection coverage", () => {
  it("summarizes scopes and failures without returning private raw fields", async () => {
    location.root = mkdtempSync(path.join(tmpdir(), "measureman-coverage-"));
    const folder = path.join(location.root, "incoming", "gerpgo", id);
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, "manifest.json"), JSON.stringify({ taskId: id, capturedAt: "2026-10-01T00:00:00Z", secret: "private-field", sources: [
      { name: "ads-1-2026-09-01", status: "completed", pages: 2, total: 101, records: [{ private: "private-record" }] },
      { name: "ads-1-2026-09-02", status: "failed", pages: 0, total: null, error: "权限不足" },
      { name: "ads-1-2026-09-03", status: "skipped", pages: 0, total: null, error: "权限不足" },
    ] }));
    const summary = await readGerpgoCollectionSummary(id);
    expect(summary.domains).toEqual([{ name: "ads", completed: 1, failed: 1, skipped: 1, records: 101, pages: 2, errors: ["权限不足"] }]);
    expect(JSON.stringify(summary)).not.toContain("private");
    await expect(readGerpgoCollectionSummary("../escape")).rejects.toThrow();
  });
});
