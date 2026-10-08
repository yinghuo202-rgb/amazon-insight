import { AsyncLocalStorage } from "node:async_hooks";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const versions = new AsyncLocalStorage<Map<string, Promise<string>>>();

export function withReportVersion<T>(operation: () => Promise<T>): Promise<T> {
  return versions.getStore() ? operation() : versions.run(new Map(), operation);
}

export async function publishedReportPath(file: string) {
  const root = path.dirname(file);
  // Explicit paths outside a reports directory retain their existing pinned behavior.
  if (path.basename(root) !== "reports") return file;
  const select = async () => {
    let content: string;
    try { content = await readFile(path.join(root, "current.json"), "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return root;
      throw error;
    }
    const pointer = JSON.parse(content) as { version?: unknown };
    if (typeof pointer.version !== "string" || !/^data-\d{8}-\d{6}-[a-zA-Z0-9-]{1,20}$/.test(pointer.version)) throw new Error("报告发布版本无效，请检查数据更新记录。");
    const directory = path.join(root, ".versions", pointer.version, "reports");
    if (!(await stat(directory)).isDirectory()) throw new Error("已发布报告版本不存在。");
    return directory;
  };
  const store = versions.getStore();
  let selected = store?.get(root);
  if (!selected) { selected = select(); store?.set(root, selected); }
  return path.join(await selected, path.basename(file));
}
