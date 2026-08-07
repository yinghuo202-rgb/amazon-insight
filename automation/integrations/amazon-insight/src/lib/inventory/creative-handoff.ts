import { execFile } from "node:child_process";
import { copyFile, lstat, mkdir, readFile, symlink } from "node:fs/promises";
import path from "node:path";

import { automationRoot } from "@/lib/inventory/paths";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function creativeHandoffOutputRoot() {
  return process.env.STORE_OPS_CREATIVE_HANDOFF_OUTPUT?.trim()
    ? path.resolve(process.env.STORE_OPS_CREATIVE_HANDOFF_OUTPUT)
    : path.join(automationRoot(), "runtime", "output", "creative-handoffs");
}

function safeId(value: string) {
  if (!/^[A-Za-z0-9._+-]+$/.test(value)) throw new Error("Invalid export path");
  return value;
}

function safeFilename(value: string) {
  if (!value || value.includes("/") || value.includes("\\") || value.includes("..")) throw new Error("Invalid export filename");
  return value;
}

export function creativeHandoffFilePath(exportId: string, filename: string) {
  return path.join(creativeHandoffOutputRoot(), safeId(exportId), safeFilename(filename));
}

async function ensureArtifactRuntime() {
  const root = automationRoot();
  const workDir = path.join(root, "runtime", "artifact-work");
  await mkdir(workDir, { recursive: true });
  const nodeModulesLink = path.join(workDir, "node_modules");
  try {
    await lstat(nodeModulesLink);
  } catch {
    const configured = process.env.STORE_OPS_ARTIFACT_NODE_MODULES?.trim();
    const bundled = path.resolve(path.dirname(process.execPath), "..", "node_modules");
    await symlink(configured ? path.resolve(configured) : bundled, nodeModulesLink, "junction");
  }
  const sourceScript = path.join(root, "src", "store_ops", "js", "generate_creative_handoff.mjs");
  const runtimeScript = path.join(workDir, "generate_creative_handoff.mjs");
  await copyFile(sourceScript, runtimeScript);
  return runtimeScript;
}

async function creativeTemplatePath() {
  const root = automationRoot();
  const projectConfigPath = path.join(root, "config", "project.json");
  const project = JSON.parse(await readFile(projectConfigPath, "utf8")) as { data_root?: string; inventory_dashboard?: { creative_handoff_template?: string } };
  const projectRoot = path.dirname(path.dirname(projectConfigPath));
  const dataRoot = path.resolve(projectRoot, project.data_root || "../");
  const configured = project.inventory_dashboard?.creative_handoff_template || "归档/MC080主图美工对接表.xlsx";
  return path.resolve(dataRoot, configured);
}

export async function generateCreativeHandoff(args: { sku: string; exportId: string }) {
  const root = automationRoot();
  const runtimeScript = await ensureArtifactRuntime();
  const filename = `${args.sku}-主图+A+美工对接表.xlsx`;
  const outputPath = creativeHandoffFilePath(args.exportId, filename);
  const outputDirectory = path.dirname(outputPath);
  await mkdir(outputDirectory, { recursive: true });
  const qaPath = path.join(outputDirectory, `${args.sku}-qa.json`);
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    runtimeScript,
    "--sku", args.sku,
    "--products", path.join(root, "runtime", "reports", "product_catalog.json"),
    "--content", path.join(root, "runtime", "reports", "content_workflow.json"),
    "--variants", path.join(root, "runtime", "reports", "variant_catalog.json"),
    "--template", await creativeTemplatePath(),
    "--output", outputPath,
    "--qa", qaPath,
  ], { windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  const result = JSON.parse(lines.at(-1) || "{}") as { referenceSku?: string; family?: { parentSku?: string } | null; sheets?: string[] };
  return { filename, outputPath, referenceSku: result.referenceSku || args.sku, parentSku: result.family?.parentSku || "", sheets: result.sheets || [], stderr };
}
