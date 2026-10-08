import { readFile, stat } from "node:fs/promises";
import { publishedReportPath } from "@/lib/inventory/report-version";

type CacheEntry = {
  signature: string;
  value: Promise<unknown>;
};

const reportCache = new Map<string, CacheEntry>();

export async function loadJsonReport<T>(filePath: string, parse: (input: unknown) => T = (input) => input as T): Promise<T> {
  filePath = await publishedReportPath(filePath);
  const metadata = await stat(filePath);
  const signature = `${metadata.mtimeMs}:${metadata.size}`;
  const cached = reportCache.get(filePath);
  if (cached?.signature === signature) return cached.value as Promise<T>;

  const value = readFile(filePath, "utf8").then((content) => parse(JSON.parse(content) as unknown));
  reportCache.set(filePath, { signature, value });
  // Immutable generations are never reused; retain a bounded set in the web process.
  while (reportCache.size > 128) reportCache.delete(reportCache.keys().next().value!);
  try {
    return await value;
  } catch (error) {
    if (reportCache.get(filePath)?.value === value) reportCache.delete(filePath);
    throw error;
  }
}

export function clearJsonReportCache(filePath?: string) {
  if (filePath) reportCache.delete(filePath);
  else reportCache.clear();
}
