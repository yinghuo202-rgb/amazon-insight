import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { automationRoot } from "@/lib/inventory/paths";
import { loadJsonReport } from "@/lib/inventory/json-report-cache";

export { automationRoot } from "@/lib/inventory/paths";

export type DocumentExportResult = {
  status: "completed";
  exportId: string;
  files: Array<{ type: "shipment" | "declaration"; filename: string; part?: number; partCount?: number }>;
};

export function documentMasterPath() {
  return path.join(automationRoot(), "runtime", "reports", "document_master.json");
}

export async function getDocumentExportMeta(market: "US" | "CA") {
  const master = await loadJsonReport<{
    templates?: { shipment?: Record<string, string> };
    logistics?: Record<string, Record<string, unknown>>;
    declarationProfiles?: Record<string, Record<string, unknown>>;
    purchaseOrderLots?: Array<{ sku?: string; availableQuantity?: number }>;
    coverage?: Record<string, unknown>;
    generatedAt?: string;
  }>(documentMasterPath());
  const template = master.templates?.shipment?.[market] ?? "";
  const batches = [...template.matchAll(/CM\s*0*(\d+)/gi)].map((match) => Number(match[1]));
  const nextBatch = (batches.length ? Math.max(...batches) : 0) + 1;
  return {
    defaultBatchNumber: `CM${String(nextBatch).padStart(3, "0")}`,
    masterGeneratedAt: master.generatedAt ?? null,
    coverage: master.coverage ?? {},
    readiness: {
      shipmentSkus: Object.keys(master.logistics?.[market] ?? {}).sort(),
      declarationSkus: Object.keys(master.declarationProfiles?.[market] ?? {}).filter((sku) =>
        (master.purchaseOrderLots ?? []).some((lot) => lot.sku === sku && Number(lot.availableQuantity ?? 0) > 0)
      ).sort(),
    },
  };
}

function pythonExecutable() {
  const configured = process.env.STORE_OPS_PYTHON?.trim();
  if (configured) return configured;

  const root = automationRoot();
  const bundledRoot = path.join(
    os.homedir(),
    ".cache",
    "codex-runtimes",
    "codex-primary-runtime",
    "dependencies",
    "python",
  );
  const candidates = process.platform === "win32"
    ? [path.join(root, ".venv", "Scripts", "python.exe"), path.join(bundledRoot, "python.exe")]
    : [path.join(root, ".venv", "bin", "python"), path.join(bundledRoot, "bin", "python3")];
  return candidates.find(existsSync) ?? (process.platform === "win32" ? "python" : "python3");
}

export async function runDocumentExport(payload: unknown): Promise<DocumentExportResult> {
  const root = automationRoot();
  const requestDirectory = path.join(root, "runtime", "work", "exports");
  await mkdir(requestDirectory, { recursive: true });
  const requestPath = path.join(requestDirectory, `${Date.now()}-${randomUUID()}.json`);
  await writeFile(requestPath, JSON.stringify(payload, null, 2), "utf8");

  const args = [
    "-m",
    "store_ops",
    "--config",
    path.join(root, "config", "project.json"),
    "export-documents",
    "--request",
    requestPath,
  ];
  let result: { code: number | null; stdout: string; stderr: string };
  try {
    result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(pythonExecutable(), args, {
        cwd: root,
        windowsHide: true,
        env: {
          ...process.env,
          PYTHONIOENCODING: "utf-8",
          PYTHONPATH: path.join(root, "src"),
        },
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("单据生成超时，请稍后重试；大批次会自动生成多个分册"));
      }, 180_000);
      child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
      child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
      child.on("error", (error) => { clearTimeout(timer); reject(error); });
      child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    });
  } finally {
    await rm(requestPath, { force: true });
  }
  if (result.code !== 0) {
    const lastLine = result.stderr.trim().split(/\r?\n/).at(-1) || "单据生成失败";
    throw new Error(lastLine.replace(/^[A-Za-z.]+Error:\s*/, ""));
  }
  return JSON.parse(result.stdout.trim()) as DocumentExportResult;
}

export function exportFilePath(exportId: string, filename: string) {
  if (!/^[0-9]{8}-[0-9]{6}-[a-f0-9]{8}$/.test(exportId) || path.basename(filename) !== filename) {
    throw new Error("无效的导出文件路径");
  }
  return path.join(automationRoot(), "runtime", "output", "exports", exportId, filename);
}
