import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { publishedReportPath, withReportVersion } from "@/lib/inventory/report-version";
import { loadJsonReport } from "@/lib/inventory/json-report-cache";

describe("immutable report readers", () => {
  it("pins a generation within one read even while the pointer switches", async () => {
    const root = path.join(await mkdtemp(path.join(tmpdir(), "measureman-reports-")), "reports");
    const first = "data-20261008-120000-first", second = "data-20261008-120001-second";
    for (const [version, n] of [[first, 1], [second, 2]] as const) {
      const folder = path.join(root, ".versions", version, "reports");
      await mkdir(folder, { recursive: true });
      await writeFile(path.join(folder, "one.json"), JSON.stringify({ n }));
    }
    await writeFile(path.join(root, "current.json"), JSON.stringify({ version: first }));
    const original = path.join(root, "one.json");
    await withReportVersion(async () => {
      expect(await loadJsonReport(original)).toEqual({ n: 1 });
      await writeFile(path.join(root, "current.json"), JSON.stringify({ version: second }));
      expect(await loadJsonReport(original)).toEqual({ n: 1 });
    });
    expect(await loadJsonReport(original)).toEqual({ n: 2 });
    expect(JSON.parse(await readFile(await publishedReportPath(original), "utf8"))).toEqual({ n: 2 });
  });
  it("does not hide a malformed pointer behind legacy data", async () => {
    const root = path.join(await mkdtemp(path.join(tmpdir(), "measureman-reports-")), "reports");
    await mkdir(root);
    await writeFile(path.join(root, "current.json"), JSON.stringify({ version: "../../elsewhere" }));
    await expect(publishedReportPath(path.join(root, "one.json"))).rejects.toThrow("报告发布版本无效");
  });
});
